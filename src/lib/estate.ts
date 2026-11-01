import { useMemo } from 'react'
import {
  DEMO_NOW,
  activityHeatmap as seedHeatmap,
  alerts as seedAlerts,
  anomalyWindows as seedAnomalies,
  assets as seedAssets,
  cves as seedCves,
  epssHistory as seedEpssHistory,
  geoPoints as seedGeo,
  intelItems as seedIntel,
  postureFor,
  sourceHealth as seedSourceHealth,
  techniques as seedTechniques,
  threatDaily as seedThreatDaily,
  trafficSeries as seedTraffic,
  type AlertDay,
  type DailyThreat,
} from '../data/seed'
import { buildCveIndex, corpusMeta, corpusCves, exposurePaths, uncoveredProducts, type ExposurePath } from './corpus'
import { correlate, refreshAlert, sortAlerts, type CorrelationModel } from './correlation'
import { mergeCve, useLiveFeeds, type LiveSourceMeta } from './liveFeeds'
import { scoreAlert } from './scoring'
import { mean, stdev } from './stats'
import {
  ALL_DATASETS,
  allUploadedAssets,
  allUploadedEvents,
  datasetName,
  scopeDatasets,
  telemetryTotals,
  useUploads,
  type UploadedDataset,
} from './uploads'
import type {
  Alert,
  Asset,
  Cve,
  GeoPoint,
  IntelItem,
  LogWindow,
  RiskLevel,
  SecurityEvent,
  SourceHealth,
  TelemetryTotals,
  Technique,
  TrafficPoint,
} from './types'

/* ------------------------------------------------------------------ *
 * The estate layer.
 *
 * One place merges the seed demo, the uploaded inventory and logs, the offline
 * NVD/KEV/EPSS corpus, and the live feed patches. Every page reads useEstate(),
 * so accepting a dataset moves the whole workspace rather than one counter.
 *
 * useUploads.activeId picks which dataset that workspace describes: ALL_DATASETS
 * merges every accepted file with the demo seed, and a single dataset id narrows
 * the whole estate to that file. Pages never read datasets directly, so the
 * switcher in the topbar re-scopes correlation, scoring, telemetry and intel.
 * ------------------------------------------------------------------ */

/* An uploaded inventory can produce thousands of (asset, CVE) pairs. Every accepted path is
   queued, ordered so each exposed asset is represented once before any asset gets a second
   path. The ceilings below are a browser guard rail, not a triage filter: they only bite on
   estates far larger than the demo budgets (≤6,000 assets per dataset), and
   coverage.queueTruncated says out loud when a path was actually dropped. */
const PER_ASSET_CAP = 1000
const ACTIVE_CAP = 40000
const GATED_CAP = 20000

const HOUR = 3600000
const DAY = 86400000

const utc = (ms: number) => new Date(ms).toISOString()

const stampLabel = (ms: number) =>
  new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

const weekdayHour = (ms: number) =>
  `${new Date(ms).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${new Date(ms).toLocaleTimeString(
    'en-US',
    { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' },
  )}`

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const round2 = (value: number) => Math.round(value * 100) / 100

const isGated = (path: ExposurePath) => path.relevance === 'NOT_AFFECTED' || path.relevance === 'PRODUCT_ABSENT'

/* ------------------------------------------------------------------ *
 * CVE set: curated seed first, then the offline corpus, then live patches
 * ------------------------------------------------------------------ */

type PatchMap = Record<string, ReturnType<typeof mergeCve> extends never ? never : any>

function mergeCveSet(patches: PatchMap): Cve[] {
  const byId = new Map<string, Cve>()
  for (const cve of seedCves) byId.set(cve.id, { ...cve, provenance: 'curated' })
  for (const cve of corpusCves()) {
    if (!byId.has(cve.id)) byId.set(cve.id, cve)
  }
  return [...byId.values()].map((cve) => mergeCve(cve, patches[cve.id]))
}

/* ------------------------------------------------------------------ *
 * Alert generation
 * ------------------------------------------------------------------ */

const EMPTY_BREAKDOWN = {
  severity_points: 0,
  exploit_points: 0,
  kev_points: 0,
  criticality_points: 0,
  exposure_points: 0,
  relevance_points: 0,
  total_raw: 0,
  total_capped: 0,
  formula_version: '1.1',
}

function skeleton(id: string, asset: Asset, cve: Cve, path: ExposurePath, createdAt: string): Alert {
  return {
    id,
    cve,
    asset,
    version: path.version,
    relevance: path.relevance,
    confidence: path.relevance === 'MATCHED' ? 'HIGH' : path.relevance === 'VERSION_UNKNOWN' ? 'MEDIUM' : 'LOW',
    score: 0,
    level: 'LOW',
    suppressed: false,
    dataIncomplete: false,
    breakdown: EMPTY_BREAKDOWN,
    summary: '',
    impact: '',
    action: '',
    reasoning: '',
    generatedBy: 'template',
    createdAt,
    entities: [],
  }
}

