import { useMemo } from 'react'
import { alerts as seedAlerts, cves as seedCves, sourceHealth as seedSourceHealth } from '../data/seed'
import { buildScopedAlerts, LIVE_SCOPE, normalizeScopeId, useDataScope } from './dataScope'
import { mergeCve, useLiveFeeds, type LiveCvePatch, type LiveSource, type LiveSourceMeta } from './liveFeeds'
import { portfolioFor, predict, type MlPrediction, type MlPortfolio } from './ml'
import { postureFromCounts, relevanceReason, round1, scoreAlert } from './scoring'
import { useUploads } from './uploads'
import type { Alert, Cve, SourceHealth } from './types'

export interface LiveCounts {
  total: number
  active: number
  suppressed: number
  critical: number
  high: number
  medium: number
  low: number
  kev: number
  cves: number
}

const kevNoteFor = (cve: Cve) =>
  cve.kev && cve.kevDue
    ? ` CISA KEV remediation was due ${new Date(cve.kevDue).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`
    : ''

export function enrichAlert(alert: Alert, patch?: LiveCvePatch): Alert {
  if (!patch) return alert
  const cve = mergeCve(alert.cve, patch)
  const result = scoreAlert({
    cve,
    criticality: alert.asset.criticality,
    internetFacing: alert.asset.internetFacing,
    relevance: alert.relevance,
  })
  const kevNote = kevNoteFor(cve)
  const reasoning = result.suppressed
    ? `${relevanceReason[alert.relevance]} The relevance gate zeroes the score; a CVSS-only queue would have ranked it ${result.wouldHaveScored?.toFixed(1)}.${kevNote}`
    : `${result.level} at ${result.score.toFixed(1)}: severity ${round1(result.breakdown.severity_points)} + exploitation ${round1(result.breakdown.exploit_points + result.breakdown.kev_points)} + asset ${round1(result.breakdown.criticality_points + result.breakdown.exposure_points)} + relevance ${round1(result.breakdown.relevance_points)}.${kevNote}`

  return {
    ...alert,
    cve,
    score: result.score,
    level: result.level,
    suppressed: result.suppressed,
    suppressionReason: result.suppressed ? relevanceReason[alert.relevance] : undefined,
    wouldHaveScored: result.wouldHaveScored,
    dataIncomplete: result.dataIncomplete,
    breakdown: result.breakdown,
    reasoning,
    entities: [cve.product, alert.version !== 'unknown' && alert.version !== 'not installed' ? alert.version : '', ...cve.cwe].filter(Boolean),
  }
}

export function enrichAlerts(
  alerts: Alert[],
  patches: Record<string, LiveCvePatch>,
): Alert[] {
  return alerts.map((alert) => enrichAlert(alert, patches[alert.cve.id]))
}

export function enrichCves(cves: Cve[], patches: Record<string, LiveCvePatch>): Cve[] {
  return cves.map((cve) => mergeCve(cve, patches[cve.id]))
}

export function countsFor(alerts: Alert[], cves: Cve[]): LiveCounts {
  const active = alerts.filter((alert) => !alert.suppressed)
  return {
    total: alerts.length,
    active: active.length,
    suppressed: alerts.length - active.length,
    critical: active.filter((alert) => alert.level === 'CRITICAL').length,
    high: active.filter((alert) => alert.level === 'HIGH').length,
    medium: active.filter((alert) => alert.level === 'MEDIUM').length,
    low: active.filter((alert) => alert.level === 'LOW').length,
    kev: cves.filter((cve) => cve.kev).length,
    cves: cves.length,
  }
}

export function postureFor(counts: LiveCounts): number {
  return postureFromCounts(counts)
}

export interface LiveMl {
  byAlert: Record<string, MlPrediction>
  active: { alert: Alert; prediction: MlPrediction }[]
  portfolio: MlPortfolio
}

