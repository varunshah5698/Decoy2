import { attackProfiles, alerts as seedAlerts, assets as seedAssets, cves as seedCves, techniques } from '../data/seed'
import { postureFromCounts, scoreAlert } from './scoring'
import { mean, mulberry32, quantile, stdev } from './stats'
import type { Alert, Asset, AttackProfile, Criticality, Cve, RelevanceStatus, RiskLevel } from './types'

/* ------------------------------------------------------------------ *
 * Scenario engine for the what-if simulator.
 *
 * Every figure is computed from seeded records — CVSS vectors, EPSS,
 * KEV flags, affected ranges, the asset inventory and the ATT&CK
 * attack profiles — combined with the multipliers declared here. The
 * engine is pure and seeded, so a given scenario always replays the
 * same way, and nothing it produces is ever written back.
 * ------------------------------------------------------------------ */

export interface Dataset {
  cves: Cve[]
  alerts: Alert[]
  assets: Asset[]
}

const DEFAULT_SET: Dataset = { cves: seedCves, alerts: seedAlerts, assets: seedAssets }

/* ---------- version handling ---------- */

const numericPrefix = (value: string) => {
  const match = value.trim().match(/^[\d.]+/)
  if (!match) return null
  const parts = match[0].split('.').map(Number).filter((n) => !Number.isNaN(n))
  return parts.length ? parts : null
}