interface RankedPath {
  path: ExposurePath
  score: number
  wouldHave: number
}

function chooseQueue(ranked: RankedPath[], cap: number, perAsset: number): RankedPath[] {
  const groups = new Map<string, RankedPath[]>()
  for (const item of ranked) {
    const list = groups.get(item.path.asset.id) ?? []
    list.push(item)
    groups.set(item.path.asset.id, list)
  }
  const ordered = [...groups.values()].map((list) =>
    [...list].sort((a, b) => b.score - a.score || b.wouldHave - a.wouldHave || a.path.cve.id.localeCompare(b.path.cve.id)),
  )
  ordered.sort((a, b) => b[0].score - a[0].score || a[0].path.asset.id.localeCompare(b[0].path.asset.id))

  const picked: RankedPath[] = []
  for (let rank = 0; rank < perAsset; rank += 1) {
    for (const list of ordered) {
      if (picked.length >= cap) return picked
      const item = list[rank]
      if (item) picked.push(item)
    }
  }
  return picked
}

/* ------------------------------------------------------------------ *
 * Telemetry views derived from uploaded events
 * ------------------------------------------------------------------ */

const THREAT_CATEGORY: Record<string, string> = {
  ddos_rate_spike: 'DDoS',
  exploit_signature_match: 'Exploit',
  port_scan: 'Scanning',
  credential_reuse_suspected: 'Brute force',
}

const TYPE_CATEGORY: Record<string, string> = {
  LOGIN_FAIL: 'Brute force',
  FIREWALL_DENY: 'Scanning',
  EXPLOIT_SIGNATURE: 'Exploit',
  PROCESS_START: 'Malware C2',
  FILE_OPERATION: 'Malware C2',
  PRIVILEGE_CHANGE: 'Exploit',
  OUTBOUND_CONNECTION: 'Malware C2',
  HTTP_REQUEST: 'Scanning',
}

interface GeoAnchor {
  country: string
  numericId: string
  longitude: number
  latitude: number
}

const GEO_REF = new Map<string, GeoAnchor>(
  seedGeo.map((g) => [g.iso, { country: g.country, numericId: g.numericId, longitude: g.longitude, latitude: g.latitude }]),
)

/** Coordinates for the countries a log export can name that the demo map did not already
    place. Unknown codes are skipped rather than pinned to (0,0). */
const EXTRA_GEO: Record<string, GeoAnchor> = {
  ID: { country: 'Indonesia', numericId: '360', longitude: 117, latitude: -2 },
  PH: { country: 'Philippines', numericId: '608', longitude: 122, latitude: 12 },
  PK: { country: 'Pakistan', numericId: '586', longitude: 69, latitude: 30 },
  VN: { country: 'Vietnam', numericId: '704', longitude: 106, latitude: 16 },
  TR: { country: 'Turkiye', numericId: '792', longitude: 35, latitude: 39 },
  ES: { country: 'Spain', numericId: '724', longitude: -4, latitude: 40 },
  IT: { country: 'Italy', numericId: '380', longitude: 12.5, latitude: 42.8 },
  PL: { country: 'Poland', numericId: '616', longitude: 19, latitude: 52 },
  KE: { country: 'Kenya', numericId: '404', longitude: 38, latitude: 0 },
  AE: { country: 'United Arab Emirates', numericId: '784', longitude: 54, latitude: 24 },
  SA: { country: 'Saudi Arabia', numericId: '682', longitude: 45, latitude: 24 },
  IE: { country: 'Ireland', numericId: '372', longitude: -8, latitude: 53 },
  SE: { country: 'Sweden', numericId: '752', longitude: 16, latitude: 62 },
  AR: { country: 'Argentina', numericId: '032', longitude: -64, latitude: -34 },
  NZ: { country: 'New Zealand', numericId: '554', longitude: 172, latitude: -43 },
  CH: { country: 'Switzerland', numericId: '756', longitude: 8, latitude: 47 },
  NO: { country: 'Norway', numericId: '578', longitude: 9, latitude: 61 },
  PT: { country: 'Portugal', numericId: '620', longitude: -8, latitude: 39.5 },
}
for (const [iso, anchor] of Object.entries(EXTRA_GEO)) {
  if (!GEO_REF.has(iso)) GEO_REF.set(iso, anchor)
}

