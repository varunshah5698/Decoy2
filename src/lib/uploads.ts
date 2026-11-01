import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Asset, AssetType, Criticality, RiskLevel } from './types'

export interface LogUploadSummary {
  total: number
  eventTypes: Record<string, number>
  failedLogins: number
  distinctIps: number
  destinations: string[]
  countries: string[]
  firstTimestamp: string | null
  lastTimestamp: string | null
}

export interface UploadedDataset {
  id: string
  name: string
  type: 'Assets' | 'Logs'
  status: 'ACCEPTED' | 'PARTIAL'
  rows: number
  accepted: number
  rejected: number
  uploadedBy: string
  uploadedAt: string
  source: 'USER UPLOAD' | 'LIVE CAPTURE'
  assets: Asset[]
  logs?: LogUploadSummary
  live?: boolean
  provider?: string
  risk?: { score: number; level: RiskLevel; verdict: string }
  files?: { json: string; csv: string }
}

interface UploadsState {
  datasets: UploadedDataset[]
  add: (dataset: UploadedDataset) => void
  clear: () => void
}

export const useUploads = create<UploadsState>()(
  persist(
    (set) => ({
      datasets: [],
      add: (dataset) =>
        set((s) => {
          let budget = 4000
          const datasets = [dataset, ...s.datasets].slice(0, 25).map((entry) => {
            const keep = entry.assets.slice(0, Math.max(0, budget))
            budget -= keep.length
            return keep.length === entry.assets.length ? entry : { ...entry, assets: keep }
          })
          return { datasets }
        }),
      clear: () => set({ datasets: [] }),
    }),
    { name: 'aegis.uploads', version: 1 },
  ),
)

export const allUploadedAssets = (datasets: UploadedDataset[]): Asset[] =>
  datasets.flatMap((d) => d.assets)

export const allUploadedLogs = (datasets: UploadedDataset[]): UploadedDataset[] =>
  datasets.filter((d) => d.logs)

const TYPE_MAP: Record<string, AssetType> = {
  server: 'server',
  host: 'server',
  vm: 'server',
  app: 'app',
  application: 'app',
  web: 'app',
  website: 'app',
  endpoint: 'endpoint',
  workstation: 'endpoint',
  laptop: 'endpoint',
  desktop: 'endpoint',
  network: 'network',
  firewall: 'network',
  router: 'network',
  switch: 'network',
  database: 'database',
  db: 'database',
  cloud: 'cloud',
  saas: 'cloud',
}

const toCriticality = (value: string): Criticality => {
  const upper = value.trim().toUpperCase()
  return upper === 'HIGH' || upper === 'LOW' ? upper : 'MEDIUM'
}

const toBool = (value: string): boolean =>
  ['true', '1', 'yes', 'y', 'exposed', 'external', 'public', 'internet'].includes(value.trim().toLowerCase())

const read = (row: string[], headers: string[], mapping: Record<string, string>, key: string) => {
  const column = mapping[key]
  if (!column) return ''
  const index = headers.indexOf(column)
  return index >= 0 ? String(row[index] ?? '').trim() : ''
}

export function rowsToAssets(
  rows: string[][],
  headers: string[],
  mapping: Record<string, string>,
  datasetId: string,
): Asset[] {
  const assets: Asset[] = []
  rows.forEach((row, i) => {
    const name = read(row, headers, mapping, 'asset_name')
    if (!name) return
    const vendor = read(row, headers, mapping, 'software_vendor')
    const product = read(row, headers, mapping, 'software_product')
    const version = read(row, headers, mapping, 'software_version')
    assets.push({
      id: `UP-${datasetId}-${i + 1}`,
      name,
      type: TYPE_MAP[read(row, headers, mapping, 'asset_type').toLowerCase()] ?? 'server',
      department: read(row, headers, mapping, 'owner_department') || 'Unassigned',
      criticality: toCriticality(read(row, headers, mapping, 'criticality')),
      businessFunction: read(row, headers, mapping, 'business_function') || 'Uploaded asset',
      internetFacing: toBool(read(row, headers, mapping, 'internet_facing')),
      sensitivity: toCriticality(read(row, headers, mapping, 'data_sensitivity')),
      source: 'USER UPLOAD',
      software:
        vendor || product || version
          ? [{ vendor: vendor || 'Unknown', product: product || 'Unknown', version: version || 'unknown' }]
          : [],
    })
  })
  return assets.slice(0, 2000)
}