export const compareVersions = (a: string, b: string): number | null => {
  const pa = numericPrefix(a)
  const pb = numericPrefix(b)
  if (!pa || !pb) return null
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Installed version versus the CVE's published affected range. */
export const versionRelevance = (version: string, cve: Cve): RelevanceStatus => {
  if (!numericPrefix(version)) return 'VERSION_UNKNOWN'
  const { range } = cve
  const startBound = range.startIncluding ?? range.startExcluding
  if (!startBound) return 'VERSION_UNKNOWN'
  const startCmp = compareVersions(version, startBound)
  if (startCmp == null) return 'VERSION_UNKNOWN'
  if (range.startIncluding && startCmp < 0) return 'NOT_AFFECTED'
  if (range.startExcluding && startCmp <= 0) return 'NOT_AFFECTED'
  const endBound = range.endIncluding ?? range.endExcluding
  if (endBound) {
    const endCmp = compareVersions(version, endBound)
    if (endCmp != null) {
      if (range.endIncluding && endCmp > 0) return 'NOT_AFFECTED'
      if (range.endExcluding && endCmp >= 0) return 'NOT_AFFECTED'
    }
  }
  return 'MATCHED'
}

/* ---------- CVSS vector decoding ---------- */

export interface MetricReading {
  key: string
  label: string
  code: string
  name: string
  note: string
  weight: number
}

const METRIC_LABELS: Record<string, string> = {
  AV: 'Attack vector',
  AC: 'Attack complexity',
  PR: 'Privileges required',
  UI: 'User interaction',
  S: 'Scope',
  C: 'Confidentiality',
  I: 'Integrity',
  A: 'Availability',
}

const METRIC_VALUES: Record<string, Record<string, { name: string; note: string; weight: number }>> = {
  AV: {
    N: { name: 'Network', note: 'reachable across the network', weight: 1 },
    A: { name: 'Adjacent', note: 'needs a shared network segment', weight: 0.74 },
    L: { name: 'Local', note: 'needs a shell or installed context', weight: 0.44 },
    P: { name: 'Physical', note: 'needs hands on the hardware', weight: 0.18 },
  },
  AC: {
    L: { name: 'Low', note: 'no special conditions to line up', weight: 0.96 },
    H: { name: 'High', note: 'depends on a race or rare config', weight: 0.58 },
  },
  PR: {
    N: { name: 'None', note: 'an unauthenticated caller can begin', weight: 1 },
    L: { name: 'Low', note: 'needs one ordinary account', weight: 0.82 },
    H: { name: 'High', note: 'needs an administrative account', weight: 0.54 },
  },
  UI: {
    N: { name: 'None', note: 'fires without anyone clicking', weight: 0.96 },
    R: { name: 'Required', note: 'someone has to be tricked first', weight: 0.52 },
  },
  S: {
    U: { name: 'Unchanged', note: 'damage stays inside the component', weight: 0.6 },
    C: { name: 'Changed', note: 'damage spills past the component', weight: 1 },
  },
  C: {
    H: { name: 'High', note: 'the data set is fully readable', weight: 1 },
    L: { name: 'Low', note: 'a slice of the data is readable', weight: 0.35 },
    N: { name: 'None', note: 'no confidentiality loss', weight: 0.05 },
  },
  I: {
    H: { name: 'High', note: 'data can be rewritten freely', weight: 1 },
    L: { name: 'Low', note: 'limited rewriting is possible', weight: 0.35 },
    N: { name: 'None', note: 'no integrity loss', weight: 0.05 },
  },
  A: {
    H: { name: 'High', note: 'the service is fully lost', weight: 1 },
    L: { name: 'Low', note: 'the service degrades briefly', weight: 0.35 },
    N: { name: 'None', note: 'no availability loss', weight: 0.05 },
  },
}

/** The CVSS vector for a whole attack profile, used when no CVE drives the class. */
const PROFILE_VECTOR: Record<string, string> = {
  ddos: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H',
  phishing: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H',
  ransomware: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H',
  malware: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H',
  sqli: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N',
  bruteforce: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N',
  stuffing: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N',
  supplychain: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:H/A:H',
  xss: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:L/A:N',
  insider: 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N',
}

export const decodeVector = (vector: string): MetricReading[] => {
  const out: MetricReading[] = []
  for (const part of vector.split('/').slice(1)) {
    const [key, code] = part.split(':')
    const reading = METRIC_VALUES[key]?.[code]
    if (!reading) continue
    out.push({ key, label: METRIC_LABELS[key] ?? key, code, name: reading.name, note: reading.note, weight: reading.weight })
  }
  return out
}

const weightAt = (readings: MetricReading[], key: string, fallback: number) =>
  readings.find((m) => m.key === key)?.weight ?? fallback

/* ---------- applicability ---------- */

const FIT_BY_TYPE: Record<Asset['type'], string[]> = {
  app: ['sqli', 'xss', 'bruteforce', 'stuffing', 'supplychain', 'ransomware', 'malware'],
  server: ['ransomware', 'malware', 'supplychain', 'bruteforce', 'phishing', 'insider'],
  network: ['ddos', 'bruteforce', 'stuffing', 'malware', 'insider'],
  database: ['sqli', 'insider', 'bruteforce', 'ransomware'],
  cloud: ['ddos', 'sqli', 'xss', 'stuffing', 'malware'],
  endpoint: ['phishing', 'malware', 'insider', 'ransomware', 'bruteforce'],
}

const TYPE_LABEL: Record<Asset['type'], string> = {
  app: 'application',
  server: 'server',
  network: 'network device',
  database: 'database',
  cloud: 'cloud edge',
  endpoint: 'workstation',
}

/* The asset tag gives the base surface, but the package itself can widen it: an
   injection flaw in a product installed on a plain server still puts injection in play. */
const CWE_TO_CLASS: Record<string, string> = {
  'CWE-89': 'sqli',
  'CWE-79': 'xss',
  'CWE-80': 'xss',
  'CWE-352': 'xss',
}

const surfaceClasses = (cves: Cve[]) =>
  [...new Set(cves.flatMap((cve) => (cve.cwe ?? []).map((id) => CWE_TO_CLASS[id]).filter((key): key is string => Boolean(key))))]

const NEEDS_INTERNET = new Set(['ddos', 'sqli', 'xss', 'bruteforce', 'stuffing'])

/** Classes whose mechanism runs through a published software flaw. */
const CVE_LINKED = new Set(['ddos', 'sqli', 'xss', 'ransomware', 'malware', 'supplychain'])

/* Only some weakness families can produce a given mechanism, so a deserialization RCE
   powers malware and ransomware but says nothing about SQL injection. A CVE whose CWE
   is absent from the feed is treated as family-unverified rather than ruled out. */
const MECHANISM_CWE: Record<string, string[]> = {
  ddos: ['CWE-400', 'CWE-674', 'CWE-770', 'CWE-774'],
  ransomware: ['CWE-77', 'CWE-78', 'CWE-94', 'CWE-119', 'CWE-125', 'CWE-190', 'CWE-269', 'CWE-287', 'CWE-364', 'CWE-416', 'CWE-502', 'CWE-787', 'CWE-918'],
  malware: ['CWE-77', 'CWE-78', 'CWE-94', 'CWE-119', 'CWE-125', 'CWE-190', 'CWE-269', 'CWE-287', 'CWE-364', 'CWE-416', 'CWE-502', 'CWE-787', 'CWE-918'],
  supplychain: ['CWE-330', 'CWE-494', 'CWE-506', 'CWE-565', 'CWE-829'],
  sqli: ['CWE-89'],
  xss: ['CWE-79', 'CWE-80'],
}

const familyMatches = (cve: Cve, profileKey: string) => {
  const family = MECHANISM_CWE[profileKey]
  if (!family) return false
  const list = cve.cwe ?? []
  if (!list.length) return true
  return list.some((id) => family.includes(id))
}

/** The stage where the flaw itself is used — the only stage that carries the entry probability. */
const ENTRY_TACTICS = new Set(['Initial Access', 'Credential Access', 'Execution'])

const SEVERITY_FLOOR_BASE: Record<RiskLevel, number> = { CRITICAL: 0.78, HIGH: 0.62, MEDIUM: 0.44, LOW: 0.28 }

/** Simulated hours a phase occupies before it resolves. */
const PHASE_HOURS: Record<string, number> = {
  Reconnaissance: 6,
  'Resource Development': 8,
  'Initial Access': 3,
  Execution: 2,
  Persistence: 4,
  'Privilege Esc.': 3,
  'Defense Evasion': 3,
  'Credential Access': 5,
  Discovery: 4,
  'Lateral Movement': 7,
  Collection: 5,
  'Command & Control': 6,
  Exfiltration: 4,
  Impact: 2,
}

const phaseHours = (tactic: string) => PHASE_HOURS[tactic] ?? 4

/* ---------- mitigation gates ---------- */

interface ControlRule {
  tactics: string[]
  multiplier: number
}

const CONTROL_RULES: { match: RegExp; rule: ControlRule }[] = [
  { match: /patch|upgrade|remove affected/i, rule: { tactics: ['Initial Access', 'Execution', 'Resource Development'], multiplier: 0.22 } },
  { match: /rate limit|throttle|scrubbing|degradation|error surface|egress/i, rule: { tactics: ['Reconnaissance', 'Impact', 'Command & Control'], multiplier: 0.45 } },
  { match: /mfa|phishing-resistant|device-bound|legacy auth|breach corpora/i, rule: { tactics: ['Credential Access', 'Initial Access'], multiplier: 0.3 } },
  { match: /segment|allow-list|offline|immutable/i, rule: { tactics: ['Lateral Movement', 'Impact', 'Exfiltration'], multiplier: 0.4 } },
  { match: /endpoint|tamper|hunt|unsigned/i, rule: { tactics: ['Execution', 'Persistence', 'Defense Evasion'], multiplier: 0.5 } },
  { match: /parameter|content security|escape|httponly|samesite/i, rule: { tactics: ['Initial Access', 'Collection'], multiplier: 0.38 } },
  { match: /review|alert|playbook|provenance|reproduce|drill|pin/i, rule: { tactics: ['Discovery', 'Defense Evasion', 'Collection'], multiplier: 0.62 } },
]

const ruleFor = (control: string) => CONTROL_RULES.find((entry) => entry.match.test(control))?.rule ?? null

export interface ControlToggle {
  id: string
  label: string
  team: string
  tactics: string[]
  multiplier: number
  fromClass: string
}

const controlId = (profileKey: string, control: string) => `${profileKey}:${control}`

const controlsForProfile = (profile: AttackProfile): ControlToggle[] =>
  profile.mitigations.map((mitigation) => {
    const rule = ruleFor(mitigation.control)
    return {
      id: controlId(profile.key, mitigation.control),
      label: mitigation.control,
      team: mitigation.team,
      tactics: rule?.tactics ?? [profile.stages[profile.stages.length - 1]?.tactic ?? 'Impact'],
      multiplier: rule?.multiplier ?? 0.7,
      fromClass: profile.name,
    }
  })

/* ---------- model shapes ---------- */

export interface ChainStage {
  index: number
  tactic: string
  note: string
  techniqueId?: string
  techniqueName?: string
  probability: number
  cumulative: number
  gates: string[]
  duration: number
  reached: number
}

export interface SimClass {
  key: string
  name: string
  category: string
  description: string
  severity: RiskLevel
  baseProbability: number
  likelihood: number
  meanHours: number
  p10Hours: number
  p50Hours: number
  p90Hours: number
  blockedMostAt: string
  cveIds: string[]
  cweIds: string[]
  techniqueIds: string[]
  indicators: string[]
  controls: ControlToggle[]
  chain: ChainStage[]
  driver: Cve | null
  vector: string
  basis: 'CVE-backed' | 'profile-only'
  impact: { c: number; i: number; a: number }
  outcome: string
  how: string
  profile: AttackProfile
  plan: ClassPlan
}

export interface RuledOut {
  key: string
  name: string
  reason: string
}

export interface SimEvent {
  id: string
  at: number
  classKey: string
  className: string
  tactic: string
  stageIndex: number
  techniqueId?: string
  techniqueName?: string
  verdict: 'attempt' | 'success' | 'blocked'
  probability: number
  z: number
  detail: string
  indicator?: string
  mitigation?: string
  cveId?: string
  assetName: string
}

export interface SpreadTarget {
  assetId: string
  name: string
  department: string
  hop: number
  software: string
  probability: number
  criticality: Criticality
  internetFacing: boolean
}

export interface SensitivityRow {
  id: string
  label: string
  team: string
  tactics: string[]
  rateOn: number
  rateOff: number
  delta: number
  fromClass: string
}

export interface HistogramBin {
  label: string
  from: number
  to: number
  count: number
}

export interface Aggregate {
  breachRate: number
  expectedBreaches: number
  worstClass: SimClass | null
  expectedHops: number
  additionalCritical: number
  additionalHigh: number
  postureAfter: number
  histogram: HistogramBin[]
  cdf: { hour: number; cumulative: number }[]
  quantiles: { p10: number; p50: number; p90: number; mean: number }
  classOrder: { key: string; name: string; likelihood: number; severity: RiskLevel; stageAttrition: number[] }[]
}

export interface SoftwareTarget {
  key: string
  vendor: string
  product: string
  hosts: { asset: Asset; version: string }[]
  versions: string[]
  cves: Cve[]
  activeAlerts: number
  maxCvss: number
  maxEpss: number
  kevCount: number
}

export interface ScenarioOverrides {
  patched: boolean
  internetFacing: boolean
  criticality: Criticality
}

export interface WhatIfRow {
  alertId: string
  cveId: string
  baseline: number
  scenario: number
  levelBefore: RiskLevel
  levelAfter: RiskLevel
  suppressedAfter: boolean
  wouldHave?: number
}

export interface WhatIfResult {
  rows: WhatIfRow[]
  postureBefore: number
  postureAfter: number
  sumBefore: number
  sumAfter: number
}

export interface SimInput {
  softwareKey: string
  assetId: string
  version?: string
  overrides: ScenarioOverrides
  enabledControls: string[]
  trials: number
  seed: number
  /** How many of the ranked classes the blast radius is projected from; defaults to 3. */
  classesSeen?: number
}

export interface SimModel {
  target: SoftwareTarget
  asset: Asset
  assetLabel: string
  version: string
  classes: SimClass[]
  ruledOut: RuledOut[]
  events: SimEvent[]
  windowHours: number
  aggregate: Aggregate
  spread: SpreadTarget[]
  sensitivity: SensitivityRow[]
  heat: { cols: string[]; rows: { key: string; name: string; cwe: string[]; cells: number[]; total: number }[] }
  controls: ControlToggle[]
  whatif: WhatIfResult
  seed: number
  trials: number
  clockMarks: number[]
}

export const buildSoftwareTargets = (data: Dataset = DEFAULT_SET): SoftwareTarget[] => {
  const map = new Map<string, SoftwareTarget>()
  for (const asset of data.assets) {
    for (const entry of asset.software) {
      const key = `${entry.vendor}|${entry.product}`
      const existing = map.get(key)
      if (existing) {
        if (!existing.hosts.some((host) => host.asset.id === asset.id)) existing.hosts.push({ asset, version: entry.version })
        if (!existing.versions.includes(entry.version)) existing.versions.push(entry.version)
      } else {
        map.set(key, {
          key,
          vendor: entry.vendor,
          product: entry.product,
          hosts: [{ asset, version: entry.version }],
          versions: [entry.version],
          cves: [],
          activeAlerts: 0,
          maxCvss: 0,
          maxEpss: 0,
          kevCount: 0,
        })
      }
    }
  }
  for (const target of map.values()) {
    target.cves = data.cves.filter((cve) => cve.product === target.product)
    target.activeAlerts = data.alerts.filter((alert) => !alert.suppressed && alert.cve.product === target.product).length
    target.maxCvss = target.cves.reduce((max, cve) => Math.max(max, cve.cvss ?? 0), 0)
    target.maxEpss = target.cves.reduce((max, cve) => Math.max(max, cve.epss ?? 0), 0)
    target.kevCount = target.cves.filter((cve) => cve.kev).length
  }
  return [...map.values()].sort(
    (a, b) => b.cves.length - a.cves.length || b.activeAlerts - a.activeAlerts || a.product.localeCompare(b.product),
  )
}

/* ---------- what-if overlay on the stored alert queue ---------- */

const severityCounts = (items: { suppressed: boolean; level: RiskLevel }[]) => ({
  critical: items.filter((item) => !item.suppressed && item.level === 'CRITICAL').length,
  high: items.filter((item) => !item.suppressed && item.level === 'HIGH').length,
})

export const whatifOnAsset = (data: Dataset, assetId: string, overrides: ScenarioOverrides): WhatIfResult => {
  const rows: WhatIfRow[] = data.alerts
    .filter((alert) => alert.asset.id === assetId)
    .map((alert) => {
      const next = scoreAlert({
        cve: alert.cve,
        criticality: overrides.criticality,
        internetFacing: overrides.internetFacing,
        relevance: overrides.patched ? 'NOT_AFFECTED' : alert.relevance,
      })
      return {
        alertId: alert.id,
        cveId: alert.cve.id,
        baseline: alert.score,
        scenario: next.score,
        levelBefore: alert.level,
        levelAfter: next.level,
        suppressedAfter: next.suppressed,
        wouldHave: next.wouldHaveScored,
      }
    })

  const scenarioRow = (alert: Alert) => rows.find((row) => row.alertId === alert.id)
  const overlay = data.alerts.map((alert) => {
    const row = scenarioRow(alert)
    return row ? { suppressed: row.suppressedAfter, level: row.levelAfter } : { suppressed: alert.suppressed, level: alert.level }
  })
  const baseline = data.alerts.filter((alert) => !alert.suppressed)

  return {
    rows,
    postureBefore: postureFromCounts(severityCounts(baseline)),
    postureAfter: postureFromCounts(severityCounts(overlay)),
    sumBefore: rows.reduce((sum, row) => sum + row.baseline, 0),
    sumAfter: rows.reduce((sum, row) => sum + row.scenario, 0),
  }
}

/* ---------- chain construction ---------- */

const relevanceMultiplier: Record<RelevanceStatus, number> = {
  MATCHED: 1.12,
  VERSION_UNKNOWN: 0.86,
  NOT_AFFECTED: 0.34,
  PRODUCT_ABSENT: 0.3,
}

const severityRank: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }
const techniqueName = (id?: string) => (id ? techniques.find((t) => t.id === id)?.name ?? id : undefined)
const clamp01 = (value: number) => Math.min(0.97, Math.max(0.02, value))

