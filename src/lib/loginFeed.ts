import { useMemo } from 'react'
import {
  LOGIN_CSV_FILE,
  LOGIN_JSON_FILE,
  LOGIN_POLL_MS,
  analyzeLoginEvents,
  useLoginIntel,
  type LoginAnalysis,
  type LoginEvent,
  type LoginFeedStatus,
} from './loginIntel'
import type { LogWindow } from './types'
import type { LogUploadSummary, UploadedDataset } from './uploads'

/* The portal capture arrives as raw login attempts. This module turns it into
   two first-class Aegis things: a Logs dataset and per-attempt anomaly windows. */

export const LIVE_LOGIN_DATASET_ID = 'DS-LIVE-LOGIN'
export const LIVE_LOGIN_DATASET_NAME = 'Northwind portal logins · live'
const MAX_WINDOWS = 160

const round2 = (n: number) => Math.round(n * 100) / 100

const toIso = (epoch: number) => new Date(epoch).toISOString()

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

const dayStamp = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/* Keep a HIGH identity score on or above the page's 0.20 anomaly threshold. */
const anomalyFromRisk = (risk: number) => {
  if (risk >= 55) return round2(0.2 + ((risk - 55) / 45) * 0.4)
  return round2(-0.3 + (risk / 55) * 0.5)
}

const describeWindow = (analysis: LoginAnalysis, event: LoginEvent) => {
  const finding = analysis.findings[0]
  if (finding) return finding.title
  if (analysis.level !== 'LOW') return analysis.verdict
  return event.success ? 'Successful sign-in within tolerance' : 'Failed sign-in below the detection threshold'
}

export function loginWindows(events: LoginEvent[]): LogWindow[] {
  if (!events.length) return []
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const sample = sorted.slice(-MAX_WINDOWS)
  const sameDay =
    new Date(sample[0].at).toDateString() === new Date(sample[sample.length - 1].at).toDateString()
  const seenIps = new Set<string>()
  const seenCountries = new Set<string>()
  const windows: LogWindow[] = []
  let previous = 0
  let failuresSoFar = 0

  sample.forEach((event, index) => {
    const prefix = sample.slice(0, index + 1)
    const analysis = analyzeLoginEvents(prefix)
    if (!event.success) failuresSoFar += 1
    const epoch = Date.parse(event.at)
    const gap = previous ? Math.max(0.5, (epoch - previous) / 1000) : 1
    previous = epoch
    const newCountry = !seenCountries.has(event.country)
    seenCountries.add(event.country)
    seenIps.add(event.sourceIp)
    const level = analysis.level
    windows.push({
      id: `LIVE-${event.id}`,
      label: sameDay ? clock(event.at) : `${dayStamp(event.at)} ${clock(event.at)}`,
      at: event.at,
      failedLogins: event.success ? 0 : 1,
      successes: event.success ? 1 : 0,
      attemptsSoFar: index + 1,
      failuresSoFar,
      riskScore: analysis.score,
      distinctIps: seenIps.size,
      rps: Math.max(1, Math.round(1 / gap)),
      countryNovelty: newCountry ? 1 : 0,
      anomalyScore: anomalyFromRisk(analysis.score),
      anomaly: level === 'HIGH' || level === 'CRITICAL',
      reason: describeWindow(analysis, event),
      account: event.email,
      sourceIp: event.sourceIp,
      country: event.city ? `${event.city}, ${event.countryName}` : event.countryName,
      level,
      kind: 'live',
    })
  })

  return windows
}

export function loginLogSummary(analysis: LoginAnalysis): LogUploadSummary {
  const codes = analysis.sources.flatMap((source) => source.countries)
  const eventTypes: Record<string, number> = {}
  if (analysis.metrics.failures) eventTypes.LOGIN_FAIL = analysis.metrics.failures
  if (analysis.metrics.successes) eventTypes.LOGIN_SUCCESS = analysis.metrics.successes
  return {
    total: analysis.metrics.attempts,
    eventTypes,
    failedLogins: analysis.metrics.failures,
    distinctIps: analysis.metrics.ips,
    destinations: ['Northwind Employee Portal'],
    countries: [...new Set(codes)],
    firstTimestamp: analysis.firstAt,
    lastTimestamp: analysis.lastAt,
  }
}

export function buildLoginDataset(
  analysis: LoginAnalysis,
  status: LoginFeedStatus,
  lastSync: string | null,
): UploadedDataset | null {
  if (!analysis.metrics.attempts) return null
  const live = status === 'live'
  return {
    id: LIVE_LOGIN_DATASET_ID,
    name: LIVE_LOGIN_DATASET_NAME,
    type: 'Logs',
    status: 'ACCEPTED',
    rows: analysis.metrics.attempts,
    accepted: analysis.metrics.attempts,
    rejected: 0,
    uploadedBy: 'Northwind decoy portal',
    uploadedAt: lastSync ?? analysis.lastAt ?? toIso(Date.now()),
    source: 'LIVE CAPTURE',
    assets: [],
    logs: loginLogSummary(analysis),
    live: true,
    provider: live ? `Auto-fetch · poll ${LOGIN_POLL_MS / 1000}s` : 'Last capture · portal offline',
    risk: { score: analysis.score, level: analysis.level, verdict: analysis.verdict },
    files: { json: LOGIN_JSON_FILE, csv: LOGIN_CSV_FILE },
  }
}

export interface LoginCapture {
  events: LoginEvent[]
  analysis: LoginAnalysis
  windows: LogWindow[]
  failed: number
  granted: number
  accounts: number
  sources: number
  countries: number
  latestFailure: LoginEvent | null
  dataset: UploadedDataset | null
  status: LoginFeedStatus
  error: string | null
  lastSync: string | null
  autoRefresh: boolean
}

function buildCapture(
  events: LoginEvent[],
  status: LoginFeedStatus,
  error: string | null,
  lastSync: string | null,
  autoRefresh: boolean,
): LoginCapture {
  const analysis = analyzeLoginEvents(events)
  const newestFirst = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return {
    events,
    analysis,
    windows: loginWindows(events),
    failed: analysis.metrics.failures,
    granted: analysis.metrics.successes,
    accounts: analysis.metrics.accounts,
    sources: analysis.metrics.ips,
    countries: analysis.metrics.countries,
    latestFailure: newestFirst.find((event) => !event.success) ?? null,
    dataset: buildLoginDataset(analysis, status, lastSync),
    status,
    error,
    lastSync,
    autoRefresh,
  }
}

export function currentLoginCapture(): LoginCapture {
  const state = useLoginIntel.getState()
  return buildCapture(state.events, state.status, state.error, state.lastSync, state.autoRefresh)
}

export function useLoginCapture(): LoginCapture {
  const events = useLoginIntel((state) => state.events)
  const status = useLoginIntel((state) => state.status)
  const error = useLoginIntel((state) => state.error)
  const lastSync = useLoginIntel((state) => state.lastSync)
  const autoRefresh = useLoginIntel((state) => state.autoRefresh)
  return useMemo(() => buildCapture(events, status, error, lastSync, autoRefresh), [events, status, error, lastSync, autoRefresh])
}