function geoFromEvents(events: SecurityEvent[]): GeoPoint[] {
  const counts = new Map<string, number>()
  const categories = new Map<string, Record<string, number>>()
  for (const event of events) {
    const iso = event.sourceCountry
    if (!iso) continue
    counts.set(iso, (counts.get(iso) ?? 0) + 1)
    const label = THREAT_CATEGORY[event.threatIndicator] ?? TYPE_CATEGORY[event.type] ?? 'Scanning'
    const bucket = categories.get(iso) ?? {}
    bucket[label] = (bucket[label] ?? 0) + 1
    categories.set(iso, bucket)
  }
  const out: GeoPoint[] = []
  counts.forEach((count, iso) => {
    const anchor = GEO_REF.get(iso)
    if (!anchor) return
    const tally = categories.get(iso) ?? {}
    const dominant = Object.entries(tally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'Scanning'
    out.push({
      id: `geo-${iso.toLowerCase()}`,
      country: anchor.country,
      iso,
      numericId: anchor.numericId,
      category: dominant,
      count,
      longitude: anchor.longitude,
      latitude: anchor.latitude,
    })
  })
  return out.sort((a, b) => b.count - a.count || a.iso.localeCompare(b.iso))
}

function trafficFromEvents(events: SecurityEvent[]): TrafficPoint[] {
  const buckets = 48
  const first = events[0].ts
  const last = events[events.length - 1].ts
  const width = Math.max(HOUR, Math.ceil((last - first) / buckets) || HOUR)
  const stats = Array.from({ length: buckets }, () => ({ count: 0, bytes: 0, failed: 0, rpsSum: 0, rpsN: 0 }))
  for (const event of events) {
    const index = clamp(Math.floor((event.ts - first) / width), 0, buckets - 1)
    const bucket = stats[index]
    bucket.count += 1
    bucket.bytes += event.bytesIn + event.bytesOut
    if (event.outcome === 'failure' || event.type === 'LOGIN_FAIL') bucket.failed += 1
    if (event.rps !== null) {
      bucket.rpsSum += event.rps
      bucket.rpsN += 1
    }
  }
  const counts = stats.map((s) => s.count)
  const threshold = mean(counts) + 2 * (stdev(counts) || 1)
  return stats.map((bucket, i) => {
    const burst = bucket.count > threshold
    const rps = bucket.rpsN ? bucket.rpsSum / bucket.rpsN : bucket.count / (width / 1000)
    return {
      time: stampLabel(first + i * width),
      rps: Math.round(rps * 10) / 10,
      bytes: bucket.bytes,
      failed: bucket.failed,
      anomaly: burst,
      burst,
    }
  })
}

/** Six-hour windows per destination-free feature set: failures, source spread, request
   rate, and countries that had not appeared anywhere earlier in the record. */
function anomaliesFromEvents(events: SecurityEvent[]): LogWindow[] {
  const width = 6 * HOUR
  const first = events[0].ts
  const last = events[events.length - 1].ts
  const start = Math.floor(first / width) * width
  const size = clamp(Math.ceil((last - start) / width) || 1, 1, 240)
  const buckets = Array.from({ length: size }, (_, i) => ({
    at: start + i * width,
    failed: 0,
    ips: new Set<string>(),
    countries: new Set<string>(),
    rpsSum: 0,
    rpsN: 0,
  }))
  for (const event of events) {
    const bucket = buckets[clamp(Math.floor((event.ts - start) / width), 0, size - 1)]
    if (event.outcome === 'failure' || event.type === 'LOGIN_FAIL') bucket.failed += 1
    if (event.sourceIp) bucket.ips.add(event.sourceIp)
    if (event.sourceCountry) bucket.countries.add(event.sourceCountry)
    if (event.rps !== null) {
      bucket.rpsSum += event.rps
      bucket.rpsN += 1
    }
  }

  const seen = new Set<string>()
  const features = buckets.map((bucket) => {
    let novelty = 0
    for (const country of bucket.countries) {
      if (!seen.has(country)) {
        novelty += 1
        seen.add(country)
      }
    }
    return {
      bucket,
      failed: bucket.failed,
      ips: bucket.ips.size,
      rps: bucket.rpsN ? bucket.rpsSum / bucket.rpsN : bucket.failed / (width / 1000),
      novelty,
    }
  })

  const muFail = mean(features.map((f) => f.failed))
  const sdFail = stdev(features.map((f) => f.failed)) || 1
  const muIps = mean(features.map((f) => f.ips))
  const sdIps = stdev(features.map((f) => f.ips)) || 1

  const scored = features.map((f) => {
    const zFail = (f.failed - muFail) / sdFail
    const zIps = (f.ips - muIps) / sdIps
    const raw = 0.17 * zFail + 0.09 * zIps + 0.06 * f.novelty - 0.09
    return { ...f, zFail, zIps, anomalyScore: round2(clamp(raw, -0.3, 0.6)) }
  })

  const shown = scored.filter((f) => f.failed > 0 || f.ips > 0).slice(-28)
  return shown.map((f, i) => {
    const anomaly = f.anomalyScore > 0.2
    const reason = anomaly
      ? f.novelty > 0 && f.novelty >= f.zFail
        ? 'Sign-in traffic from a country absent from the baseline'
        : f.zIps > f.zFail
          ? 'Credential spray spread across many source IPs'
          : 'Failed-login burst above the baseline'
      : undefined
    return {
      id: `W-${String(i + 1).padStart(2, '0')}`,
      label: weekdayHour(f.bucket.at),
      failedLogins: f.failed,
      distinctIps: f.ips,
      rps: Math.round(f.rps * 10) / 10,
      countryNovelty: f.novelty,
      anomalyScore: f.anomalyScore,
      anomaly,
      reason,
    }
  })
}

function heatmapFromEvents(events: SecurityEvent[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const event of events) {
    const d = new Date(event.ts)
    grid[d.getUTCDay()][d.getUTCHours()] += 1
  }
  return grid
}

const TECHNIQUE_SIGNALS: { id: string; match: (event: SecurityEvent) => boolean }[] = [
  { id: 'T1190', match: (e) => e.type === 'EXPLOIT_SIGNATURE' || e.threatIndicator === 'exploit_signature_match' },
  { id: 'T1498', match: (e) => e.threatIndicator === 'ddos_rate_spike' },
  { id: 'T1046', match: (e) => e.threatIndicator === 'port_scan' || e.type === 'FIREWALL_DENY' },
  { id: 'T1110', match: (e) => e.type === 'LOGIN_FAIL' || e.threatIndicator === 'credential_reuse_suspected' },
  { id: 'T1003', match: (e) => e.processName.includes('lsass') },
  { id: 'T1021', match: (e) => e.protocol === 'SSH' || e.processName.includes('sshd') },
  { id: 'T1059', match: (e) => /cmd|powershell|java|bash/.test(e.processName) },
  { id: 'T1071', match: (e) => e.type === 'OUTBOUND_CONNECTION' || (e.protocol === 'HTTPS' && e.type === 'HTTP_REQUEST') },
  { id: 'T1068', match: (e) => e.type === 'PRIVILEGE_CHANGE' },
  { id: 'T1105', match: (e) => e.type === 'FILE_OPERATION' },
  { id: 'T1070', match: (e) => e.action === 'block' || e.action === 'quarantine' },
]

function techniquesFromEvents(events: SecurityEvent[]): Technique[] {
  const counts: Record<string, number> = {}
  for (const signal of TECHNIQUE_SIGNALS) {
    let hit = 0
    for (const event of events) {
      if (signal.match(event)) hit += 1
    }
    if (hit) counts[signal.id] = hit
  }
  return seedTechniques.map((technique) => ({ ...technique, observed: counts[technique.id] ?? 0 }))
}

/* ------------------------------------------------------------------ *
 * Intel feed and source health
 * ------------------------------------------------------------------ */

function intelFromEstate(
  datasets: UploadedDataset[],
  paths: ExposurePath[],
  uncovered: { product: string; vendor: string; assets: number }[],
  assets: Asset[],
): IntelItem[] {
  const items: IntelItem[] = [...seedIntel]

  for (const dataset of datasets) {
    items.push({
      id: `INT-UP-${dataset.id}`,
      source: 'USER UPLOAD',
      title: `${dataset.name} accepted into the workspace`,
      summary: `${dataset.assets.length.toLocaleString()} assets and ${(dataset.events?.length ?? dataset.logs?.total ?? 0).toLocaleString()} log events re-correlated against the NVD corpus.`,
      category: 'Ingestion',
      published: dataset.uploadedAt,
    })
  }

  const cveLookup = new Map(paths.map((path) => [path.cve.id, path.cve]))
  const kevHits = new Map<string, number>()
  for (const path of paths) {
    if (path.cve.kev && path.relevance === 'MATCHED') {
      kevHits.set(path.cve.id, (kevHits.get(path.cve.id) ?? 0) + 1)
    }
  }
  const topKev = [...kevHits.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6)
  for (const [id, count] of topKev) {
    const cve = cveLookup.get(id)
    if (!cve) continue
    items.push({
      id: `INT-KEV-${id}`,
      source: 'CISA KEV',
      title: `${id} matches ${count.toLocaleString()} estate assets`,
      summary: `${cve.vendor} ${cve.product} · CVSS ${cve.cvss ?? 'n/a'}${cve.kevDue ? ` · KEV due ${cve.kevDue}` : ''}. Version-verified against the installed inventory.`,
      category: 'Exploitation',
      published: cve.kevDue ? `${cve.kevDue.slice(0, 10)}T12:00:00Z` : cve.published || utc(DEMO_NOW.getTime()),
      url: `https://nvd.nist.gov/vuln/detail/${id}`,
    })
  }

  for (const gap of uncovered.filter((entry) => entry.assets > 0).slice(0, 4)) {
    items.push({
      id: `INT-GAP-${gap.vendor}-${gap.product}`,
      source: 'NVD',
      title: `No NVD configuration data for ${gap.vendor} ${gap.product}`,
      summary: `${gap.assets.toLocaleString()} assets declare ${gap.product}, but the corpus has no version ranges for it, so those assets are reported as uncovered rather than safe.`,
      category: 'Coverage',
      published: corpusMeta.generatedAt,
      url: 'https://nvd.nist.gov/vuln',
    })
  }

  if (assets.length > seedAssets.length) {
    items.push({
      id: 'INT-CORPUS',
      source: 'NVD',
      title: `Offline NVD corpus covers ${corpusMeta.products} product lines`,
      summary: `${corpusMeta.records.toLocaleString()} records joined from the NVD 2.0 feeds, CISA KEV ${corpusMeta.feeds.kev} and EPSS ${corpusMeta.feeds.epss}.`,
      category: 'Vulnerability enrichment',
      published: corpusMeta.generatedAt,
      url: 'https://nvd.nist.gov/vuln/data-feeds',
    })
  }

  return items.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime())
}