interface ClassPlan {
  profile: AttackProfile
  driver: Cve | null
  vector: string
  cveIds: string[]
  cweIds: string[]
  base: number
  severity: RiskLevel
  amplified: string | null
  fit: number
  basis: 'CVE-backed' | 'profile-only'
}

/** Every tactic has an intrinsic ease of being pulled off; the CVSS vector then
 *  nudges it. The entry tactic skips all of this and uses the CVE-derived base. */
const STAGE_EASE: Record<string, number> = {
  Reconnaissance: 0.9,
  'Resource Development': 0.78,
  'Initial Access': 0.8,
  Execution: 0.72,
  Persistence: 0.68,
  'Privilege Esc.': 0.62,
  'Defense Evasion': 0.66,
  'Credential Access': 0.6,
  Discovery: 0.8,
  'Lateral Movement': 0.55,
  Collection: 0.7,
  'Command & Control': 0.64,
  Exfiltration: 0.58,
  Impact: 0.5,
}

const easeOf = (tactic: string) => STAGE_EASE[tactic] ?? 0.6

/* One published flaw does not convert into every mechanism at the same rate: a remote
   unauthenticated read is a natural injection entry but a poor ransomware one. Each
   CVE-linked class compares the driver's own vector with the access shape its mechanism
   needs, and the closeness scales the entry probability. */
