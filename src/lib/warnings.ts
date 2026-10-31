import { DEMO_NOW } from '../data/seed'
import { fmtScore } from './format'
import type { Alert, Cve } from './types'

export type WarningStage =
  | 'EMERGING'
  | 'MATCHED'
  | 'ELEVATED'
  | 'WARNING'
  | 'PREVENT'
  | 'MONITORING'
  | 'REDUCED'

export const WARNING_STAGES: {
  key: WarningStage
  label: string
  short: string
  description: string
  color: string
}[] = [
  {
    key: 'EMERGING',
    label: 'Emerging signal',
    short: 'Emerging',
    description: 'A vulnerability or signal exists, but the version gate has not confirmed exposure.',
    color: '#8d99a8',
  },
  {
    key: 'MATCHED',
    label: 'Exposure matched',
    short: 'Matched',
    description: 'An installed version falls inside the affected range. Treatment is being decided.',
    color: '#3ed2c1',
  },
  {
    key: 'ELEVATED',
    label: 'Elevated',
    short: 'Elevated',
    description: 'Exploitation signals are strong or the asset is business-critical.',
    color: '#e3a455',
  },
  {
    key: 'WARNING',
    label: 'Active warning',
    short: 'Warning',
    description: 'Immediate attention: critical score, confirmed exploitation, or both.',
    color: '#ff5a1f',
  },
  {
    key: 'PREVENT',
    label: 'Prevention underway',
    short: 'Prevent',
    description: 'A preventive action is accepted or in progress.',
    color: '#5b7ea6',
  },
  {
    key: 'MONITORING',
    label: 'Monitoring',
    short: 'Monitor',
    description: 'The fix is reported complete and is waiting for independent verification.',
    color: '#6f8499',
  },
  {
    key: 'REDUCED',
    label: 'Risk reduced',
    short: 'Reduced',
    description: 'A person verified the fix against the evidence that raised the warning.',
    color: '#3fae74',
  },
]

export const stageMeta = (stage: WarningStage) =>
  WARNING_STAGES.find((s) => s.key === stage) ?? WARNING_STAGES[0]

export type ActionStatus = 'NEW' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED'

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  NEW: 'New',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  VERIFIED: 'Verified',
}

export const ACTION_STEPS: { key: ActionStatus; label: string; hint: string }[] = [
  { key: 'NEW', label: 'New', hint: 'Raised from live evidence, not yet owned.' },
  { key: 'ACCEPTED', label: 'Accepted', hint: 'A team has taken responsibility.' },
  { key: 'IN_PROGRESS', label: 'In progress', hint: 'Work has started.' },
  { key: 'COMPLETED', label: 'Completed', hint: 'Reported done. Not yet proven.' },
  { key: 'VERIFIED', label: 'Verified', hint: 'Checked against fresh evidence by a person.' },
]

export const ageInDays = (iso: string, now = DEMO_NOW) =>
  Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000))

/**
 * Derives the warning stage for one alert. The stage is a reading of the
 * evidence plus the action lifecycle — never a value the user sets directly.
 */
export function warningStageFor(
  alert: Alert,
  ctx: { acknowledged: boolean; actionStatuses?: ActionStatus[] },
): WarningStage {
  const statuses = ctx.actionStatuses ?? []
  if (statuses.includes('VERIFIED')) return 'REDUCED'
  if (statuses.includes('COMPLETED')) return 'MONITORING'
  if (statuses.includes('IN_PROGRESS') || statuses.includes('ACCEPTED')) return 'PREVENT'
  if (alert.suppressed) return 'EMERGING'
  if (alert.level === 'CRITICAL' || (alert.cve.kev && alert.level === 'HIGH')) return 'WARNING'
  if (alert.level === 'HIGH' || alert.score >= 55 || (alert.cve.kev && alert.relevance === 'MATCHED')) {
    return 'ELEVATED'
  }
  return 'MATCHED'
}

export function stageCounts(
  alerts: Alert[],
  acks: Record<string, unknown>,
  entries: Record<string, { status: ActionStatus }>,
  actionsFor: (alertId: string) => string[],
): Record<WarningStage, number> {
  const base = Object.fromEntries(WARNING_STAGES.map((s) => [s.key, 0])) as Record<WarningStage, number>
  alerts.forEach((alert) => {
    const statuses = actionsFor(alert.id).map((id) => entries[id]?.status ?? 'NEW')
    const stage = warningStageFor(alert, { acknowledged: Boolean(acks[alert.id]), actionStatuses: statuses })
    base[stage] += 1
  })
  return base
}

