/**
 * Generate upload-ready test datasets for Aegis Sentinel.
 *
 * The inventory rows are built from the real product keys in src/data/vuln-corpus.json,
 * and every installed version is picked by replaying corpus.ts range maths, so the
 * correlation engine is guaranteed a decision on each row instead of guessing.
 *
 *   node scripts/gen-test-datasets.mjs [--assets 160] [--events 8000] [--seed 7]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'testdata')
const corpus = JSON.parse(readFileSync(resolve(ROOT, 'src/data/vuln-corpus.json'), 'utf8'))

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : Number(args[i + 1])
}
const ASSET_TARGET = flag('assets', 160)
const EVENT_TARGET = flag('events', 8000)
const SEED = flag('seed', 7)

/* ------------------------------------------------------------------ *
 * Mirrors of the pure resolvers in src/lib/corpus.ts. Keep in step.
 * ------------------------------------------------------------------ */

const slug = (value) =>
  String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_|_$/g, '')

const VENDOR_ALIASES = {
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

const productIndex = new Map()
for (const key of Object.keys(corpus.products)) {
  const product = key.split(':')[1]
  productIndex.set(product, productIndex.has(product) ? '' : key)
}

const resolveKey = (vendor, product) => {
  const v = slug(vendor)
  const p = slug(product)
  if (!p) return null
  const exact = `${VENDOR_ALIASES[v] ?? v}:${p}`
  if (corpus.products[exact]) return exact
  if (corpus.products[`${v}:${p}`]) return `${v}:${p}`
  return productIndex.get(p) || null
}

const UNKNOWN_VERSIONS = new Set(['', '*', '-', 'n/a', 'na', 'unknown', 'undetermined', 'null'])

const tokenize = (version) => {
  const cleaned = String(version).trim().toLowerCase()
  if (UNKNOWN_VERSIONS.has(cleaned)) return null
  const matches = cleaned.match(/\d+|[a-z]+/g)
  return matches ? matches.map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : null
}

const compareVersions = (a, b) => {
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

const inside = (version, range) => {
  const test = (bound, cmp) => {
    if (!bound) return true
    const delta = compareVersions(version, bound)
    return delta === null ? null : cmp(delta)
  }
  const checks = [
    test(range.si, (d) => d >= 0),
    test(range.se, (d) => d > 0),
    test(range.ei, (d) => d <= 0),
    test(range.ee, (d) => d < 0),
  ]
  if (checks.some((pass) => pass === null)) return null
  return checks.every(Boolean)
}

/* ------------------------------------------------------------------ *
 * Deterministic randomness
 * ------------------------------------------------------------------ */

let state = SEED >>> 0
const rnd = () => {
  state = (state + 0x6d2b79f5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (list) => list[Math.floor(rnd() * list.length)]
const chance = (p) => rnd() < p
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1))

/* ------------------------------------------------------------------ *
 * Version sourcing
 * ------------------------------------------------------------------ */

const bump = (bound, direction) => {
  const tokens = tokenize(bound)
  if (!tokens) return null
  const numeric = tokens.filter((t) => typeof t === 'number')
  if (!numeric.length) return null
  const last = numeric.length - 1
  const value = numeric.map((n, i) => (i === last ? Math.max(0, n + direction) : n))
  return value.join('.')
}

/** One version that lands inside the CVE's affected window, or null if unsatisfiable. */
const vulnerableVersion = (record) => {
  for (const range of record.ranges) {
    const candidates = [
      range.si,
      range.ei,
      range.ee ? bump(range.ee, -1) : null,
      range.ee,
      range.se ? bump(range.se, -1) : null,
    ]
    for (const candidate of candidates) {
      if (!candidate) continue
      if (inside(candidate, range) === true) return candidate
    }
  }
  return null
}

/** The vendor/product strings a CSV cell can carry and still resolve to this corpus key. */
const displayFor = (key) => {
  const entry = corpus.products[key]
  const [keyVendor, keyProduct] = key.split(':')
  const candidates = [
    [entry.vendor, entry.product],
    [keyVendor, keyProduct],
    [entry.vendor, keyProduct],
  ]
  for (const [vendor, product] of candidates) {
    if (resolveKey(vendor, product) === key) return { vendor, product }
  }
  return { vendor: keyVendor, product: keyProduct }
}

const PACKABLE = Object.keys(corpus.products)
  .map((key) => {
    const records = corpus.products[key].cves
    const vulnerable = records
      .map((record) => ({ id: record.id, version: vulnerableVersion(record), kev: record.kev, cvss: record.cvss }))
      .filter((hit) => hit.version)
    const latestFix = records
      .map((record) => String(record.fix ?? '').match(/\d+(?:\.\d+)+/)?.[0])
      .filter(Boolean)
      .sort(compareVersions)
      .at(-1)
    return { key, count: records.length, vulnerable, display: displayFor(key), fix: latestFix }
  })
  .filter((p) => p.vulnerable.length >= 4)

/* ------------------------------------------------------------------ *
 * The fictional estate: Cobalt Freight Co.
 * ------------------------------------------------------------------ */

const ANCHOR = Date.parse('2026-10-31T09:42:00Z')
const HOUR = 3600_000

const SITES = [
  { code: 'RTM', site: 'Rotterdam Hub', region: 'eu-west', country: 'NL', net: '10.20' },
  { code: 'SIN', site: 'Singapore Hub', region: 'ap-southeast', country: 'SG', net: '10.30' },
  { code: 'CHI', site: 'Chicago DC', region: 'us-central', country: 'US', net: '10.40' },
  { code: 'DAL', site: 'Dallas DC', region: 'us-east', country: 'US', net: '10.50' },
  { code: 'BOM', site: 'Mumbai Office', region: 'ap-south', country: 'IN', net: '10.60' },
  { code: 'DUB', site: 'Dublin Office', region: 'eu-north', country: 'IE', net: '10.70' },
]

const DEPARTMENTS = [
  { name: 'Operations', function: 'Freight orchestration', criticality: 'HIGH', sensitivity: 'HIGH' },
  { name: 'Engineering', function: 'Customer platform', criticality: 'HIGH', sensitivity: 'MEDIUM' },
  { name: 'Finance', function: 'Billing and settlement', criticality: 'HIGH', sensitivity: 'HIGH' },
  { name: 'People', function: 'HR self-service', criticality: 'MEDIUM', sensitivity: 'HIGH' },
  { name: 'Commerce', function: 'Partner EDI gateway', criticality: 'HIGH', sensitivity: 'MEDIUM' },
  { name: 'IT', function: 'Directory and remote access', criticality: 'HIGH', sensitivity: 'HIGH' },
  { name: 'Legal', function: 'Records retention', criticality: 'LOW', sensitivity: 'HIGH' },
  { name: 'Analytics', function: 'Telemetry warehouse', criticality: 'MEDIUM', sensitivity: 'MEDIUM' },
]

const TYPES = ['server', 'app', 'database', 'network', 'endpoint', 'cloud']
const OS = [
  ['Ubuntu Server', '22.04 LTS'],
  ['Ubuntu Server', '20.04 LTS'],
  ['Red Hat Enterprise Linux', '9.3'],
  ['Windows Server', '2022'],
  ['Debian', '12'],
]
const COMPLIANCE = ['SOC2', 'ISO27001', 'PCI-DSS', 'GDPR', 'NIS2']
const ROLES = ['svc-backup', 'm.okafor', 'j.smith', 'a.iyer', 'dev.rodriguez', 'k.tanaka', 'admin', 'svc-sync', 'l.haddad', 'ops-runner']
const OWNER_TIERS = ['tier-1-noc', 'tier-2-platform', 'tier-3-security']

const UNPACKAGED = ['Cobalt Waybill Engine', 'Quayside Scanner', 'Freightline Scheduler', 'Cobalt Agent']

const assets = []
const inventoryRows = []

const makeAsset = (n) => {
  const site = SITES[n % SITES.length]
  const dept = pick(DEPARTMENTS)
  const type = pick(TYPES)
  const internetFacing = type === 'app' || type === 'network' ? chance(0.7) : chance(0.15)
  const [osName, osVersion] = pick(OS)
  const patchAge = int(3, 190)
  const id = `CFC-${String(1000 + n)}`
  const name = `${site.code.toLowerCase()}-${type}-${dept.name.slice(0, 3).toLowerCase()}-${String(n).padStart(3, '0')}`
  const hostname = `${name}.${site.code.toLowerCase()}.cobaltfreight.example`
  const ip = `10.${site.net.split('.')[1]}.${int(1, 40)}.${int(2, 250)}`
  const env = internetFacing ? (chance(0.75) ? 'prod' : 'staging') : pick(['prod', 'prod', 'staging', 'dev', 'dr'])
  const installedDays = int(40, 900)

  const asset = {
    id,
    name,
    hostname,
    ip,
    publicIp: internetFacing ? `198.51.100.${int(2, 250)}` : '',
    type,
    dept,
    site,
    osName,
    osVersion,
    env,
    internetFacing,
    patchAge,
    installedDays,
    packages: [],
  }

  const bundle = []
  const wanted = int(1, 4)
  for (let i = 0; i < wanted; i += 1) {
    const product = pick(PACKABLE)
    const mode = env === 'dev' || env === 'staging' ? pick(['vuln', 'vuln', 'vuln', 'fixed', 'unknown']) : pick(['vuln', 'vuln', 'fixed', 'unknown'])
    let version
    let cveId = ''
    if (mode === 'vuln') {
      const hit = pick(product.vulnerable)
      version = hit.version
      cveId = hit.id
    } else if (mode === 'fixed' && product.fix) {
      version = product.fix
    } else {
      version = pick(['', 'unknown', '*'])
    }
    bundle.push({ product, version, cveId, mode })
  }
  if (chance(0.35)) bundle.push({ product: null, name: pick(UNPACKAGED), version: `${int(1, 4)}.${int(0, 9)}.${int(0, 9)}`, mode: 'absent' })
  asset.packages = bundle
  return asset
}

for (let n = 1; n <= ASSET_TARGET; n += 1) assets.push(makeAsset(n))

const iso = (ms) => new Date(ms).toISOString()
const dateOnly = (ms) => iso(ms).slice(0, 10)

for (const asset of assets) {
  for (const pkg of asset.packages) {
    const display = pkg.product ? pkg.product.display : { vendor: 'Cobalt Freight', product: pkg.name }
    const version = pkg.version
    const cpe =
      pkg.product && version && version !== 'unknown' && version !== '*'
        ? `cpe:2.3:a:${pkg.product.key.split(':')[0]}:${pkg.product.key.split(':')[1]}:${version}:*:*:*:*:*:*:*`
        : ''
    inventoryRows.push({
      asset_id: asset.id,
      asset_name: asset.name,
      hostname: asset.hostname,
      ip_address: asset.ip,
      public_ip: asset.publicIp,
      asset_type: asset.type,
      owner_department: asset.dept.name,
      owner_email: `${asset.dept.name.toLowerCase()}@cobaltfreight.example`,
      business_unit: `BU-${asset.dept.name.slice(0, 3).toUpperCase()}`,
      criticality: asset.dept.criticality,
      business_function: asset.dept.function,
      internet_facing: asset.internetFacing ? 'true' : 'false',
      data_sensitivity: asset.dept.sensitivity,
      data_classification: asset.dept.sensitivity === 'HIGH' ? 'restricted' : 'internal',
      environment: asset.env,
      site_name: asset.site.site,
      region: asset.site.region,
      country: asset.site.country,
      os_name: asset.osName,
      os_version: asset.osVersion,
      cpu_cores: int(2, 32),
      ram_gb: pick([4, 8, 16, 32, 64, 128]),
      storage_gb: pick([80, 250, 500, 1000, 2000]),
      network_segment: asset.internetFacing ? 'dmz-public' : `core-${asset.site.code.toLowerCase()}`,
      vlan_id: `VLAN-${int(10, 400)}`,
      firewall_zone: asset.internetFacing ? 'edge' : pick(['internal', 'restricted', 'management']),
      patch_group: pick(['ring-fast', 'ring-standard', 'ring-frozen']),
      last_patch_date: dateOnly(ANCHOR - asset.patchAge * 24 * HOUR),
      days_since_patch: asset.patchAge,
      backup_enabled: chance(0.8) ? 'true' : 'false',
      backup_frequency: pick(['hourly', 'daily', 'weekly', 'none']),
      mfa_enabled: chance(0.65) ? 'true' : 'false',
      edr_installed: chance(0.75) ? 'true' : 'false',
      antivirus_status: pick(['current', 'out-of-date', 'not-installed', 'current', 'current']),
      install_date: dateOnly(ANCHOR - asset.installedDays * 24 * HOUR),
      lifecycle_status: pick(['active', 'active', 'active', 'out-of-support', 'deprecated']),
      support_end_date: dateOnly(ANCHOR + int(-400, 1200) * 24 * HOUR),
      compliance_scope: [pick(COMPLIANCE), pick(COMPLIANCE)].filter((v, i, list) => list.indexOf(v) === i).join(';'),
      asset_owner_contact_tier: pick(OWNER_TIERS),
      tags: [asset.env, asset.type, asset.site.code].join(';'),
      data_source: 'ServiceNow CMDB export',
      software_vendor: display.vendor,
      software_product: display.product,
      software_version: version,
      software_cpe: cpe,
    })
  }
}

/* ------------------------------------------------------------------ *
 * Telemetry: normal traffic plus scripted attacker behaviour
 * ------------------------------------------------------------------ */

const ATTACKERS = [
  ['45.83.122.', 'RU'],
  ['103.152.77.', 'CN'],
  ['185.220.101.', 'DE'],
  ['91.240.118.', 'NL'],
  ['41.79.14.', 'NG'],
  ['196.240.59.', 'VN'],
  ['177.54.180.', 'BR'],
  ['13.228.90.', 'SG'],
  ['203.0.113.', 'US'],
  ['198.51.100.', 'IN'],
]
const COUNTRIES = ['US', 'IN', 'SG', 'NL', 'DE', 'GB', 'BR', 'VN', 'CN', 'RU', 'AE', 'ZA', 'AU', 'ID', 'MY', 'TR', 'PL', 'ES', 'UA', 'KZ']
const SENSORS = ['sensor-edge-01', 'sensor-core-02', 'sensor-dc-chicago', 'sensor-cloud-egress', 'sensor-identity', 'sensor-office-apac']
const PATHS = ['/api/waybill', '/login', '/admin', '/wp-login.php', '/actuator/env', '/.env', '/feed', '/solr/admin', '/struts.action', '/geoit/ping', '/cgi-bin/sid']
const PROCESSES = ['powershell.exe', 'wmic.exe', 'curl.exe', 'bash', 'schtasks.exe', 'procdump.exe', 'ngrok', 'rclone']
const RULES = ['ET EXPLOIT Log4j JNDI lookup', 'ET EXPLOIT SSRF metadata endpoint', 'ET POLICY outbound tunnel', 'Auth: 10 failures in 60s', 'ET TROjan C2 beacon', 'Privilege: role granted']

const events = []
let eventSeq = 1
const emit = (ts, fields) => {
  events.push({ event_id: `EVT-${String(eventSeq++).padStart(6, '0')}`, timestamp: iso(ts), ...fields })
}

const baseRow = (ts, asset) => {
  const attacker = pick(ATTACKERS)
  const internal = chance(0.45)
  return {
    event_type: 'HTTP_REQUEST',
    event_category: 'web',
    severity: 'INFO',
    outcome: 'success',
    source_ip: internal ? `10.${int(10, 90)}.${int(1, 40)}.${int(2, 250)}` : `${attacker[0]}${int(2, 250)}`,
    source_port: int(30000, 65000),
    source_hostname: internal ? `ws-${int(1, 80)}.${asset.site.code.toLowerCase()}.cobaltfreight.example` : '',
    country_code: internal ? asset.site.country : pick(COUNTRIES),
    dest_ip: asset.ip,
    dest_port: pick([443, 443, 443, 80, 8080, 3306, 5432, 6379, 22]),
    dest_asset: asset.name,
    dest_asset_id: asset.id,
    protocol: 'HTTPS',
    bytes: int(400, 40000),
    bytes_in: int(200, 8000),
    bytes_out: int(200, 40000),
    packets: int(1, 120),
    duration_ms: int(4, 9000),
    http_method: pick(['GET', 'GET', 'POST', 'PUT']),
    http_path: pick(PATHS),
    http_status: pick([200, 200, 204, 301, 401, 403, 500]),
    user_agent: pick(['Mozilla/5.0 (Windows NT 10.0) Chrome/128', 'Mozilla/5.0 (Macintosh) Safari/605', 'curl/8.4.0', 'python-requests/2.31', 'Nmap Scripting Engine', 'Java/1.8.0_202']),
    username: pick(ROLES),
    user_role: pick(['admin', 'operator', 'analyst', 'service', 'guest']),
    auth_method: pick(['saml', 'oidc', 'password', 'apikey', 'certificate']),
    mfa_used: chance(0.5) ? 'true' : 'false',
    session_id: `sess-${Math.floor(rnd() * 1e9).toString(16)}`,
    device_id: `dev-${int(1000, 9999)}`,
    rule_name: '',
    action: 'allow',
    threat_indicator: '',
    process_name: '',
    risk_score: '',
    requests_per_second: int(1, 40),
    sensor_id: pick(SENSORS),
    site_name: asset.site.site,
    data_source: 'Cobalt SIEM export',
  }
}

// Baseline: seven days of ordinary traffic.
for (let i = 0; i < EVENT_TARGET; i += 1) {
  const ts = ANCHOR - Math.floor(rnd() * 7 * 24 * HOUR)
  const asset = pick(assets)
  const row = baseRow(ts, asset)
  const roll = rnd()
  if (roll < 0.55) row.event_type = 'HTTP_REQUEST'
  else if (roll < 0.72) Object.assign(row, { event_type: 'LOGIN_SUCCESS', event_category: 'auth', dest_port: 443 })
  else if (roll < 0.8) Object.assign(row, { event_type: 'LOGIN_FAIL', outcome: 'failure', severity: 'LOW' })
  else if (roll < 0.88) Object.assign(row, { event_type: 'FIREWALL_ALLOW', event_category: 'network' })
  else if (roll < 0.94) Object.assign(row, { event_type: 'FIREWALL_DENY', action: 'block', outcome: 'failure', event_category: 'network' })
  else if (roll < 0.97) Object.assign(row, { event_type: 'PROCESS_START', event_category: 'endpoint', process_name: pick(PROCESSES), source_ip: asset.ip })
  else Object.assign(row, { event_type: 'FILE_OPERATION', event_category: 'endpoint', process_name: pick(PROCESSES), source_ip: asset.ip })
  emit(ts, row)
}

// Scenario 1 · credential brute force against the exposed portal hosts.
const bruteTargets = assets.filter((a) => a.internetFacing).slice(0, 8)
for (const target of bruteTargets) {
  const attacker = pick(ATTACKERS)
  const start = ANCHOR - Math.floor(rnd() * 6 * 24 * HOUR)
  const volume = int(120, 320)
  for (let i = 0; i < volume; i += 1) {
    const ts = start + i * int(2000, 9000)
    const row = baseRow(ts, target)
    Object.assign(row, {
      event_type: i % 37 === 0 ? 'LOGIN_SUCCESS' : 'LOGIN_FAIL',
      event_category: 'auth',
      outcome: i % 37 === 0 ? 'success' : 'failure',
      severity: i % 37 === 0 ? 'MEDIUM' : 'LOW',
      source_ip: `${attacker[0]}${int(2, 250)}`,
      country_code: attacker[1],
      user_agent: 'python-requests/2.31',
      http_path: '/login',
      http_method: 'POST',
      http_status: i % 37 === 0 ? 302 : 401,
      rule_name: 'Auth: 10 failures in 60s',
      risk_score: int(55, 95),
      requests_per_second: int(40, 260),
      sensor_id: 'sensor-identity',
    })
    emit(ts, row)
  }
}

// Scenario 2 · exploitation of the exact CVEs the inventory carries.
const vulnerable = assets.filter((a) => a.packages.some((p) => p.mode === 'vuln'))
for (let i = 0; i < 90; i += 1) {
  const asset = pick(vulnerable)
  const pkg = pick(asset.packages.filter((p) => p.mode === 'vuln'))
  const ts = ANCHOR - Math.floor(rnd() * 5 * 24 * HOUR)
  const attacker = pick(ATTACKERS)
  const row = baseRow(ts, asset)
  Object.assign(row, {
    event_type: 'EXPLOIT_SIGNATURE',
    event_category: 'ids',
    severity: pkg.cveId ? 'CRITICAL' : 'HIGH',
    outcome: chance(0.3) ? 'success' : 'blocked',
    action: chance(0.3) ? 'alert' : 'block',
    threat_indicator: `${pkg.cveId || 'generic-probe'}_${(pkg.product?.key ?? 'unknown').replace(':', '_')}`,
    rule_name: pick(RULES),
    http_path: pick(PATHS),
    http_method: 'POST',
    http_status: pick([200, 403, 500]),
    source_ip: `${attacker[0]}${int(2, 250)}`,
    country_code: attacker[1],
    risk_score: int(70, 99),
    sensor_id: 'sensor-edge-01',
  })
  emit(ts, row)
  if (row.outcome === 'success') {
    const after = ts + int(4, 90) * 60_000
    const chain = { ...row, event_type: 'PROCESS_START', event_category: 'endpoint', severity: 'CRITICAL', source_ip: asset.ip, threat_indicator: '', process_name: pick(PROCESSES), action: 'allow', rule_name: '', risk_score: int(80, 99) }
    emit(after, chain)
    const exfil = {
      ...row,
      event_type: 'OUTBOUND_CONNECTION',
      event_category: 'network',
      severity: 'HIGH',
      outcome: 'success',
      action: 'allow',
      source_ip: asset.ip,
      dest_ip: `${attacker[0]}${int(2, 250)}`,
      dest_port: pick([443, 8443, 53, 21]),
      country_code: attacker[1],
      bytes_out: int(400_000, 9_000_000),
      bytes: int(400_000, 9_000_000),
      threat_indicator: 'c2_beacon_possible',
      rule_name: 'ET POLICY outbound tunnel',
      risk_score: int(75, 96),
      sensor_id: 'sensor-cloud-egress',
    }
    emit(after + int(3, 40) * 60_000, exfil)
  }
}

// Scenario 3 · privilege escalation followed by account abuse.
for (let i = 0; i < 40; i += 1) {
  const asset = pick(assets)
  const ts = ANCHOR - Math.floor(rnd() * 6 * 24 * HOUR)
  const row = baseRow(ts, asset)
  Object.assign(row, {
    event_type: 'PRIVILEGE_CHANGE',
    event_category: 'identity',
    severity: 'HIGH',
    outcome: 'success',
    threat_indicator: 'privilege_escalation',
    rule_name: 'Privilege: role granted',
    username: pick(ROLES),
    user_role: 'admin',
    risk_score: int(65, 92),
    sensor_id: 'sensor-identity',
    source_ip: asset.ip,
  })
  emit(ts, row)
}

/* ------------------------------------------------------------------ *
 * Edge-case file: the shapes that should not crash the importer
 * ------------------------------------------------------------------ */

const edgeRows = [
  { asset_name: '', asset_type: 'server', criticality: 'HIGH', software_product: 'nginx' },
  { asset_id: 'CFC-EDGE-01', asset_name: 'quoted, name with comma', hostname: 'edge-01', asset_type: 'workstation', criticality: 'unknown-value', internet_facing: 'yes', software_vendor: 'NGINX', software_product: 'nginx', software_version: '1.20.0' },
  { asset_id: 'CFC-EDGE-02', asset_name: 'palo alto wrong vendor spelling', asset_type: 'FireWall', criticality: 'critical', internet_facing: 'exposed', software_vendor: 'Palo Networks', software_product: 'PAN-OS', software_version: '10.2.3' },
  { asset_id: 'CFC-EDGE-03', asset_name: 'cpe only, blank flat columns', asset_type: 'vm', criticality: 'high', software_vendor: '', software_product: '', software_version: '', software_cpe: 'cpe:/a:apache:log4j:2.14.1' },
  { asset_id: 'CFC-EDGE-04', asset_name: 'bad timestamps and numbers', asset_type: 'host', criticality: 'low', cpu_cores: 'many', ram_gb: 'n/a', last_patch_date: '31/10/2026', days_since_patch: '-1', software_vendor: 'F5', software_product: 'nginx', software_version: '1.17.0' },
  { asset_id: 'CFC-EDGE-05', asset_name: 'unicode + emoji owner', owner_department: 'People ✦ Pune', country: 'in', compliance_scope: 'SOC2,ISO27001;GDPR', tags: 'ünïcode;标签', software_vendor: 'Google', software_product: 'Chrome', software_version: '115.0.5790.170' },
  { asset_id: 'CFC-EDGE-05', asset_name: 'unicode + emoji owner', asset_type: 'endpoint', software_vendor: 'Elastic', software_product: 'Elasticsearch', software_version: '7.10.0' },
  { asset_id: 'CFC-EDGE-06', asset_name: 'csv injection probe', asset_type: 'server', criticality: 'HIGH', tags: '=1+1', software_vendor: 'Jenkins', software_product: 'Jenkins', software_version: '2.400' },
  { asset_id: 'CFC-EDGE-07', asset_name: 'product absent from corpus', asset_type: 'cloud', criticality: 'MEDIUM', software_vendor: 'Cobalt Freight', software_product: 'Waybill Engine', software_version: '9.9.9' },
]

/* ------------------------------------------------------------------ *
 * Serialise
 * ------------------------------------------------------------------ */

const escape = (value) => {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const toCsv = (rows, columns) =>
  [columns.join(','), ...rows.map((row) => columns.map((c) => escape(row[c] ?? '')).join(','))].join('\n') + '\n'

mkdirSync(OUT, { recursive: true })

const inventoryColumns = Object.keys(inventoryRows[0])
writeFileSync(resolve(OUT, 'cobalt-inventory.csv'), toCsv(inventoryRows, inventoryColumns))
writeFileSync(
  resolve(OUT, 'cobalt-inventory.json'),
  JSON.stringify(
    { source: 'ServiceNow CMDB export', generatedAt: iso(ANCHOR), assets: inventoryRows.slice(0, 400) },
    null,
    0,
  ) + '\n',
)

const eventColumns = Object.keys(events[0])
writeFileSync(resolve(OUT, 'cobalt-telemetry.csv'), toCsv(events, eventColumns))
writeFileSync(resolve(OUT, 'cobalt-telemetry.jsonl'), events.slice(0, 2500).map((e) => JSON.stringify(e)).join('\n') + '\n')

const edgeColumns = [...new Set(edgeRows.flatMap((row) => Object.keys(row)))]
writeFileSync(resolve(OUT, 'cobalt-edge-cases.csv'), toCsv(edgeRows, edgeColumns))

/* ------------------------------------------------------------------ *
 * Proof that the inventory will actually correlate
 * ------------------------------------------------------------------ */

const matched = new Map()
const statuses = { MATCHED: 0, NOT_AFFECTED: 0, VERSION_UNKNOWN: 0, UNRESOLVED: 0 }

/** Mirror of corpus.ts parseCpe: legacy `cpe:/a:v:p:v` and `cpe:2.3:a:v:p:v`. */
const parseCpe = (criteria) => {
  const bits = String(criteria).trim().toLowerCase().split(':')
  if (bits[1]?.startsWith('/')) return { vendor: bits[2] ?? '', product: bits[3] ?? '', version: bits[4] ?? '' }
  if (bits[1] === '2.3') return { vendor: bits[3] ?? '', product: bits[4] ?? '', version: bits[5] ?? '' }
  return null
}

for (const row of inventoryRows) {
  const cpe = row.software_cpe ? parseCpe(row.software_cpe) : null
  const key = cpe
    ? resolveKey(cpe.vendor, cpe.product)
    : resolveKey(row.software_vendor, row.software_product)
  if (!key) {
    statuses.UNRESOLVED += 1
    continue
  }
  const version = (cpe?.version && cpe.version !== '*' ? cpe.version : '') || String(row.software_version).trim()
  const record = corpus.products[key].cves.find((entry) =>
    entry.ranges.some((range) => inside(version, range) === true),
  )
  if (record) {
    statuses.MATCHED += 1
    const list = matched.get(key) ?? new Set()
    list.add(record.id)
    matched.set(key, list)
    continue
  }
  if (UNKNOWN_VERSIONS.has(version.toLowerCase())) statuses.VERSION_UNKNOWN += 1
  else statuses.NOT_AFFECTED += 1
}

const bytes = (f) => (readFileSync(resolve(OUT, f)).length / 1024).toFixed(0)
console.log(`seed ${SEED} · anchor ${iso(ANCHOR)}`)
console.log(`assets ${assets.length} · inventory rows ${inventoryRows.length} · events ${events.length}`)
console.log(`row decisions → MATCHED ${statuses.MATCHED} · NOT_AFFECTED ${statuses.NOT_AFFECTED} · VERSION_UNKNOWN ${statuses.VERSION_UNKNOWN} · PRODUCT_ABSENT ${statuses.UNRESOLVED}`)
console.log(`products hit ${matched.size} · distinct CVE ids reachable ${new Set([...matched.values()].flat()).size}`)
console.log(`files (KB) → inventory ${bytes('cobalt-inventory.csv')} · telemetry ${bytes('cobalt-telemetry.csv')} · edge ${bytes('cobalt-edge-cases.csv')} · json ${bytes('cobalt-inventory.json')} · jsonl ${bytes('cobalt-telemetry.jsonl')}`)
