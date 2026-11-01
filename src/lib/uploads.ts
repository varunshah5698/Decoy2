import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { idbStorage } from './idb'
import type {
  Asset,
  AssetType,
  Criticality,
  InventoryFacts,
  RiskLevel,
  SecurityEvent,
  Software,
  TelemetryTotals,
} from './types'

/* ------------------------------------------------------------------ *
 * Field catalogue
 *
 * The upload hub maps every declared field, but a wide export carries far more
 * columns than an operator wants to place by hand, so each kind also ships a
 * preset: when the header row matches the preset signature the whole schema is
 * mapped in one pass and the manual selects stay available as overrides.
 * ------------------------------------------------------------------ */

export interface FieldSpec {
  key: string
  label: string
  required?: boolean
  core?: boolean
  aliases: string[]
}

export const INVENTORY_FIELDS: FieldSpec[] = [
  { key: 'asset_name', label: 'asset_name', required: true, core: true, aliases: ['asset', 'name', 'hostname', 'system', 'host_name'] },
  { key: 'asset_id', label: 'asset_id', core: true, aliases: ['id', 'external_id', 'cmdb_id', 'device_id'] },
  { key: 'asset_type', label: 'asset_type', core: true, aliases: ['type', 'category', 'class'] },
  { key: 'owner_department', label: 'owner_department', core: true, aliases: ['department', 'dept', 'owner', 'team', 'owner_team'] },
  { key: 'criticality', label: 'criticality', core: true, aliases: ['business_criticality', 'importance', 'tier', 'asset_criticality'] },
  { key: 'business_function', label: 'business_function', core: true, aliases: ['function', 'purpose', 'service'] },
  { key: 'internet_facing', label: 'internet_facing', core: true, aliases: ['exposed', 'external', 'public', 'internet', 'is_internet_facing'] },
  { key: 'data_sensitivity', label: 'data_sensitivity', core: true, aliases: ['sensitivity', 'classification', 'data_classification'] },
  { key: 'software_vendor', label: 'software_vendor', core: true, aliases: ['vendor', 'publisher', 'software_publisher'] },
  { key: 'software_product', label: 'software_product', core: true, aliases: ['product', 'software', 'application', 'package'] },
  { key: 'software_version', label: 'software_version', core: true, aliases: ['version', 'installed_version', 'release'] },
  { key: 'software_cpe', label: 'software_cpe', core: true, aliases: ['cpe', 'cpe_uri', 'cpe23', 'cpe_uri_binding'] },
  { key: 'hostname', label: 'hostname', aliases: ['dns_name', 'fqdn', 'host'] },
  { key: 'ip_address', label: 'ip_address', aliases: ['ip', 'private_ip', 'ipv4', 'address'] },
  { key: 'public_ip', label: 'public_ip', aliases: ['external_ip', 'wan_ip'] },
  { key: 'environment', label: 'environment', aliases: ['env', 'stage', 'deployment'] },
  { key: 'site_name', label: 'site_name', aliases: ['site', 'location', 'datacenter', 'dc'] },
  { key: 'region', label: 'region', aliases: ['geo_region', 'area'] },
  { key: 'country', label: 'country', aliases: ['country_code', 'geo'] },
  { key: 'owner_email', label: 'owner_email', aliases: ['owner_contact', 'email', 'contact'] },
  { key: 'business_unit', label: 'business_unit', aliases: ['bu', 'division', 'cost_center'] },
  { key: 'data_classification', label: 'data_classification', aliases: ['classification_label', 'info_classification'] },
  { key: 'os_name', label: 'os_name', aliases: ['os', 'operating_system', 'platform'] },
  { key: 'os_version', label: 'os_version', aliases: ['os_release', 'build'] },
  { key: 'cpu_cores', label: 'cpu_cores', aliases: ['vcpu', 'cores', 'cpu'] },
  { key: 'ram_gb', label: 'ram_gb', aliases: ['memory_gb', 'ram', 'memory'] },
  { key: 'storage_gb', label: 'storage_gb', aliases: ['disk_gb', 'storage', 'disk'] },
  { key: 'network_segment', label: 'network_segment', aliases: ['segment', 'subnet', 'zone'] },
  { key: 'vlan_id', label: 'vlan_id', aliases: ['vlan'] },
  { key: 'firewall_zone', label: 'firewall_zone', aliases: ['fw_zone', 'security_zone'] },
  { key: 'patch_group', label: 'patch_group', aliases: ['patch_ring', 'update_ring'] },
  { key: 'last_patch_date', label: 'last_patch_date', aliases: ['patched_on', 'last_update', 'last_patch'] },
  { key: 'days_since_patch', label: 'days_since_patch', aliases: ['patch_age_days', 'age_days'] },
  { key: 'backup_enabled', label: 'backup_enabled', aliases: ['backup', 'has_backup'] },
  { key: 'backup_frequency', label: 'backup_frequency', aliases: ['backup_schedule', 'backup_cadence'] },
  { key: 'mfa_enabled', label: 'mfa_enabled', aliases: ['mfa', 'mfa_enforced'] },
  { key: 'edr_installed', label: 'edr_installed', aliases: ['edr', 'has_edr', 'aedr'] },
  { key: 'antivirus_status', label: 'antivirus_status', aliases: ['av_status', 'antivirus', 'av'] },
  { key: 'install_date', label: 'install_date', aliases: ['provisioned_on', 'created'] },
  { key: 'lifecycle_status', label: 'lifecycle_status', aliases: ['lifecycle', 'status', 'eol_status'] },
  { key: 'support_end_date', label: 'support_end_date', aliases: ['eol_date', 'eos_date', 'end_of_support'] },
  { key: 'compliance_scope', label: 'compliance_scope', aliases: ['compliance', 'scopes', 'regulation'] },
  { key: 'asset_owner_contact_tier', label: 'asset_owner_contact_tier', aliases: ['contact_tier', 'escalation_tier'] },
  { key: 'tags', label: 'tags', aliases: ['labels', 'keywords'] },
  { key: 'data_source', label: 'data_source', aliases: ['source', 'origin', 'system_of_record'] },
]