const toEpoch = (value: string): number | null => {
  if (!value) return null
  const parsed = Date.parse(value)
  if (!Number.isNaN(parsed)) return parsed
  const numeric = Number(value)
  return Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : null
}

export function rowsToLogSummary(
  rows: string[][],
  headers: string[],
  mapping: Record<string, string>,
): LogUploadSummary {
  const eventTypes: Record<string, number> = {}
  const destinations = new Set<string>()
  const countries = new Set<string>()
  const ips = new Set<string>()
  let failedLogins = 0
  let first: number | null = null
  let last: number | null = null

  rows.forEach((row) => {
    const event = read(row, headers, mapping, 'event_type').toUpperCase() || 'OTHER'
    eventTypes[event] = (eventTypes[event] ?? 0) + 1
    if (event === 'LOGIN_FAIL') failedLogins += 1
    const ip = read(row, headers, mapping, 'source_ip')
    if (ip) ips.add(ip)
    const destination = read(row, headers, mapping, 'dest_asset')
    if (destination) destinations.add(destination)
    const country = read(row, headers, mapping, 'country_code').toUpperCase()
    if (country) countries.add(country)
    const epoch = toEpoch(read(row, headers, mapping, 'timestamp'))
    if (epoch !== null) {
      first = first === null ? epoch : Math.min(first, epoch)
      last = last === null ? epoch : Math.max(last, epoch)
    }
  })

  return {
    total: rows.length,
    eventTypes,
    failedLogins,
    distinctIps: ips.size,
    destinations: [...destinations].slice(0, 25),
    countries: [...countries].slice(0, 25),
    firstTimestamp: first === null ? null : new Date(first).toISOString(),
    lastTimestamp: last === null ? null : new Date(last).toISOString(),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const WRAPPER_KEYS = ['data', 'assets', 'logs', 'records', 'items', 'rows', 'results', 'events', 'inventory']

export function extractRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (!isRecord(value)) return []
  for (const key of WRAPPER_KEYS) {
    const nested = value[key]
    if (Array.isArray(nested)) return nested.filter(isRecord)
  }
  const arrays = Object.values(value).filter(Array.isArray) as unknown[][]
  if (arrays.length === 1) return arrays[0].filter(isRecord)
  return [value]
}

function flattenRecord(
  record: Record<string, unknown>,
  prefix = '',
  depth = 0,
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [key, value] of Object.entries(record)) {
    const name = prefix ? `${prefix}_${key}` : key
    if (isRecord(value) && depth < 2) {
      flattenRecord(value, name, depth + 1, out)
    } else if (Array.isArray(value) && value.length && value.every(isRecord) && depth < 2) {
      flattenRecord(value[0], name, depth + 1, out)
      if (value.length > 1) out[`${name}_additional`] = value.slice(1).map((item) => JSON.stringify(item)).join(' | ')
    } else if (Array.isArray(value)) {
      out[name] = value.map((item) => (isRecord(item) ? JSON.stringify(item) : String(item))).join(' | ')
    } else {
      out[name] = value
    }
  }
  return out
}

const cellText = (value: unknown) => {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function parseObjects(text: string): string[][] {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Empty file')
  let records: Record<string, unknown>[] = []
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    records = extractRecords(JSON.parse(trimmed))
  } else {
    records = trimmed
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => extractRecords(JSON.parse(line)))
  }
  if (!records.length) throw new Error('No records found')
  const flat = records.map((record) => flattenRecord(record))
  const headers = [...new Set(flat.flatMap((record) => Object.keys(record)))]
  return [headers, ...flat.map((record) => headers.map((header) => cellText(record[header])))]
}
