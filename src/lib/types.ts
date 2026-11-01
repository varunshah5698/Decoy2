export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type RelevanceStatus = 'MATCHED' | 'VERSION_UNKNOWN' | 'NOT_AFFECTED' | 'PRODUCT_ABSENT'
export type Criticality = 'HIGH' | 'MEDIUM' | 'LOW'
export type SourceName =
  | 'NVD'
  | 'CISA KEV'
  | 'FIRST EPSS'
  | 'MITRE ATT&CK'
  | 'CERT-In'
  | 'USER UPLOAD'
  | 'SIMULATED'

export type AssetType = 'server' | 'app' | 'endpoint' | 'network' | 'database' | 'cloud'

export interface Software {
  vendor: string
  product: string
  version: string
  cpe?: string
}

/** The operational detail an inventory export can carry about one asset. Seed assets
    leave these absent, so every reader treats them as optional evidence. */
export interface InventoryFacts {
  externalId: string
  hostname: string
  ipAddress: string
  publicIp: string
  environment: string
  site: string
  region: string
  country: string
  os: string
  osVersion: string
  cpuCores: number | null
  ramGb: number | null
  storageGb: number | null
  networkSegment: string
  vlan: string
  firewallZone: string
  patchGroup: string
  lastPatchDate: string
  daysSincePatch: number | null
  backupEnabled: boolean | null
  backupFrequency: string
  mfaEnabled: boolean | null
  edrInstalled: boolean | null
  antivirusStatus: string
  businessUnit: string
  dataClassification: string
  lifecycleStatus: string
  supportEndDate: string
  complianceScope: string[]
  ownerTier: string
  tags: string[]
}

export interface Asset {
  id: string
  name: string
  type: AssetType
  department: string
  criticality: Criticality
  businessFunction: string
  internetFacing: boolean
  sensitivity: Criticality
  source: 'SIMULATED' | 'USER UPLOAD'
  software: Software[]
  inventory?: InventoryFacts
  datasetId?: string
}

export interface VersionRange {
  startIncluding?: string
  startExcluding?: string
  endIncluding?: string
  endExcluding?: string
}

export interface Cve {
  id: string
  title: string
  description: string
  published: string
  modified: string
  cvss: number | null
  vector: string
  severity: RiskLevel
  cwe: string[]
  epss: number | null
  epssPercentile: number | null
  kev: boolean
  kevDue?: string
  kevRansomware?: boolean
  vendor: string
  product: string
  range: VersionRange
  ranges?: VersionRange[]
  fixVersion: string
  refs: { url: string; source: string }[]
  provenance?: 'curated' | 'nvd-corpus'
}

export interface Breakdown {
  severity_points: number
  exploit_points: number
  kev_points: number
  criticality_points: number
  exposure_points: number
  relevance_points: number
  total_raw: number
  total_capped: number
  formula_version: string
}

export interface Alert {
  id: string
  cve: Cve
  asset: Asset
  version: string
  relevance: RelevanceStatus
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  score: number
  level: RiskLevel
  suppressed: boolean
  suppressionReason?: string
  wouldHaveScored?: number
  dataIncomplete: boolean
  breakdown: Breakdown
  summary: string
  impact: string
  action: string
  reasoning: string
  generatedBy: 'template' | 'llm'
  createdAt: string
  entities: string[]
}

export interface SourceHealth {
  source: string
  status: 'OK' | 'DEGRADED' | 'SIMULATED'
  lastSuccess: string
  records: number
  note: string
  kind: 'real' | 'simulated'
}

export interface IntelItem {
  id: string
  source: SourceName
  title: string
  summary: string
  category: string
  published: string
  url?: string
  simulated?: boolean
}

export interface GeoPoint {
  id: string
  country: string
  iso: string
  numericId: string
  category: string
  count: number
  longitude: number
  latitude: number
}

export interface LogWindow {
  id: string
  label: string
  failedLogins: number
  distinctIps: number
  rps: number
  countryNovelty: number
  anomalyScore: number
  anomaly: boolean
  reason?: string
}

export interface TrafficPoint {
  time: string
  rps: number
  bytes: number
  failed: number
  anomaly: boolean
  burst?: boolean
}

export interface Technique {
  id: string
  name: string
  tactic: string
  tacticId: string
  description: string
  observed: number
}

export interface AttackProfile {
  key: string
  name: string
  category: string
  description: string
  defaultSeverity: RiskLevel
  techniques: string[]
  stages: { tactic: string; note: string }[]
  mitigations: { control: string; team: string }[]
  indicators: string[]
}

/** One row of an uploaded security log, normalised to the fields every telemetry view
    reads. Numbers are pre-parsed so charts never re-coerce strings. */
export interface SecurityEvent {
  id: string
  ts: number
  type: string
  category: string
  severity: RiskLevel
  outcome: string
  sourceIp: string
  sourceCountry: string
  sourceHostname: string
  destIp: string
  destPort: number | null
  destAssetId: string
  destAssetName: string
  protocol: string
  bytesIn: number
  bytesOut: number
  packets: number
  durationMs: number
  httpMethod: string
  httpPath: string
  httpStatus: number | null
  userAgent: string
  username: string
  userRole: string
  authMethod: string
  mfaUsed: boolean | null
  sessionId: string
  deviceId: string
  ruleName: string
  action: string
  threatIndicator: string
  processName: string
  riskScore: number | null
  rps: number | null
  sensorId: string
  siteName: string
}

export interface TelemetryTotals {
  events: number
  assetsTargeted: number
  distinctSourceIps: number
  distinctUsers: number
  failures: number
  threatHits: number
  bytes: number
  firstTs: number | null
  lastTs: number | null
  byType: { label: string; value: number }[]
  byThreat: { label: string; value: number }[]
  byCountry: { label: string; value: number }[]
  topUsers: { label: string; value: number }[]
  sensors: number
  sites: string[]
}