/* ------------------------------------------------------------------ */
/* Preventive recommendations                                          */
/* ------------------------------------------------------------------ */

export type RecommendationKind = 'PATCH' | 'VERIFY' | 'EXPOSURE'
export type RecommendationPriority = 'P1' | 'P2' | 'P3' | 'P4'

export const KIND_LABEL: Record<RecommendationKind, string> = {
  PATCH: 'Patch',
  VERIFY: 'Confirm version',
  EXPOSURE: 'Reduce exposure',
}

export const PRIORITY_LABEL: Record<RecommendationPriority, string> = {
  P1: 'P1 · act now',
  P2: 'P2 · this week',
  P3: 'P3 · scheduled',
  P4: 'P4 · watch',
}

export const PRIORITY_ORDER: RecommendationPriority[] = ['P1', 'P2', 'P3', 'P4']

const SLA_DAYS: Record<RecommendationPriority, number> = { P1: 3, P2: 7, P3: 14, P4: 30 }

const TEAM_BY_DEPARTMENT: Record<string, string> = {
  'People Operations': 'HR Platforms',
  Finance: 'Finance Systems',
  'IT Infrastructure': 'Platform Engineering',
  Engineering: 'Application Security',
  'Customer Experience': 'Customer Platforms',
  Facilities: 'Facilities Technology',
}

export const teamForDepartment = (department: string) =>
  TEAM_BY_DEPARTMENT[department] ?? 'IT Operations'

export interface Recommendation {
  id: string
  alertId: string
  cveId: string
  cveTitle: string
  assetId: string
  assetName: string
  department: string
  kind: RecommendationKind
  title: string
  detail: string
  rationale: string[]
  priority: RecommendationPriority
  team: string
  due: string
  fixVersion: string
  version: string
  score: number
  level: Alert['level']
  kev: boolean
  internetFacing: boolean
  evidence: { label: string; value: string }[]
  verification: string
  evidenceKey: string
  createdAt: string
}

