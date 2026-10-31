import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { cves as seedCves } from '../data/seed'
import { levelFromScore } from './scoring'
import type { Cve, RiskLevel } from './types'

export type LiveSource = 'NVD' | 'CISA KEV' | 'FIRST EPSS'

export const LIVE_SOURCES: LiveSource[] = ['NVD', 'CISA KEV', 'FIRST EPSS']

export interface LiveCvePatch {
  cvss?: number | null
  vector?: string
  severity?: RiskLevel
  cwe?: string[]
  published?: string
  modified?: string
  description?: string
  refs?: Cve['refs']
  epss?: number
  epssPercentile?: number
  kev?: boolean
  kevDue?: string | null
  nvdAt?: string
  epssAt?: string
  kevAt?: string
}

export interface LiveSourceMeta {
  fetchedAt: string
  status: 'ok' | 'error'
  records: number
  total?: number
  error?: string
}

interface LiveFeedsState {
  patches: Record<string, LiveCvePatch>
  meta: Partial<Record<LiveSource, LiveSourceMeta>>
  syncing: boolean
  phase: string | null
  progress: { done: number; total: number } | null
  lastError: string | null
  syncAll: (options?: { force?: boolean }) => Promise<void>
}

const KEV_TTL = 6 * 3600 * 1000
const EPSS_TTL = 6 * 3600 * 1000
const NVD_TTL = 24 * 3600 * 1000
// NVD asks for at most 5 requests per 30s without an API key.
const NVD_GAP_MS = 6500

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const isFresh = (meta: LiveSourceMeta | undefined, ttl: number) =>
  meta?.status === 'ok' && Date.now() - new Date(meta.fetchedAt).getTime() < ttl

const mergePatches = (
  current: Record<string, LiveCvePatch>,
  incoming: Record<string, LiveCvePatch>,
): Record<string, LiveCvePatch> => {
  const next = { ...current }
  for (const [id, patch] of Object.entries(incoming)) {
    next[id] = { ...next[id], ...patch }
  }
  return next
}

async function fetchKev(ids: string[]) {
  const response = await fetch('/api/feeds/kev', { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`KEV feed returned ${response.status}`)
  const data = await response.json()
  const rows: any[] = Array.isArray(data?.vulnerabilities) ? data.vulnerabilities : []
  if (!rows.length) throw new Error('KEV feed was empty')
  const byId = new Map(rows.map((row) => [String(row.cveID), row]))
  const at = new Date().toISOString()
  const patch: Record<string, LiveCvePatch> = {}
  for (const id of ids) {
    const row = byId.get(id)
    patch[id] = { kev: Boolean(row), kevDue: row?.dueDate ?? null, kevAt: at }
  }
  return { patch, records: Number(data?.count) || rows.length }
}

async function fetchEpss(ids: string[]) {
  const url = `https://api.first.org/data/v1/epss?cve=${encodeURIComponent(ids.join(','))}`
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`EPSS API returned ${response.status}`)
  const data = await response.json()
  const rows: any[] = Array.isArray(data?.data) ? data.data : []
  const at = new Date().toISOString()
  const patch: Record<string, LiveCvePatch> = {}
  for (const row of rows) {
    const epss = Number(row.epss)
    if (!Number.isFinite(epss)) continue
    const percentile = Number(row.percentile)
    patch[String(row.cve)] = {
      epss,
      epssPercentile: Number.isFinite(percentile) ? percentile : undefined,
      epssAt: at,
    }
  }
  return { patch, records: rows.length }
}

const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])

const toSeverity = (raw: unknown, score: number | null): RiskLevel | undefined => {
  const upper = typeof raw === 'string' ? raw.toUpperCase() : ''
  if (SEVERITIES.has(upper)) return upper as RiskLevel
  return score == null ? undefined : levelFromScore(score)
}

const toIso = (value: unknown) => {
  if (typeof value !== 'string' || !value) return undefined
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value)
  const parsed = new Date(hasZone ? value : `${value}Z`)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