function healthFromEstate(
  datasets: UploadedDataset[],
  events: SecurityEvent[],
  liveMeta: Partial<Record<'NVD' | 'CISA KEV' | 'FIRST EPSS', LiveSourceMeta>>,
  paths: ExposurePath[],
): SourceHealth[] {
  const uploadedRows = datasets.reduce((total, d) => total + d.assets.length, 0)
  const rows: SourceHealth[] = seedSourceHealth.map((row) => {
    const meta = liveMeta[row.source as 'NVD' | 'CISA KEV' | 'FIRST EPSS']
    if (!meta?.fetchedAt) {
      /* The seed rows carry invented freshness for the three real feeds. Until a pull has
         actually run in this browser, say so instead of presenting that as live health. */
      if (row.kind !== 'real') return row
      return { ...row, status: 'SIMULATED', note: 'bundled corpus · no live pull in this browser yet' }
    }
    return {
      ...row,
      status: meta.status === 'ok' ? 'OK' : 'DEGRADED',
      lastSuccess: meta.fetchedAt,
      records: meta.records || row.records,
      note: `${row.note} · live pull ${meta.records.toLocaleString()} record(s)`,
    }
  })
  rows.push({
    source: 'NVD Corpus',
    status: 'OK',
    lastSuccess: corpusMeta.generatedAt,
    records: corpusMeta.records,
    note: `${corpusMeta.products} products built offline from ${corpusMeta.feeds.nvd}`,
    kind: 'real',
  })
  rows.push({
    source: 'USER UPLOAD',
    status: datasets.length ? 'OK' : 'SIMULATED',
    lastSuccess: datasets.length
      ? datasets.map((d) => d.uploadedAt).sort()[datasets.length - 1]
      : DEMO_NOW.toISOString(),
    records: uploadedRows + events.length,
    note: datasets.length
      ? `${datasets.length} dataset(s) · ${paths.length.toLocaleString()} correlation paths`
      : 'no dataset accepted yet',
    kind: 'real',
  })
  return rows
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

export interface AssetTelemetry {
  events: number
  failures: number
  threatHits: number
  lastTs: number | null
  threats: string[]
}

export interface EstateCoverage {
  datasets: number
  uploadedAssets: number
  events: number
  matchedPaths: number
  unverifiedPaths: number
  gatedPaths: number
  queuedActive: number
  queueTruncated: boolean
  uncovered: { product: string; vendor: string; assets: number }[]
  kevMatches: number
  hasUploads: boolean
  hasEvents: boolean
  corpusProducts: number
  corpusRecords: number
  threatDailyReal: boolean
  epssReal: boolean
  telemetryAssets: number
}

export interface DatasetScope {
  id: string
  all: boolean
  label: string
  datasets: UploadedDataset[]
  /** True when the demo seed inventory is part of the scope: either the merged view, or a
      dataset that carries no inventory rows of its own and needs the seed as join context. */
  includesSeed: boolean
}

export interface Estate {
  now: number
  nowIso: string
  datasets: UploadedDataset[]
  scope: DatasetScope
  assets: Asset[]
  seedAssets: Asset[]
  uploadedAssets: Asset[]
  assetById: Map<string, Asset>
  departments: string[]
  cves: Cve[]
  cveById: Map<string, Cve>
  alerts: Alert[]
  activeAlerts: Alert[]
  suppressedAlerts: Alert[]
  alertById: Map<string, Alert>
  model: CorrelationModel
  counts: CorrelationModel['counts'] & { medium: number; low: number }
  posture: number
  postureTrend: number[]
  alertDaily: AlertDay[]
  threatDaily: DailyThreat[]
  activityHeatmap: number[][]
  epssHistory: { id: string; color: string; points: { date: string; value: number }[] }[]
  sourceHealth: SourceHealth[]
  intelItems: IntelItem[]
  geoPoints: GeoPoint[]
  anomalyWindows: LogWindow[]
  trafficSeries: TrafficPoint[]
  techniques: Technique[]
  telemetry: TelemetryTotals | null
  events: SecurityEvent[]
  paths: ExposurePath[]
  pathsByAsset: Map<string, ExposurePath[]>
  alertsByAsset: Map<string, Alert[]>
  telemetryByAsset: Map<string, AssetTelemetry>
  coverage: EstateCoverage
  syncIds: string[]
  nvdIds: string[]
}

function buildEstate(
  datasets: UploadedDataset[],
  activeId: string,
  patches: PatchMap,
  liveMeta: Partial<Record<'NVD' | 'CISA KEV' | 'FIRST EPSS', LiveSourceMeta>>,
): Estate {
  const inScope = scopeDatasets(datasets, activeId)
  const uploadedAssets = allUploadedAssets(inScope)
  const includesSeed = activeId === ALL_DATASETS || uploadedAssets.length === 0
  const scope: DatasetScope = {
    id: activeId,
    all: activeId === ALL_DATASETS,
    label: activeId === ALL_DATASETS ? (datasets.length ? 'All datasets' : 'Demo seed') : datasetName(datasets, activeId),
    datasets: inScope,
    includesSeed,
  }

  const orderedEvents = [...allUploadedEvents(inScope)].sort((a, b) => a.ts - b.ts)
  const assets = includesSeed ? [...seedAssets, ...uploadedAssets] : uploadedAssets

  const cves = mergeCveSet(patches)
  const cveById = new Map(cves.map((cve) => [cve.id, cve]))
  const index = buildCveIndex(cves)

  const seedPairs = new Set(seedAlerts.map((alert) => `${alert.asset.id}::${alert.cve.id}`))
  const allPaths = exposurePaths(assets, index)
  const freshPaths = allPaths.filter((path) => !seedPairs.has(path.key))

  const scoredPaths: RankedPath[] = freshPaths.map((path) => {
    const result = scoreAlert({
      cve: path.cve,
      criticality: path.asset.criticality,
      internetFacing: path.asset.internetFacing,
      relevance: path.relevance,
    })
    return { path, score: result.score, wouldHave: result.wouldHaveScored ?? 0 }
  })

  const activeRanked = scoredPaths
    .filter((item) => !isGated(item.path))
    .sort((a, b) => b.score - a.score || a.path.cve.id.localeCompare(b.path.cve.id) || a.path.asset.id.localeCompare(b.path.asset.id))
  const gatedRanked = scoredPaths
    .filter((item) => item.path.relevance === 'NOT_AFFECTED' && item.path.cve.kev)
    .sort(
      (a, b) => b.wouldHave - a.wouldHave || a.path.cve.id.localeCompare(b.path.cve.id) || a.path.asset.id.localeCompare(b.path.asset.id),
    )

  const activeQueued = chooseQueue(activeRanked, ACTIVE_CAP, PER_ASSET_CAP)
  const gatedQueued = chooseQueue(gatedRanked, GATED_CAP, PER_ASSET_CAP)
  const queued = [...activeQueued, ...gatedQueued]

  const uploadedAtById = new Map(inScope.map((dataset) => [dataset.id, dataset.uploadedAt]))
  const generated = queued.map((item, i) => {
    const cve = cveById.get(item.path.cve.id) ?? item.path.cve
    const createdAt = uploadedAtById.get(item.path.asset.datasetId ?? '') ?? utc(DEMO_NOW.getTime())
    const alert = skeleton(`ALR-U${String(i + 1).padStart(4, '0')}`, item.path.asset, cve, item.path, createdAt)
    return refreshAlert(alert, cve, item.path.version)
  })

  const liveAlerts = includesSeed ? seedAlerts.map((alert) => refreshAlert(alert, cveById.get(alert.cve.id) ?? alert.cve)) : []
  const alerts = sortAlerts([...liveAlerts, ...generated])
  const activeAlerts = alerts.filter((alert) => !alert.suppressed)
  const suppressedAlerts = alerts.filter((alert) => alert.suppressed)

  const pathsByAsset = new Map<string, ExposurePath[]>()
  for (const path of allPaths) {
    const list = pathsByAsset.get(path.asset.id) ?? []
    list.push(path)
    pathsByAsset.set(path.asset.id, list)
  }

  const alertsByAsset = new Map<string, Alert[]>()
  for (const alert of alerts) {
    const list = alertsByAsset.get(alert.asset.id) ?? []
    list.push(alert)
    alertsByAsset.set(alert.asset.id, list)
  }
  alertsByAsset.forEach((list) => list.sort((a, b) => Number(a.suppressed) - Number(b.suppressed) || b.score - a.score))

  const model = correlate(alerts, assets, cves)
  const counts = {
    ...model.counts,
    medium: activeAlerts.filter((a) => a.level === 'MEDIUM').length,
    low: activeAlerts.filter((a) => a.level === 'LOW').length,
  }
  const posture = postureFor(activeAlerts, assets)

  const lastUpload = inScope.reduce((max, d) => Math.max(max, new Date(d.uploadedAt).getTime()), 0)
  const now = Math.max(DEMO_NOW.getTime(), orderedEvents.length ? orderedEvents[orderedEvents.length - 1].ts : 0, lastUpload)

  const dayBuckets = (dayStart: number) => {
    const end = dayStart + DAY
    return alerts.filter((a) => {
      const t = new Date(a.createdAt).getTime()
      return t >= dayStart && t < end
    })
  }

  const alertDaily: AlertDay[] = Array.from({ length: 8 }, (_, i) => {
    const dayStart = new Date(now - (7 - i) * DAY)
    dayStart.setUTCHours(0, 0, 0, 0)
    const inDay = dayBuckets(dayStart.getTime())
    const levelCount = (level: RiskLevel) => inDay.filter((a) => a.level === level).length
    return {
      label: dayLabel(dayStart.getTime()),
      critical: levelCount('CRITICAL'),
      high: levelCount('HIGH'),
      medium: levelCount('MEDIUM'),
      low: levelCount('LOW'),
    }
  })

  const postureTrend: number[] = Array.from({ length: 8 }, (_, i) => {
    const dayStart = new Date(now - (7 - i) * DAY)
    dayStart.setUTCHours(0, 0, 0, 0)
    const raisedBy = alerts.filter((a) => new Date(a.createdAt).getTime() < dayStart.getTime() + DAY)
    return postureFor(raisedBy, assets)
  })

  const threatDaily: DailyThreat[] = (() => {
    const rows = Array.from({ length: 30 }, (_, i) => {
      const day = new Date(now - (29 - i) * DAY)
      day.setUTCHours(0, 0, 0, 0)
      const dayStart = day.getTime()
      const inDay = cves.filter((cve) => {
        if (!cve.published) return false
        const t = new Date(cve.published).getTime()
        return t >= dayStart && t < dayStart + DAY
      })
      return { date: day.toISOString(), label: dayLabel(dayStart), newCves: inDay.length, kev: inDay.filter((cve) => cve.kev).length }
    })
    return rows.some((row) => row.newCves > 0) ? rows : seedThreatDaily
  })()
  const threatDailyReal = threatDaily.some((row) => row.newCves > 0)

  const epssHistory: Estate['epssHistory'] = (() => {
    const palette = ['#e5545a', '#e08a2f', '#e6c229', '#3ed2c1']
    const picks: Cve[] = []
    const ranked = activeAlerts
      .filter((a) => a.cve.epss !== null)
      .sort((a, b) => (b.cve.epss ?? 0) - (a.cve.epss ?? 0) || a.cve.id.localeCompare(b.cve.id))
    for (const alert of ranked) {
      if (picks.some((cve) => cve.id === alert.cve.id)) continue
      picks.push(alert.cve)
      if (picks.length === 4) break
    }
    if (picks.length < 4) return seedEpssHistory
    return picks.map((cve, i) => {
      const base = cve.epss ?? 0.3
      return {
        id: cve.id,
        color: palette[i],
        points: Array.from({ length: 30 }, (_, k) => {
          const at = now - (29 - k) * DAY
          return { date: dayLabel(at), value: clamp(round2(base * (0.72 + (k / 29) * 0.28)), 0, 1) }
        }),
      }
    })
  })()
  const epssReal = epssHistory.every((series) => !seedEpssHistory.some((s) => s.id === series.id))

  const telemetryByAsset = new Map<string, AssetTelemetry>()
  if (orderedEvents.length) {
    const lookup = new Map<string, string>()
    for (const asset of assets) {
      if (asset.inventory?.externalId) lookup.set(asset.inventory.externalId, asset.id)
      lookup.set(asset.name.toLowerCase(), asset.id)
    }
    for (const event of orderedEvents) {
      const id =
        (event.destAssetId && lookup.get(event.destAssetId)) ||
        (event.destAssetName && lookup.get(event.destAssetName.toLowerCase()))
      if (!id) continue
      const entry =
        telemetryByAsset.get(id) ?? ({ events: 0, failures: 0, threatHits: 0, lastTs: null, threats: [] } as AssetTelemetry)
      entry.events += 1
      if (event.outcome === 'failure' || event.type === 'LOGIN_FAIL') entry.failures += 1
      if (event.threatIndicator) {
        entry.threatHits += 1
        if (!entry.threats.includes(event.threatIndicator) && entry.threats.length < 6) entry.threats.push(event.threatIndicator)
      }
      entry.lastTs = entry.lastTs === null ? event.ts : Math.max(entry.lastTs, event.ts)
      telemetryByAsset.set(id, entry)
    }
  }

  const uncovered = uncoveredProducts(assets)
  const coverage: EstateCoverage = {
    datasets: inScope.length,
    uploadedAssets: uploadedAssets.length,
    events: orderedEvents.length,
    matchedPaths: allPaths.filter((p) => p.relevance === 'MATCHED').length,
    unverifiedPaths: allPaths.filter((p) => p.relevance === 'VERSION_UNKNOWN').length,
    gatedPaths: allPaths.filter(isGated).length,
    queuedActive: generated.filter((a) => !a.suppressed).length,
    queueTruncated: activeRanked.length > activeQueued.length || gatedRanked.length > gatedQueued.length,
    uncovered,
    kevMatches: new Set(allPaths.filter((p) => p.relevance === 'MATCHED' && p.cve.kev).map((p) => p.cve.id)).size,
    hasUploads: inScope.length > 0,
    hasEvents: orderedEvents.length > 0,
    corpusProducts: corpusMeta.products,
    corpusRecords: corpusMeta.records,
    threatDailyReal,
    epssReal,
    telemetryAssets: telemetryByAsset.size,
  }

  const seedIds = seedCves.map((cve) => cve.id)
  const queueIds = new Set(alerts.map((alert) => alert.cve.id))
  const syncIds = [...new Set([...seedIds, ...queueIds])]
  const nvdIds = [
    ...new Set([...seedIds, ...alerts.filter((a) => a.dataIncomplete && !a.suppressed).map((a) => a.cve.id)]),
  ].slice(0, 30)

  return {
    now,
    nowIso: utc(now),
    datasets,
    scope,
    assets,
    seedAssets,
    uploadedAssets,
    assetById: new Map(assets.map((asset) => [asset.id, asset])),
    departments: [...new Set(assets.map((asset) => asset.department))],
    cves,
    cveById,
    alerts,
    activeAlerts,
    suppressedAlerts,
    alertById: new Map(alerts.map((alert) => [alert.id, alert])),
    model,
    counts,
    posture,
    postureTrend,
    alertDaily,
    threatDaily,
    activityHeatmap: orderedEvents.length ? heatmapFromEvents(orderedEvents) : seedHeatmap,
    epssHistory,
    sourceHealth: healthFromEstate(inScope, orderedEvents, liveMeta, allPaths),
    intelItems: intelFromEstate(inScope, allPaths, uncovered, assets),
    geoPoints: orderedEvents.length ? geoFromEvents(orderedEvents) : seedGeo,
    anomalyWindows: orderedEvents.length ? anomaliesFromEvents(orderedEvents) : seedAnomalies,
    trafficSeries: orderedEvents.length ? trafficFromEvents(orderedEvents) : seedTraffic,
    techniques: orderedEvents.length ? techniquesFromEvents(orderedEvents) : seedTechniques,
    telemetry: orderedEvents.length ? telemetryTotals(orderedEvents) : null,
    events: orderedEvents,
    paths: allPaths,
    pathsByAsset,
    alertsByAsset,
    telemetryByAsset,
    coverage,
    syncIds,
    nvdIds,
  }
}

/* ------------------------------------------------------------------ *
 * Access
 * ------------------------------------------------------------------ */

type LivePatches = ReturnType<typeof useLiveFeeds.getState>['patches']

let cache: { datasets: UploadedDataset[]; activeId: string; patches: LivePatches; value: Estate } | null = null

function estateFrom(datasets: UploadedDataset[], activeId: string, patches: LivePatches): Estate {
  if (cache && cache.datasets === datasets && cache.activeId === activeId && cache.patches === patches) return cache.value
  const value = buildEstate(datasets, activeId, patches, useLiveFeeds.getState().meta)
  cache = { datasets, activeId, patches, value }
  return value
}

/** For non-hook call sites (the AI context builder, ML helpers). */
export function getEstate(): Estate {
  const { datasets, activeId } = useUploads.getState()
  return estateFrom(datasets, activeId, useLiveFeeds.getState().patches)
}

export function useEstate(): Estate {
  const datasets = useUploads((state) => state.datasets)
  const activeId = useUploads((state) => state.activeId)
  const patches = useLiveFeeds((state) => state.patches)
  return useMemo(() => estateFrom(datasets, activeId, patches), [datasets, activeId, patches])
}
