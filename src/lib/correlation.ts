import { useMemo } from 'react'
import { alerts as seedAlerts, assets as seedAssets } from '../data/seed'
import { useLiveCves } from './liveFeeds'
import { relevanceReason, round1, scoreAlert } from './scoring'
import type { Alert, Asset, Cve, RiskLevel } from './types'

export const RISK_ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

export const riskRank = (level: RiskLevel) => RISK_ORDER.indexOf(level)

export const worstLevel = (list: Alert[]): RiskLevel | null => {
  let worst: RiskLevel | null = null
  for (const alert of list) {
    if (alert.suppressed) continue
    if (!worst || riskRank(alert.level) > riskRank(worst)) worst = alert.level
  }
  return worst
}

export const rangeText = (cve: Cve) => {
  const r = cve.range
  if (!r.startIncluding && !r.startExcluding && !r.endIncluding && !r.endExcluding) return 'not published'
  const start = r.startIncluding ? `≥ ${r.startIncluding}` : r.startExcluding ? `> ${r.startExcluding}` : '*'
  const end = r.endIncluding ? `≤ ${r.endIncluding}` : r.endExcluding ? `< ${r.endExcluding}` : '*'
  return `${start} → ${end}`
}

export const sortAlerts = (list: Alert[]) =>
  [...list].sort(
    (a, b) =>
      Number(a.suppressed) - Number(b.suppressed) ||
      b.score - a.score ||
      a.cve.id.localeCompare(b.cve.id),
  )

const kevNote = (cve: Cve) =>
  cve.kev && cve.kevDue
    ? ` CISA KEV remediation was due ${new Date(cve.kevDue).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}.`
    : ''

const refreshAlert = (alert: Alert, cve: Cve): Alert => {
  const result = scoreAlert({
    cve,
    criticality: alert.asset.criticality,
    internetFacing: alert.asset.internetFacing,
    relevance: alert.relevance,
  })

  const installed = alert.asset.software.find((entry) => entry.product.toLowerCase() === cve.product.toLowerCase())
  const version = installed?.version ?? alert.version
  const asset = alert.asset

  const summary =
    alert.relevance === 'MATCHED'
      ? `${cve.title} applies to ${asset.name}: ${cve.product} ${version} falls inside the affected range.`
      : alert.relevance === 'VERSION_UNKNOWN'
        ? `${cve.title} may apply to ${asset.name}; the installed ${cve.product} version could not be verified.`
        : alert.relevance === 'NOT_AFFECTED'
          ? `${asset.name} runs ${cve.product} ${version}, which is outside the affected range.`
          : `${cve.product} is associated with ${asset.name} in the graph, but the product is not in its inventory.`

  const impact = `${asset.businessFunction} depends on ${asset.name}. A successful exploit could interrupt this service and expose ${asset.sensitivity.toLowerCase()}-sensitivity data.`

  const action =
    alert.relevance === 'MATCHED' || alert.relevance === 'VERSION_UNKNOWN'
      ? `Upgrade ${cve.product} on ${asset.name} to ${cve.fixVersion}, then restart the affected service.`
      : `No action required for ${asset.name}; keep the version check in the correlation pipeline.`

  const reasoning = result.suppressed
    ? `${relevanceReason[alert.relevance]} The relevance gate zeroes the score; a CVSS-only queue would have ranked it ${result.wouldHaveScored?.toFixed(1)}.${kevNote(cve)}`
    : `${result.level} at ${result.score.toFixed(1)}: severity ${round1(result.breakdown.severity_points)} + exploitation ${round1(result.breakdown.exploit_points + result.breakdown.kev_points)} + asset ${round1(result.breakdown.criticality_points + result.breakdown.exposure_points)} + relevance ${round1(result.breakdown.relevance_points)}.${kevNote(cve)}`

  return {
    ...alert,
    cve,
    version,
    score: result.score,
    level: result.level,
    suppressed: result.suppressed,
    suppressionReason: result.suppressed ? relevanceReason[alert.relevance] : undefined,
    wouldHaveScored: result.wouldHaveScored,
    dataIncomplete: result.dataIncomplete,
    breakdown: result.breakdown,
    summary,
    impact,
    action,
    reasoning,
    entities: [cve.product, version !== 'unknown' && version !== 'not installed' ? version : '', ...cve.cwe].filter(Boolean),
  }
}

export interface CorrelationModel {
  alerts: Alert[]
  assets: Asset[]
  cves: Cve[]
  alertsByAsset: Map<string, Alert[]>
  alertsByCve: Map<string, Alert[]>
  bestByAsset: Map<string, Alert>
  worstByAsset: Map<string, RiskLevel>
  linkedCveIds: Set<string>
  unlinkedCves: Cve[]
  counts: {
    total: number
    active: number
    suppressed: number
    critical: number
    high: number
    kev: number
    unlinked: number
    assetsWithHazards: number
    linkedCves: number
  }
}

export function buildCorrelationModel(liveCves: Cve[]): CorrelationModel {
  const cveMap = new Map(liveCves.map((cve) => [cve.id, cve]))
  const alerts = sortAlerts(
    seedAlerts.map((alert) => refreshAlert(alert, cveMap.get(alert.cve.id) ?? alert.cve)),
  )

  const alertsByAsset = new Map<string, Alert[]>()
  const alertsByCve = new Map<string, Alert[]>()
  for (const alert of alerts) {
    const assetList = alertsByAsset.get(alert.asset.id) ?? []
    assetList.push(alert)
    alertsByAsset.set(alert.asset.id, assetList)

    const cveList = alertsByCve.get(alert.cve.id) ?? []
    cveList.push(alert)
    alertsByCve.set(alert.cve.id, cveList)
  }

  const bestByAsset = new Map<string, Alert>()
  const worstByAsset = new Map<string, RiskLevel>()
  alertsByAsset.forEach((list, assetId) => {
    bestByAsset.set(assetId, list[0])
    const worst = worstLevel(list)
    if (worst) worstByAsset.set(assetId, worst)
  })

  const linkedCveIds = new Set(alerts.map((alert) => alert.cve.id))
  const unlinkedCves = liveCves.filter((cve) => !linkedCveIds.has(cve.id))
  const active = alerts.filter((alert) => !alert.suppressed)

  return {
    alerts,
    assets: seedAssets,
    cves: liveCves,
    alertsByAsset,
    alertsByCve,
    bestByAsset,
    worstByAsset,
    linkedCveIds,
    unlinkedCves,
    counts: {
      total: alerts.length,
      active: active.length,
      suppressed: alerts.length - active.length,
      critical: active.filter((alert) => alert.level === 'CRITICAL').length,
      high: active.filter((alert) => alert.level === 'HIGH').length,
      kev: active.filter((alert) => alert.cve.kev).length,
      unlinked: unlinkedCves.length,
      assetsWithHazards: new Set(active.map((alert) => alert.asset.id)).size,
      linkedCves: linkedCveIds.size,
    },
  }
}

export function useCorrelationModel(): CorrelationModel {
  const cves = useLiveCves()
  return useMemo(() => buildCorrelationModel(cves), [cves])
}
