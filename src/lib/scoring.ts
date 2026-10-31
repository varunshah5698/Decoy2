import type { Alert, Breakdown, Cve, Criticality, RelevanceStatus, RiskLevel } from './types'

export const FORMULA_VERSION = '1.1'

export const WEIGHTS = {
  severity: 25,
  epss: 25,
  kev: 10,
  criticality: 25,
  exposure: 5,
  relevance: 10,
}

const CRITICALITY_POINTS: Record<Criticality, number> = { HIGH: 25, MEDIUM: 15, LOW: 5 }

export const round1 = (n: number) => Math.round(n * 10) / 10

export const levelFromScore = (score: number): RiskLevel => {
  if (score >= 85) return 'CRITICAL'
  if (score >= 65) return 'HIGH'
  if (score >= 40) return 'MEDIUM'
  return 'LOW'
}

const raise = (current: RiskLevel, floor: RiskLevel): RiskLevel => {
  const order: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
  return order.indexOf(current) >= order.indexOf(floor) ? current : floor
}

interface ScoreInput {
  cve: Cve
  criticality: Criticality
  internetFacing: boolean
  relevance: RelevanceStatus
}

interface ScoreResult {
  breakdown: Breakdown
  score: number
  level: RiskLevel
  suppressed: boolean
  wouldHaveScored?: number
  dataIncomplete: boolean
}

export function scoreAlert({ cve, criticality, internetFacing, relevance }: ScoreInput): ScoreResult {
  const suppressed = relevance === 'NOT_AFFECTED' || relevance === 'PRODUCT_ABSENT'
  const severity_points = cve.cvss == null ? 0 : (cve.cvss / 10) * WEIGHTS.severity
  const exploit_points = cve.epss == null ? 0 : cve.epss * 100 * (WEIGHTS.epss / 100)
  const kev_points = cve.kev ? WEIGHTS.kev : 0
  const criticality_points = CRITICALITY_POINTS[criticality]
  const exposure_points = internetFacing ? WEIGHTS.exposure : 0
  const relevance_points = relevance === 'MATCHED' ? 10 : relevance === 'VERSION_UNKNOWN' ? 5 : 0

  const raw = severity_points + exploit_points + kev_points + criticality_points + exposure_points + relevance_points
  const capped = round1(Math.min(raw, 100))
  const dataIncomplete = cve.cvss == null || cve.epss == null

  const wouldHaveRaw = raw - relevance_points + (suppressed ? 10 : 0)
  const wouldHaveScored = round1(Math.min(wouldHaveRaw, 100))

  let level: RiskLevel = suppressed ? 'LOW' : levelFromScore(capped)
  let score = suppressed ? 0 : capped

  if (!suppressed && cve.kev && relevance === 'MATCHED') {
    level = raise(level, criticality === 'HIGH' ? 'CRITICAL' : 'HIGH')
  }

  const breakdown: Breakdown = {
    severity_points,
    exploit_points,
    kev_points,
    criticality_points,
    exposure_points,
    relevance_points,
    total_raw: raw,
    total_capped: score,
    formula_version: FORMULA_VERSION,
  }

  return {
    breakdown,
    score,
    level,
    suppressed,
    wouldHaveScored: suppressed ? wouldHaveScored : undefined,
    dataIncomplete,
  }
}

export const scoreLabel = (level: RiskLevel) =>
  ({ CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' })[level]

export const relevanceLabel: Record<RelevanceStatus, string> = {
  MATCHED: 'Version in range',
  VERSION_UNKNOWN: 'Version unverified',
  NOT_AFFECTED: 'Not affected',
  PRODUCT_ABSENT: 'Product absent',
}

export const relevanceReason: Record<RelevanceStatus, string> = {
  MATCHED: 'Installed version falls inside the published affected range.',
  VERSION_UNKNOWN: 'Product is present but the installed version is missing or unparseable.',
  NOT_AFFECTED: 'Installed version is outside the affected range.',
  PRODUCT_ABSENT: 'The affected product is not present on this asset.',
}