export function mlForAlerts(alerts: Alert[]): LiveMl {
  const byAlert: Record<string, MlPrediction> = {}
  for (const alert of alerts) byAlert[alert.id] = predict(alert)
  const active = alerts
    .filter((alert) => !alert.suppressed)
    .map((alert) => ({ alert, prediction: byAlert[alert.id] }))
    .sort((a, b) => b.prediction.probability - a.prediction.probability)
  return { byAlert, active, portfolio: portfolioFor(active) }
}

export function useLiveAlerts(): Alert[] {
  const patches = useLiveFeeds((state) => state.patches)
  const scopeId = useDataScope((state) => state.scopeId)
  const datasets = useUploads((state) => state.datasets)
  return useMemo(() => {
    const id = normalizeScopeId(scopeId, datasets)
    return id === LIVE_SCOPE ? enrichAlerts(seedAlerts, patches) : buildScopedAlerts(id, datasets, patches)
  }, [patches, scopeId, datasets])
}

export function useLiveActiveAlerts(): Alert[] {
  const alerts = useLiveAlerts()
  return useMemo(() => alerts.filter((alert) => !alert.suppressed), [alerts])
}

export function useLiveSuppressedAlerts(): Alert[] {
  const alerts = useLiveAlerts()
  return useMemo(() => alerts.filter((alert) => alert.suppressed), [alerts])
}

export function useLiveCves(): Cve[] {
  const patches = useLiveFeeds((state) => state.patches)
  return useMemo(() => enrichCves(seedCves, patches), [patches])
}

export function useLiveCveById(): Record<string, Cve> {
  const cves = useLiveCves()
  return useMemo(
    () => Object.fromEntries(cves.map((cve) => [cve.id, cve])) as Record<string, Cve>,
    [cves],
  )
}

export function useLiveCounts(): LiveCounts {
  const alerts = useLiveAlerts()
  const cves = useLiveCves()
  return useMemo(() => countsFor(alerts, cves), [alerts, cves])
}

export function useLivePosture(): number {
  const counts = useLiveCounts()
  return postureFor(counts)
}

export function useLiveMl(): LiveMl {
  const alerts = useLiveAlerts()
  return useMemo(() => mlForAlerts(alerts), [alerts])
}

export function currentLiveAlerts(): Alert[] {
  const datasets = useUploads.getState().datasets
  const id = normalizeScopeId(useDataScope.getState().scopeId, datasets)
  const patches = useLiveFeeds.getState().patches
  return id === LIVE_SCOPE ? enrichAlerts(seedAlerts, patches) : buildScopedAlerts(id, datasets, patches)
}

export function currentLiveCves(): Cve[] {
  return enrichCves(seedCves, useLiveFeeds.getState().patches)
}

export function currentLiveCounts(): LiveCounts {
  return countsFor(currentLiveAlerts(), currentLiveCves())
}

export function currentLivePosture(): number {
  return postureFor(currentLiveCounts())
}

const LIVE_SOURCES: LiveSource[] = ['NVD', 'CISA KEV', 'FIRST EPSS']

export function sourceHealthFor(meta: Partial<Record<LiveSource, LiveSourceMeta>>): SourceHealth[] {
  return seedSourceHealth.map((source) => {
    if (!LIVE_SOURCES.includes(source.source as LiveSource)) return source
    const live = meta[source.source as LiveSource]
    if (!live) return source
    return {
      ...source,
      status: live.status === 'ok' ? 'OK' : 'DEGRADED',
      lastSuccess: live.fetchedAt,
      note:
        live.status === 'ok'
          ? `${source.note} · live pull`
          : `${source.note} · ${live.error ?? 'live pull failed'}`,
    }
  })
}

export function useLiveSourceHealth(): SourceHealth[] {
  const meta = useLiveFeeds((state) => state.meta)
  return useMemo(() => sourceHealthFor(meta), [meta])
}

export function currentLiveSourceHealth(): SourceHealth[] {
  return sourceHealthFor(useLiveFeeds.getState().meta)
}

export function currentLiveMl(alerts: Alert[] = currentLiveAlerts()): LiveMl {
  return mlForAlerts(alerts)
}
