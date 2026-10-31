import {
  BODY_LIMIT,
  buildUpstreamRequest,
  createRateLimiter,
  parsePayload,
  providerErrorMessage,
} from './ai-core.mjs'

const STREAM_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}

export function sendJson(res, status, payload) {
  if (res.writableEnded) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

export function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } })
}

function readStream(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > limit) {
        reject(new Error('PAYLOAD_TOO_LARGE'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

async function readBody(req) {
  // Vercel's Node runtime pre-parses JSON bodies and exposes them as req.body.
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  }
  return readStream(req)
}

export function clientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  const realIp = req.headers?.['x-real-ip']
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim()
  return req.socket?.remoteAddress ?? 'unknown'
}

export function createNodeHandler(env, options = {}) {
  const allow = createRateLimiter(options.rateLimit)

  return async function aiHandler(req, res) {
    if (req.method !== 'POST') {
      sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Use POST.')
      return
    }
    if (!env.key) {
      sendError(
        res,
        503,
        'AI_NOT_CONFIGURED',
        'The AI analyst is not configured. Set RIVER_API_KEY in the server environment.',
      )
      return
    }
    if (!allow(clientIp(req))) {
      sendError(res, 429, 'RATE_LIMITED', 'Too many analyst requests. Wait a minute and retry.')
      return
    }

    let raw
    try {
      raw = await readBody(req)
    } catch (err) {
      const tooLarge = err?.message === 'PAYLOAD_TOO_LARGE'
      sendError(
        res,
        tooLarge ? 413 : 400,
        tooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
        tooLarge ? 'Request body too large.' : 'Could not read the request body.',
      )
      return
    }

    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      sendError(res, 400, 'BAD_REQUEST', 'Body must be valid JSON.')
      return
    }

    const parsed = parsePayload(payload)
    if (parsed.error) {
      sendError(res, parsed.error.status, parsed.error.code, parsed.error.message)
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    res.on('close', () => {
      clearTimeout(timeout)
      controller.abort()
    })

    const { url, init } = buildUpstreamRequest({
      env,
      mode: parsed.mode,
      history: parsed.history,
      context: parsed.context,
      signal: controller.signal,
    })

    let upstream
    try {
      upstream = await fetch(url, init)
    } catch {
      clearTimeout(timeout)
      if (!res.headersSent) {
        sendError(
          res,
          502,
          'UPSTREAM_UNREACHABLE',
          'Could not reach the AI provider. Check your connection and try again.',
        )
      }
      return
    }

    if (!upstream.ok || !upstream.body) {
      clearTimeout(timeout)
      console.warn(`[aegis-ai] provider responded ${upstream.status}`)
      if (!res.headersSent) {
        sendError(res, 502, `UPSTREAM_${upstream.status}`, providerErrorMessage(upstream.status))
      }
      return
    }

    res.statusCode = 200
    for (const [name, value] of Object.entries(STREAM_HEADERS)) res.setHeader(name, value)
    res.flushHeaders?.()

    const reader = upstream.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!res.writableEnded) res.write(value)
      }
    } catch {
      /* client disconnected or upstream aborted */
    } finally {
      clearTimeout(timeout)
      if (!res.writableEnded) res.end()
    }
  }
}