export const EVENT_FIELDS: FieldSpec[] = [
  { key: 'timestamp', label: 'timestamp', required: true, core: true, aliases: ['time', 'ts', 'datetime', 'event_time', '@timestamp', 'occurred_at'] },
  { key: 'event_type', label: 'event_type', required: true, core: true, aliases: ['event', 'type', 'action', 'signal'] },
  { key: 'source_ip', label: 'source_ip', core: true, aliases: ['ip', 'src_ip', 'client_ip', 'remote_addr'] },
  { key: 'dest_asset', label: 'dest_asset', core: true, aliases: ['destination', 'asset', 'target', 'dest_asset_name', 'host'] },
  { key: 'dest_asset_id', label: 'dest_asset_id', core: true, aliases: ['asset_id', 'target_asset_id', 'cmdb_id'] },
  { key: 'username', label: 'username', core: true, aliases: ['user', 'account', 'principal', 'user_name'] },
  { key: 'event_category', label: 'event_category', core: true, aliases: ['category', 'channel'] },
  { key: 'severity', label: 'severity', core: true, aliases: ['level', 'risk_level'] },
  { key: 'outcome', label: 'outcome', core: true, aliases: ['result', 'status', 'success'] },
  { key: 'threat_indicator', label: 'threat_indicator', core: true, aliases: ['threat', 'indicator', 'detection', 'signature'] },
  { key: 'country_code', label: 'country_code', core: true, aliases: ['country', 'source_country', 'geo', 'client_country'] },
  { key: 'user_agent', label: 'user_agent', core: true, aliases: ['agent', 'ua'] },
  { key: 'protocol', label: 'protocol', core: true, aliases: ['proto', 'transport'] },
  { key: 'bytes', label: 'bytes', core: true, aliases: ['size', 'response_bytes', 'bytes_total'] },
  { key: 'bytes_in', label: 'bytes_in', aliases: ['in_bytes', 'rx_bytes'] },
  { key: 'bytes_out', label: 'bytes_out', aliases: ['out_bytes', 'tx_bytes'] },
  { key: 'event_id', label: 'event_id', aliases: ['id', 'record_id'] },
  { key: 'timezone', label: 'timezone', aliases: ['tz'] },
  { key: 'source_port', label: 'source_port', aliases: ['src_port'] },
  { key: 'source_hostname', label: 'source_hostname', aliases: ['src_host'] },
  { key: 'dest_ip', label: 'dest_ip', aliases: ['dst_ip', 'target_ip'] },
  { key: 'dest_port', label: 'dest_port', aliases: ['dst_port', 'port'] },
  { key: 'packets', label: 'packets', aliases: ['pkt', 'packet_count'] },
  { key: 'duration_ms', label: 'duration_ms', aliases: ['duration', 'elapsed_ms'] },
  { key: 'http_method', label: 'http_method', aliases: ['method'] },
  { key: 'http_path', label: 'http_path', aliases: ['path', 'uri', 'url'] },
  { key: 'http_status', label: 'http_status', aliases: ['status_code', 'response_code'] },
  { key: 'user_role', label: 'user_role', aliases: ['role'] },
  { key: 'auth_method', label: 'auth_method', aliases: ['auth', 'authentication_method'] },
  { key: 'mfa_used', label: 'mfa_used', aliases: ['mfa'] },
  { key: 'session_id', label: 'session_id', aliases: ['session'] },
  { key: 'device_id', label: 'device_id', aliases: ['device'] },
  { key: 'rule_name', label: 'rule_name', aliases: ['rule', 'policy'] },
  { key: 'action', label: 'action', aliases: ['disposition'] },
  { key: 'process_name', label: 'process_name', aliases: ['process', 'image'] },
  { key: 'risk_score', label: 'risk_score', aliases: ['risk', 'score'] },
  { key: 'requests_per_second', label: 'requests_per_second', aliases: ['rps', 'rate'] },
  { key: 'sensor_id', label: 'sensor_id', aliases: ['sensor'] },
  { key: 'site_name', label: 'site_name', aliases: ['site', 'location'] },
  { key: 'data_source', label: 'data_source', aliases: ['source', 'origin'] },
]

