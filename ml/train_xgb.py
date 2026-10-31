#!/usr/bin/env python3
"""
Train the Aegis XGBoost exploitation-prior model and export browser-ready trees.

The demo workspace only has 15 correlation candidates, so training on those
would not be meaningful. This script generates a larger synthetic corpus with
the same feature ranges and label logic as the demo, then trains a real
gradient-boosted model with hyperparameter search, 5-fold CV and early stopping.

Outputs:
  src/data/xgb-model.json       compact trees + feature order + base margin
  src/data/xgb-model-card.json  metrics, params, importances, calibration

Run: npm run train:model
"""

from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xgboost as xgb
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import StratifiedKFold, train_test_split

SEED = 20261031
N_ROWS = 120_000
FEATURES = [
    "cvss",
    "epss",
    "kev",
    "internet_facing",
    "asset_criticality",
    "age_days",
    "confidence",
    "version_verified",
    "deterministic_score",
    "patch_available",
    "epss_x_cvss",
    "kev_x_epss",
    "exposure_index",
]
ROOT = Path(__file__).resolve().parent.parent
MODEL_OUT = ROOT / "src" / "data" / "xgb-model.json"
CARD_OUT = ROOT / "src" / "data" / "xgb-model-card.json"


def sigmoid(z: np.ndarray | float):
    return 1.0 / (1.0 + np.exp(-z))


def generate_corpus(rng: np.random.Generator, n: int):
    cvss = np.clip(rng.normal(7.4, 1.9, n), 0.1, 10.0)
    epss = np.where(
        rng.random(n) < 0.62,
        np.clip(rng.beta(0.55, 4.2, n), 0.0002, 0.99),
        np.clip(rng.beta(2.2, 2.0, n), 0.0002, 0.99),
    )
    kev = rng.binomial(1, sigmoid(-2.45 + 2.6 * epss + 0.25 * (cvss - 7.0)))
    criticality = rng.choice([3, 2, 1], size=n, p=[0.47, 0.38, 0.15])
    internet = rng.binomial(1, np.where(criticality == 3, 0.5, 0.33))
    age_days = np.clip(rng.gamma(1.7, 24.0, n), 0.1, 365.0)
    confidence = rng.choice([1.0, 0.65, 0.3], size=n, p=[0.62, 0.26, 0.12])
    version_verified = rng.binomial(1, np.clip(0.68 + 0.22 * confidence, 0, 1))
    patch_available = rng.binomial(1, 0.85, n)

    crit_points = np.select([criticality == 3, criticality == 2], [25.0, 15.0], default=5.0)
    deterministic = np.minimum(
        100.0,
        (cvss / 10.0) * 25.0
        + epss * 25.0
        + kev * 10.0
        + crit_points
        + internet * 5.0
        + np.where(version_verified == 1, 10.0, 5.0),
    )

    z = (
        -6.15
        + 2.15 * (epss - 0.25)
        + 1.65 * kev
        + 0.5 * (cvss / 10.0)
        + 0.95 * internet
        + 0.4 * ((criticality - 1) / 2.0)
        + 0.4 * confidence
        + 0.7 * version_verified
        + 0.25 * np.minimum(age_days, 180.0) / 180.0
        + 1.05 * kev * epss
        + 0.65 * internet * epss
        + 0.3 * (deterministic / 100.0)
        + rng.normal(0.0, 0.72, n)
    )
    y = rng.binomial(1, sigmoid(z))

    X = np.column_stack(
        [
            cvss,
            epss,
            kev,
            internet,
            criticality,
            age_days,
            confidence,
            version_verified,
            deterministic,
            patch_available,
            epss * cvss,
            kev * epss,
            internet * (criticality / 3.0),
        ]
    ).astype(np.float32)
    return X, y.astype(np.int32)


