import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeEnv } from './ai-core.mjs'
import { createNodeHandler, sendJson } from './ai-node.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dist = join(root, 'dist')

function loadLocalEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = join(root, name)
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match || process.env[match[1]] !== undefined) continue
      let value = match[2].trim()
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
      if (quoted) value = value.slice(1, -1)
      process.env[match[1]] = value
    }
  }
}

loadLocalEnv()

const env = normalizeEnv(process.env)
const aiHandler = createNodeHandler(env)
const port = Number(process.env.PORT || 4173)
const host = process.env.HOST || '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

function cacheControl(path) {
  if (path.includes(`${sep}assets${sep}`)) return 'public, max-age=31536000, immutable'
  return 'no-cache'
}

async function serveFile(req, res, filePath) {
  const body = await readFile(filePath)
  res.statusCode = 200
  res.setHeader('Content-Type', MIME[extname(filePath).toLowerCase()] || 'application/octet-stream')
  res.setHeader('Cache-Control', cacheControl(filePath))
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(body)
}

async function handleStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET.' } })
    return
  }

  let pathname = '/'
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname)
  } catch {
    sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'Malformed URL.' } })
    return
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const filePath = resolve(dist, relative)
  if (filePath !== dist && !filePath.startsWith(dist + sep)) {
    sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'Invalid path.' } })
    return
  }

  const exists = existsSync(filePath) && statSync(filePath).isFile()
  if (exists) {
    await serveFile(req, res, filePath)
    return
  }

  if (extname(relative)) {
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } })
    return
  }

  const fallback = join(dist, 'index.html')
  if (!existsSync(fallback)) {
    sendJson(res, 503, {
      error: { code: 'NO_BUILD', message: 'No production build found. Run npm run build first.' },
    })
    return
  }
  await serveFile(req, res, fallback)
}

const server = createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0]

  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true, aiConfigured: Boolean(env.key) })
    return
  }

  if (pathname === '/api/ai/chat') {
    aiHandler(req, res).catch((error) => {
      console.error('[aegis-server]', error instanceof Error ? error.message : error)
      if (!res.headersSent) {
        sendJson(res, 500, { error: { code: 'INTERNAL', message: 'The server failed to handle the request.' } })
      } else if (!res.writableEnded) {
        res.end()
      }
    })
    return
  }

  handleStatic(req, res).catch((error) => {
    console.error('[aegis-server]', error instanceof Error ? error.message : error)
    if (!res.headersSent) {
      sendJson(res, 500, { error: { code: 'INTERNAL', message: 'The server failed to serve the file.' } })
    } else if (!res.writableEnded) {
      res.end()
    }
  })
})

server.listen(port, host, () => {
  console.log(`Aegis Sentinel on http://localhost:${port} · AI ${env.key ? 'configured' : 'not configured'}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
