const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET.' } })
    return
  }

  try {
    const upstream = await fetch(KEV_URL, {
      headers: { accept: 'application/json', 'user-agent': 'Aegis Sentinel demo' },
    })
    if (!upstream.ok) throw new Error(`CISA returned ${upstream.status}`)
    const body = await upstream.text()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400')
    res.status(200).send(body)
  } catch (error) {
    res.status(502).json({
      error: {
        code: 'UPSTREAM_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'CISA feed unavailable',
      },
    })
  }
}
