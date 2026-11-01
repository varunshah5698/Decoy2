import corpusJson from '../data/vuln-corpus.json'
import type { Asset, Cve, RelevanceStatus, RiskLevel, Software, VersionRange } from './types'

/* ------------------------------------------------------------------ *
 * The offline NVD corpus.
 *
 * ml/build_vuln_corpus.py joins the NVD 2.0 annual feeds with the CISA KEV
 * catalog and FIRST EPSS scores, keyed by the CPE vendor:product an inventory can
 * declare. The browser cannot ask NVD for thousands of CPE lookups, so correlation
 * runs against this file and the live feeds patch the records it already holds.
 * ------------------------------------------------------------------ */

interface CorpusRange {
  si?: string
  se?: string
  ei?: string
  ee?: string
}

interface CorpusRecord {
  id: string
  vendor: string
  product: string
  cvss: number | null
  vector: string
  severity: string
  cwe: string[]
  epss: number | null
  epssPercentile: number | null
  kev: boolean
  kevDue: string | null
  published: string
  modified: string
  description: string
  fix: string
  ranges: CorpusRange[]
  refs: { url: string; source: string }[]
}

interface CorpusFile {
  generatedAt: string
  sources: { nvd: string; epss: string; kev: string }
  records: number
  products: Record<string, { vendor: string; product: string; cves: CorpusRecord[] }>
}

const corpus = corpusJson as unknown as CorpusFile

export const corpusMeta = {
  generatedAt: corpus.generatedAt,
  feeds: corpus.sources,
  products: Object.keys(corpus.products).length,
  records: corpus.records,
}

export const corpusProducts = Object.entries(corpus.products).map(([key, entry]) => ({
  key,
  vendor: entry.vendor,
  product: entry.product,
  count: entry.cves.length,
  kev: entry.cves.filter((cve) => cve.kev).length,
}))

const toLevel = (severity: string, cvss: number | null): RiskLevel => {
  const upper = severity.toUpperCase()
  if (upper === 'CRITICAL' || upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW') return upper
  if (cvss == null) return 'LOW'
  if (cvss >= 9) return 'CRITICAL'
  if (cvss >= 7) return 'HIGH'
  if (cvss >= 4) return 'MEDIUM'
  return 'LOW'
}

const expandRange = (range: CorpusRange): VersionRange => ({
  ...(range.si ? { startIncluding: range.si } : {}),
  ...(range.se ? { startExcluding: range.se } : {}),
  ...(range.ei ? { endIncluding: range.ei } : {}),
  ...(range.ee ? { endExcluding: range.ee } : {}),
})

const titleOf = (record: CorpusRecord) => `${record.id} · ${record.vendor} ${record.product}`

const toCve = (record: CorpusRecord): Cve => ({
  id: record.id,
  title: titleOf(record),
  description: record.description,
  published: record.published ? `${record.published}T00:00:00Z` : '',
  modified: record.modified ? `${record.modified}T00:00:00Z` : '',
  cvss: record.cvss,
  vector: record.vector,
  severity: toLevel(record.severity, record.cvss),
  cwe: record.cwe,
  epss: record.epss,
  epssPercentile: record.epssPercentile,
  kev: record.kev,
  kevDue: record.kevDue ?? undefined,
  vendor: record.vendor,
  product: record.product,
  range: expandRange(record.ranges[0] ?? {}),
  ranges: record.ranges.map(expandRange),
  fixVersion: record.fix,
  refs: record.refs,
  provenance: 'nvd-corpus',
})

/** One Cve per CVE id; a record that covers two products keeps its first range set. */
export const corpusCves = (): Cve[] => {
  const byId = new Map<string, Cve>()
  for (const entry of Object.values(corpus.products)) {
    for (const record of entry.cves) {
      if (!byId.has(record.id)) byId.set(record.id, toCve(record))
    }
  }
  return [...byId.values()]
}

export const corpusRecordsFor = (key: string): CorpusRecord[] => corpus.products[key]?.cves ?? []

/* ------------------------------------------------------------------ *
 * CPE key resolution
 * ------------------------------------------------------------------ */

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_|_$/g, '')

const VENDOR_ALIASES: Record<string, string> = {
  nginx: 'f5',
  palonetworks: 'paloaltonetworks',
  palo_alto_networks: 'paloaltonetworks',
  vmware: 'vmware',
  broadcom: 'vmware',
  hpe: 'hp',
  canonical: 'ubuntu',
  red_hat: 'redhat',
  ix_systems: 'ixsystems',
  ngnix: 'nginx',
}

