import { useMemo } from 'react'
import { useScopedInventory } from './dataScope'
import { useLiveCves } from './liveFeeds'
import { useLiveAlerts } from './liveData'
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

export function buildCorrelationModel(liveCves: Cve[], liveAlerts: Alert[], liveAssets: Asset[]): CorrelationModel {
  const alerts = sortAlerts(liveAlerts)

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
    assets: liveAssets,
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
  const alerts = useLiveAlerts()
  const assets = useScopedInventory()
  return useMemo(() => buildCorrelationModel(cves, alerts, assets), [cves, alerts, assets])
}
