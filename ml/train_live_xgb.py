#!/usr/bin/env python3
"""
Train the Aegis exploitation prior on live public feeds.

Corpus (cached under ml/.cache, refresh with --refresh):
  NVD 2.0 annual feeds 2022-2026 for CVSS vectors, CWE and references
  FIRST EPSS current scores for exploit-probability features
  CISA KEV catalog for the label: observed in-the-wild exploitation

The label and the six-factor score are excluded from the features to avoid
leakage — `kev`, `kev_x_epss` and `deterministic_score` never enter training.
Only features the browser can compute from a CVE are used, so the exported
trees score alerts without any server round-trip.

Outputs:
  src/data/xgb-model.json       compact trees + feature order + base margin
  src/data/xgb-model-card.json  metrics, params, importances, calibration, bands

Run: python3 ml/train_live_xgb.py [--refresh]
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import math
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xgboost as xgb
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import StratifiedKFold, train_test_split

SEED = 20261031
YEARS = [2022, 2023, 2024, 2025, 2026]
FEATURES = [
    "cvss",
    "epss",
    "epss_percentile",
    "epss_x_cvss",
    "attack_vector_network",
    "attack_complexity_low",
    "privileges_none",
    "user_interaction_none",
]
KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
EPSS_URL = "https://epss.cyentia.com/epss_scores-current.csv.gz"
NVD_URL = "https://nvd.nist.gov/feeds/json/cve/2.0/nvdcve-2.0-{year}.json.gz"
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "ml" / ".cache"
MODEL_OUT = ROOT / "src" / "data" / "xgb-model.json"
CARD_OUT = ROOT / "src" / "data" / "xgb-model-card.json"


def download(url: str, path: Path, refresh: bool) -> Path:
    if path.exists() and not refresh:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "Aegis Sentinel training"})
    with urllib.request.urlopen(request, timeout=180) as response, path.open("wb") as out:
        while chunk := response.read(1 << 20):
            out.write(chunk)
    return path


def load_kev(refresh: bool) -> tuple[set[str], str]:
    path = download(KEV_URL, CACHE / "kev.json", refresh)
    payload = json.loads(path.read_text(encoding="utf-8"))
    ids = {row["cveID"] for row in payload["vulnerabilities"]}
    return ids, str(payload.get("catalogVersion", "unknown"))


def load_epss(refresh: bool) -> tuple[dict[str, float], dict[str, float], str]:
    path = download(EPSS_URL, CACHE / "epss-current.csv.gz", refresh)
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        body = "".join(line for line in handle if not line.startswith("#"))
    scores: dict[str, float] = {}
    percentiles: dict[str, float] = {}
    for row in csv.DictReader(io.StringIO(body)):
        try:
            scores[row["cve"]] = float(row["epss"])
            percentiles[row["cve"]] = float(row["percentile"])
        except (KeyError, TypeError, ValueError):
            continue
    model_version = "current"
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("#model_version:"):
                model_version = line.split(":", 1)[1].split(",", 1)[0].strip()
                break
    return scores, percentiles, model_version


def vector_flags(vector: str) -> tuple[int, int, int, int]:
    parts = set(vector.split("/"))
    network = int("AV:N" in parts)
    low_complexity = int("AC:L" in parts)
    no_privileges = int("PR:N" in parts or "Au:N" in parts)
    no_interaction = int("UI:N" in parts)
    return network, low_complexity, no_privileges, no_interaction


def pick_metric(metrics: dict) -> dict | None:
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        entries = metrics.get(key) or []
        for entry in entries:
            if entry.get("type") == "Primary" and entry.get("cvssData"):
                return entry["cvssData"]
        if entries and entries[0].get("cvssData"):
            return entries[0]["cvssData"]
    return None


def load_nvd(refresh: bool, kev: set[str], epss: dict[str, float], percentiles: dict[str, float]):
    rows: list[list[float]] = []
    labels: list[int] = []
    positives = 0
    for year in YEARS:
        path = download(NVD_URL.format(year=year), CACHE / f"nvdcve-2.0-{year}.json.gz", refresh)
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            payload = json.load(handle)
        print(f"  {year}: {len(payload['vulnerabilities']):,} NVD records")
        for item in payload["vulnerabilities"]:
            cve = item.get("cve") or {}
            cve_id = cve.get("id")
            if not cve_id or cve_id not in epss:
                continue
            data = pick_metric(cve.get("metrics") or {})
            if not data:
                continue
            cvss = data.get("baseScore")
            if not isinstance(cvss, (int, float)):
                continue
            vector = data.get("vectorString") or ""
            network, low_complexity, no_privileges, no_interaction = vector_flags(vector)
            score = float(epss[cve_id])
            percentile = float(percentiles.get(cve_id, 0.0))
            rows.append(
                [
                    float(cvss),
                    score,
                    percentile,
                    score * float(cvss),
                    float(network),
                    float(low_complexity),
                    float(no_privileges),
                    float(no_interaction),
                ]
            )
            label = int(cve_id in kev)
            labels.append(label)
            positives += label
    X = np.asarray(rows, dtype=np.float32)
    y = np.asarray(labels, dtype=np.int32)
    print(f"corpus: {len(X):,} rows · {positives:,} KEV positives ({y.mean() * 100:.2f}%)")
    if 0 in (positives, len(y) - positives):
        raise SystemExit("corpus must contain both KEV and non-KEV rows")
    return X, y


def choose_bands(probabilities: np.ndarray) -> dict[str, float]:
    elevated = float(np.quantile(probabilities, 0.99))
    watch = float(np.quantile(probabilities, 0.95))
    if watch >= elevated:
        watch = elevated / 2
    return {"elevated": round(elevated, 4), "watch": round(watch, 4)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="re-download feeds instead of using ml/.cache")
    args = parser.parse_args()

    print("fetching live feeds")
    kev, kev_version = load_kev(args.refresh)
    epss, percentiles, epss_version = load_epss(args.refresh)
    print(f"  KEV {len(kev):,} entries · catalog {kev_version}")
    print(f"  EPSS {len(epss):,} scores · model {epss_version}")
    X, y = load_nvd(args.refresh, kev, epss, percentiles)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.18, stratify=y, random_state=SEED)
    X_fit, X_valid, y_fit, y_valid = train_test_split(
        X_train, y_train, test_size=0.18, stratify=y_train, random_state=SEED + 1
    )
    X_search, _, y_search, _ = train_test_split(
        X_fit, y_fit, train_size=0.5, stratify=y_fit, random_state=SEED + 2
    )
    print(f"  search sample {len(X_search):,} rows · {int(y_search.sum()):,} positives")

    dsearch = xgb.DMatrix(X_search, label=y_search, feature_names=FEATURES)
    dvalid = xgb.DMatrix(X_valid, label=y_valid, feature_names=FEATURES)
    dfull = xgb.DMatrix(X_train, label=y_train, feature_names=FEATURES)
    dtest = xgb.DMatrix(X_test, label=y_test, feature_names=FEATURES)

    base_params = {
        "objective": "binary:logistic",
        "eval_metric": ["auc", "logloss"],
        "tree_method": "hist",
        "seed": SEED,
        "nthread": 6,
    }
    grid = [
        {"max_depth": 4, "eta": 0.06, "subsample": 0.9, "colsample_bytree": 0.9, "min_child_weight": 2},
        {"max_depth": 5, "eta": 0.05, "subsample": 0.9, "colsample_bytree": 0.9, "min_child_weight": 3},
        {"max_depth": 6, "eta": 0.04, "subsample": 0.88, "colsample_bytree": 0.85, "min_child_weight": 4},
        {"max_depth": 7, "eta": 0.035, "subsample": 0.85, "colsample_bytree": 0.8, "min_child_weight": 5},
        {"max_depth": 5, "eta": 0.045, "subsample": 0.88, "colsample_bytree": 0.9, "min_child_weight": 3, "gamma": 0.1},
    ]

    print(f"hyperparameter search: {len(grid)} configs × 3-fold CV")
    best = None
    for i, config in enumerate(grid, 1):
        params = {**base_params, **config}
        cv = xgb.cv(
            params,
            dsearch,
            num_boost_round=600,
            nfold=3,
            stratified=True,
            early_stopping_rounds=60,
            seed=SEED + i,
            verbose_eval=False,
        )
        auc = float(cv["test-auc-mean"].iloc[-1])
        rounds = len(cv)
        print(f"  config {i}: depth {config['max_depth']} · eta {config['eta']} · AUC {auc:.4f} · {rounds} rounds")
        if best is None or auc > best["auc"]:
            best = {"config": config, "auc": auc, "rounds": rounds}

    params = {**base_params, **best["config"]}
    print(f"selected: {json.dumps(best['config'])}")

    print("final 5-fold CV with early stopping")
    cv = xgb.cv(
        params,
        dfull,
        num_boost_round=2400,
        nfold=5,
        stratified=True,
        early_stopping_rounds=100,
        seed=SEED + 11,
        verbose_eval=False,
    )
    cv_auc = float(cv["test-auc-mean"].iloc[-1])
    cv_logloss = float(cv["test-logloss-mean"].iloc[-1])
    cv_rounds = len(cv)
    print(f"  CV AUC {cv_auc:.4f} · logloss {cv_logloss:.4f} · best iteration {cv_rounds}")

    booster = xgb.train(
        params,
        dfull,
        num_boost_round=cv_rounds,
        evals=[(dvalid, "valid")],
        verbose_eval=False,
    )

    prob_test = booster.predict(dtest)
    test_auc = float(roc_auc_score(y_test, prob_test))
    test_logloss = float(log_loss(y_test, prob_test))
    test_brier = float(brier_score_loss(y_test, prob_test))
    print(f"test AUC {test_auc:.4f} · logloss {test_logloss:.4f} · Brier {test_brier:.4f}")

    order = np.argsort(prob_test)
    calibration = []
    for i, idx in enumerate(np.array_split(order, 10)):
        lo, hi = i * 10, (i + 1) * 10
        calibration.append(
            {
                "bin": f"{lo}-{hi}%",
                "predicted": round(float(prob_test[idx].mean()) * 100, 1),
                "observed": round(float(y_test[idx].mean()) * 100, 1),
                "count": int(len(idx)),
            }
        )

    bands = choose_bands(prob_test)
    print(f"bands: elevated ≥ {bands['elevated'] * 100:.2f}% · watch ≥ {bands['watch'] * 100:.2f}%")

    gain = booster.get_score(importance_type="gain")
    total_gain = sum(gain.values()) or 1.0
    importance = sorted(
        (
            {
                "feature": name,
                "gain": round(float(gain.get(name, 0.0)), 2),
                "share": round(float(gain.get(name, 0.0)) / total_gain * 100, 1),
            }
            for name in FEATURES
        ),
        key=lambda row: row["gain"],
        reverse=True,
    )

    raw = json.loads(booster.save_raw(raw_format="json"))
    model = raw["learner"]["gradient_booster"]["model"]
    base_score = float(raw["learner"]["learner_model_param"]["base_score"].strip("[]"))
    base_margin = math.log(base_score / (1.0 - base_score))

    trees = []
    for tree in model["trees"]:
        nodes = []
        for i, left in enumerate(tree["left_children"]):
            if left == -1:
                nodes.append([-1, 0.0, 0, 0, 0, round(float(tree["base_weights"][i]), 8)])
            else:
                nodes.append(
                    [
                        int(tree["split_indices"][i]),
                        round(float(tree["split_conditions"][i]), 8),
                        int(left),
                        int(tree["right_children"][i]),
                        int(tree["default_left"][i]),
                        0.0,
                    ]
                )
        trees.append(nodes)

    runtime = {
        "format": "aegis-xgb-runtime-1",
        "version": "xgb-live-2.0.0",
        "objective": "binary:logistic",
        "features": FEATURES,
        "baseMargin": round(base_margin, 8),
        "rounds": len(trees),
        "trees": trees,
    }
    MODEL_OUT.write_text(json.dumps(runtime, separators=(",", ":")), encoding="utf-8")

    card = {
        "name": "Aegis XGBoost live exploit prior",
        "version": "xgb-live-2.0.0",
        "objective": "binary:logistic",
        "target": "CISA KEV membership (observed in-the-wild exploitation)",
        "trainedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataset": {
            "rows": int(len(X)),
            "trainRows": int(len(X_train)),
            "testRows": int(len(X_test)),
            "positiveRate": round(float(y.mean()) * 100, 2),
            "source": f"Live CISA KEV {kev_version} · FIRST EPSS {epss_version} · NVD 2.0 {YEARS[0]}–{YEARS[-1]}",
        },
        "feeds": {
            "kevCatalog": kev_version,
            "epssModel": epss_version,
            "nvdYears": f"{YEARS[0]}–{YEARS[-1]}",
            "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "params": {
            "maxDepth": best["config"]["max_depth"],
            "eta": best["config"]["eta"],
            "subsample": best["config"]["subsample"],
            "colsampleByTree": best["config"]["colsample_bytree"],
            "minChildWeight": best["config"]["min_child_weight"],
            "gamma": best["config"].get("gamma", 0),
            "earlyStoppingRounds": 100,
        },
        "rounds": len(trees),
        "search": {"configs": len(grid), "cvFolds": 3, "bestSearchAuc": round(best["auc"], 4)},
        "cv": {"folds": 5, "auc": round(cv_auc, 4), "logloss": round(cv_logloss, 4), "bestIteration": cv_rounds},
        "test": {
            "auc": round(test_auc, 4),
            "logloss": round(test_logloss, 4),
            "brier": round(test_brier, 4),
        },
        "calibration": calibration,
        "bands": bands,
        "featureImportance": importance,
        "disclaimer": (
            "Retrospective prior trained on live NVD, EPSS and KEV snapshots. EPSS already reflects "
            "observed exploitation, so metrics are optimistic for forward prediction. The label and the "
            "six-factor score are excluded from training."
        ),
    }
    CARD_OUT.write_text(json.dumps(card, indent=2), encoding="utf-8")

    def manual(x):
        margin = base_margin
        for nodes in trees:
            node = 0
            while nodes[node][0] != -1:
                feature, threshold, left, right, default_left, _ = nodes[node]
                node = left if x[feature] < threshold else right
            margin += nodes[node][5]
        return 1.0 / (1.0 + math.exp(-margin))

    sample = X_test[:300]
    diffs = [abs(manual(row) - float(p)) for row, p in zip(sample, prob_test[:300])]
    max_diff = max(diffs)
    print(f"export parity: max |manual - xgb| = {max_diff:.3e}")
    if max_diff > 1e-5:
        print("export parity check failed", file=sys.stderr)
        return 1

    print(f"wrote {MODEL_OUT.relative_to(ROOT)} ({MODEL_OUT.stat().st_size / 1024:.1f} KB)")
    print(f"wrote {CARD_OUT.relative_to(ROOT)}")
    print("top features: " + ", ".join(f"{f['feature']} {f['share']}%" for f in importance[:5]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
