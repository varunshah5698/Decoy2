import { create } from 'zustand'
import type { RiskLevel } from './types'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface LoginEvent {
  id: string
  at: string
  email: string
  success: boolean
  reason?: string
  sourceIp: string
  country: string
  countryName: string
  city?: string
  latitude?: number
  longitude?: number
  userAgent?: string
  device?: string
  portal?: string
  isTor?: boolean
  simulated?: boolean
}

export type LoginFeedStatus = 'idle' | 'connecting' | 'live' | 'offline'

export interface LoginContributor {
  id: string
  label: string
  value: number
  max: number
  note: string
}

export interface LoginAccount {
  email: string
  attempts: number
  failures: number
  successes: number
  ips: number
  countries: string[]
  first: string
  last: string
  takeover: boolean
}

export interface LoginSource {
  ip: string
  attempts: number
  failures: number
  successes: number
  countries: string[]
  accounts: string[]
  tor: boolean
}

export interface LoginFinding {
  id: string
  severity: RiskLevel
  title: string
  detail: string
  evidence: string[]
  technique: { id: string; name: string }
  action: string
}

export interface LoginBucket {
  at: string
  label: string
  attempts: number
  failures: number
  successes: number
  risk: number
}

interface TakeoverInfo {
  email: string
  failuresBefore: number
  firstFailureAt: string
  successAt: string
  ip: string
  country: string
  city: string
  isTor: boolean
}

interface TravelInfo {
  email: string
  from: string
  to: string
  minutes: number
  distanceKm: number
  speedKmh: number
}

interface AccountAgg {
  attempts: number
  failures: number
  successes: number
  ips: Set<string>
  countries: Set<string>
  first: number
  last: number
  events: LoginEvent[]
}

interface SourceAgg {
  attempts: number
  failures: number
  successes: number
  accounts: Set<string>
  countries: Set<string>
  tor: boolean
}

export interface LoginAnalysis {
  asOf: string | null
  firstAt: string | null
  lastAt: string | null
  windowMs: number
  score: number
  rawScore: number
  level: RiskLevel
  verdict: string
  scoreDelta: number
  contributors: LoginContributor[]
  metrics: {
    attempts: number
    failures: number
    successes: number
    failureRate: number
    accounts: number
    targetedAccounts: number
    ips: number
    countries: number
    recentFailures: number
    peakPerMinute: number
    durationMs: number
    torEvents: number
    simulatedEvents: number
    scriptEvents: number
    offHours: number
  }
  accounts: LoginAccount[]
  sources: LoginSource[]
  findings: LoginFinding[]
  techniques: { id: string; name: string }[]
  narrative: string
  recommendations: string[]
  buckets: LoginBucket[]
  takeover: TakeoverInfo | null
  impossibleTravel: TravelInfo | null
}

/* ------------------------------------------------------------------ */
/* Constants and small helpers                                         */
/* ------------------------------------------------------------------ */

export const LOGIN_LEVELS = { critical: 80, high: 55, medium: 30 } as const
export const LOGIN_POLL_MS = 2000

/* The portal is a separate Node service. Locally it is proxied by Vite on
   /api/portal; in production the browser talks to the Render deployment.
   VITE_PORTAL_API_BASE lets a host point at a different portal origin. */
const DEFAULT_PORTAL_ORIGIN = 'https://northwind-decoy-portal.onrender.com'
const configuredPortalOrigin = (import.meta.env.VITE_PORTAL_API_BASE as string | undefined)?.trim().replace(/\/+$/, '')
const localHost = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
export const PORTAL_ORIGIN = configuredPortalOrigin || (localHost ? '' : DEFAULT_PORTAL_ORIGIN)
export const PORTAL_API = PORTAL_ORIGIN ? `${PORTAL_ORIGIN}/api` : '/api/portal'
export const PORTAL_HOME =
  PORTAL_ORIGIN ||
  (typeof window === 'undefined' ? 'http://localhost:4300' : `${window.location.protocol}//${window.location.hostname}:4300`)
export const LOGIN_JSON_FILE = `${PORTAL_API}/events?limit=1000`
export const LOGIN_CSV_FILE = `${PORTAL_API}/events.csv`

const SCRIPT_UA =
  /(curl|python-requests|python-urllib|go-http-client|okhttp|wget|libwww|httpclient|headlesschrome|phantomjs|selenium|puppeteer|playwright|\bbot\b)/i

const COUNTRY_NAMES: Record<string, string> = {
  IN: 'India',
  SG: 'Singapore',
  US: 'United States',
  NL: 'Netherlands',
  BR: 'Brazil',
  NG: 'Nigeria',
  GB: 'United Kingdom',
  DE: 'Germany',
  FR: 'France',
  AU: 'Australia',
  CA: 'Canada',
  JP: 'Japan',
  CN: 'China',
  RU: 'Russia',
  AE: 'United Arab Emirates',
  ZA: 'South Africa',
}

export const countryLabel = (code: string) =>
  !code || code === 'unknown' ? 'Unknown location' : code.length === 2 ? COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase() : code

export const loginLevel = (score: number): RiskLevel =>
  score >= LOGIN_LEVELS.critical
    ? 'CRITICAL'
    : score >= LOGIN_LEVELS.high
      ? 'HIGH'
      : score >= LOGIN_LEVELS.medium
        ? 'MEDIUM'
        : 'LOW'

const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

