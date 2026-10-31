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
  vendor: string
  product: string
  range: VersionRange
  fixVersion: string
  refs: { url: string; source: string }[]
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