const DRIVER_IDEAL: Record<string, { av: number; pr: number; ui: number; c: number; i: number; a: number }> = {
  ddos: { av: 1, pr: 1, ui: 1, c: 0.05, i: 0.05, a: 1 },
  ransomware: { av: 0.85, pr: 0.6, ui: 0.55, c: 0.9, i: 1, a: 1 },
  malware: { av: 0.85, pr: 0.6, ui: 0.55, c: 0.9, i: 1, a: 0.6 },
  supplychain: { av: 0.6, pr: 0.55, ui: 0.6, c: 0.7, i: 1, a: 0.7 },
  sqli: { av: 1, pr: 1, ui: 1, c: 1, i: 0.6, a: 0.1 },
  xss: { av: 1, pr: 1, ui: 0.5, c: 0.9, i: 0.7, a: 0.1 },
}

/** Ceiling for a single entry attempt, however severe the CVE: no flaw is a sure thing. */
const ENTRY_CEILING = 0.9

const fitOf = (profileKey: string, readings: MetricReading[]): number => {
  const ideal = DRIVER_IDEAL[profileKey]
  if (!ideal) return 1
  const gaps = [
    Math.abs(weightAt(readings, 'AV', 0.85) - ideal.av),
    Math.abs(weightAt(readings, 'PR', 0.7) - ideal.pr),
    Math.abs(weightAt(readings, 'UI', 0.7) - ideal.ui),
    Math.abs(weightAt(readings, 'C', 0.4) - ideal.c),
    Math.abs(weightAt(readings, 'I', 0.4) - ideal.i),
    Math.abs(weightAt(readings, 'A', 0.4) - ideal.a),
  ]
  return 0.45 + 0.55 * (1 - Math.max(...gaps))
}

