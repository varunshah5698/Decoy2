import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEMO_NOW, assets as seedAssets, cves as seedCves } from '../data/seed'
import { mergeCve, type LiveCvePatch } from './liveFeeds'
import { plural } from './format'
import { relevanceReason, round1, scoreAlert } from './scoring'
import { allUploadedAssets, useUploads, type UploadedDataset } from './uploads'
import type { Alert, Asset, Cve, RelevanceStatus, VersionRange } from './types'

export const LIVE_SCOPE = 'live'
export const ALL_UPLOADS_SCOPE = 'uploads'

export const MAX_GENERATED_ALERTS = 2000

interface DataScopeState {
  scopeId: string
  setScopeId: (scopeId: string) => void
}

export const useDataScope = create<DataScopeState>()(
  persist(
    (set) => ({
      scopeId: LIVE_SCOPE,
      setScopeId: (scopeId) => set({ scopeId }),
    }),
    { name: 'aegis.datascope', version: 1 },
  ),
)

const assetDatasets = (datasets: UploadedDataset[]) => datasets.filter((dataset) => dataset.assets.length > 0)

export function normalizeScopeId(scopeId: string, datasets: UploadedDataset[]): string {
  if (!scopeId || scopeId === LIVE_SCOPE) return LIVE_SCOPE
  const usable = assetDatasets(datasets)
  if (scopeId === ALL_UPLOADS_SCOPE) return usable.length ? ALL_UPLOADS_SCOPE : LIVE_SCOPE
  return usable.some((dataset) => dataset.id === scopeId) ? scopeId : LIVE_SCOPE
}

/* The live scope keeps the seeded estate and folds every accepted upload into it.
   A dataset scope replaces the estate entirely: the workspace asks "what does the
   threat catalog see on this inventory?" instead of "what does it see on all of it?" */
export function scopedInventory(scopeId: string, datasets: UploadedDataset[]): Asset[] {
  const id = normalizeScopeId(scopeId, datasets)
  if (id === LIVE_SCOPE) return [...allUploadedAssets(datasets), ...seedAssets]
  if (id === ALL_UPLOADS_SCOPE) return allUploadedAssets(datasets)
  return datasets.find((dataset) => dataset.id === id)?.assets ?? seedAssets
}

export function useScopedInventory(): Asset[] {
  const scopeId = useDataScope((state) => state.scopeId)
  const datasets = useUploads((state) => state.datasets)
  return useMemo(() => scopedInventory(scopeId, datasets), [scopeId, datasets])
}

export interface ScopeInfo {
  id: string
  kind: 'live' | 'uploads' | 'dataset'
  label: string
  detail: string
  dataset?: UploadedDataset
}

export function scopeInfo(scopeId: string, datasets: UploadedDataset[]): ScopeInfo {
  const id = normalizeScopeId(scopeId, datasets)
  const assets = scopedInventory(id, datasets)
  const assetCount = `${assets.length} ${plural(assets.length, 'asset')}`
  if (id === LIVE_SCOPE) {
    return {
      id,
      kind: 'live',
      label: 'Live feeds',
      detail: `${assetCount} · seeded estate + uploads`,
    }
  }
  if (id === ALL_UPLOADS_SCOPE) {
    const usable = assetDatasets(datasets)
    return {
      id,
      kind: 'uploads',
      label: 'All uploads',
      detail: `${usable.length} ${plural(usable.length, 'dataset')} · ${assetCount}`,
    }
  }
  const dataset = datasets.find((entry) => entry.id === id)
  return {
    id,
    kind: 'dataset',
    label: dataset?.name ?? 'Uploaded dataset',
    detail: `${assetCount} · ${dataset?.status.toLowerCase() ?? 'accepted'}`,
    dataset,
  }
}

export function useScopeInfo(): ScopeInfo {
  const scopeId = useDataScope((state) => state.scopeId)
  const datasets = useUploads((state) => state.datasets)
  return useMemo(() => scopeInfo(scopeId, datasets), [scopeId, datasets])
}

/* ---------- version comparison ---------- */

export interface ParsedVersion {
  numbers: number[]
  suffix: string
}

const UNKNOWN_VERSIONS = new Set(['', 'unknown', 'not installed', 'n/a', 'na', 'none', 'null', '-', '—'])