const toRefs = (references: any[]): Cve['refs'] =>
  references
    .slice(0, 6)
    .map((reference) => {
      const url = String(reference?.url ?? '')
      if (!url) return null
      let host = ''
      try {
        host = new URL(url).hostname.replace(/^www\./, '')
      } catch {
        host = ''
      }
      const source = host.includes('nvd.nist.gov')
        ? 'NVD'
        : host.includes('cisa.gov')
          ? 'CISA'
          : host || 'Reference'
      return { url, source }
    })
    .filter((ref): ref is Cve['refs'][number] => Boolean(ref))

async function fetchNvd(id: string): Promise<LiveCvePatch> {
  const response = await fetch(
    `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(id)}`,
    { headers: { accept: 'application/json' } },
  )
  if (response.status === 403 || response.status === 429) throw new Error('NVD rate limit reached')
  if (!response.ok) throw new Error(`NVD returned ${response.status}`)
  const data = await response.json()
  const record = data?.vulnerabilities?.[0]?.cve
  if (!record) throw new Error(`NVD has no record for ${id}`)

  const metric =
    record.metrics?.cvssMetricV31?.[0] ??
    record.metrics?.cvssMetricV30?.[0] ??
    record.metrics?.cvssMetricV2?.[0]
  const score = typeof metric?.cvssData?.baseScore === 'number' ? metric.cvssData.baseScore : null
  const description = record.descriptions?.find((entry: any) => entry.lang === 'en')?.value
  const cweValues = ((record.weaknesses ?? []) as any[])
    .flatMap((weakness: any) => (weakness.description ?? []).map((entry: any) => entry.value))
    .filter((value: unknown): value is string => typeof value === 'string' && /^CWE-\d+$/.test(value))
  const cwe: string[] = [...new Set<string>(cweValues)]

  return {
    cvss: score,
    vector: typeof metric?.cvssData?.vectorString === 'string' ? metric.cvssData.vectorString : undefined,
    severity: toSeverity(metric?.cvssData?.baseSeverity ?? metric?.baseSeverity, score),
    cwe: cwe.length ? cwe : undefined,
    description: typeof description === 'string' ? description : undefined,
    published: toIso(record.published),
    modified: toIso(record.lastModified),
    refs: Array.isArray(record.references) ? toRefs(record.references) : undefined,
    nvdAt: new Date().toISOString(),
  }
}

let run: Promise<void> | null = null