/** The tuning the engine applies, exported so the board can print the same numbers it runs. */
export const MODEL_FACTORS = {
  entryCeiling: ENTRY_CEILING,
  relevance: relevanceMultiplier,
  stageEase: STAGE_EASE,
  severityFloor: SEVERITY_FLOOR_BASE,
  fitRange: [0.45, 1] as [number, number],
  mechanismCwe: MECHANISM_CWE,
}

const planClass = (
  profile: AttackProfile,
  asset: Asset,
  productCves: Cve[],
  version: string,
  overrides: ScenarioOverrides,
): ClassPlan => {
  const matched = overrides.patched ? [] : productCves.filter((cve) => versionRelevance(version, cve) === 'MATCHED')
  const unverifiable = overrides.patched
    ? []
    : productCves.filter((cve) => versionRelevance(version, cve) === 'VERSION_UNKNOWN')
  const linked = CVE_LINKED.has(profile.key)
  const inScope = [...matched, ...unverifiable]
  const candidates = linked ? inScope.filter((cve) => familyMatches(cve, profile.key)) : []
  const driver = candidates.sort((a, b) => (b.cvss ?? 0) - (a.cvss ?? 0) || (b.epss ?? 0) - (a.epss ?? 0))[0] ?? null
  const vector = driver?.vector ?? PROFILE_VECTOR[profile.key]
  const readings = decodeVector(vector)
  const fit = driver ? fitOf(profile.key, readings) : 1

  let base: number
  if (driver) {
    base =
      (0.22 + 0.4 * ((driver.cvss ?? 0) / 10) + 0.3 * (driver.epss ?? 0) + (driver.kev ? 0.03 : 0)) *
      relevanceMultiplier[versionRelevance(version, driver)] *
      fit
  } else if (overrides.patched && linked) {
    base = SEVERITY_FLOOR_BASE[profile.defaultSeverity] * 0.45
  } else if (linked && inScope.length) {
    base = SEVERITY_FLOOR_BASE[profile.defaultSeverity] * 0.62
  } else if (linked && productCves.length) {
    base = SEVERITY_FLOOR_BASE[profile.defaultSeverity] * 0.5
  } else {
    // No flaw evidence at all: the profile's own severity floor, discounted for it.
    base = SEVERITY_FLOOR_BASE[profile.defaultSeverity] * 0.75
  }

  if (overrides.criticality === 'HIGH') base *= 1.04
  if (asset.type === 'network' && profile.key === 'phishing') base *= 0.6

  return {
    profile,
    driver,
    vector,
    cveIds: linked ? candidates.map((cve) => cve.id) : [],
    cweIds: linked ? [...new Set(candidates.flatMap((cve) => cve.cwe))] : [],
    base: clamp01(Math.min(base, ENTRY_CEILING)),
    severity: profile.defaultSeverity,
    amplified: driver && driver.severity === 'CRITICAL' ? driver.id : null,
    fit,
    basis: driver ? 'CVE-backed' : 'profile-only',
  }
}

const buildChain = (plan: ClassPlan, enabled: Set<string>): ChainStage[] => {
  const readings = decodeVector(plan.vector)
  const av = weightAt(readings, 'AV', 0.8)
  const ac = weightAt(readings, 'AC', 0.85)
  const pr = weightAt(readings, 'PR', 0.85)
  const ui = weightAt(readings, 'UI', 0.8)
  const scope = weightAt(readings, 'S', 0.65)
  const impacts = readings.filter((m) => ['C', 'I', 'A'].includes(m.key)).map((m) => m.weight)
  const ciaAvg = impacts.length ? mean(impacts) : 0.6
  const controls = controlsForProfile(plan.profile)
  const entryIndex = plan.profile.stages.findIndex((stage) => ENTRY_TACTICS.has(stage.tactic))

  const chain: ChainStage[] = []
  let cumulative = 1

  plan.profile.stages.forEach((stage, index) => {
    const tactic = stage.tactic
    let probability: number
    if (index === (entryIndex < 0 ? 0 : entryIndex)) {
      probability = clamp01(plan.base)
    } else {
      const ease = easeOf(tactic)
      let modifier = 1
      if (tactic === 'Reconnaissance' || tactic === 'Discovery') modifier = 0.72 + 0.28 * av
      else if (tactic === 'Execution') modifier = (0.6 + 0.4 * ac) * (0.6 + 0.4 * ui)
      else if (tactic === 'Privilege Esc.') modifier = 0.6 + 0.4 * pr
      else if (tactic === 'Credential Access') modifier = 0.7 + 0.3 * pr
      else if (tactic === 'Lateral Movement') modifier = 0.55 + 0.45 * scope
      else if (tactic === 'Collection' || tactic === 'Exfiltration') modifier = 0.6 + 0.4 * scope
      else if (tactic === 'Impact') modifier = 0.5 + 0.5 * ciaAvg
      else if (tactic === 'Persistence' || tactic === 'Defense Evasion') modifier = 0.65 + 0.35 * ac
      else if (tactic === 'Command & Control') modifier = 0.65 + 0.35 * scope
      probability = clamp01(ease * modifier)
    }

    const gates: string[] = []
    for (const control of controls) {
      if (!enabled.has(control.id) || !control.tactics.includes(tactic)) continue
      probability = clamp01(probability * control.multiplier)
      gates.push(control.label)
    }

    chain.push({
      index,
      tactic,
      note: stage.note,
      techniqueId: plan.profile.techniques[index % Math.max(1, plan.profile.techniques.length)],
      techniqueName: techniqueName(plan.profile.techniques[index % Math.max(1, plan.profile.techniques.length)]),
      probability,
      cumulative: cumulative * probability,
      gates,
      duration: phaseHours(tactic),
      reached: cumulative,
    })
    cumulative *= probability
  })

  return chain
}