export function parseVersion(raw: string | null | undefined): ParsedVersion | null {
  if (!raw) return null
  let value = raw.trim().toLowerCase()
  if (UNKNOWN_VERSIONS.has(value)) return null
  value = value.replace(/^version\s+/, '').replace(/^v(?=\d)/, '')
  const buildFree = value.split('+')[0]
  const dash = buildFree.indexOf('-')
  const core = dash > 0 ? buildFree.slice(0, dash) : buildFree
  let suffix = dash > 0 ? buildFree.slice(dash + 1) : ''
  const numbers: number[] = []
  for (const part of core.split('.')) {
    const match = /^(\d+)(.*)$/.exec(part)
    if (!match) return null
    numbers.push(Number(match[1]))
    if (match[2] && !suffix) suffix = match[2]
  }
  return numbers.length ? { numbers, suffix } : null
}

const suffixTokens = (suffix: string) => suffix.match(/\d+|\D+/g) ?? []

const compareSuffix = (left: string, right: string): number => {
  const a = suffixTokens(left)
  const b = suffixTokens(right)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const numericX = /^\d+$/.test(x)
    const numericY = /^\d+$/.test(y)
    if (numericX && numericY) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y)
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

// Single-letter + digits reads as a build/hotfix marker (9.8p1, 11.1.2-h3);
// anything longer reads as a prerelease (2.0-beta9).
const isBuildSuffix = (suffix: string) => /^[a-z]\d+$/.test(suffix)

export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return null
  for (let i = 0; i < Math.max(a.numbers.length, b.numbers.length); i += 1) {
    const x = a.numbers[i] ?? 0
    const y = b.numbers[i] ?? 0
    if (x !== y) return x - y
  }
  if (a.suffix === b.suffix) return 0
  if (!a.suffix) return isBuildSuffix(b.suffix) ? -1 : 1
  if (!b.suffix) return isBuildSuffix(a.suffix) ? 1 : -1
  return compareSuffix(a.suffix, b.suffix)
}

export const hasBounds = (range: VersionRange) =>
  Boolean(range.startIncluding || range.startExcluding || range.endIncluding || range.endExcluding)

export function versionInRange(version: string, range: VersionRange): boolean | null {
  if (!parseVersion(version)) return null
  const bounds: [string | undefined, (c: number) => boolean][] = [
    [range.startIncluding, (c) => c >= 0],
    [range.startExcluding, (c) => c > 0],
    [range.endIncluding, (c) => c <= 0],
    [range.endExcluding, (c) => c < 0],
  ]
  for (const [bound, accept] of bounds) {
    if (!bound) continue
    const comparison = compareVersions(version, bound)
    if (comparison === null) return null
    if (!accept(comparison)) return false
  }
  return true
}

const normalizeProduct = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// "Windows" records also cover "Windows Server" in inventory, mirroring the seed.
export function productMatches(product: string, cveProduct: string): boolean {
  const left = normalizeProduct(product)
  const right = normalizeProduct(cveProduct)
  if (!left || !right) return false
  return left === right || left.startsWith(`${right} `) || right.startsWith(`${left} `)
}

/* ---------- generated correlation ---------- */

const kevNote = (cve: Cve) =>
  cve.kev && cve.kevDue
    ? ` CISA KEV remediation was due ${new Date(cve.kevDue).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}.`
    : ''

const uploadedAtByAsset = (datasets: UploadedDataset[]) => {
  const map = new Map<string, string>()
  for (const dataset of datasets) {
    for (const asset of dataset.assets) map.set(asset.id, dataset.uploadedAt)
  }
  return map
}

const clampedStamp = (iso: string | undefined) => {
  const parsed = iso ? new Date(iso).getTime() : DEMO_NOW.getTime()
  const safe = Number.isNaN(parsed) ? DEMO_NOW.getTime() : parsed
  return new Date(Math.min(safe, DEMO_NOW.getTime())).toISOString()
}

function relevanceFor(cve: Cve, version: string): RelevanceStatus {
  if (!parseVersion(version)) return 'VERSION_UNKNOWN'
  if (!hasBounds(cve.range)) return 'VERSION_UNKNOWN'
  const inRange = versionInRange(version, cve.range)
  if (inRange === null) return 'VERSION_UNKNOWN'
  return inRange ? 'MATCHED' : 'NOT_AFFECTED'
}