export const EVENT_TYPES = [
  'LOGIN_SUCCESS',
  'LOGIN_FAIL',
  'HTTP_REQUEST',
  'FIREWALL_ALLOW',
  'FIREWALL_DENY',
  'EXPLOIT_SIGNATURE',
  'PROCESS_START',
  'FILE_OPERATION',
  'PRIVILEGE_CHANGE',
  'OUTBOUND_CONNECTION',
  'OTHER',
]

const normalize = (header: string) =>
  header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

export function autoMap(headers: string[], fields: FieldSpec[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const field of fields) {
    const hit = headers.find((header) => {
      const n = normalize(header)
      return n === field.key || field.aliases.includes(n)
    })
    if (hit) map[field.key] = hit
  }
  return map
}

/** Preset signature check so a wide export needs no manual mapping. */
export function detectPreset(headers: string[], kind: 'assets' | 'logs'): { matched: number; total: number } | null {
  const fields = kind === 'assets' ? INVENTORY_FIELDS : EVENT_FIELDS
  const signature =
    kind === 'assets'
      ? ['asset_id', 'asset_type', 'software_cpe', 'environment', 'owner_department']
      : ['event_id', 'event_type', 'dest_asset_id', 'threat_indicator', 'sensor_id']
  const normalised = new Set(headers.map(normalize))
  if (!signature.every((column) => normalised.has(column))) return null
  const map = autoMap(headers, fields)
  return { matched: Object.keys(map).length, total: fields.length }
}

export const fieldFor = (kind: 'assets' | 'logs') => (kind === 'assets' ? INVENTORY_FIELDS : EVENT_FIELDS)

/* ------------------------------------------------------------------ *
 * Cell readers
 * ------------------------------------------------------------------ */

const TYPE_MAP: Record<string, AssetType> = {
  server: 'server',
  host: 'server',
  vm: 'server',
  virtual_machine: 'server',
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
  load_balancer: 'network',
  database: 'database',
  db: 'database',
  cloud: 'cloud',
  saas: 'cloud',
}

const toCriticality = (value: string): Criticality => {
  const upper = value.trim().toUpperCase()
  return upper === 'HIGH' || upper === 'LOW' ? upper : 'MEDIUM'
}