interface TrialOutcome {
  breach: boolean
  hours: number
  blockedAt: number | null
  hops: number
}

const runTrials = (chain: ChainStage[], trials: number, seed: number, hopChance: number): TrialOutcome[] => {
  const rng = mulberry32(seed)
  const outcomes: TrialOutcome[] = []
  for (let trial = 0; trial < trials; trial += 1) {
    let hours = 0
    let breach = true
    let blockedAt: number | null = null
    for (const stage of chain) {
      hours += stage.duration * (0.55 + 0.9 * rng())
      if (rng() > stage.probability) {
        breach = false
        blockedAt = stage.index
        break
      }
    }
    let hops = 0
    if (breach) {
      for (let hop = 0; hop < 3; hop += 1) {
        if (rng() < hopChance / (hop + 1)) hops += 1
        else break
      }
    }
    outcomes.push({ breach, hours, blockedAt, hops })
  }
  return outcomes
}

const breachRateOf = (chain: ChainStage[], trials: number, seed: number) => {
  const terminal = chain[chain.length - 1]
  const outcomes = runTrials(chain, trials, seed, terminal ? terminal.cumulative : 0)
  return {
    rate: outcomes.filter((outcome) => outcome.breach).length / Math.max(1, outcomes.length),
    outcomes,
  }
}

/* The classes are independent attempts on the same host, so trial t of every class is
   one run of the whole scenario: it breaches if any class gets all the way through, and
   the clock stops on the fastest one. */
const jointFromTrials = (perClass: TrialOutcome[][], trials: number) => {
  const hours: number[] = []
  let hops = 0
  let rolls = 0
  for (let t = 0; t < trials; t += 1) {
    const won: TrialOutcome[] = []
    for (const outcomes of perClass) {
      const outcome = outcomes[t]
      if (!outcome) continue
      rolls += 1
      hops += outcome.hops
      if (outcome.breach) won.push(outcome)
    }
    if (won.length) hours.push(Math.min(...won.map((outcome) => outcome.hours)))
  }
  return {
    rate: trials ? hours.length / trials : 0,
    hours,
    expectedHops: rolls ? hops / rolls : 0,
  }
}

const classSeed = (seed: number, key: string) => seed + key.length * 977

const histogramOf = (hours: number[], window: number): HistogramBin[] => {
  const bins = 12
  const size = Math.max(1, window / bins)
  const out: HistogramBin[] = Array.from({ length: bins }, (_, index) => ({
    label: `${Math.round(index * size)}–${Math.round((index + 1) * size)}h`,
    from: index * size,
    to: (index + 1) * size,
    count: 0,
  }))
  for (const value of hours) out[Math.min(bins - 1, Math.floor(value / size))].count += 1
  return out
}

/** Lateral reach follows the seeded inventory: hosts that already share a package. */
const spreadFrom = (data: Dataset, assetId: string, product: string, chance: number): SpreadTarget[] => {
  const origin = data.assets.find((asset) => asset.id === assetId)
  if (!origin) return []
  const visited = new Set([origin.id])
  let frontier = [origin]
  const out: SpreadTarget[] = []
  for (let hop = 1; hop <= 3 && frontier.length; hop += 1) {
    const next: Asset[] = []
    for (const source of frontier) {
      const products = source.software.map((entry) => entry.product)
      for (const candidate of data.assets) {
        if (visited.has(candidate.id)) continue
        const shared = candidate.software.find((entry) => products.includes(entry.product))
        if (!shared) continue
        visited.add(candidate.id)
        const sameComponent = candidate.software.some((entry) => entry.product === product)
        const bonus = sameComponent ? 1.15 : candidate.internetFacing ? 1 : 0.85
        out.push({
          assetId: candidate.id,
          name: candidate.name,
          department: candidate.department,
          hop,
          software: `${shared.product} ${shared.version}`,
          probability: Math.min(0.95, chance * 0.55 ** (hop - 1) * bonus * (candidate.criticality === 'HIGH' ? 1.05 : 1)),
          criticality: candidate.criticality,
          internetFacing: candidate.internetFacing,
        })
        next.push(candidate)
      }
    }
    frontier = next
  }
  return out.sort((a, b) => a.hop - b.hop || b.probability - a.probability).slice(0, 8)
}

const howSentence = (plan: ClassPlan, asset: Asset, chain: ChainStage[]) => {
  const readings = decodeVector(plan.vector)
  const named = (key: string, fallback: string) => readings.find((m) => m.key === key)?.name ?? fallback
  const first = chain[0]
  const last = chain[chain.length - 1]
  const origin = plan.driver ? plan.driver.title : `${plan.profile.name} · ${plan.profile.category.toLowerCase()}`
  const gate = first?.gates.length ? ` Stage one is gated by ${first.gates.join(' and ')}.` : ''
  return `${origin} on ${asset.name}: entry is ${named('AV', 'Network').toLowerCase()} with ${named(
    'PR',
    'None',
  ).toLowerCase()} privileges and ${named('UI', 'None').toLowerCase()} user interaction. The run opens with "${
    first?.note ?? plan.profile.description
  }" and, if nothing stops it, ends with "${last?.note ?? 'impact'}.${gate}`
}