/** Product-only fallback so a wrong vendor slug still resolves when the package name
    is unambiguous in the corpus. */
const productIndex = new Map<string, string>()
for (const key of Object.keys(corpus.products)) {
  const product = key.split(':')[1]
  if (!productIndex.has(product)) productIndex.set(product, key)
  else productIndex.set(product, '')
}

export interface CpeParts {
  part: string
  vendor: string
  product: string
  version: string
}

export function parseCpe(criteria: string): CpeParts | null {
  const value = criteria.trim().toLowerCase()
  if (!value.startsWith('cpe:')) return null
  const bits = value.split(':')
  if (bits[1]?.startsWith('/')) {
    return { part: bits[1].slice(1), vendor: bits[2] ?? '', product: bits[3] ?? '', version: bits[4] ?? '' }
  }
  // cpe:2.3:<part>:<vendor>:<product>:<version>:...
  if (bits[1] === '2.3') {
    return { part: bits[2] ?? '', vendor: bits[3] ?? '', product: bits[4] ?? '', version: bits[5] ?? '' }
  }
  return null
}

/** The corpus key for one declared software package, or null when NVD publishes no
    configuration data for it. */
export function productKey(software: Software): string | null {
  const parsed = software.cpe ? parseCpe(software.cpe) : null
  const vendor = slug(parsed?.vendor || software.vendor)
  const product = slug(parsed?.product || software.product)
  if (!product) return null
  const aliased = VENDOR_ALIASES[vendor] ?? vendor
  const exact = `${aliased}:${product}`
  if (corpus.products[exact]) return exact
  const raw = `${vendor}:${product}`
  if (corpus.products[raw]) return raw
  const fallback = productIndex.get(product)
  return fallback || null
}

/* ------------------------------------------------------------------ *
 * Version comparison
 * ------------------------------------------------------------------ */

const UNKNOWN_VERSIONS = new Set(['', '*', '-', 'n/a', 'na', 'unknown', 'undetermined', 'null'])

type Token = number | string

const tokenize = (version: string): Token[] | null => {
  const cleaned = version.trim().toLowerCase()
  if (UNKNOWN_VERSIONS.has(cleaned)) return null
  const matches = cleaned.match(/\d+|[a-z]+/g)
  return matches ? matches.map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : null
}

/** Release-agnostic compare: numeric runs order numerically, alphabetic runs lexically,
    and a shorter token list sorts first (1.2 < 1.2.1). */
export function compareVersions(a: string, b: string): number | null {
  const left = tokenize(a)
  const right = tokenize(b)
  if (!left || !right) return null
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    const x = left[i]
    const y = right[i]
    if (x === y) continue
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return 0
}

/** Microsoft packages are declared by marketing version and ranged by build number,
    so a comparison tries every spelling of the same release. */
const VERSION_SCHEMES: Record<string, Record<string, string[]>> = {
  'microsoft:exchange_server': {
    '2010': ['14.0'],
    '2013': ['15.0'],
    '2016': ['15.1'],
    '2019': ['15.2'],
  },
  'microsoft:windows_server': {
    '2012': ['6.2.9200'],
    '2012r2': ['6.3.9600'],
    '2016': ['10.0.14393'],
    '2019': ['10.0.17763'],
    '2022': ['10.0.20348'],
  },
  'microsoft:windows': { '10': ['10.0.19041'], '11': ['10.0.22000'] },
}

export function candidateVersions(key: string, version: string): string[] {
  const trimmed = version.trim()
  if (!trimmed) return []
  const normalised = trimmed.toLowerCase().replace(/[\s.]/g, '')
  const schemes = VERSION_SCHEMES[key]?.[normalised]
  return schemes ? [trimmed, ...schemes] : [trimmed]
}

/** Version read from the CPE when the inventory declares one, else the flat column. */
export function declaredVersion(software: Software): string {
  const parsed = software.cpe ? parseCpe(software.cpe) : null
  return (parsed?.version && parsed.version !== '*' ? parsed.version : '') || software.version || ''
}

