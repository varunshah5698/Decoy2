#!/usr/bin/env python3
"""
Build the offline NVD corpus that Aegis uses to correlate an uploaded inventory.

The browser cannot ask NVD for thousands of CPE matches, so this script does the
join offline, from the feeds already cached under ml/.cache:

  NVD 2.0 annual feeds 2022-2026  -> CVSS, CWE, description, affected version ranges
  FIRST EPSS current scores       -> exploitation probability
  CISA KEV catalog                -> known-exploited flag and remediation due date

Only the products that a real inventory can declare are kept, so the emitted file
stays small enough to ship in the bundle. Run:

  python3 ml/build_vuln_corpus.py                     # cached feeds
  python3 ml/build_vuln_corpus.py --refresh           # re-download feeds first
  python3 ml/build_vuln_corpus.py --cpe-file a.csv    # add products from an inventory export
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]
PER_PRODUCT_CAP = 30
MAX_RANGES_PER_CVE = 8
DESCRIPTION_CHARS = 320
MAX_REFS = 3
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "ml" / ".cache"
OUT = ROOT / "src" / "data" / "vuln-corpus.json"

KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
EPSS_URL = "https://epss.cyentia.com/epss_scores-current.csv.gz"
NVD_URL = "https://nvd.nist.gov/feeds/json/cve/2.0/nvdcve-2.0-{year}.json.gz"

# Products the demo estate and the shipped inventory exports can declare. A product
# is matched as vendor:product from the CPE URI, so the same package under a second
# vendor slug (f5:nginx and nginx:nginx) needs both keys listed here.
SEED_PRODUCTS = [
    "apache:log4j",
    "apache:struts",
    "f5:nginx",
    "openbsd:openssh",
    "microsoft:exchange_server",
    "microsoft:windows_server",
    "microsoft:windows",
    "microsoft:outlook",
    "vmware:spring_framework",
    "progress:moveit_transfer",
    "citrix:netscaler_adc",
    "tukaani:xz",
    "paloaltonetworks:pan-os",
    "google:chrome",
    "ixsystems:truenas",
    "postgresql:postgresql",
    "jenkins:jenkins",
    "fortinet:fortios",
    "postfix:postfix",
    "synology:dsm",
    "hpe:ilo",
    "oracle:database",
    "mysql:mysql",
    "redis:redis",
    "elastic:elasticsearch",
    "hashicorp:vault",
    "gitlab:gitlab",
    "sonarsource:sonarqube",
    "hp:printer_driver",
    "sophos:firewall_platform_group_sg",
    "mitik:ismg",
    "sonicwall:sonosw",
    "zohocorp:manageengine_adselfservice_plus",
    "apache:tomcat",
    "atlassian:confluence_server",
    "d-link:dgs",
]

# Loose product aliases so an inventory that spells the package differently still
# reaches the corpus. Key is the CPE product slug, value the display name.
PRODUCT_DISPLAY = {
    "apache:log4j": ("Apache", "Log4j"),
    "apache:struts": ("Apache", "Struts"),
    "f5:nginx": ("NGINX", "nginx"),
    "openbsd:openssh": ("OpenBSD", "OpenSSH"),
    "microsoft:exchange_server": ("Microsoft", "Exchange Server"),
    "microsoft:windows_server": ("Microsoft", "Windows Server"),
    "microsoft:windows": ("Microsoft", "Windows"),
    "microsoft:outlook": ("Microsoft", "Outlook"),
    "vmware:spring_framework": ("VMware", "Spring Framework"),
    "progress:moveit_transfer": ("Progress", "MOVEit Transfer"),
    "citrix:netscaler_adc": ("Citrix", "NetScaler ADC"),
    "tukaani:xz": ("Tukaani", "XZ Utils"),
    "paloaltonetworks:pan-os": ("Palo Alto Networks", "PAN-OS"),
    "google:chrome": ("Google", "Chrome"),
    "ixsystems:truenas": ("iXsystems", "TrueNAS"),
    "postgresql:postgresql": ("PostgreSQL", "PostgreSQL"),
    "jenkins:jenkins": ("Jenkins", "Jenkins"),
    "fortinet:fortios": ("Fortinet", "FortiOS"),
    "postfix:postfix": ("Postfix", "Postfix"),
    "synology:dsm": ("Synology", "DSM"),
    "hpe:ilo": ("HPE", "iLO"),
    "oracle:database": ("Oracle", "Database"),
    "mysql:mysql": ("Oracle", "MySQL"),
    "redis:redis": ("Redis", "Redis"),
    "elastic:elasticsearch": ("Elastic", "Elasticsearch"),
    "hashicorp:vault": ("HashiCorp", "Vault"),
    "gitlab:gitlab": ("GitLab", "GitLab"),
    "sonarsource:sonarqube": ("SonarSource", "SonarQube"),
    "hp:printer_driver": ("HP", "Printer Driver"),
    "hpe:smh": ("HPE", "Systems Management Home"),
    "sophos:firewall": ("Sophos", "Firewall Platform Group"),
    "sophos:firewall_platform_group_sg": ("Sophos", "Firewall Platform Group SG"),
    "mitik:ismg": ("MITIK", "ISG"),
    "d-link:dgs": ("D-Link", "DGS Switch"),
    "zohocorp:manageengine_adselfservice_plus": ("Zoho", "ManageEngine ADSelfService Plus"),
    "sonicwall:sonosw": ("SonicWall", "SonicOS"),
    "zimbra:zimbra_collaboration": ("Zimbra", "Collaboration"),
    "apache:activemq": ("Apache", "ActiveMQ"),
    "apache:tomcat": ("Apache", "Tomcat"),
    "confluence:confluence_server": ("Atlassian", "Confluence"),
    "atlassian:confluence_server": ("Atlassian", "Confluence"),
}

CPE_PARTS = re.compile(r"^(?:cpe:/(?P<binding22>[a-z])|cpe:(?P<version_token>[^:]*):(?P<part>[a-z_o]):(?P<vendor>[^:]*):(?P<product>[^:]*):(?P<release>[^:]*))")


def download(url: str, path: Path, refresh: bool) -> Path:
    if path.exists() and not refresh:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    time.sleep(6)  # NVD asks for a small delay between feed pulls
    request = urllib.request.Request(url, headers={"User-Agent": "Aegis Sentinel corpus build"})
    with urllib.request.urlopen(request, timeout=300) as response, path.open("wb") as out:
        while chunk := response.read(1 << 20):
            out.write(chunk)
    return path


def parse_cpe(criteria: str) -> tuple[str, str, str, str] | None:
    """Return (part, vendor, product, version) for a cpe:2.3: or cpe:/ binding."""
    match = CPE_PARTS.match(criteria.strip().lower())
    if not match:
        return None
    if match.group("binding22"):
        rest = criteria.strip().lower().split(":")[1:]
        part, vendor, product, release = (rest + ["", "", "", ""])[:4]
        part = part.lstrip("/")
    else:
        part, vendor, product, release = (
            match.group("part"),
            match.group("vendor"),
            match.group("product"),
            match.group("release"),
        )
    if not vendor or not product:
        return None
    return part, vendor, product, release


def load_kev(refresh: bool) -> tuple[dict[str, dict], str]:
    path = download(KEV_URL, CACHE / "kev.json", refresh)
    payload = json.loads(path.read_text(encoding="utf-8"))
    entries = {
        row["cveID"]: {
            "due": row.get("dueDate"),
            "name": row.get("vulnerabilityName"),
            "ransomware": row.get("knownRansomwareCampaignUse") == "Known",
        }
        for row in payload.get("vulnerabilities", [])
    }
    return entries, str(payload.get("catalogVersion", "unknown"))


def load_epss(refresh: bool) -> tuple[dict[str, tuple[float, float]], str]:
    path = download(EPSS_URL, CACHE / "epss-current.csv.gz", refresh)
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        body = "".join(line for line in handle if not line.startswith("#"))
    scores: dict[str, tuple[float, float]] = {}
    for row in csv.DictReader(io.StringIO(body)):
        try:
            scores[row["cve"]] = (float(row["epss"]), float(row["percentile"]))
        except (KeyError, TypeError, ValueError):
            continue
    version = "current"
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("#model_version:"):
                version = line.split(":", 1)[1].split(",", 1)[0].strip()
                break
    return scores, version


def pick_metric(metrics: dict) -> dict | None:
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        entries = metrics.get(key) or []
        primary = next((e for e in entries if e.get("type") == "Primary" and e.get("cvssData")), None)
        if primary:
            return primary["cvssData"]
        if entries and entries[0].get("cvssData"):
            return entries[0]["cvssData"]
    return None


def ranges_for(cve: dict, product_key: str) -> list[dict]:
    """Affected version ranges declared for one vendor:product in this record."""
    vendor, product = product_key.split(":", 1)
    found: list[dict] = []

    def scan(node: dict) -> None:
        for entry in node.get("cpeMatch") or []:
            if not entry.get("vulnerable"):
                continue
            parsed = parse_cpe(entry.get("criteria", ""))
            if not parsed:
                continue
            _, cpe_vendor, cpe_product, cpe_version = parsed
            if cpe_vendor != vendor or cpe_product != product:
                continue
            rng = {}
            for src, dst in (
                ("versionStartIncluding", "si"),
                ("versionStartExcluding", "se"),
                ("versionEndIncluding", "ei"),
                ("versionEndExcluding", "ee"),
            ):
                if entry.get(src):
                    rng[dst] = entry[src]
            if not rng and cpe_version not in ("", "*", "-", "n/a"):
                rng = {"si": cpe_version, "ei": cpe_version}
            if rng:
                found.append(rng)
        for child in node.get("children") or []:
            scan(child)

    for config in cve.get("configurations") or []:
        for node in config.get("nodes") or []:
            scan(node)
    return found


def version_key(value: str) -> tuple:
    tokens = re.findall(r"\d+|[a-z]+", value.lower())
    return tuple((0, int(t)) if t.isdigit() else (1, t) for t in tokens)


def dedupe_ranges(ranges: list[dict]) -> list[dict]:
    seen: dict[tuple, dict] = {}
    for rng in ranges:
        signature = tuple((key, rng.get(key)) for key in ("si", "se", "ei", "ee"))
        seen.setdefault(signature, rng)
    ordered = sorted(seen.values(), key=lambda r: version_key(r.get("si") or r.get("se") or "0"))
    if len(ordered) > MAX_RANGES_PER_CVE:
        # keep the envelope plus the highest bands so a wide range set stays readable
        ordered = [ordered[0], *ordered[-(MAX_RANGES_PER_CVE - 1):]]
    return ordered


def fix_version_for(ranges: list[dict]) -> str:
    """NVD does not publish a fix field; the upper bound of the affected range is the
    first version the advisory considers safe."""
    ends = [r["ee"] for r in ranges if r.get("ee")]
    if ends:
        return f"{max(ends, key=version_key)} or later"
    ends = [r["ei"] for r in ranges if r.get("ei")]
    if ends:
        return f"later than {max(ends, key=version_key)}"
    return "vendor security update"


def describe(cve: dict) -> str:
    for entry in cve.get("descriptions") or []:
        if entry.get("lang") == "en":
            text = " ".join((entry.get("value") or "").split())
            return text[:DESCRIPTION_CHARS]
    return ""


def refs_for(cve: dict) -> list[dict]:
    out = []
    for reference in (cve.get("references") or [])[:24]:
        url = reference.get("url", "")
        if not url.startswith("http"):
            continue
        host = re.sub(r"^www\.", "", url.split("/")[2]) if len(url.split("/")) > 2 else ""
        source = "NVD" if "nvd.nist.gov" in host else "CISA" if "cisa.gov" in host else host or "Reference"
        if any(item["url"] == url for item in out):
            continue
        out.append({"url": url, "source": source})
        if len(out) >= MAX_REFS:
            break
    return out


def iter_nvd(path: Path):
    """Stream the vulnerabilities array without materialising every record."""
    text = gzip.open(path, "rt", encoding="utf-8").read()
    start = text.index('"vulnerabilities"')
    start = text.index("[", start)
    decoder = json.JSONDecoder()
    index = start + 1
    while index < len(text):
        while index < len(text) and text[index] in " \t\r\n,":
            index += 1
        if index >= len(text) or text[index] == "]":
            return
        record, index = decoder.raw_decode(text, index)
        yield record


def seed_cve_ids() -> set[str]:
    text = (ROOT / "src" / "data" / "seed.ts").read_text(encoding="utf-8")
    return set(re.findall(r"id: '(CVE-[0-9]{4}-[0-9]+)'", text))


def build(products: list[str], refresh: bool, cap: int = PER_PRODUCT_CAP) -> dict:
    print("loading KEV + EPSS")
    kev, kev_version = load_kev(refresh)
    epss, epss_version = load_epss(refresh)
    print(f"  KEV {len(kev):,} entries ({kev_version}) · EPSS {len(epss):,} scores ({epss_version})")

    wanted = set(products)
    curated = seed_cve_ids()
    print(f"  skipping {len(curated)} CVE ids already curated in seed.ts")
    hits: dict[str, dict[str, dict]] = {key: {} for key in wanted}
    for year in YEARS:
        path = CACHE / f"nvdcve-2.0-{year}.json.gz"
        if not path.exists():
            download(NVD_URL.format(year=year), path, refresh)
        seen = 0
        matched = 0
        for item in iter_nvd(path):
            cve = item.get("cve") or {}
            cve_id = cve.get("id")
            seen += 1
            if not cve_id or cve_id in curated:
                continue
            metric = pick_metric(cve.get("metrics") or {})
            if not metric or not isinstance(metric.get("baseScore"), (int, float)):
                continue
            for product_key in wanted:
                ranges = ranges_for(cve, product_key)
                if not ranges:
                    continue
                ranges = dedupe_ranges(ranges)
                matched += 1
                vendor, product = product_key.split(":", 1)
                display_vendor, display_product = PRODUCT_DISPLAY.get(product_key, (vendor, product))
                score, percentile = epss.get(cve_id, (None, None))
                kev_entry = kev.get(cve_id)
                hits[product_key][cve_id] = {
                    "id": cve_id,
                    "vendor": display_vendor,
                    "product": display_product,
                    "cvss": round(float(metric["baseScore"]), 1),
                    "vector": metric.get("vectorString", ""),
                    "severity": metric.get("baseSeverity") or "",
                    "cwe": sorted(
                        {
                            value.get("value")
                            for weakness in (cve.get("weaknesses") or [])
                            for value in (weakness.get("description") or [])
                            if re.fullmatch(r"CWE-\d+", value.get("value", ""))
                        }
                    ),
                    "epss": score,
                    "epssPercentile": percentile,
                    "kev": bool(kev_entry),
                    "kevDue": kev_entry.get("due") if kev_entry else None,
                    "published": (cve.get("published") or "")[:10],
                    "modified": (cve.get("lastModified") or "")[:10],
                    "description": describe(cve),
                    "fix": fix_version_for(ranges),
                    "ranges": ranges[:MAX_RANGES_PER_CVE],
                    "refs": refs_for(cve),
                }
        print(f"  {year}: {seen:,} NVD records scanned · {matched:,} product hits")

    products_out = {}
    total = 0
    for key, records in hits.items():
        if not records:
            continue
        ranked = sorted(
            records.values(),
            key=lambda r: (r["kev"], (r["cvss"] or 0) * (r["epss"] or 0.001) + (r["cvss"] or 0) / 20),
            reverse=True,
        )[:PER_PRODUCT_CAP]
        vendor, product = key.split(":", 1)
        display_vendor, display_product = PRODUCT_DISPLAY.get(key, (vendor, product))
        products_out[key] = {
            "vendor": display_vendor,
            "product": display_product,
            "cves": ranked,
        }
        total += len(ranked)

    return {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sources": {
            "nvd": f"nvdcve-2.0 {{{','.join(map(str, YEARS))}}}",
            "epss": epss_version,
            "kev": kev_version,
        },
        "products": products_out,
        "records": total,
    }


def products_from_csv(path: Path) -> list[str]:
    out = []
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            criteria = (row.get("software_cpe") or "").strip()
            parsed = parse_cpe(criteria)
            if parsed:
                _, vendor, product, _ = parsed
                if product and product != "*":
                    out.append(f"{vendor}:{product}")
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="re-download feeds instead of ml/.cache")
    parser.add_argument("--cpe-file", action="append", default=[], help="inventory CSV whose software_cpe column extends the watchlist")
    parser.add_argument("--cap", type=int, default=PER_PRODUCT_CAP, help="CVEs kept per product")
    args = parser.parse_args()

    products = list(dict.fromkeys(SEED_PRODUCTS))
    for file in args.cpe_file:
        extra = products_from_csv(Path(file))
        print(f"{file}: {len(set(extra))} product keys from inventory")
        products += [p for p in extra if p not in products]

    payload = build(products, args.refresh, args.cap)
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} · {len(payload['products'])} products · {payload['records']:,} CVE records · {len(text):,} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