const formatDuration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours < 24) return mins ? `${hours}h ${mins}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const hrs = hours % 24
  return hrs ? `${days}d ${hrs}h` : `${days}d`
}

const formatClock = (iso: string, withDate = false) =>
  new Date(iso).toLocaleString('en-US', {
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

const listWithAnd = (values: string[]) => {
  const list = values.filter(Boolean)
  if (!list.length) return ''
  if (list.length === 1) return list[0]
  if (list.length === 2) return `${list[0]} and ${list[1]}`
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

const normalizeKeys = (record: Record<string, unknown>) => {
  const map = new Map<string, unknown>()
  for (const [key, value] of Object.entries(record)) {
    map.set(key.replace(/[^a-z0-9]/gi, '').toLowerCase(), value)
  }
  return map
}

const pick = (map: Map<string, unknown>, aliases: string[]) => {
  for (const alias of aliases) {
    const value = map.get(alias)
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

const parseTime = (value: unknown): number | null => {
  if (value == null) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return value < 1e12 ? value * 1000 : value
  }
  const text = String(value).trim()
  if (!text) return null
  const numeric = Number(text)
  if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(text)) {
    return numeric < 1e12 ? numeric * 1000 : numeric
  }
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? null : parsed
}

const parseBool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  return ['true', '1', 'yes', 'y', 'on', 'tor', 'synthetic', 'demo'].includes(String(value ?? '').trim().toLowerCase())
}

const FAILURE_HINTS = [
  'fail',
  'denied',
  'deny',
  'invalid',
  'incorrect',
  'reject',
  'error',
  'blocked',
  'locked',
  'unauthor',
  'bad',
  'mismatch',
]
const SUCCESS_HINTS = ['success', 'succeed', 'granted', 'allowed', 'accept', 'pass', 'ok', 'true', 'login_success']

const parseSuccess = (value: unknown, reason?: unknown): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) {
    const reasonText = String(reason ?? '').trim().toLowerCase()
    return reasonText === 'ok' || reasonText === 'success'
  }
  if (FAILURE_HINTS.some((hint) => text.includes(hint))) return false
  if (SUCCESS_HINTS.some((hint) => text.includes(hint))) return true
  return false
}

const haversineKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

const numberOrUndefined = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/* ------------------------------------------------------------------ */
/* Normalisation: portal JSON, imported JSON/JSONL and CSV             */
/* ------------------------------------------------------------------ */

const normalizeRecord = (record: Record<string, unknown>, index: number): LoginEvent | null => {
  const map = normalizeKeys(record)
  const epoch = parseTime(
    pick(map, ['at', 'timestamp', 'time', 'datetime', 'eventtime', 'date', 'ts', 'occurredat', 'createdat']),
  )
  if (epoch === null) return null

  const email = String(pick(map, ['email', 'username', 'user', 'account', 'principal', 'upn', 'accountname', 'login']) ?? '')
    .trim()
    .toLowerCase()
  const reason = String(pick(map, ['reason', 'failurereason', 'resultreason', 'statusreason', 'error']) ?? '')
  const success = parseSuccess(
    pick(map, ['success', 'ok', 'outcome', 'result', 'eventtype', 'event', 'status', 'action', 'decision']),
    reason,
  )

  const rawCountry = String(pick(map, ['country', 'countrycode', 'cc', 'region']) ?? '').trim()
  const providedCountryName = String(pick(map, ['countryname']) ?? '').trim()
  const countryCode = /^[a-z]{2}$/i.test(rawCountry) ? rawCountry.toUpperCase() : ''
  const countryName =
    providedCountryName ||
    (countryCode ? COUNTRY_NAMES[countryCode] ?? countryCode : rawCountry) ||
    'Unknown location'

  const city = String(pick(map, ['city', 'location', 'town']) ?? '').trim()
  const rawIp = String(
    pick(map, ['sourceip', 'srcip', 'ip', 'clientip', 'remoteip', 'ipaddress', 'sourceaddress', 'actorip']) ?? '',
  ).trim()
  const userAgent = String(pick(map, ['useragent', 'ua', 'agent', 'httpuseragent']) ?? '').trim()
  const device = String(pick(map, ['device', 'devicename']) ?? '').trim()

  return {
    id: String(pick(map, ['id', 'eventid', 'recordid', 'uid']) ?? `IMP-${String(index + 1).padStart(3, '0')}`),
    at: new Date(epoch).toISOString(),
    email: email || '(unknown account)',
    success,
    reason: reason || (success ? 'OK' : 'FAILED'),
    sourceIp: rawIp || 'unknown',
    country: countryCode || rawCountry || 'unknown',
    countryName,
    city: city || undefined,
    latitude: numberOrUndefined(pick(map, ['latitude', 'lat'])),
    longitude: numberOrUndefined(pick(map, ['longitude', 'lng', 'lon'])),
    userAgent: userAgent || undefined,
    device: device || undefined,
    portal: String(pick(map, ['portal', 'application', 'app', 'service']) ?? 'Northwind Employee Portal'),
    isTor: parseBool(pick(map, ['istor', 'tor'])),
    simulated: parseBool(pick(map, ['simulated', 'synthetic', 'demo'])),
  }
}

export function normalizeLoginRecords(records: unknown[]): LoginEvent[] {
  const events: LoginEvent[] = []
  records.forEach((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return
    const event = normalizeRecord(record as Record<string, unknown>, index)
    if (event) events.push(event)
  })
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

export function normalizePortalPayload(payload: unknown): LoginEvent[] {
  if (Array.isArray(payload)) return normalizeLoginRecords(payload)
  if (payload && typeof payload === 'object') {
    const events = (payload as { events?: unknown }).events
    if (Array.isArray(events)) return normalizeLoginRecords(events)
  }
  return []
}

/* ------------------------------------------------------------------ */
/* Deterministic analysis                                              */
/* ------------------------------------------------------------------ */

const emptyAnalysis = (): LoginAnalysis => ({
  asOf: null,
  firstAt: null,
  lastAt: null,
  windowMs: 0,
  score: 0,
  rawScore: 0,
  level: 'LOW',
  verdict: 'No sign-in activity captured',
  scoreDelta: 0,
  contributors: [],
  metrics: {
    attempts: 0,
    failures: 0,
    successes: 0,
    failureRate: 0,
    accounts: 0,
    targetedAccounts: 0,
    ips: 0,
    countries: 0,
    recentFailures: 0,
    peakPerMinute: 0,
    durationMs: 0,
    torEvents: 0,
    simulatedEvents: 0,
    scriptEvents: 0,
    offHours: 0,
  },
  accounts: [],
  sources: [],
  findings: [],
  techniques: [],
  narrative:
    'No sign-in attempts have been captured yet. Start the Northwind decoy portal, fail a few logins, and the board will rebuild itself on the next poll.',
  recommendations: [],
  buckets: [],
  takeover: null,
  impossibleTravel: null,
})

interface Core {
  score: number
  rawScore: number
  contributors: LoginContributor[]
  level: RiskLevel
  metrics: LoginAnalysis['metrics']
  accounts: LoginAccount[]
  sources: LoginSource[]
  takeover: TakeoverInfo | null
  impossibleTravel: TravelInfo | null
  novelCountry: { email: string; country: string; city: string; isTor: boolean; previousCountry?: string } | null
  signals: {
    brute: boolean
    spray: boolean
    stuffing: boolean
    distributed: boolean
    script: boolean
    torSuccess: boolean
    torFailure: boolean
    offHours: boolean
  }
  failureIps: number
  failureAccounts: number
}

function computeCore(sorted: LoginEvent[]): Core {
  const emptyMetrics = emptyAnalysis().metrics
  if (!sorted.length) {
    return {
      score: 0,
      rawScore: 0,
      contributors: [],
      level: 'LOW',
      metrics: emptyMetrics,
      accounts: [],
      sources: [],
      takeover: null,
      impossibleTravel: null,
      novelCountry: null,
      signals: {
        brute: false,
        spray: false,
        stuffing: false,
        distributed: false,
        script: false,
        torSuccess: false,
        torFailure: false,
        offHours: false,
      },
      failureIps: 0,
      failureAccounts: 0,
    }
  }

  const first = Date.parse(sorted[0].at)
  const last = Date.parse(sorted[sorted.length - 1].at)
  const duration = Math.max(0, last - first)
  const recentCutoff = last - 15 * 60_000

  const accountMap = new Map<string, AccountAgg>()
  const sourceMap = new Map<string, SourceAgg>()
  const countries = new Set<string>()
  let failures = 0
  let successes = 0
  let recentFailures = 0
  let torEvents = 0
  let simulatedEvents = 0
  let scriptEvents = 0
  let offHours = 0
  const minuteCounts = new Map<number, number>()
  const torSuccess = sorted.some((event) => event.success && event.isTor)
  let torFailure = false
  const failureIpsSet = new Set<string>()
  const failureAccountsSet = new Set<string>()
  const healthFailures = new Map<string, LoginEvent[]>()

  for (const event of sorted) {
    const time = Date.parse(event.at)
    const countryKey = event.country || event.countryName || 'unknown'
    countries.add(countryKey)
    if (event.isTor) torEvents += 1
    if (event.simulated) simulatedEvents += 1
    if (event.userAgent && SCRIPT_UA.test(event.userAgent)) scriptEvents += 1
    const hour = new Date(event.at).getHours()
    if (hour >= 22 || hour < 6) offHours += 1
    const minute = Math.floor(time / 60_000)
    minuteCounts.set(minute, (minuteCounts.get(minute) ?? 0) + 1)

    let account = accountMap.get(event.email)
    if (!account) {
      account = {
        attempts: 0,
        failures: 0,
        successes: 0,
        ips: new Set(),
        countries: new Set(),
        first: time,
        last: time,
        events: [],
      }
      accountMap.set(event.email, account)
    }
    account.attempts += 1
    account.last = Math.max(account.last, time)
    account.first = Math.min(account.first, time)
    account.ips.add(event.sourceIp)
    account.countries.add(countryKey)
    account.events.push(event)

    let source = sourceMap.get(event.sourceIp)
    if (!source) {
      source = {
        attempts: 0,
        failures: 0,
        successes: 0,
        accounts: new Set(),
        countries: new Set(),
        tor: false,
      }
      sourceMap.set(event.sourceIp, source)
    }
    source.attempts += 1
    source.accounts.add(event.email)
    source.countries.add(countryKey)
    source.tor = source.tor || Boolean(event.isTor)

    if (event.success) {
      successes += 1
      account.successes += 1
      source.successes += 1
    } else {
      failures += 1
      account.failures += 1
      source.failures += 1
      if (time >= recentCutoff) recentFailures += 1
      if (event.isTor) torFailure = true
      failureIpsSet.add(event.sourceIp)
      failureAccountsSet.add(event.email)
      const bucket = healthFailures.get(event.email) ?? []
      bucket.push(event)
      healthFailures.set(event.email, bucket)
    }
  }

  const peakPerMinute = Math.max(0, ...minuteCounts.values())

  // Brute force: five or more failures for one account inside any 15-minute span.
  const bruteAccounts: { email: string; count: number; first: number; last: number; ips: Set<string> }[] = []
  for (const [email, events] of healthFailures) {
    const times = events.map((event) => Date.parse(event.at)).sort((a, b) => a - b)
    let best = 0
    let bestStart = 0
    let bestEnd = 0
    let left = 0
    for (let right = 0; right < times.length; right += 1) {
      while (times[right] - times[left] > 15 * 60_000) left += 1
      const count = right - left + 1
      if (count > best) {
        best = count
        bestStart = times[left]
        bestEnd = times[right]
      }
    }
    if (best >= 5) {
      bruteAccounts.push({
        email,
        count: best,
        first: bestStart,
        last: bestEnd,
        ips: new Set(events.filter((event) => Date.parse(event.at) >= bestStart).map((event) => event.sourceIp)),
      })
    }
  }
  bruteAccounts.sort((a, b) => b.count - a.count)

  // Spray: one source failing against three or more accounts within the recent window.
  let spraySource: { ip: string; emailCount: number; failures: number; countries: string[] } | null = null
  for (const [ip, source] of sourceMap) {
    const recentAccounts = new Set<string>()
    let recentCount = 0
    for (const event of sorted) {
      if (event.sourceIp !== ip || event.success || Date.parse(event.at) < recentCutoff) continue
      recentAccounts.add(event.email)
      recentCount += 1
    }
    if (recentAccounts.size >= 3 && !spraySource) {
      spraySource = { ip, emailCount: recentAccounts.size, failures: recentCount, countries: [...source.countries] }
    }
  }

  // Takeover: a success following at least three failures for the same account within 30 minutes.
  let takeover: TakeoverInfo | null = null
  let novelCountry: Core['novelCountry'] = null
  const successCountries = new Map<string, string[]>()
  for (const [email, account] of accountMap) {
    const successesForAccount = account.events.filter((event) => event.success)
    successCountries.set(
      email,
      successesForAccount.map((event) => event.country || event.countryName || 'unknown'),
    )
    let priorFailures: number[] = []
    for (const event of account.events) {
      const time = Date.parse(event.at)
      if (!event.success) {
        priorFailures.push(time)
        continue
      }
      const recent = priorFailures.filter((failureAt) => time - failureAt <= 30 * 60_000)
      if (recent.length >= 3) {
        const candidate: TakeoverInfo = {
          email,
          failuresBefore: recent.length,
          firstFailureAt: new Date(recent[0]).toISOString(),
          successAt: event.at,
          ip: event.sourceIp,
          country: event.country || event.countryName || 'unknown',
          city: event.city ?? '',
          isTor: Boolean(event.isTor),
        }
        if (!takeover || candidate.failuresBefore > takeover.failuresBefore) takeover = candidate
      }
      priorFailures = []
    }
  }

  if (takeover) {
    const prior = (successCountries.get(takeover.email) ?? []).filter((country) => country !== takeover!.country)
    if (takeover.isTor || prior.length > 0) {
      novelCountry = {
        email: takeover.email,
        country: takeover.country,
        city: takeover.city,
        isTor: takeover.isTor,
        previousCountry: prior[0],
      }
    }
  }

  // Impossible travel between two successful sign-ins for the same account.
  let impossibleTravel: TravelInfo | null = null
  for (const [email, account] of accountMap) {
    const successesForAccount = account.events.filter((event) => event.success)
    for (let i = 0; i < successesForAccount.length; i += 1) {
      for (let j = i + 1; j < successesForAccount.length; j += 1) {
        const from = successesForAccount[i]
        const to = successesForAccount[j]
        const minutes = (Date.parse(to.at) - Date.parse(from.at)) / 60_000
        if (minutes <= 0 || minutes > 90) continue
        const countryA = from.country || from.countryName
        const countryB = to.country || to.countryName
        if (countryA === countryB) continue
        if (
          from.latitude === undefined ||
          from.longitude === undefined ||
          to.latitude === undefined ||
          to.longitude === undefined
        ) {
          continue
        }
        const distanceKm = haversineKm(from.latitude, from.longitude, to.latitude, to.longitude)
        if (distanceKm < 300) continue
        const speedKmh = distanceKm / (minutes / 60)
        if (speedKmh >= 900) {
          if (!impossibleTravel || speedKmh > impossibleTravel.speedKmh) {
            impossibleTravel = { email, from: countryA, to: countryB, minutes, distanceKm, speedKmh }
          }
        }
      }
    }
  }

  // Shared user agent across three or more failing source addresses.
  const uaIps = new Map<string, Set<string>>()
  for (const event of sorted) {
    if (event.success || !event.userAgent) continue
    const set = uaIps.get(event.userAgent) ?? new Set<string>()
    set.add(event.sourceIp)
    uaIps.set(event.userAgent, set)
  }
  const sharedUa = [...uaIps.values()].some((set) => set.size >= 3)

  const failureIps = failureIpsSet.size
  const failureAccounts = failureAccountsSet.size
  const accountSpread = Math.min(16, Math.max(0, failureAccounts - 1) * 3.4)
  const sourceSpread = Math.min(14, Math.max(0, failureIps - 1) * 2.4)
  const failurePressure = Math.min(30, recentFailures * 2.4 + (failures - recentFailures) * 0.6)
  const velocity = Math.min(12, peakPerMinute * 2.4)
  const stuffing = failures >= 8 && failureIps >= 3 && failureAccounts >= 3
  const spray = Boolean(spraySource)
  const brute = bruteAccounts.length > 0
  const distributed = failureIps >= 4 && failures >= 5
  const script = scriptEvents > 0
  const attackPattern = stuffing ? 8 : spray ? 8 : brute ? 6 : 0
  const compromise = takeover ? 32 : successes > 0 && failures >= 3 ? 12 : 0
  const geo = Math.min(
    10,
    (impossibleTravel ? 6 : 0) +
      (novelCountry ? 3 : 0) +
      (torSuccess ? 3 : 0) +
      (torFailure && !torSuccess ? 1 : 0),
  )
  const automation = Math.min(5, script ? 5 : sharedUa ? 2 : 0)
  const persistence = failures >= 8 && duration >= 4 * 60_000 ? 8 : failures >= 5 && duration >= 2 * 60_000 ? 4 : 0
  const offHoursPoints = offHours > 0 && failures >= 3 ? 3 : 0

  const contributors: LoginContributor[] = [
    {
      id: 'failure',
      label: 'Failure pressure',
      value: round1(failurePressure),
      max: 30,
      note: `${recentFailures} recent · ${failures - recentFailures} earlier ${plural(failures, 'failure')}`,
    },
    {
      id: 'accounts',
      label: 'Account spread',
      value: round1(accountSpread),
      max: 16,
      note: `${failureAccounts} ${plural(failureAccounts, 'account')} targeted`,
    },
    {
      id: 'sources',
      label: 'Source spread',
      value: round1(sourceSpread),
      max: 14,
      note: `${failureIps} failing ${plural(failureIps, 'address', 'addresses')}`,
    },
    {
      id: 'compromise',
      label: 'Successful break-in',
      value: round1(compromise),
      max: 32,
      note: takeover
        ? `success after ${takeover.failuresBefore} failures`
        : compromise > 0
          ? 'success during failure activity'
          : 'no success after an attack',
    },
    {
      id: 'velocity',
      label: 'Burst velocity',
      value: round1(velocity),
      max: 12,
      note: `peak ${peakPerMinute} ${plural(peakPerMinute, 'attempt')} / minute`,
    },
    {
      id: 'geo',
      label: 'Geo anomaly',
      value: round1(geo),
      max: 10,
      note: [
        impossibleTravel ? 'impossible travel' : '',
        novelCountry ? 'new country' : '',
        torSuccess || torFailure ? 'Tor exit' : '',
      ]
        .filter(Boolean)
        .join(' · ') || 'no country anomaly',
    },
    {
      id: 'automation',
      label: 'Automation signals',
      value: round1(automation),
      max: 5,
      note: script ? `${scriptEvents} scripted ${plural(scriptEvents, 'client')}` : sharedUa ? 'one client across many IPs' : 'browser-like clients',
    },
    {
      id: 'persistence',
      label: 'Persistence',
      value: round1(persistence),
      max: 8,
      note: failures >= 5 ? `attack spanned ${formatDuration(duration)}` : 'short-lived activity',
    },
    {
      id: 'offhours',
      label: 'Off-hours',
      value: round1(offHoursPoints),
      max: 3,
      note: offHoursPoints ? `${offHours} ${plural(offHours, 'event')} after 22:00` : 'within business hours',
    },
    {
      id: 'pattern',
      label: 'Attack pattern',
      value: round1(attackPattern),
      max: 8,
      note: stuffing ? 'distributed stuffing' : spray ? 'password spray' : brute ? 'brute force' : 'no pattern match',
    },
  ]

  const rawScore = contributors.reduce((sum, item) => sum + item.value, 0)
  const score = clamp(Math.round(rawScore), 0, 100)

  const accounts: LoginAccount[] = [...accountMap.entries()]
    .map(([email, account]) => ({
      email,
      attempts: account.attempts,
      failures: account.failures,
      successes: account.successes,
      ips: account.ips.size,
      countries: [...account.countries],
      first: new Date(account.first).toISOString(),
      last: new Date(account.last).toISOString(),
      takeover: takeover?.email === email,
    }))
    .sort((a, b) => b.failures - a.failures || b.attempts - a.attempts)

  const sources: LoginSource[] = [...sourceMap.entries()]
    .map(([ip, source]) => ({
      ip,
      attempts: source.attempts,
      failures: source.failures,
      successes: source.successes,
      countries: [...source.countries],
      accounts: [...source.accounts],
      tor: source.tor,
    }))
    .sort((a, b) => b.failures - a.failures || b.attempts - a.attempts)

  return {
    score,
    rawScore: round1(rawScore),
    contributors,
    level: loginLevel(score),
    metrics: {
      attempts: sorted.length,
      failures,
      successes,
      failureRate: failures / sorted.length,
      accounts: accountMap.size,
      targetedAccounts: failureAccounts,
      ips: sourceMap.size,
      countries: countries.size,
      recentFailures,
      peakPerMinute,
      durationMs: duration,
      torEvents,
      simulatedEvents,
      scriptEvents,
      offHours,
    },
    accounts,
    sources,
    takeover,
    impossibleTravel,
    novelCountry,
    signals: {
      brute,
      spray,
      stuffing,
      distributed,
      script,
      torSuccess,
      torFailure,
      offHours: offHoursPoints > 0,
    },
    failureIps,
    failureAccounts,
  }
}

function buildFindings(core: Core, sorted: LoginEvent[]): LoginFinding[] {
  const findings: LoginFinding[] = []
  const { metrics, takeover, impossibleTravel, novelCountry, signals } = core

  if (takeover) {
    findings.push({
      id: 'takeover',
      severity: 'CRITICAL',
      title: `Account takeover likely — ${takeover.email}`,
      detail: `${takeover.failuresBefore} failed attempts preceded a successful sign-in from ${takeover.city ? `${takeover.city}, ` : ''}${countryLabel(
        takeover.country,
      )}. The successful attempt reused the same account inside the 30-minute attack window.`,
      evidence: [
        `${takeover.failuresBefore} failures before the success`,
        `success at ${formatClock(takeover.successAt)} from ${takeover.ip}`,
        takeover.isTor ? 'success came from a Tor exit node' : 'success came from the attack infrastructure',
      ],
      technique: { id: 'T1078', name: 'Valid Accounts' },
      action: `Revoke all sessions for ${takeover.email}, force a password reset and re-enrol MFA before restoring access.`,
    })
  }

  if (impossibleTravel) {
    findings.push({
      id: 'impossible-travel',
      severity: 'HIGH',
      title: `Impossible travel for ${impossibleTravel.email}`,
      detail: `The account signed in from ${countryLabel(impossibleTravel.from)} and then ${countryLabel(
        impossibleTravel.to,
      )} ${formatDuration(impossibleTravel.minutes * 60_000)} later — roughly ${Math.round(
        impossibleTravel.distanceKm,
      ).toLocaleString('en-US')} km apart, implying ${Math.round(impossibleTravel.speedKmh).toLocaleString('en-US')} km/h.`,
      evidence: [
        `implied speed ${Math.round(impossibleTravel.speedKmh).toLocaleString('en-US')} km/h`,
        `${Math.round(impossibleTravel.distanceKm).toLocaleString('en-US')} km in ${formatDuration(impossibleTravel.minutes * 60_000)}`,
      ],
      technique: { id: 'T1078', name: 'Valid Accounts' },
      action: 'Challenge the session with step-up authentication and confirm with the account owner which location is genuine.',
    })
  }

  const topBrute = core.accounts.find((account) => account.failures >= 5)
  if (topBrute) {
    const bruteAccount = core.accounts
      .filter((account) => account.failures >= 5)
      .sort((a, b) => b.failures - a.failures)[0]
    if (bruteAccount) {
      findings.push({
        id: `brute-${bruteAccount.email}`,
        severity: bruteAccount.takeover || bruteAccount.failures >= 8 ? 'HIGH' : 'MEDIUM',
        title: `Brute force against ${bruteAccount.email}`,
        detail: `${bruteAccount.failures} failed sign-ins hit this account from ${bruteAccount.ips} source ${plural(
          bruteAccount.ips,
          'address',
          'addresses',
        )} across ${bruteAccount.countries.length} ${plural(bruteAccount.countries.length, 'country', 'countries')}.`,
        evidence: [
          `${bruteAccount.failures} failures · ${bruteAccount.attempts} total attempts`,
          bruteAccount.countries.map((country) => countryLabel(country)).join(', '),
        ],
        technique: { id: 'T1110.001', name: 'Password Guessing' },
        action: 'Rate-limit the account and source addresses, then require MFA for the next successful sign-in.',
      })
    }
  }

  const sprayIp = core.signals.spray
    ? core.sources.find((source) => new Set(source.accounts).size >= 3 && source.failures > 0)
    : null
  if (sprayIp) {
    findings.push({
      id: `spray-${sprayIp.ip}`,
      severity: 'HIGH',
      title: `Password spray from ${sprayIp.ip}`,
      detail: `${sprayIp.failures} failures from this address touched ${sprayIp.accounts.length} accounts. Spraying trades depth for breadth to stay under per-account lockout thresholds.`,
      evidence: [
        `${sprayIp.accounts.length} accounts targeted`,
        `${sprayIp.failures} failures from one source`,
        sprayIp.tor ? 'Tor exit node' : `${countryLabel(sprayIp.countries[0] ?? '')}`,
      ],
      technique: { id: 'T1110.003', name: 'Password Spraying' },
      action: 'Block the source, add IP-aware rate limiting and alert on any success tied to this address.',
    })
  }

  if (signals.stuffing) {
    findings.push({
      id: 'stuffing',
      severity: 'HIGH',
      title: 'Distributed credential stuffing',
      detail: `${metrics.failures} failures were spread across ${core.failureAccounts} accounts and ${core.failureIps} addresses — breadth across both accounts and sources is the stuffing signature.`,
      evidence: [
        `${core.failureIps} source addresses`,
        `${core.failureAccounts} accounts touched`,
        `${Math.round(metrics.failureRate * 100)}% of attempts failed`,
      ],
      technique: { id: 'T1110.004', name: 'Credential Stuffing' },
      action: 'Block the address set, reject known-breached passwords and force MFA for every account that was attempted.',
    })
  }

  if (novelCountry && !impossibleTravel) {
    findings.push({
      id: 'novel-country',
      severity: 'MEDIUM',
      title: `New sign-in country for ${novelCountry.email}`,
      detail: `The account succeeded from ${novelCountry.city ? `${novelCountry.city}, ` : ''}${countryLabel(
        novelCountry.country,
      )}, which is not where this account normally signs in${novelCountry.previousCountry ? ` (previously ${countryLabel(novelCountry.previousCountry)})` : ''}.`,
      evidence: [novelCountry.isTor ? 'Tor exit node' : 'new country', 'success after failure activity'],
      technique: { id: 'T1078', name: 'Valid Accounts' },
      action: 'Send a step-up challenge and notify the account owner through a channel outside the portal.',
    })
  }

  if (signals.script) {
    findings.push({
      id: 'automation',
      severity: 'MEDIUM',
      title: 'Scripted client on the login surface',
      detail: `${metrics.scriptEvents} events used a non-browser user agent. Automated clients do not type passwords by hand, so this supports an attack rather than a mistyping user.`,
      evidence: [`${metrics.scriptEvents} scripted ${plural(metrics.scriptEvents, 'request')}`, 'user agent signature match'],
      technique: { id: 'T1110', name: 'Brute Force' },
      action: 'Challenge non-browser clients with a proof-of-work or CAPTCHA and block the offending user agent.',
    })
  }

  if (signals.distributed && !signals.stuffing) {
    findings.push({
      id: 'distributed',
      severity: 'MEDIUM',
      title: 'Distributed source activity',
      detail: `The capture contains failures from ${core.failureIps} addresses, which is more consistent with a coordinated run than a single confused user.`,
      evidence: [`${core.failureIps} distinct failing addresses`],
      technique: { id: 'T1110', name: 'Brute Force' },
      action: 'Correlate the addresses against ASN and hosting ranges before blocking the whole set.',
    })
  }

  if (signals.offHours && findings.length > 0) {
    findings.push({
      id: 'off-hours',
      severity: 'LOW',
      title: 'Off-hours timing',
      detail: `${metrics.offHours} attempts landed between 22:00 and 06:00 local time, when the helpdesk is least able to verify a human.`,
      evidence: [`${metrics.offHours} off-hours events`],
      technique: { id: 'T1078', name: 'Valid Accounts' },
      action: 'Tune after-hours conditional access for this application.',
    })
  }

  const order: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
  return findings.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 6)
}

function buildNarrative(core: Core, sorted: LoginEvent[]): string {
  const { metrics, takeover, impossibleTravel, signals } = core
  if (!sorted.length) return emptyAnalysis().narrative

  const span = formatDuration(metrics.durationMs)
  const from = formatClock(sorted[0].at, metrics.durationMs > 24 * 3_600_000)
  const to = formatClock(sorted[sorted.length - 1].at, metrics.durationMs > 24 * 3_600_000)
  const failureCountries = [
    ...new Set(sorted.filter((event) => !event.success).map((event) => event.country || event.countryName)),
  ]
    .filter(Boolean)
    .map((country) => countryLabel(country))
  const topAccount = core.accounts[0]
  const intro = `Between ${from} and ${to} (${span}), the Northwind portal recorded ${metrics.attempts} sign-in ${plural(
    metrics.attempts,
    'attempt',
  )}: ${metrics.failures} failed and ${metrics.successes} succeeded.`

  if (takeover) {
    const account = core.accounts.find((entry) => entry.email === takeover.email)
    const failureSentence = `${takeover.failuresBefore} of the failures hit ${takeover.email} from ${
      account ? account.ips : core.failureIps
    } source ${plural(account?.ips ?? core.failureIps, 'address', 'addresses')}${
      failureCountries.length ? ` across ${listWithAnd(failureCountries)}` : ''
    }.`
    const successSentence = `At ${formatClock(takeover.successAt)}, that account then signed in successfully from ${
      takeover.city ? `${takeover.city}, ` : ''
    }${countryLabel(takeover.country)}${takeover.isTor ? ', a Tor exit node' : ''}, ${formatDuration(
      Date.parse(takeover.successAt) - Date.parse(takeover.firstFailureAt),
    )} after the first failure.`
    const travelSentence = impossibleTravel
      ? `The same account had signed in from ${countryLabel(impossibleTravel.from)} earlier; reaching ${countryLabel(
          impossibleTravel.to,
        )} in ${formatDuration(impossibleTravel.minutes * 60_000)} would require about ${Math.round(
          impossibleTravel.speedKmh,
        ).toLocaleString('en-US')} km/h, which is not possible for a person.`
      : ''
    return [
      intro,
      failureSentence,
      successSentence,
      travelSentence,
      'This is the signature of a successful brute-force or credential-stuffing run, not ordinary user error. Treat the account as compromised until the owner confirms otherwise.',
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  if (signals.stuffing || signals.spray) {
    const label = signals.stuffing ? 'credential stuffing' : 'password spray'
    return [
      intro,
      `${metrics.failures} failures touched ${core.failureAccounts} accounts from ${core.failureIps} source ${
        core.failureIps === 1 ? 'address' : 'addresses'
      }${failureCountries.length ? ` in ${listWithAnd(failureCountries)}` : ''}. Peak velocity was ${metrics.peakPerMinute} ${
        metrics.peakPerMinute === 1 ? 'attempt' : 'attempts'
      } in one minute.`,
      `No successful break-in followed — yet. The breadth of accounts paired with the source pattern is consistent with a ${label} run; the objective is usually to find one weak password and return later.`,
      'Block and rate-limit the sources, challenge any follow-up success and require MFA on every attempted account.',
    ].join('\n\n')
  }

  if (signals.brute) {
    return [
      intro,
      `${topAccount?.email ?? 'A single account'} absorbed ${topAccount?.failures ?? metrics.failures} of the failures from ${
        topAccount?.ips ?? core.failureIps
      } ${plural(topAccount?.ips ?? core.failureIps, 'address', 'addresses')}. The attempt rate peaked at ${metrics.peakPerMinute} per minute.`,
      metrics.successes > 0
        ? 'Successful sign-ins were recorded, but none followed a concentrated run of failures. Keep watching for a success that lands after the next burst.'
        : 'No success followed the failures, so the password is still holding — but the account remains an active target.',
      'Rate-limit the account and source addresses, and make sure MFA or lockout is enforcing a ceiling above five failures.',
    ].join('\n\n')
  }

  if (metrics.failures > 0) {
    return [
      intro,
      `${topAccount?.email ?? 'The targeted account'} accounts for ${topAccount?.failures ?? metrics.failures} ${
        (topAccount?.failures ?? metrics.failures) === 1 ? 'failure' : 'failures'
      }${metrics.ips > 1 ? ` from ${metrics.ips} different addresses` : ''}.`,
      'No attack pattern crossed the detection threshold. That is consistent with mistyped passwords or a stale saved credential, not an intrusion attempt. Monitor without paging anyone.',
    ].join('\n\n')
  }

  return [
    intro,
    `${metrics.successes === 1 ? 'The only event is a successful sign-in' : 'All events are successful sign-ins'} with no preceding failure burst${
      metrics.countries > 1 ? ', though more than one country appears in the capture' : ''
    }.`,
    'Nothing on this board is above the detection threshold. Sign-in activity looks routine.',
  ].join('\n\n')
}

function buildRecommendations(core: Core): string[] {
  const actions: string[] = []
  const { takeover, impossibleTravel, signals, metrics } = core

  if (takeover) {
    actions.push(`Revoke every active session for ${takeover.email} and force a password reset plus MFA re-enrolment.`)
    actions.push(
      `Block ${takeover.ip}${takeover.isTor ? ' and the Tor exit range' : ''} at the edge, and alert on any further attempt against ${takeover.email}.`,
    )
    actions.push('Open an incident and notify the account owner through a channel outside the portal.')
  } else if (signals.stuffing || signals.spray || signals.brute) {
    const source = core.sources[0]
    if (source) actions.push(`Rate-limit and temporarily block ${source.ip}, then watch for a rotate to a new address.`)
    actions.push('Enforce step-up MFA on the targeted accounts before the next successful sign-in.')
    actions.push('Watch for a delayed success: stuffing runs often return with a working credential.')
  } else if (metrics.failures > 0) {
    actions.push('No containment needed. Keep the failed attempts in the baseline and review if the count climbs.')
  } else {
    actions.push('No action. The board will keep polling and will score the next attempt automatically.')
  }

  if (impossibleTravel && !takeover) {
    actions.push('Challenge the travel pair with conditional access and confirm the genuine location with the owner.')
  }
  if (signals.script) {
    actions.push('Add a challenge for non-browser clients so scripts cannot hammer the form cheaply.')
  }
  actions.push('Preserve login-events.json and login-events.csv as the evidence trail for this capture.')

  return actions.slice(0, 5)
}

const buildTechniques = (findings: LoginFinding[]) => {
  const seen = new Map<string, string>()
  for (const finding of findings) seen.set(finding.technique.id, finding.technique.name)
  return [...seen.entries()].map(([id, name]) => ({ id, name }))
}

const buildBuckets = (sorted: LoginEvent[], core: Core): LoginBucket[] => {
  if (!sorted.length) return []
  const first = Date.parse(sorted[0].at)
  const last = Date.parse(sorted[sorted.length - 1].at)
  let bucketMs = 60_000
  if (core.metrics.durationMs > 20 * 60_000) bucketMs = 5 * 60_000
  if (core.metrics.durationMs > 2 * 3_600_000) bucketMs = 30 * 60_000
  if (core.metrics.durationMs > 12 * 3_600_000) bucketMs = 2 * 3_600_000
  if (core.metrics.durationMs > 3 * 24 * 3_600_000) bucketMs = 24 * 3_600_000

  let start = Math.floor(first / bucketMs) * bucketMs
  const count = () => Math.floor((last - start) / bucketMs) + 1
  while (count() > 60) {
    bucketMs *= 2
    start = Math.floor(first / bucketMs) * bucketMs
  }
  if (count() < 6) {
    start = Math.max(0, start - (6 - count()) * bucketMs)
  }

  const buckets: LoginBucket[] = []
  const end = Math.floor(last / bucketMs) * bucketMs + bucketMs
  for (let cursor = start; cursor <= end - 1; cursor += bucketMs) {
    const bucketEvents = sorted.filter((event) => {
      const time = Date.parse(event.at)
      return time >= cursor && time < cursor + bucketMs
    })
    if (bucketEvents.length === 0 && buckets.length === 0 && cursor + bucketMs <= first) continue
    const prefix = sorted.filter((event) => Date.parse(event.at) < cursor + bucketMs)
    const bucketCore = computeCore(prefix)
    const date = new Date(cursor + bucketMs - 1)
    buckets.push({
      at: date.toISOString(),
      label:
        bucketMs >= 24 * 3_600_000
          ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : date.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              ...(core.metrics.durationMs > 24 * 3_600_000 ? { month: 'short', day: 'numeric' } : {}),
            }),
      attempts: bucketEvents.length,
      failures: bucketEvents.filter((event) => !event.success).length,
      successes: bucketEvents.filter((event) => event.success).length,
      risk: bucketCore.score,
    })
  }
  return buckets
}

const buildVerdict = (core: Core): string => {
  if (!core.metrics.attempts) return 'No sign-in activity captured'
  if (core.takeover) return 'Account takeover likely'
  if (core.signals.stuffing) return 'Credential stuffing in progress'
  if (core.signals.spray) return 'Password spray in progress'
  if (core.signals.brute) return 'Brute force in progress'
  if (core.level === 'CRITICAL' || core.level === 'HIGH') return 'Elevated sign-in attack'
  if (core.metrics.failures > 0) return 'Failed sign-ins observed'
  return 'Healthy sign-in activity'
}

export function analyzeLoginEvents(events: LoginEvent[]): LoginAnalysis {
  if (!events.length) return emptyAnalysis()
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const core = computeCore(sorted)
  const previous = sorted.length > 1 ? computeCore(sorted.slice(0, -1)) : null
  const findings = buildFindings(core, sorted)
  const buckets = buildBuckets(sorted, core)

  return {
    asOf: sorted[sorted.length - 1].at,
    firstAt: sorted[0].at,
    lastAt: sorted[sorted.length - 1].at,
    windowMs: core.metrics.durationMs,
    score: core.score,
    rawScore: core.rawScore,
    level: core.level,
    verdict: buildVerdict(core),
    scoreDelta: previous ? core.score - previous.score : 0,
    contributors: core.contributors,
    metrics: core.metrics,
    accounts: core.accounts,
    sources: core.sources,
    findings,
    techniques: buildTechniques(findings),
    narrative: buildNarrative(core, sorted),
    recommendations: buildRecommendations(core),
    buckets,
    takeover: core.takeover,
    impossibleTravel: core.impossibleTravel,
  }
}

/* ------------------------------------------------------------------ */
/* Export helpers                                                      */
/* ------------------------------------------------------------------ */

export const LOGIN_CSV_HEADER = [
  'id',
  'at',
  'email',
  'success',
  'reason',
  'source_ip',
  'country',
  'country_name',
  'city',
  'latitude',
  'longitude',
  'is_tor',
  'device',
  'user_agent',
  'portal',
  'simulated',
] as const

const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function eventsToCsv(events: LoginEvent[]): string {
  const rows = events.map((event) =>
    [
      event.id,
      event.at,
      event.email,
      event.success,
      event.reason ?? '',
      event.sourceIp,
      event.country,
      event.countryName,
      event.city ?? '',
      event.latitude ?? '',
      event.longitude ?? '',
      event.isTor ?? false,
      event.device ?? '',
      event.userAgent ?? '',
      event.portal ?? '',
      event.simulated ?? false,
    ]
      .map(csvCell)
      .join(','),
  )
  return [LOGIN_CSV_HEADER.join(','), ...rows].join('\n')
}

/* ------------------------------------------------------------------ */
/* Live capture store                                                  */
/* ------------------------------------------------------------------ */

interface LoginIntelState {
  events: LoginEvent[]
  status: LoginFeedStatus
  error: string | null
  lastSync: string | null
  autoRefresh: boolean
  refresh: () => Promise<void>
  start: () => void
  stop: () => void
  resetRemote: () => Promise<void>
  setAutoRefresh: (value: boolean) => void
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let requestSeq = 0
let refreshInFlight = false

export const useLoginIntel = create<LoginIntelState>()((set, get) => ({
  events: [],
  status: 'idle',
  error: null,
  lastSync: null,
  autoRefresh: true,

  refresh: async () => {
    if (refreshInFlight) return
    refreshInFlight = true
    const seq = ++requestSeq
    if (!get().lastSync) set({ status: 'connecting' })
    try {
      const response = await fetch(LOGIN_JSON_FILE, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      const contentType = response.headers.get('content-type') ?? ''
      if (!response.ok || !contentType.includes('application/json')) {
        throw new Error(
          response.status === 404
            ? 'Portal API not found. Start it with npm run portal.'
            : `The decoy portal is not reachable at ${PORTAL_HOME}.`,
        )
      }
      const payload = await response.json()
      if (seq !== requestSeq) return
      set({
        events: normalizePortalPayload(payload),
        status: 'live',
        error: null,
        lastSync: new Date().toISOString(),
      })
    } catch (error) {
      if (seq !== requestSeq) return
      set({
        status: 'offline',
        error: error instanceof Error ? error.message : 'The decoy portal is unreachable.',
      })
    } finally {
      refreshInFlight = false
    }
  },

  start: () => {
    void get().refresh()
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = setInterval(() => {
      if (get().autoRefresh) void get().refresh()
    }, LOGIN_POLL_MS)
  },

  stop: () => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  },

  resetRemote: async () => {
    const response = await fetch(`${PORTAL_API}/reset`, { method: 'POST' })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !contentType.includes('application/json')) {
      throw new Error('The portal could not reset the capture. Is it still running?')
    }
    requestSeq += 1
    set({ events: [], lastSync: new Date().toISOString(), error: null, status: 'live' })
  },

  setAutoRefresh: (value) => set({ autoRefresh: value }),
}))