def main() -> int:
    rng = np.random.default_rng(SEED)
    X, y = generate_corpus(rng, N_ROWS)
    print(f"corpus: {len(X):,} rows · positive rate {y.mean():.3f}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.18, stratify=y, random_state=SEED
    )
    X_fit, X_valid, y_fit, y_valid = train_test_split(
        X_train, y_train, test_size=0.18, stratify=y_train, random_state=SEED + 1
    )

    dtrain = xgb.DMatrix(X_fit, label=y_fit, feature_names=FEATURES)
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
        {"max_depth": 5, "eta": 0.05, "subsample": 0.9, "colsample_bytree": 0.85, "min_child_weight": 2},
        {"max_depth": 6, "eta": 0.04, "subsample": 0.9, "colsample_bytree": 0.85, "min_child_weight": 3},
        {"max_depth": 6, "eta": 0.07, "subsample": 0.95, "colsample_bytree": 0.95, "min_child_weight": 1},
        {"max_depth": 7, "eta": 0.035, "subsample": 0.85, "colsample_bytree": 0.8, "min_child_weight": 4},
        {"max_depth": 8, "eta": 0.03, "subsample": 0.8, "colsample_bytree": 0.8, "min_child_weight": 5},
        {"max_depth": 5, "eta": 0.045, "subsample": 0.88, "colsample_bytree": 0.9, "min_child_weight": 3, "gamma": 0.1},
        {"max_depth": 6, "eta": 0.05, "subsample": 0.92, "colsample_bytree": 0.88, "min_child_weight": 2, "lambda": 1.5},
        {"max_depth": 7, "eta": 0.05, "subsample": 0.9, "colsample_bytree": 0.9, "min_child_weight": 2, "alpha": 0.15},
    ]

    print(f"hyperparameter search: {len(grid)} configs × 4-fold CV")
    best = None
    for i, config in enumerate(grid, 1):
        params = {**base_params, **config}
        cv = xgb.cv(
            params,
            dtrain,
            num_boost_round=900,
            nfold=4,
            stratified=True,
            early_stopping_rounds=45,
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

    # Calibration by decile of predicted probability.
    order = np.argsort(prob_test)
    bins = np.array_split(order, 10)
    calibration = []
    for i, idx in enumerate(bins):
        lo, hi = i * 10, (i + 1) * 10
        calibration.append(
            {
                "bin": f"{lo}-{hi}%",
                "predicted": round(float(prob_test[idx].mean()) * 100, 1),
                "observed": round(float(y_test[idx].mean()) * 100, 1),
                "count": int(len(idx)),
            }
        )

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
        "version": "xgb-1.0.0",
        "objective": "binary:logistic",
        "features": FEATURES,
        "baseMargin": round(base_margin, 8),
        "rounds": len(trees),
        "trees": trees,
    }
    MODEL_OUT.write_text(json.dumps(runtime, separators=(",", ":")), encoding="utf-8")

    card = {
        "name": "Aegis XGBoost exploit prior",
        "version": "xgb-1.0.0",
        "objective": "binary:logistic",
        "target": "30-day exploitation probability",
        "trainedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataset": {
            "rows": N_ROWS,
            "trainRows": int(len(X_train)),
            "testRows": int(len(X_test)),
            "positiveRate": round(float(y.mean()) * 100, 1),
            "source": "Synthetic correlation corpus calibrated to demo seed ranges",
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
        "search": {
            "configs": len(grid),
            "cvFolds": 4,
            "bestSearchAuc": round(best["auc"], 4),
        },
        "cv": {"folds": 5, "auc": round(cv_auc, 4), "logloss": round(cv_logloss, 4), "bestIteration": cv_rounds},
        "test": {
            "auc": round(test_auc, 4),
            "logloss": round(test_logloss, 4),
            "brier": round(test_brier, 4),
        },
        "calibration": calibration,
        "featureImportance": importance,
        "disclaimer": "Demo model trained on synthetic telemetry. Useful for showing model wiring, not validated for production triage.",
    }
    CARD_OUT.write_text(json.dumps(card, indent=2), encoding="utf-8")

    # Prove the compact export matches XGBoost itself.
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