const BOOL_TRUE = ['true', '1', 'yes', 'y', 'exposed', 'external', 'public', 'internet', 'enabled', 'on', 'known', 'supported']

const toBool = (value: string): boolean => BOOL_TRUE.includes(value.trim().toLowerCase())

const toBoolOrNull = (value: string): boolean | null => {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  if (BOOL_TRUE.includes(trimmed)) return true
  if (['false', '0', 'no', 'n', 'disabled', 'off', 'unknown'].includes(trimmed)) return false
  return null
}

const toNumberOrNull = (value: string): number | null => {
  const parsed = Number(value.replace(/[, ]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

const toList = (value: string): string[] =>
  value
    ? value
        .split(/[;|,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : []

const toEpoch = (value: string): number | null => {
  if (!value) return null
  const parsed = Date.parse(value)
  if (!Number.isNaN(parsed)) return parsed
  const numeric = Number(value)
  return Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : null
}

/** Wide exports run through here 18k+ times, so the column positions are resolved once per file. */
const columnIndexes = (headers: string[], mapping: Record<string, string>) => {
  const at = new Map(headers.map((header, index) => [header, index]))
  const resolved: Record<string, number> = {}
  for (const [key, column] of Object.entries(mapping)) {
    const index = at.get(column)
    if (index !== undefined) resolved[key] = index
  }
  return resolved
}

const cellReader = (row: string[], indexes: Record<string, number>) => (key: string) => {
  const index = indexes[key]
  return index === undefined ? '' : String(row[index] ?? '').trim()
}

/* ------------------------------------------------------------------ *
 * Inventory rows → assets
 * ------------------------------------------------------------------ */

export function rowsToAssets(
  rows: string[][],
  headers: string[],
  mapping: Record<string, string>,
  datasetId: string,
): Asset[] {
  const byId = new Map<string, Asset>()
  const indexes = columnIndexes(headers, mapping)

  rows.forEach((row, i) => {
    const cell = cellReader(row, indexes)
    const name = cell('asset_name')
    if (!name) return
    const externalId = cell('asset_id')
    const cpe = cell('software_cpe')
    const vendor = cell('software_vendor')
    const product = cell('software_product')
    const version = cell('software_version')
    const software: Software[] =
      vendor || product || version || cpe
        ? [{ vendor: vendor || 'Unknown', product: product || 'Unknown', version: version || '', cpe: cpe || undefined }]
        : []

    const facts: InventoryFacts = {
      externalId,
      hostname: cell('hostname') || name,
      ipAddress: cell('ip_address'),
      publicIp: cell('public_ip'),
      environment: cell('environment').toLowerCase() || 'unknown',
      site: cell('site_name'),
      region: cell('region'),
      country: cell('country').toUpperCase(),
      os: cell('os_name'),
      osVersion: cell('os_version'),
      cpuCores: toNumberOrNull(cell('cpu_cores')),
      ramGb: toNumberOrNull(cell('ram_gb')),
      storageGb: toNumberOrNull(cell('storage_gb')),
      networkSegment: cell('network_segment'),
      vlan: cell('vlan_id'),
      firewallZone: cell('firewall_zone'),
      patchGroup: cell('patch_group'),
      lastPatchDate: cell('last_patch_date'),
      daysSincePatch: toNumberOrNull(cell('days_since_patch')),
      backupEnabled: toBoolOrNull(cell('backup_enabled')),
      backupFrequency: cell('backup_frequency'),
      mfaEnabled: toBoolOrNull(cell('mfa_enabled')),
      edrInstalled: toBoolOrNull(cell('edr_installed')),
      antivirusStatus: cell('antivirus_status'),
      businessUnit: cell('business_unit'),
      dataClassification: cell('data_classification'),
      lifecycleStatus: cell('lifecycle_status'),
      supportEndDate: cell('support_end_date'),
      complianceScope: toList(cell('compliance_scope')),
      ownerTier: cell('asset_owner_contact_tier'),
      tags: toList(cell('tags')),
    }

    const id = externalId ? `UP-${datasetId}-${externalId}` : `UP-${datasetId}-${i + 1}`
    const existing = byId.get(id)
    if (existing) {
      // A second row for the same asset is a second package, not a duplicate asset.
      const known = new Set(existing.software.map((entry) => `${entry.product} ${entry.version}`))
      for (const entry of software) {
        if (!known.has(`${entry.product} ${entry.version}`)) existing.software.push(entry)
      }
      if (existing.criticality !== 'HIGH' && toCriticality(cell('criticality')) === 'HIGH') {
        existing.criticality = 'HIGH'
      }
      if (!existing.internetFacing) existing.internetFacing = toBool(cell('internet_facing'))
      return
    }

    byId.set(id, {
      id,
      name,
      type: TYPE_MAP[normalize(cell('asset_type'))] ?? 'server',
      department: cell('owner_department') || 'Unassigned',
      criticality: toCriticality(cell('criticality')),
      businessFunction: cell('business_function') || 'Uploaded asset',
      internetFacing: toBool(cell('internet_facing')),
      sensitivity: toCriticality(cell('data_sensitivity')),
      source: 'USER UPLOAD',
      software,
      inventory: facts,
      datasetId,
    })
  })

  return [...byId.values()]
}

/* ------------------------------------------------------------------ *
 * Log rows → events
 * ------------------------------------------------------------------ */

const LEVELS: Record<string, RiskLevel> = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  MODERATE: 'MEDIUM',
  LOW: 'LOW',
  INFO: 'LOW',
  NONE: 'LOW',
}

export function rowsToEvents(
  rows: string[][],
  headers: string[],
  mapping: Record<string, string>,
  datasetId: string,
): SecurityEvent[] {
  const events: SecurityEvent[] = []
  const indexes = columnIndexes(headers, mapping)
  rows.forEach((row, i) => {
    const cell = cellReader(row, indexes)
    const ts = toEpoch(cell('timestamp'))
    if (ts === null) return
    const type = (cell('event_type') || 'OTHER').toUpperCase()
    const bytesIn = toNumberOrNull(cell('bytes_in')) ?? 0
    const bytesOut = toNumberOrNull(cell('bytes_out')) ?? toNumberOrNull(cell('bytes')) ?? 0
    events.push({
      id: cell('event_id') || `UP-${datasetId}-EVT-${i + 1}`,
      ts,
      type,
      category: cell('event_category').toLowerCase() || type.toLowerCase(),
      severity: LEVELS[cell('severity').toUpperCase()] ?? 'LOW',
      outcome: cell('outcome').toLowerCase(),
      sourceIp: cell('source_ip'),
      sourceCountry: cell('country_code').toUpperCase(),
      sourceHostname: cell('source_hostname'),
      destIp: cell('dest_ip'),
      destPort: toNumberOrNull(cell('dest_port')),
      destAssetId: cell('dest_asset_id'),
      destAssetName: cell('dest_asset'),
      protocol: cell('protocol').toUpperCase(),
      bytesIn,
      bytesOut,
      packets: toNumberOrNull(cell('packets')) ?? 0,
      durationMs: toNumberOrNull(cell('duration_ms')) ?? 0,
      httpMethod: cell('http_method').toUpperCase(),
      httpPath: cell('http_path'),
      httpStatus: toNumberOrNull(cell('http_status')),
      userAgent: cell('user_agent'),
      username: cell('username'),
      userRole: cell('user_role').toLowerCase(),
      authMethod: cell('auth_method').toLowerCase(),
      mfaUsed: toBoolOrNull(cell('mfa_used')),
      sessionId: cell('session_id'),
      deviceId: cell('device_id'),
      ruleName: cell('rule_name'),
      action: cell('action').toLowerCase(),
      threatIndicator: cell('threat_indicator').toLowerCase().replace(/\s+/g, '_'),
      processName: cell('process_name').toLowerCase(),
      riskScore: toNumberOrNull(cell('risk_score')),
      rps: toNumberOrNull(cell('requests_per_second')),
      sensorId: cell('sensor_id'),
      siteName: cell('site_name'),
    })
  })
  return events
}

/* ------------------------------------------------------------------ *
 * Dataset summaries
 * ------------------------------------------------------------------ */

export interface LogUploadSummary {
  total: number
  eventTypes: Record<string, number>
  failedLogins: number
  distinctIps: number
  destinations: string[]
  countries: string[]
  firstTimestamp: string | null
  lastTimestamp: string | null
  threatIndicators: Record<string, number>
  bytes: number
  sensors: number
}

const topKeys = (counts: Record<string, number>, limit: number) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label]) => label)

export function summarizeEvents(events: SecurityEvent[]): LogUploadSummary {
  const eventTypes: Record<string, number> = {}
  const threatIndicators: Record<string, number> = {}
  const destinations: Record<string, number> = {}
  const countries = new Set<string>()
  const ips = new Set<string>()
  const sensors = new Set<string>()
  let failedLogins = 0
  let bytes = 0
  let first: number | null = null
  let last: number | null = null

  for (const event of events) {
    eventTypes[event.type] = (eventTypes[event.type] ?? 0) + 1
    if (event.threatIndicator) threatIndicators[event.threatIndicator] = (threatIndicators[event.threatIndicator] ?? 0) + 1
    if (event.type === 'LOGIN_FAIL' || event.outcome === 'failure') failedLogins += 1
    if (event.sourceIp) ips.add(event.sourceIp)
    if (event.destAssetId) destinations[event.destAssetId] = (destinations[event.destAssetId] ?? 0) + 1
    else if (event.destAssetName) destinations[event.destAssetName] = (destinations[event.destAssetName] ?? 0) + 1
    if (event.sourceCountry) countries.add(event.sourceCountry)
    if (event.sensorId) sensors.add(event.sensorId)
    bytes += event.bytesIn + event.bytesOut
    first = first === null ? event.ts : Math.min(first, event.ts)
    last = last === null ? event.ts : Math.max(last, event.ts)
  }

  return {
    total: events.length,
    eventTypes,
    failedLogins,
    distinctIps: ips.size,
    destinations: topKeys(destinations, 25),
    countries: [...countries].sort(),
    firstTimestamp: first === null ? null : new Date(first).toISOString(),
    lastTimestamp: last === null ? null : new Date(last).toISOString(),
    threatIndicators,
    bytes,
    sensors: sensors.size,
  }
}

export function telemetryTotals(events: SecurityEvent[]): TelemetryTotals {
  const byType: Record<string, number> = {}
  const byThreat: Record<string, number> = {}
  const byCountry: Record<string, number> = {}
  const byUser: Record<string, number> = {}
  const ips = new Set<string>()
  const assets = new Set<string>()
  const users = new Set<string>()
  const sensors = new Set<string>()
  const sites = new Set<string>()
  let failures = 0
  let threatHits = 0
  let bytes = 0
  let first: number | null = null
  let last: number | null = null

  for (const event of events) {
    byType[event.type] = (byType[event.type] ?? 0) + 1
    if (event.threatIndicator) {
      byThreat[event.threatIndicator] = (byThreat[event.threatIndicator] ?? 0) + 1
      threatHits += 1
    }
    if (event.sourceCountry) byCountry[event.sourceCountry] = (byCountry[event.sourceCountry] ?? 0) + 1
    if (event.username) {
      byUser[event.username] = (byUser[event.username] ?? 0) + 1
      users.add(event.username)
    }
    if (event.sourceIp) ips.add(event.sourceIp)
    if (event.destAssetId) assets.add(event.destAssetId)
    else if (event.destAssetName) assets.add(event.destAssetName)
    if (event.sensorId) sensors.add(event.sensorId)
    if (event.siteName) sites.add(event.siteName)
    if (event.outcome === 'failure' || event.type === 'LOGIN_FAIL') failures += 1
    bytes += event.bytesIn + event.bytesOut
    first = first === null ? event.ts : Math.min(first, event.ts)
    last = last === null ? event.ts : Math.max(last, event.ts)
  }

  const ranked = (counts: Record<string, number>, limit: number) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([label, value]) => ({ label, value }))

  return {
    events: events.length,
    assetsTargeted: assets.size,
    distinctSourceIps: ips.size,
    distinctUsers: users.size,
    failures,
    threatHits,
    bytes,
    firstTs: first,
    lastTs: last,
    byType: ranked(byType, 12),
    byThreat: ranked(byThreat, 12),
    byCountry: ranked(byCountry, 20),
    topUsers: ranked(byUser, 12),
    sensors: sensors.size,
    sites: [...sites].sort(),
  }
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

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
  source: 'USER UPLOAD'
  assets: Asset[]
  logs?: LogUploadSummary
  events?: SecurityEvent[]
  preset?: string
  truncated?: string
}