/* ---------- the run ---------- */

export const simulate = (input: SimInput, data: Dataset = DEFAULT_SET): SimModel => {
  const targets = buildSoftwareTargets(data)
  const target = targets.find((item) => item.key === input.softwareKey) ?? targets[0]
  const host = target.hosts.find((item) => item.asset.id === input.assetId) ?? target.hosts[0]
  const asset = host.asset
  const version = input.version ?? host.version
  const overrides = input.overrides
  const fit = FIT_BY_TYPE[asset.type] ?? []
  const surface = input.overrides.patched ? [] : surfaceClasses(target.cves)
  const allowed = new Set([...fit, ...surface])

  const applicable = attackProfiles.filter((profile) => allowed.has(profile.key))
  const validIds = new Set(applicable.flatMap((profile) => controlsForProfile(profile).map((control) => control.id)))
  const enabled = new Set(input.enabledControls.filter((id) => validIds.has(id)))

  const classes: SimClass[] = []
  const ruledOut: RuledOut[] = []
  const outcomesByKey = new Map<string, TrialOutcome[]>()

  for (const profile of attackProfiles) {
    if (!allowed.has(profile.key)) {
      ruledOut.push({
        key: profile.key,
        name: profile.name,
        reason: `not modelled against a ${TYPE_LABEL[asset.type]} running ${target.product}`,
      })
      continue
    }
    if (NEEDS_INTERNET.has(profile.key) && !overrides.internetFacing) {
      ruledOut.push({ key: profile.key, name: profile.name, reason: 'needs an internet-facing surface; this scenario runs internal' })
      continue
    }

    const plan = planClass(profile, asset, target.cves, version, overrides)
    const chain = buildChain(plan, enabled)
    const terminal = chain[chain.length - 1]
    const { rate, outcomes } = breachRateOf(chain, input.trials, classSeed(input.seed, profile.key))
    outcomesByKey.set(profile.key, outcomes)
    const breachHours = outcomes.filter((outcome) => outcome.breach).map((outcome) => outcome.hours).sort((a, b) => a - b)
    const blockedTally = new Map<string, number>()
    outcomes
      .filter((outcome) => !outcome.breach && outcome.blockedAt != null)
      .forEach((outcome) => {
        const tactic = chain[outcome.blockedAt as number].tactic
        blockedTally.set(tactic, (blockedTally.get(tactic) ?? 0) + 1)
      })
    const blockedMostAt =
      [...blockedTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'no stage failure recorded'

    const readings = decodeVector(plan.vector)
    classes.push({
      key: profile.key,
      name: profile.name,
      category: profile.category,
      description: profile.description,
      severity: plan.severity,
      baseProbability: plan.base,
      likelihood: rate,
      meanHours: breachHours.length ? mean(breachHours) : NaN,
      p10Hours: breachHours.length ? quantile(breachHours, 0.1) : NaN,
      p50Hours: breachHours.length ? quantile(breachHours, 0.5) : NaN,
      p90Hours: breachHours.length ? quantile(breachHours, 0.9) : NaN,
      blockedMostAt,
      cveIds: plan.cveIds,
      cweIds: plan.cweIds,
      techniqueIds: profile.techniques,
      indicators: profile.indicators,
      controls: controlsForProfile(profile),
      chain,
      driver: plan.driver,
      vector: plan.vector,
      basis: plan.basis,
      impact: {
        c: weightAt(readings, 'C', profile.category === 'Data loss' ? 0.9 : 0.5),
        i: weightAt(readings, 'I', 0.5),
        a: weightAt(readings, 'A', profile.category === 'Availability' ? 0.95 : 0.4),
      },
      outcome: `${terminal?.note ?? profile.category} on ${asset.name} · ${asset.businessFunction.toLowerCase()} is the service that takes the hit`,
      how: howSentence(plan, asset, chain),
      profile,
      plan,
    })
  }

  classes.sort((a, b) => b.likelihood - a.likelihood || severityRank[b.severity] - severityRank[a.severity])

  const controlMap = new Map<string, ControlToggle>()
  classes.forEach((cls) => cls.controls.forEach((control) => { if (!controlMap.has(control.id)) controlMap.set(control.id, control) }))
  const controls = [...controlMap.values()]

  /* ---- canonical walkthrough: the clock the player animates ---- */
  const rawEvents: Omit<SimEvent, 'z'>[] = []
  classes.forEach((cls, classIndex) => {
    const rng = mulberry32(input.seed + 41 * (classIndex + 1) + cls.chain.length * 13)
    let clock = classIndex * 3
    cls.chain.forEach((stage, stageIndex) => {
      clock += Math.max(1, Math.round(stage.duration * (0.6 + 0.7 * rng())))
      const roll = rng()
      const verdict: SimEvent['verdict'] = roll <= stage.probability ? 'success' : stage.gates.length ? 'blocked' : 'attempt'
      rawEvents.push({
        id: `${cls.key}-${stageIndex}`,
        at: clock,
        classKey: cls.key,
        className: cls.name,
        tactic: stage.tactic,
        stageIndex,
        techniqueId: stage.techniqueId,
        techniqueName: stage.techniqueName,
        verdict,
        probability: stage.probability,
        detail:
          verdict === 'blocked'
            ? `${stage.note} — stopped by ${stage.gates[0]}`
            : `${stage.note} · ${cls.driver ? cls.driver.title : cls.description}`,
        indicator: cls.indicators[stageIndex % Math.max(1, cls.indicators.length)],
        mitigation: stage.gates[0],
        cveId: cls.cveIds.length ? cls.cveIds[stageIndex % cls.cveIds.length] : undefined,
        assetName: asset.name,
      })
    })
  })
  const probabilities = rawEvents.map((event) => event.probability)
  const pMean = mean(probabilities)
  const pSdev = stdev(probabilities)
  const events: SimEvent[] = rawEvents
    .map((event) => ({
      ...event,
      z: pSdev > 0 ? Math.round(((event.probability - pMean) / pSdev) * 10) / 10 : 0,
    }))
    .sort((a, b) => a.at - b.at || a.className.localeCompare(b.className))
  const windowHours = Math.max(24, events.length ? events[events.length - 1].at : 24)
  const clockMarks = Array.from({ length: 13 }, (_, index) => Math.round((windowHours / 12) * index))

  /* ---- aggregate over every surviving class ---- */
  const perClass = classes.map((cls) => outcomesByKey.get(cls.key) ?? [])
  const joint = jointFromTrials(perClass, input.trials)
  const breachTimes = joint.hours
  const classOrder = classes.map((cls) => ({
    key: cls.key,
    name: cls.name,
    likelihood: cls.likelihood,
    severity: cls.severity,
    stageAttrition: cls.chain.map((stage) => stage.cumulative),
  }))

  const classesSeen = input.classesSeen ?? 3
  const spread = spreadFrom(
    data,
    asset.id,
    target.product,
    mean(classes.slice(0, classesSeen).map((cls) => cls.likelihood)),
  )

  const breachRate = joint.rate
  const expectedHops = joint.expectedHops
  /* Each class is a Bernoulli attempt, so its trial rate is also its expected count:
     summing the rates per severity gives the extra alerts this scenario forecasts. */
  const expectedBreaches = classes.reduce((sum, cls) => sum + cls.likelihood, 0)
  const additionalCritical = classes
    .filter((cls) => cls.severity === 'CRITICAL')
    .reduce((sum, cls) => sum + cls.likelihood, 0)
  const additionalHigh = classes.filter((cls) => cls.severity === 'HIGH').reduce((sum, cls) => sum + cls.likelihood, 0)
  const baselineActive = data.alerts.filter((alert) => !alert.suppressed)
  const postureAfter = postureFromCounts(
    severityCounts([
      ...baselineActive.map((alert) => ({ suppressed: false, level: alert.level })),
      ...Array.from({ length: Math.round(additionalCritical) }, () => ({ suppressed: false, level: 'CRITICAL' as RiskLevel })),
      ...Array.from({ length: Math.round(additionalHigh) }, () => ({ suppressed: false, level: 'HIGH' as RiskLevel })),
    ]),
  )

  /* ---- class × tactic heat surface ---- */
  const cols = [...new Set(classes.flatMap((cls) => cls.chain.map((stage) => stage.tactic)))]
  const heat = {
    cols,
    rows: classes.map((cls) => ({
      key: cls.key,
      name: cls.name,
      cwe: cls.cweIds,
      cells: cols.map((col) => cls.chain.find((stage) => stage.tactic === col)?.cumulative ?? 0),
      total: cls.chain.length ? cls.chain[cls.chain.length - 1].cumulative : 0,
    })),
  }

  /* ---- one control at a time, on the same seeds so the runs are paired ---- */
  const baseEnabled = new Set(input.enabledControls.filter((id) => validIds.has(id)))
  const jointWith = (control: ControlToggle, include: boolean) => {
    const next = new Set(baseEnabled)
    if (include) next.add(control.id)
    else next.delete(control.id)
    const trials = Math.min(200, input.trials)
    return jointFromTrials(
      classes.map((cls) => breachRateOf(buildChain(cls.plan, next), trials, classSeed(input.seed, cls.key)).outcomes),
      trials,
    ).rate
  }
  const sensitivity: SensitivityRow[] = controls.map((control) => {
    const rateOn = jointWith(control, true)
    const rateOff = jointWith(control, false)
    return {
      id: control.id,
      label: control.label,
      team: control.team,
      tactics: control.tactics,
      rateOn,
      rateOff,
      delta: rateOn - rateOff,
      fromClass: control.fromClass,
    }
  })

  return {
    target,
    asset,
    assetLabel: `${asset.name} · ${TYPE_LABEL[asset.type]}`,
    version,
    classes,
    ruledOut,
    events,
    windowHours,
    aggregate: {
      breachRate,
      expectedBreaches,
      worstClass: classes[0] ?? null,
      expectedHops,
      additionalCritical,
      additionalHigh,
      postureAfter,
      histogram: histogramOf(breachTimes, windowHours),
      cdf: clockMarks.map((hour) => ({
        hour,
        cumulative: breachTimes.length ? breachTimes.filter((value) => value <= hour).length / breachTimes.length : 0,
      })),
      quantiles: {
        p10: breachTimes.length ? quantile(breachTimes, 0.1) : NaN,
        p50: breachTimes.length ? quantile(breachTimes, 0.5) : NaN,
        p90: breachTimes.length ? quantile(breachTimes, 0.9) : NaN,
        mean: breachTimes.length ? mean(breachTimes) : NaN,
      },
      classOrder,
    },
    spread,
    sensitivity: sensitivity.sort((a, b) => a.delta - b.delta),
    heat,
    controls,
    whatif: whatifOnAsset(data, asset.id, overrides),
    seed: input.seed,
    trials: input.trials,
    clockMarks,
  }
}