const addDays = (base: Date, days: number) => {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

export const affectedRange = (cve: Cve) => {
  const { range } = cve
  const low = range.startIncluding
    ? `from ${range.startIncluding}`
    : range.startExcluding
      ? `after ${range.startExcluding}`
      : null
  const high = range.endIncluding
    ? `up to ${range.endIncluding}`
    : range.endExcluding
      ? `up to but not including ${range.endExcluding}`
      : null
  if (!low && !high) return 'No published range'
  return [low, high].filter(Boolean).join(' ')
}

const priorityFor = (alert: Alert): RecommendationPriority => {
  if (alert.cve.kev && alert.relevance === 'MATCHED') return 'P1'
  if (alert.level === 'CRITICAL') return 'P1'
  if (alert.level === 'HIGH') return 'P2'
  if (alert.relevance === 'VERSION_UNKNOWN' && alert.asset.criticality === 'HIGH') return 'P2'
  if (alert.level === 'MEDIUM') return 'P3'
  return 'P4'
}

const evidenceKeyFor = (alert: Alert) =>
  [
    alert.cve.id,
    alert.cve.modified,
    alert.cve.cvss ?? 'na',
    alert.cve.epss ?? 'na',
    alert.cve.kev ? 'kev' : 'nokev',
    alert.cve.fixVersion,
    alert.version,
    alert.score,
  ].join('|')

const evidenceFor = (alert: Alert) => {
  const rows = [
    { label: 'Risk score', value: `${fmtScore(alert.score)} / 100` },
    { label: 'Installed', value: alert.version === 'unknown' ? 'Not recorded' : alert.version },
    { label: 'EPSS', value: alert.cve.epss == null ? 'Not rated' : `${(alert.cve.epss * 100).toFixed(1)}%` },
    { label: 'Known exploited', value: alert.cve.kev ? 'Yes · CISA KEV' : 'Not listed' },
  ]
  return rows
}

const rationaleFor = (alert: Alert) => {
  const out: string[] = []
  if (alert.cve.kev) out.push('Known exploited')
  if (alert.cve.epss != null && alert.cve.epss >= 0.5) out.push(`EPSS ${(alert.cve.epss * 100).toFixed(0)}%`)
  if (alert.relevance === 'MATCHED') out.push('Version in range')
  if (alert.relevance === 'VERSION_UNKNOWN') out.push('Version not recorded')
  if (alert.asset.internetFacing) out.push('Internet-facing')
  if (alert.asset.criticality === 'HIGH') out.push('Critical system')
  return out.slice(0, 4)
}

function patchRec(alert: Alert, priority: RecommendationPriority, now: Date): Recommendation {
  const cve = alert.cve
  return {
    id: `rec-${alert.id}-PATCH`,
    alertId: alert.id,
    cveId: cve.id,
    cveTitle: cve.title,
    assetId: alert.asset.id,
    assetName: alert.asset.name,
    department: alert.asset.department,
    kind: 'PATCH',
    title: `Upgrade ${cve.product} on ${alert.asset.name} to ${cve.fixVersion}`,
    detail: `${cve.id} affects ${cve.product} ${affectedRange(cve)}. Installing ${cve.fixVersion} or later removes the affected code path, then restart the service.`,
    rationale: rationaleFor(alert),
    priority,
    team: teamForDepartment(alert.asset.department),
    due: cve.kev && cve.kevDue ? cve.kevDue : addDays(now, SLA_DAYS[priority]),
    fixVersion: cve.fixVersion,
    version: alert.version,
    score: alert.score,
    level: alert.level,
    kev: cve.kev,
    internetFacing: alert.asset.internetFacing,
    evidence: evidenceFor(alert),
    verification: `A rescan of ${alert.asset.name} reports ${cve.product} ${cve.fixVersion} or later, and the affected service restarted cleanly.`,
    evidenceKey: evidenceKeyFor(alert),
    createdAt: alert.createdAt,
  }
}

function verifyRec(alert: Alert, priority: RecommendationPriority, now: Date): Recommendation {
  const cve = alert.cve
  return {
    id: `rec-${alert.id}-VERIFY`,
    alertId: alert.id,
    cveId: cve.id,
    cveTitle: cve.title,
    assetId: alert.asset.id,
    assetName: alert.asset.name,
    department: alert.asset.department,
    kind: 'VERIFY',
    title: `Confirm the ${cve.product} version on ${alert.asset.name}`,
    detail: `${cve.product} is on the asset, but its version is missing. Until the version is recorded, exposure cannot be confirmed or ruled out.`,
    rationale: rationaleFor(alert),
    priority,
    team: teamForDepartment(alert.asset.department),
    due: addDays(now, SLA_DAYS[priority]),
    fixVersion: cve.fixVersion,
    version: alert.version,
    score: alert.score,
    level: alert.level,
    kev: cve.kev,
    internetFacing: alert.asset.internetFacing,
    evidence: [
      { label: 'Risk score', value: `${fmtScore(alert.score)} / 100` },
      { label: 'Installed', value: 'Not recorded' },
      { label: 'Affected range', value: affectedRange(cve) },
      { label: 'Known exploited', value: cve.kev ? 'Yes · CISA KEV' : 'Not listed' },
    ],
    verification: `The asset inventory records the installed ${cve.product} version and a rescan confirms it, so the alert can be scored or cleared.`,
    evidenceKey: evidenceKeyFor(alert),
    createdAt: alert.createdAt,
  }
}

function exposureRec(alert: Alert, priority: RecommendationPriority, now: Date): Recommendation {
  const cve = alert.cve
  return {
    id: `rec-${alert.id}-EXPOSURE`,
    alertId: alert.id,
    cveId: cve.id,
    cveTitle: cve.title,
    assetId: alert.asset.id,
    assetName: alert.asset.name,
    department: alert.asset.department,
    kind: 'EXPOSURE',
    title: `Reduce internet exposure on ${alert.asset.name}`,
    detail: `Keep public traffic away from ${alert.asset.name} until the ${cve.product} patch is verified. Restrict the service at the edge or add a compensating control.`,
    rationale: rationaleFor(alert),
    priority: priority === 'P1' ? 'P1' : 'P2',
    team: 'Security Operations',
    due: addDays(now, priority === 'P1' ? 1 : 3),
    fixVersion: cve.fixVersion,
    version: alert.version,
    score: alert.score,
    level: alert.level,
    kev: cve.kev,
    internetFacing: true,
    evidence: [
      { label: 'Reachability', value: 'Public' },
      { label: 'Asset importance', value: alert.asset.criticality },
      { label: 'Risk score', value: `${fmtScore(alert.score)} / 100` },
      { label: 'Known exploited', value: cve.kev ? 'Yes · CISA KEV' : 'Not listed' },
    ],
    verification: `An external scan shows ${alert.asset.name} is no longer reachable from the public internet, or the edge control is documented and tested.`,
    evidenceKey: evidenceKeyFor(alert),
    createdAt: alert.createdAt,
  }
}

/**
 * Builds preventive actions from the current alert evidence. Generation is
 * deterministic: the same alert evidence always produces the same action ids,
 * so status and notes survive live-data refreshes.
 */
export function buildRecommendations(alerts: Alert[], now = DEMO_NOW): Recommendation[] {
  const out: Recommendation[] = []
  const seen = new Set<string>()
  const exposureByAsset = new Map<string, Recommendation>()
  const rank = (r: Recommendation) => PRIORITY_ORDER.indexOf(r.priority)

  const addExposure = (alert: Alert, priority: RecommendationPriority) => {
    const next = exposureRec(alert, priority, now)
    const current = exposureByAsset.get(alert.asset.id)
    if (
      !current ||
      rank(next) < rank(current) ||
      (rank(next) === rank(current) && next.score > current.score)
    ) {
      exposureByAsset.set(alert.asset.id, next)
    }
  }

  const relevanceRank = (alert: Alert) =>
    alert.relevance === 'MATCHED' ? 0 : alert.relevance === 'VERSION_UNKNOWN' ? 1 : 2
  const ordered = alerts
    .slice()
    .sort((a, b) => relevanceRank(a) - relevanceRank(b) || b.score - a.score)

  ordered.forEach((alert) => {
    if (alert.suppressed) return
    const priority = priorityFor(alert)
    const key = `${alert.cve.id}|${alert.asset.id}`
    if (seen.has(key)) return
    seen.add(key)

    if (alert.relevance === 'VERSION_UNKNOWN') {
      out.push(verifyRec(alert, priority, now))
      if (alert.asset.internetFacing) addExposure(alert, priority)
      return
    }
    if (alert.relevance !== 'MATCHED') return
    out.push(patchRec(alert, priority, now))
    if (alert.asset.internetFacing && (alert.level === 'CRITICAL' || alert.level === 'HIGH')) {
      addExposure(alert, priority)
    }
  })

  out.push(...exposureByAsset.values())
  return out.sort(
    (a, b) =>
      PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
      b.score - a.score ||
      a.id.localeCompare(b.id),
  )
}

export const isOverdue = (rec: Recommendation, status: ActionStatus, now = DEMO_NOW) =>
  status !== 'VERIFIED' && new Date(rec.due).getTime() < now.getTime()

export const isStale = (
  rec: Recommendation,
  entry?: { evidenceKey?: string; status: ActionStatus },
) => Boolean(entry && entry.status !== 'NEW' && entry.evidenceKey && entry.evidenceKey !== rec.evidenceKey)

export function actionStats(
  recs: Recommendation[],
  entries: Record<string, { status: ActionStatus }>,
  now = DEMO_NOW,
) {
  const statusOf = (id: string): ActionStatus => entries[id]?.status ?? 'NEW'
  const byStatus = Object.fromEntries(
    (['NEW', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED'] as ActionStatus[]).map((s) => [
      s,
      recs.filter((r) => statusOf(r.id) === s).length,
    ]),
  ) as Record<ActionStatus, number>
  const open = recs.filter((r) => statusOf(r.id) !== 'VERIFIED')
  return {
    total: recs.length,
    byStatus,
    open: open.length,
    verified: byStatus.VERIFIED,
    p1Open: open.filter((r) => r.priority === 'P1').length,
    overdue: open.filter((r) => isOverdue(r, statusOf(r.id), now)).length,
    verifiedShare: recs.length ? byStatus.VERIFIED / recs.length : 0,
  }
}
