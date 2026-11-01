/**
 * Northwind Employee Portal — the decoy login app behind the Aegis live demo.
 *
 * Runs on its own port (4300 locally; PORT on Render) and records every sign-in
 * attempt to portal/data/login-events.json and portal/data/login-events.csv. The
 * Aegis console reads the JSON through the Vite proxy in development, or
 * directly from this service in production.
 *
 * Demo only. No real authentication, no real user data, no passwords stored.
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const portalRoot = resolve(fileURLToPath(new URL('.', import.meta.url)))
const dataDir = join(portalRoot, 'data')
const jsonFile = join(dataDir, 'login-events.json')
const csvFile = join(dataDir, 'login-events.csv')
const port = Number(process.env.PORT || process.env.PORTAL_PORT || 4300)
const host = process.env.PORTAL_HOST || '0.0.0.0'
const consoleDefault = process.env.RENDER || process.env.PORT ? 'https://decoy2.onrender.com' : 'http://localhost:5173'
const aegisConsole = (process.env.AEGIS_CONSOLE_URL || consoleDefault).replace(/\/+$/, '')

mkdirSync(dataDir, { recursive: true })

const SHARED_PASSWORD = 'Northwind#2026'
const MAX_EVENTS = 3000

const ACCOUNTS = [
  {
    email: 'priya.nair@northwind.demo',
    name: 'Priya Nair',
    department: 'Finance Operations',
    password: SHARED_PASSWORD,
  },
  {
    email: 'ravi.kumar@northwind.demo',
    name: 'Ravi Kumar',
    department: 'Engineering',
    password: SHARED_PASSWORD,
  },
  {
    email: 'ananya.sen@northwind.demo',
    name: 'Ananya Sen',
    department: 'People Operations',
    password: SHARED_PASSWORD,
  },
]

const ORIGINS = {
  mumbai: {
    ip: '103.72.14.21',
    country: 'IN',
    country_name: 'India',
    city: 'Mumbai',
    latitude: 19.076,
    longitude: 72.8777,
    is_tor: false,
  },
  singapore: {
    ip: '128.199.164.20',
    country: 'SG',
    country_name: 'Singapore',
    city: 'Singapore',
    latitude: 1.3521,
    longitude: 103.8198,
    is_tor: false,
  },
  ashburn: {
    ip: '44.209.12.88',
    country: 'US',
    country_name: 'United States',
    city: 'Ashburn',
    latitude: 39.0438,
    longitude: -77.4874,
    is_tor: false,
  },
  amsterdam: {
    ip: '185.220.101.42',
    country: 'NL',
    country_name: 'Netherlands',
    city: 'Amsterdam',
    latitude: 52.3676,
    longitude: 4.9041,
    is_tor: true,
  },
  saopaulo: {
    ip: '177.54.144.6',
    country: 'BR',
    country_name: 'Brazil',
    city: 'São Paulo',
    latitude: -23.5505,
    longitude: -46.6333,
    is_tor: false,
  },
  lagos: {
    ip: '102.89.33.70',
    country: 'NG',
    country_name: 'Nigeria',
    city: 'Lagos',
    latitude: 6.5244,
    longitude: 3.3792,
    is_tor: false,
  },
}

const AUTO_ORIGINS = ['mumbai', 'singapore', 'ashburn', 'amsterdam']
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const SCRIPT_UA = 'curl/8.4.0'

const CSV_HEADER = [
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
]

let seq = 0
const nextId = () => `EVT-${Date.now().toString(36).toUpperCase()}-${String(++seq).padStart(3, '0')}`

function readEvents() {
  try {
    if (!existsSync(jsonFile)) return []
    const parsed = JSON.parse(readFileSync(jsonFile, 'utf8'))
    if (Array.isArray(parsed)) return parsed
    return Array.isArray(parsed?.events) ? parsed.events : []
  } catch {
    return []
  }
}

const csvCell = (value) => {
  const text = value == null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function writeEvents(events) {
  const clipped = [...events]
    .filter((event) => event && event.at)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-MAX_EVENTS)
  writeFileSync(jsonFile, `${JSON.stringify(clipped, null, 2)}\n`)
  const rows = clipped.map((event) => CSV_HEADER.map((key) => csvCell(event[key])).join(','))
  writeFileSync(csvFile, `${CSV_HEADER.join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`)
  return clipped
}

function summarize(events) {
  let failed = 0
  let granted = 0
  for (const event of events) {
    if (event.success) granted += 1
    else failed += 1
  }
  return { total: events.length, failed, granted }
}

function record(event) {
  const events = readEvents()
  events.push(event)
  const next = writeEvents(events)
  return { event, summary: summarize(next) }
}

const deviceFromUa = (ua) => {
  const os = /Windows NT/i.test(ua)
    ? 'Windows'
    : /Android/i.test(ua)
      ? 'Android'
      : /iPhone|iPad/i.test(ua)
        ? 'iOS'
        : /Mac OS X/i.test(ua)
          ? 'macOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Unknown OS'
  const client = /Edg\//i.test(ua)
    ? 'Edge'
    : /OPR\//i.test(ua)
      ? 'Opera'
      : /Chrome\//i.test(ua)
        ? 'Chrome'
        : /Firefox\//i.test(ua)
          ? 'Firefox'
          : /Safari\//i.test(ua)
            ? 'Safari'
            : /curl\//i.test(ua)
              ? 'curl'
              : /python-requests/i.test(ua)
                ? 'python-requests'
                : /bot|headless|phantom|selenium/i.test(ua)
                  ? 'Automation'
                  : 'Unknown client'
  return `${client} · ${os}`
}

function buildEvent({ email, success, reason, origin, userAgent, simulated = false, at }) {
  return {
    id: nextId(),
    at: at ?? new Date().toISOString(),
    email,
    success,
    reason,
    source_ip: origin.ip,
    country: origin.country,
    country_name: origin.country_name,
    city: origin.city,
    latitude: origin.latitude,
    longitude: origin.longitude,
    is_tor: Boolean(origin.is_tor),
    device: deviceFromUa(userAgent),
    user_agent: userAgent,
    portal: 'Northwind Employee Portal',
    simulated,
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.statusCode = status
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 64 * 1024) {
        reject(new Error('Body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw) return resolveBody({})
      try {
        resolveBody(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

async function handleLogin(req, res) {
  const body = await readBody(req)
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const requestedOrigin = String(body.origin ?? 'auto')
  const events = readEvents()

  const account = ACCOUNTS.find((entry) => entry.email === email)
  const success = Boolean(account && password === account.password)
  const reason = success ? 'OK' : account ? 'INVALID_PASSWORD' : 'UNKNOWN_ACCOUNT'
  const automaticOrigin = AUTO_ORIGINS[events.length % AUTO_ORIGINS.length]
  const originKey = requestedOrigin !== 'auto' && ORIGINS[requestedOrigin] ? requestedOrigin : automaticOrigin
  const origin = ORIGINS[originKey]
  const userAgent = String(req.headers['user-agent'] || 'unknown')

  const event = buildEvent({
    email: email || '(blank)',
    success,
    reason,
    origin,
    userAgent,
  })
  const { summary } = record(event)

  console.log(
    `[northwind] ${success ? 'LOGIN_SUCCESS' : 'LOGIN_FAIL (flagged)'} ${email || '(blank)'} · ${origin.city}, ${origin.country}` +
      `${origin.is_tor ? ' [tor]' : ''} · ${summary.failed} failed / ${summary.total} attempts`,
  )

  send(res, 200, {
    ok: true,
    success,
    flagged: !success,
    message: success ? `Signed in as ${account.name}.` : 'Email or password is incorrect.',
    account: success ? { email: account.email, name: account.name, department: account.department } : null,
    event,
    origin: {
      key: originKey,
      city: origin.city,
      country: origin.country,
      country_name: origin.country_name,
      is_tor: origin.is_tor,
    },
    total: summary.total,
    failed: summary.failed,
    granted: summary.granted,
  })
}

function simulatedTime(now, minutesAgo) {
  return new Date(now - minutesAgo * 60_000).toISOString()
}

function simulateAto(now) {
  const events = []
  const push = (minutesAgo, email, success, originKey, userAgent = BROWSER_UA) =>
    events.push(
      buildEvent({
        email,
        success,
        reason: success ? 'OK' : 'INVALID_PASSWORD',
        origin: ORIGINS[originKey],
        userAgent,
        simulated: true,
        at: simulatedTime(now, minutesAgo),
      }),
    )

  push(9.2, 'priya.nair@northwind.demo', true, 'mumbai')
  push(6.6, 'priya.nair@northwind.demo', false, 'mumbai')
  push(6.2, 'priya.nair@northwind.demo', false, 'singapore')
  push(5.8, 'priya.nair@northwind.demo', false, 'ashburn')
  push(5.3, 'priya.nair@northwind.demo', false, 'amsterdam')
  push(4.9, 'priya.nair@northwind.demo', false, 'singapore')
  push(4.4, 'priya.nair@northwind.demo', false, 'mumbai')
  push(3.9, 'priya.nair@northwind.demo', false, 'amsterdam')
  push(3.5, 'priya.nair@northwind.demo', false, 'ashburn')
  push(3.1, 'priya.nair@northwind.demo', false, 'singapore')
  push(2.6, 'priya.nair@northwind.demo', true, 'amsterdam')
  push(2.2, 'ravi.kumar@northwind.demo', false, 'ashburn')
  push(1.8, 'ravi.kumar@northwind.demo', false, 'ashburn')
  return events
}

function simulateSpray(now) {
  const events = []
  const targets = [
    ['priya.nair@northwind.demo', 4],
    ['ravi.kumar@northwind.demo', 4],
    ['ananya.sen@northwind.demo', 4],
    ['finance.team@northwind.demo', 2],
    ['hr.helpdesk@northwind.demo', 2],
  ]
  let slot = 0
  const total = targets.reduce((sum, [, count]) => sum + count, 0)
  for (const [email, count] of targets) {
    for (let index = 0; index < count; index += 1) {
      const minutesAgo = 3.4 - (slot / Math.max(1, total - 1)) * 2.8
      events.push(
        buildEvent({
          email,
          success: false,
          reason: 'INVALID_PASSWORD',
          origin: ORIGINS.ashburn,
          userAgent: SCRIPT_UA,
          simulated: true,
          at: simulatedTime(now, minutesAgo),
        }),
      )
      slot += 1
    }
  }
  events.push(
    buildEvent({
      email: 'ananya.sen@northwind.demo',
      success: true,
      reason: 'OK',
      origin: ORIGINS.ashburn,
      userAgent: SCRIPT_UA,
      simulated: true,
      at: simulatedTime(now, 0.4),
    }),
  )
  return events
}

async function handleSimulate(req, res) {
  const body = await readBody(req)
  const scenario = String(body.scenario ?? 'ato')
  const now = Date.now()
  const generated = scenario === 'spray' ? simulateSpray(now) : simulateAto(now)
  const events = readEvents()
  const next = writeEvents([...events, ...generated])
  const summary = summarize(next)
  console.log(
    `[northwind] simulated ${scenario} · wrote ${generated.length} events · ${summary.failed} failed / ${summary.total} attempts`,
  )
  send(res, 200, {
    ok: true,
    scenario,
    added: generated.length,
    ...summary,
  })
}

function handleReset(res) {
  writeEvents([])
  console.log('[northwind] capture reset')
  send(res, 200, { ok: true, total: 0, failed: 0, granted: 0 })
}

function handleEvents(req, res) {
  const url = new URL(req.url || '/', 'http://localhost')
  const limit = Math.min(MAX_EVENTS, Math.max(1, Number(url.searchParams.get('limit') || 1000)))
  const all = readEvents()
  const events = all.slice(-limit)
  const summary = summarize(all)
  send(res, 200, {
    ok: true,
    generated_at: new Date().toISOString(),
    ...summary,
    returned: events.length,
    files: {
      json: 'portal/data/login-events.json',
      csv: 'portal/data/login-events.csv',
    },
    events,
  })
}

function handleCsv(res) {
  writeEvents(readEvents())
  const body = existsSync(csvFile) ? readFileSync(csvFile, 'utf8') : `${CSV_HEADER.join(',')}\n`
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'inline; filename="northwind-login-events.csv"')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.end(body)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function handleStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname)
  if (pathname === '/favicon.ico') {
    res.statusCode = 204
    res.end()
    return
  }
  const file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  if (!['index.html', 'portal.css', 'portal.js'].includes(file)) {
    send(res, 404, { error: 'Not found' })
    return
  }
  const filePath = join(portalRoot, file)
  if (!existsSync(filePath)) {
    send(res, 404, { error: 'Not found' })
    return
  }
  res.statusCode = 200
  res.setHeader('Content-Type', MIME[extname(filePath)] || 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(readFileSync(filePath))
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.end()
    return
  }

  const pathname = (req.url || '/').split('?')[0]

  if (pathname === '/api/health') {
    const summary = summarize(readEvents())
    send(res, 200, {
      ok: true,
      service: 'northwind-decoy-portal',
      ...summary,
      console: aegisConsole,
      files: { json: jsonFile, csv: csvFile },
    })
    return
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    handleEvents(req, res)
    return
  }

  if (pathname === '/api/events.csv' && req.method === 'GET') {
    handleCsv(res)
    return
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    handleLogin(req, res).catch((error) => {
      console.error('[northwind] login error', error)
      if (!res.headersSent) send(res, 400, { ok: false, error: error.message || 'Login failed' })
      else if (!res.writableEnded) res.end()
    })
    return
  }

  if (pathname === '/api/simulate' && req.method === 'POST') {
    handleSimulate(req, res).catch((error) => {
      console.error('[northwind] simulate error', error)
      if (!res.headersSent) send(res, 400, { ok: false, error: error.message || 'Simulation failed' })
      else if (!res.writableEnded) res.end()
    })
    return
  }

  if (pathname === '/api/reset' && req.method === 'POST') {
    handleReset(res)
    return
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    handleStatic(req, res)
    return
  }

  send(res, 405, { error: 'Method not allowed' })
})

server.listen(port, host, () => {
  console.log('')
  console.log(`  Northwind decoy portal  →  http://localhost:${port}`)
  console.log(`  Aegis console           →  ${aegisConsole}/app`)
  console.log(`  Failed attempt register →  ${aegisConsole}/app/anomalies`)
  console.log(`  Capture files           →  ${jsonFile}`)
  console.log(`                             ${csvFile}`)
  console.log('')
  console.log('  Every sign-in attempt is recorded. Demo only — no passwords are stored.')
  console.log('')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