export const MAX_DATASETS = 12
export const MAX_ASSETS = 6000
export const MAX_EVENTS = 60000

/** Sentinel scope: every accepted dataset merged, which is also how the demo seed stands alone. */
export const ALL_DATASETS = 'ALL'

interface UploadsState {
  datasets: UploadedDataset[]
  /** The dataset every page analyses; see estate.ts for how it re-scopes the workspace. */
  activeId: string
  add: (dataset: UploadedDataset) => void
  remove: (id: string) => void
  clear: () => void
  setActive: (id: string) => void
}

const enforceBudget = (datasets: UploadedDataset[]): UploadedDataset[] =>
  datasets.slice(0, MAX_DATASETS).map((entry) => {
    if (entry.assets.length <= MAX_ASSETS && (entry.events?.length ?? 0) <= MAX_EVENTS) return entry
    const assets = entry.assets.slice(0, MAX_ASSETS)
    const events = entry.events?.slice(0, MAX_EVENTS)
    const dropped = entry.assets.length - assets.length + (entry.events?.length ?? 0) - (events?.length ?? 0)
    return {
      ...entry,
      assets,
      ...(events ? { events } : {}),
      truncated: `${dropped.toLocaleString()} row(s) dropped by the browser budget`,
    }
  })

export const useUploads = create<UploadsState>()(
  persist(
    (set) => ({
      datasets: [],
      activeId: ALL_DATASETS,
      add: (dataset) => set((state) => ({ datasets: enforceBudget([dataset, ...state.datasets]) })),
      remove: (id) =>
        set((state) => ({
          datasets: state.datasets.filter((entry) => entry.id !== id),
          activeId: state.activeId === id ? ALL_DATASETS : state.activeId,
        })),
      clear: () => set({ datasets: [], activeId: ALL_DATASETS }),
      setActive: (id) => set({ activeId: id }),
    }),
    {
      name: 'aegis.uploads',
      version: 3,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({ datasets: state.datasets, activeId: state.activeId }),
      migrate: (persisted: any) => {
        const state = persisted ?? {}
        const has = Array.isArray(state.datasets) && state.datasets.some((d: UploadedDataset) => d.id === state.activeId)
        return { ...state, activeId: has ? state.activeId : ALL_DATASETS }
      },
    },
  ),
)

