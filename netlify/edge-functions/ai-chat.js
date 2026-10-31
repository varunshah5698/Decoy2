import {
  buildUpstreamRequest,
  createRateLimiter,
  normalizeEnv,
  parsePayload,
  providerErrorMessage,
} from '../../server/ai-core.mjs'

const allow = createRateLimiter()

function json(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function readEnv(name) {
  const netlify = globalThis.Netlify
  return netlify?.env?.get?.(name) ?? ''
}

export default async function handler(request) {
  if (request.method !== 'POST') return json(405, 'METHOD_NOT_ALLOWED', 'Use POST.')

  const env = normalizeEnv({
    RIVER_API_KEY: readEnv('RIVER_API_KEY'),
    RIVER_BASE_URL: readEnv('RIVER_BASE_URL'),
    RIVER_MODEL: readEnv('RIVER_MODEL'),
  })

  if (!env.key) {
    return json(
      503,
      'AI_NOT_CONFIGURED',
      'The AI analyst is not configured. Set RIVER_API_KEY in the server environment.',
    )
  }

  const ip =
    request.headers.get('x-nf-client-connection-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  if (!allow(ip)) return json(429, 'RATE_LIMITED', 'Too many analyst requests. Wait a minute and retry.')

  let payload
  try {
    payload = await request.json()
  } catch {
    return json(400, 'BAD_REQUEST', 'Body must be valid JSON.')
  }

  const parsed = parsePayload(payload)
  if (parsed.error) return json(parsed.error.status, parsed.error.code, parsed.error.message)

  const { url, init } = buildUpstreamRequest({
    env,
    mode: parsed.mode,
    history: parsed.history,
    context: parsed.context,
    signal: AbortSignal.timeout(120_000),
  })

  let upstream
  try {
    upstream = await fetch(url, init)
  } catch {
    return json(502, 'UPSTREAM_UNREACHABLE', 'Could not reach the AI provider. Try again shortly.')
  }

  if (!upstream.ok || !upstream.body) {
    return json(502, `UPSTREAM_${upstream.status}`, providerErrorMessage(upstream.status))
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