function buildGeneratedAlert({
  asset,
  cve,
  version,
  relevance,
  cveIndex,
  createdAt,
}: {
  asset: Asset
  cve: Cve
  version: string
  relevance: RelevanceStatus
  cveIndex: number
  createdAt: string
}): Alert {
  const result = scoreAlert({
    cve,
    criticality: asset.criticality,
    internetFacing: asset.internetFacing,
    relevance,
  })
  const confidence = relevance === 'MATCHED' ? 'HIGH' : relevance === 'VERSION_UNKNOWN' ? 'MEDIUM' : 'LOW'

  const summary =
    relevance === 'MATCHED'
      ? `${cve.title} applies to ${asset.name}: ${cve.product} ${version} falls inside the affected range.`
      : relevance === 'VERSION_UNKNOWN'
        ? `${cve.title} may apply to ${asset.name}; the installed ${cve.product} version could not be verified.`
        : `${asset.name} runs ${cve.product} ${version}, which is outside the affected range.`

  const impact = `${asset.businessFunction} depends on ${asset.name}. A successful exploit could interrupt this service and expose ${asset.sensitivity.toLowerCase()}-sensitivity data.`

  const action =
    relevance === 'MATCHED' || relevance === 'VERSION_UNKNOWN'
      ? `Upgrade ${cve.product} on ${asset.name} to ${cve.fixVersion}, then restart the affected service.`
      : `No action required for ${asset.name}; keep the version check in the correlation pipeline.`

  const reasoning = result.suppressed
    ? `${relevanceReason[relevance]} The relevance gate zeroes the score; a CVSS-only queue would have ranked it ${result.wouldHaveScored?.toFixed(1)}.${kevNote(cve)}`
    : `${result.level} at ${result.score.toFixed(1)}: severity ${round1(result.breakdown.severity_points)} + exploitation ${round1(result.breakdown.exploit_points + result.breakdown.kev_points)} + asset ${round1(result.breakdown.criticality_points + result.breakdown.exposure_points)} + relevance ${round1(result.breakdown.relevance_points)}.${kevNote(cve)}`

  const assetKey = asset.id.replace(/^UP-/, 'U').replace(/[^A-Za-z0-9-]/g, '')

  return {
    id: `ALR-${assetKey}-${String(cveIndex + 1).padStart(3, '0')}`,
    cve,
    asset,
    version,
    relevance,
    confidence,
    score: result.score,
    level: result.level,
    suppressed: result.suppressed,
    suppressionReason: result.suppressed ? relevanceReason[relevance] : undefined,
    wouldHaveScored: result.wouldHaveScored,
    dataIncomplete: result.dataIncomplete,
    breakdown: result.breakdown,
    summary,
    impact,
    action,
    reasoning,
    generatedBy: 'template',
    createdAt,
    entities: [cve.product, version !== 'unknown' ? version : '', ...cve.cwe].filter(Boolean),
  }
}

export function buildScopedAlerts(
  scopeId: string,
  datasets: UploadedDataset[],
  patches: Record<string, LiveCvePatch>,
): Alert[] {
  const id = normalizeScopeId(scopeId, datasets)
  if (id === LIVE_SCOPE) return []
  const assets = scopedInventory(id, datasets)
  if (!assets.length) return []

  const catalog = seedCves.map((cve) => mergeCve(cve, patches[cve.id]))
  const stamps = uploadedAtByAsset(datasets)
  const alerts: Alert[] = []

  outer: for (const asset of assets) {
    for (let cveIndex = 0; cveIndex < catalog.length; cveIndex += 1) {
      if (alerts.length >= MAX_GENERATED_ALERTS) break outer
      const cve = catalog[cveIndex]
      const software = asset.software.find((entry) => productMatches(entry.product, cve.product))
      if (!software) continue
      const version = software.version?.trim() || 'unknown'
      alerts.push(
        buildGeneratedAlert({
          asset,
          cve,
          version,
          relevance: relevanceFor(cve, version),
          cveIndex,
          createdAt: clampedStamp(stamps.get(asset.id)),
        }),
      )
    }
  }

  return alerts.sort(
    (a, b) =>
      Number(a.suppressed) - Number(b.suppressed) ||
      b.score - a.score ||
      a.cve.id.localeCompare(b.cve.id) ||
      a.asset.name.localeCompare(b.asset.name),
  )
}