const inRange = (version: string, range: VersionRange): boolean | null => {
  const test = (bound: string | undefined, cmp: (delta: number) => boolean) => {
    if (!bound) return true
    const delta = compareVersions(version, bound)
    return delta === null ? null : cmp(delta)
  }
  const checks = [
    test(range.startIncluding, (delta) => delta >= 0),
    test(range.startExcluding, (delta) => delta > 0),
    test(range.endIncluding, (delta) => delta <= 0),
    test(range.endExcluding, (delta) => delta < 0),
  ]
  if (checks.some((pass) => pass === null)) return null
  return checks.every(Boolean)
}

const rangesOf = (cve: Cve): VersionRange[] => (cve.ranges?.length ? cve.ranges : [cve.range])

/** Is this installed version inside the affected window NVD published for the CVE? */
export function relevanceFor(version: string, cve: Cve, key = ''): RelevanceStatus {
  const candidates = candidateVersions(key, version)
  if (!candidates.length) return 'VERSION_UNKNOWN'
  const ranges = rangesOf(cve)
  let unparseable = false
  for (const candidate of candidates) {
    for (const range of ranges) {
      const inside = inRange(candidate, range)
      if (inside === true) return 'MATCHED'
      if (inside === null) unparseable = true
    }
  }
  return unparseable ? 'VERSION_UNKNOWN' : 'NOT_AFFECTED'
}

/** The version spelling that matched, for display in the evidence chain. */
export function matchedVersion(version: string, cve: Cve, key = ''): string {
  const ranges = rangesOf(cve)
  for (const candidate of candidateVersions(key, version)) {
    if (ranges.some((range) => inRange(candidate, range) === true)) return candidate
  }
  return version
}

/* ------------------------------------------------------------------ *
 * Exposure paths
 * ------------------------------------------------------------------ */

export interface ExposurePath {
  cve: Cve
  asset: Asset
  version: string
  relevance: RelevanceStatus
  key: string
}

const isKevCandidate = (cve: Cve) => cve.kev || (cve.epss ?? 0) >= 0.8

/** Every (asset, cve) pair the corpus can decide something about. Suppressed pairs are
    kept only when a CVSS-only queue would have ranked them, which is what makes the
    relevance gate visible rather than invisible. */
export function exposurePaths(assets: Asset[], cvesByProduct: Map<string, Cve[]>): ExposurePath[] {
  const paths: ExposurePath[] = []
  for (const asset of assets) {
    const seen = new Set<string>()
    for (const software of asset.software) {
      const key = productKey(software)
      if (!key) continue
      const version = declaredVersion(software)
      for (const cve of cvesByProduct.get(key) ?? []) {
        if (seen.has(cve.id)) continue
        seen.add(cve.id)
        const relevance = relevanceFor(version, cve, key)
        if (relevance === 'NOT_AFFECTED' && !isKevCandidate(cve)) continue
        paths.push({
          cve,
          asset,
          version: matchedVersion(version, cve, key),
          relevance,
          key: `${asset.id}::${cve.id}`,
        })
      }
    }
  }
  return paths
}

/** CVEs grouped by the corpus product key an installed package can look them up under. */
export const buildCveIndex = (cves: Cve[]): Map<string, Cve[]> => {
  const index = new Map<string, Cve[]>()
  const push = (key: string, cve: Cve) => {
    const list = index.get(key) ?? []
    if (!list.some((entry) => entry.id === cve.id)) {
      list.push(cve)
      index.set(key, list)
    }
  }
  for (const cve of cves) {
    const key = productKey({ vendor: cve.vendor, product: cve.product, version: '' })
    if (key) {
      push(key, cve)
      continue
    }
    const raw = `${slug(cve.vendor)}:${slug(cve.product)}`
    if (corpus.products[raw]) push(raw, cve)
  }
  return index
}

/** Products an inventory declares that the corpus has no NVD configuration data for. */
export function uncoveredProducts(assets: Asset[]): { product: string; vendor: string; assets: number }[] {
  const out = new Map<string, { product: string; vendor: string; assets: number }>()
  for (const asset of assets) {
    for (const software of asset.software) {
      if (productKey(software)) continue
      const name = `${software.vendor || 'Unknown'} ${software.product || 'package'}`
      const existing = out.get(name)
      if (existing) existing.assets += 1
      else out.set(name, { product: software.product || 'package', vendor: software.vendor || 'Unknown', assets: 1 })
    }
  }
  return [...out.values()].sort((a, b) => b.assets - a.assets)
}