async function runSync(
  set: (partial: Partial<LiveFeedsState> | ((state: LiveFeedsState) => Partial<LiveFeedsState>)) => void,
  get: () => LiveFeedsState,
  force: boolean,
) {
  const ids = seedCves.map((cve) => cve.id)
  const errors: string[] = []
  set({ syncing: true, phase: 'starting', progress: null, lastError: null })

  const snapshot = get().meta
  const stamp = () => new Date().toISOString()

  if (force || !isFresh(snapshot['CISA KEV'], KEV_TTL)) {
    set({ phase: 'CISA KEV' })
    try {
      const { patch, records } = await fetchKev(ids)
      set((state) => ({
        patches: mergePatches(state.patches, patch),
        meta: {
          ...state.meta,
          'CISA KEV': { fetchedAt: stamp(), status: 'ok', records, total: records },
        },
      }))
    } catch (error) {
      const detail = messageOf(error)
      errors.push(`KEV: ${detail}`)
      set((state) => ({
        meta: {
          ...state.meta,
          'CISA KEV': { fetchedAt: stamp(), status: 'error', records: 0, error: detail },
        },
      }))
    }
  }

  if (force || !isFresh(snapshot['FIRST EPSS'], EPSS_TTL)) {
    set({ phase: 'FIRST EPSS' })
    try {
      const { patch, records } = await fetchEpss(ids)
      set((state) => ({
        patches: mergePatches(state.patches, patch),
        meta: {
          ...state.meta,
          'FIRST EPSS': { fetchedAt: stamp(), status: 'ok', records, total: ids.length },
        },
      }))
    } catch (error) {
      const detail = messageOf(error)
      errors.push(`EPSS: ${detail}`)
      set((state) => ({
        meta: {
          ...state.meta,
          'FIRST EPSS': { fetchedAt: stamp(), status: 'error', records: 0, error: detail },
        },
      }))
    }
  }

  if (force || !isFresh(snapshot.NVD, NVD_TTL)) {
    const pending = force
      ? ids
      : ids.filter((id) => {
          const at = get().patches[id]?.nvdAt
          return !at || Date.now() - new Date(at).getTime() > NVD_TTL
        })
    let ok = 0
    let stopped = false
    for (let index = 0; index < pending.length; index += 1) {
      if (index > 0) await sleep(NVD_GAP_MS)
      set({ phase: `NVD ${index + 1}/${pending.length}`, progress: { done: index, total: pending.length } })
      try {
        const patch = await fetchNvd(pending[index])
        ok += 1
        set((state) => ({ patches: mergePatches(state.patches, { [pending[index]]: patch }) }))
      } catch (error) {
        const detail = messageOf(error)
        errors.push(`NVD ${pending[index]}: ${detail}`)
        if (detail.includes('rate limit')) {
          stopped = true
          break
        }
      }
    }
    const held = ids.length - pending.length
    set({
      progress: { done: pending.length, total: pending.length },
      meta: {
        ...get().meta,
        NVD: {
          fetchedAt: stamp(),
          status: ok === pending.length ? 'ok' : 'error',
          records: held + ok,
          total: ids.length,
          error:
            ok === pending.length
              ? undefined
              : stopped
                ? 'NVD rate limit reached; partial pull, cached for next sync'
                : `${pending.length - ok} record(s) failed; cached partial pull`,
        },
      },
    })
  }

  set({
    syncing: false,
    phase: null,
    progress: null,
    lastError: errors.length ? errors.join(' · ') : null,
  })
}

export const useLiveFeeds = create<LiveFeedsState>()(
  persist(
    (set, get) => ({
      patches: {},
      meta: {},
      syncing: false,
      phase: null,
      progress: null,
      lastError: null,
      syncAll: (options) => {
        if (run) return run
        run = runSync(set, get, Boolean(options?.force)).finally(() => {
          run = null
        })
        return run
      },
    }),
    {
      name: 'aegis.live',
      version: 1,
      partialize: (state) => ({ patches: state.patches, meta: state.meta }),
    },
  ),
)

export const mergeCve = (cve: Cve, patch?: LiveCvePatch): Cve => {
  if (!patch) return cve
  const next: Cve = { ...cve }
  if (patch.cvss !== undefined) next.cvss = patch.cvss
  if (patch.vector !== undefined) next.vector = patch.vector
  if (patch.severity !== undefined) next.severity = patch.severity
  if (patch.cwe !== undefined) next.cwe = patch.cwe
  if (patch.published !== undefined) next.published = patch.published
  if (patch.modified !== undefined) next.modified = patch.modified
  if (patch.description !== undefined) next.description = patch.description
  if (patch.refs !== undefined) next.refs = patch.refs
  if (patch.epss !== undefined) next.epss = patch.epss
  if (patch.epssPercentile !== undefined) next.epssPercentile = patch.epssPercentile
  if (patch.kev !== undefined) next.kev = patch.kev
  if (patch.kevDue !== undefined) next.kevDue = patch.kevDue ?? undefined
  return next
}

export function useLiveCves(): Cve[] {
  const patches = useLiveFeeds((state) => state.patches)
  return useMemo(() => seedCves.map((cve) => mergeCve(cve, patches[cve.id])), [patches])
}

export const latestLiveFetch = (meta: Partial<Record<LiveSource, LiveSourceMeta>>) => {
  const times = LIVE_SOURCES.map((source) => meta[source]?.fetchedAt).filter((value): value is string => Boolean(value))
  const sorted = times.sort()
  return sorted.length ? sorted[sorted.length - 1] : null
}