/** Uploads hydrate from IndexedDB, which is async; the app waits for it so no page ever
    renders an estate that is missing its datasets. */
export const uploadsReady = () =>
  new Promise<void>((resolve) => {
    const store = useUploads.persist
    if (store.hasHydrated()) {
      resolve()
      return
    }
    const unsubscribe = store.onFinishHydration(() => {
      unsubscribe()
      resolve()
    })
    setTimeout(() => resolve(), 2500)
  })

export const allUploadedAssets = (datasets: UploadedDataset[]): Asset[] =>
  datasets.flatMap((d) => d.assets)

export const allUploadedEvents = (datasets: UploadedDataset[]): SecurityEvent[] =>
  datasets.flatMap((d) => d.events ?? [])

export const allUploadedLogs = (datasets: UploadedDataset[]): UploadedDataset[] =>
  datasets.filter((d) => d.logs)

export const scopeDatasets = (datasets: UploadedDataset[], activeId: string): UploadedDataset[] =>
  activeId === ALL_DATASETS ? datasets : datasets.filter((d) => d.id === activeId)

export const datasetName = (datasets: UploadedDataset[], id: string): string =>
  datasets.find((d) => d.id === id)?.name ?? 'Demo seed'

/* ------------------------------------------------------------------ *
 * JSON / JSONL support
 * ------------------------------------------------------------------ */

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
