/**
 * Run testdata/ through the app's own importer and correlation code.
 *
 * Vite SSR-loads the real TypeScript modules, so this asserts the same paths the
 * browser takes — preset detection, row→asset/event conversion, and the corpus
 * relevance gate — instead of a re-implementation of them.
 *
 *   node scripts/verify-test-datasets.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { createServer } from 'vite'

globalThis.localStorage ??= {
  store: new Map(),
  getItem(k) {
    return this.store.get(k) ?? null
  },
  setItem(k, v) {
    this.store.set(k, v)
  },
  removeItem(k) {
    this.store.delete(k)
  },
  clear() {
    this.store.clear()
  },
}

const files = {
  inventory: 'testdata/cobalt-inventory.csv',
  telemetry: 'testdata/cobalt-telemetry.csv',
  inventoryJson: 'testdata/cobalt-inventory.json',
  telemetryJsonl: 'testdata/cobalt-telemetry.jsonl',
  edge: 'testdata/cobalt-edge-cases.csv',
}

const missing = Object.values(files).filter((f) => !existsSync(f))
if (missing.length) {
  console.error(`missing ${missing.join(', ')} — run node scripts/gen-test-datasets.mjs first`)
  process.exit(1)
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const uploads = await server.ssrLoadModule('/src/lib/uploads.ts')
const corpus = await server.ssrLoadModule('/src/lib/corpus.ts')

const parseDelimited = (text, delimiter) => {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

const ingest = (path, kind) => {
  const text = readFileSync(path, 'utf8')
  const parsed = /\.(json|jsonl|ndjson)$/.test(path)
    ? uploads.parseObjects(text)
    : parseDelimited(text, path.endsWith('.tsv') ? '\t' : ',')
  const headers = parsed[0].map((h) => h.trim().replace(/^\uFEFF/, ''))
  const rows = parsed.slice(1)
  const preset = uploads.detectPreset(headers, kind)
  const mapping = uploads.autoMap(headers, uploads.fieldFor(kind))
  return { headers, rows, preset, mapping, count: Object.keys(mapping).length }
}

let failures = 0
const check = (label, pass, detail) => {
  if (!pass) failures += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

/* ---------------------------------- assets --------------------------------- */

const inv = ingest(files.inventory, 'assets')
check('inventory hits the auto-map preset', Boolean(inv.preset), inv.preset ? `${inv.preset.matched}/${inv.preset.total} fields` : 'no preset')
const assets = uploads.rowsToAssets(inv.rows, inv.headers, inv.mapping, 'verify')
check('inventory rows become assets', assets.length > 100, `${assets.length} assets from ${inv.rows.length} rows`)
check('every asset carries software evidence', assets.every((a) => a.software.length > 0))
check('inventory facts survived the mapping', assets.every((a) => a.inventory?.site && a.inventory.environment), 'site + environment on all rows')

const paths = corpus.exposurePaths(assets, corpus.buildCveIndex(corpus.corpusCves()))
const byStatus = paths.reduce((acc, p) => ({ ...acc, [p.relevance]: (acc[p.relevance] ?? 0) + 1 }), {})
check('corpus correlation produces exposure paths', paths.length > 0, `${paths.length} paths`)
check('at least one MATCHED (version inside an NVD range)', (byStatus.MATCHED ?? 0) > 0, JSON.stringify(byStatus))
const kevHits = paths.filter((p) => p.relevance === 'MATCHED' && p.cve.kev).length
check('matched paths include KEV-catalogued CVEs', kevHits > 0, `${kevHits} KEV`)
const exposedAssets = new Set(paths.filter((p) => p.relevance === 'MATCHED').map((p) => p.asset.id)).size
check('exposure spread across the estate', exposedAssets > 30, `${exposedAssets} assets with a MATCHED CVE`)
const productsHit = new Set(paths.map((p) => `${p.cve.vendor}:${p.cve.product}`)).size
check('breadth across corpus products', productsHit > 10, `${productsHit} products`)

/* ---------------------------------- events --------------------------------- */

const log = ingest(files.telemetry, 'logs')
check('telemetry hits the auto-map preset', Boolean(log.preset), log.preset ? `${log.preset.matched}/${log.preset.total} fields` : 'no preset')
const events = uploads.rowsToEvents(log.rows, log.headers, log.mapping, 'verify')
check('telemetry rows become events', events.length > 5000, `${events.length} events`)
check('events parse to real timestamps', events.every((e) => Number.isFinite(e.ts)))
const totals = uploads.telemetryTotals(events)
const externalIds = new Set(assets.map((a) => a.inventory.externalId))
const joined = events.filter((e) => externalIds.has(e.destAssetId)).length
check('events join the inventory by dest_asset_id', joined === events.length, `${joined}/${events.length} events point at an inventory asset_id`)
const types = new Set(events.map((e) => e.type))
check('every declared event type appears', uploads.EVENT_TYPES.slice(0, -1).every((t) => types.has(t)), [...types].join(', '))
check('failed logins recorded for the anomaly windows', totals.failures > 1000, `${totals.failures} failures`)
check('threat indicators recorded', totals.threatHits > 40, `${totals.threatHits} hits`)
check('geo spread feeds the threat map', totals.byCountry.length >= 15, `${totals.byCountry.length} countries`)
check('sensors and sites resolve', totals.sensors >= 5 && totals.sites.length >= 5, `${totals.sensors} sensors · ${totals.sites.length} sites`)
const span = (totals.lastTs - totals.firstTs) / 3600_000
check('window spans multiple anomaly buckets', span > 48, `${span.toFixed(1)} hours`)
const summary = uploads.summarizeEvents(events)
check('upload summary byte totals are non-zero', summary.bytes > 0, `${summary.bytes.toLocaleString()} bytes`)

/* ------------------------------ alternate shapes ---------------------------- */

const jsonIngest = ingest(files.inventoryJson, 'assets')
check('JSON wrapper { assets: [...] } is unwrapped', jsonIngest.rows.length > 100, `${jsonIngest.rows.length} rows from ${files.inventoryJson}`)
check('JSON variant keeps the preset signature', Boolean(jsonIngest.preset))
let jsonlRows = []
let jsonlError = null
try {
  jsonlRows = ingest(files.telemetryJsonl, 'logs').rows
} catch (err) {
  jsonlError = err instanceof Error ? err.message : String(err)
}
if (jsonlRows.length > 1000) {
  check('JSONL one-record-per-line parses', true, `${jsonlRows.length} rows`)
} else {
  check('JSONL one-record-per-line parses', false, `app rejects NDJSON (${jsonlError?.slice(0, 40)}…)`)
  jsonlRows = []
}

// Shapes that must keep working through the same entry point. Expected = record rows.
const shapes = [
  ['JSON array', '[{"asset_name":"a1"},{"asset_name":"a2"}]', 2],
  ['single JSON object', '{"asset_name":"a1","site":"Mumbai Hub"}', 1],
  ['{ data: [...] } wrapper', '{"data":[{"asset_name":"a1"},{"asset_name":"a2"}]}', 2],
  ['pretty-printed array spanning lines', '[\n  {"asset_name":"a1"},\n  {"asset_name":"a2"}\n]', 2],
  ['NDJSON stream', '{"asset_name":"a1"}\n{"asset_name":"a2"}\n{"asset_name":"a3"}', 3],
  ['NDJSON with blank lines', '{"asset_name":"a1"}\n\n{"asset_name":"a2"}\n', 2],
]
for (const [label, body, expectedRows] of shapes) {
  let rows = 0
  let note = ''
  try {
    rows = uploads.parseObjects(body).length - 1
  } catch (err) {
    note = err instanceof Error ? err.message : String(err)
  }
  check(`parseObjects handles ${label}`, rows === expectedRows, note || `${rows} rows, expected ${expectedRows}`)
}
let brokenRejected = false
try {
  uploads.parseObjects('{"asset_name":"a1"\nnot json at all')
} catch {
  brokenRejected = true
}
check('unparseable JSON still throws', brokenRejected)

/* -------------------------------- edge cases -------------------------------- */

const edge = ingest(files.edge, 'assets')
const edgeAssets = uploads.rowsToAssets(edge.rows, edge.headers, edge.mapping, 'edge')
check('edge file yields assets without throwing', edgeAssets.length >= 5, `${edgeAssets.length} assets from ${edge.rows.length} rows`)
check('blank asset_name rows are dropped', edgeAssets.every((a) => a.name), `rows kept ${edgeAssets.length} of ${edge.rows.length}`)
check('unknown type falls back to server', edgeAssets.some((a) => a.type === 'server'))
check('duplicate asset_id merges into one multi-package asset', edgeAssets.some((a) => a.software.length > 1))
check('CPE-only row still resolves a corpus product', edgeAssets.some((a) => a.software.some((s) => s.cpe && !s.version)))
const edgePaths = corpus.exposurePaths(edgeAssets, corpus.buildCveIndex(corpus.corpusCves()))
check('edge rows produce at least one MATCHED path', edgePaths.some((p) => p.relevance === 'MATCHED'), `${edgePaths.length} paths`)

/* ------------------------------- estate build ------------------------------- */

// Mirrors Uploads.tsx accept(): same UploadedDataset shape, then the real estate builder.
const { useUploads } = uploads
const estate = await server.ssrLoadModule('/src/lib/estate.ts')
const makeDataset = (id, name, kind, built) => ({
  id,
  name,
  type: kind === 'assets' ? 'Assets' : 'Logs',
  status: 'ACCEPTED',
  rows: kind === 'assets' ? inv.rows.length : log.rows.length,
  accepted: built.length,
  rejected: 0,
  uploadedBy: 'admin@aegis.demo',
  uploadedAt: new Date().toISOString(),
  source: 'USER UPLOAD',
  assets: kind === 'assets' ? built : [],
  ...(kind === 'logs' ? { events: built, logs: uploads.summarizeEvents(built) } : {}),
})

useUploads.getState().clear()
useUploads.getState().add(makeDataset('DS-9001', 'cobalt-inventory.csv', 'assets', assets))
useUploads.getState().add(makeDataset('DS-9002', 'cobalt-telemetry.csv', 'logs', events))

useUploads.getState().setActive(uploads.ALL_DATASETS)
const merged = estate.getEstate()
check('estate ingests both datasets', merged.uploadedAssets.length === assets.length && merged.events.length === events.length, `${merged.uploadedAssets.length} uploaded assets · ${merged.events.length} events · scope "${merged.scope.label}"`)
check('alerts are generated for the uploaded estate', merged.alerts.length > 0, `${merged.alerts.length} alerts · ${merged.counts.critical} critical · ${merged.counts.high} high · ${merged.suppressedAlerts.length} suppressed`)
check('version gate suppresses some alerts', merged.suppressedAlerts.length > 0, `${merged.suppressedAlerts.length} zeroed by relevance`)
check('telemetry totals surface on the dashboard', merged.telemetry?.events === events.length, `${merged.telemetry?.failures} failures · ${merged.telemetry?.threatHits} threat hits`)
check('anomaly windows flag real bursts', merged.anomalyWindows.some((w) => w.anomaly), `${merged.anomalyWindows.filter((w) => w.anomaly).length}/${merged.anomalyWindows.length} windows anomalous`)
check('traffic series rebuilt from the upload', merged.trafficSeries.length > 20, `${merged.trafficSeries.length} points`)
check('threat map has geo points per country', merged.geoPoints.length >= 15, `${merged.geoPoints.length} points`)
check('uploaded assets reach the asset view', merged.assets.some((a) => a.source === 'USER UPLOAD' && a.inventory?.site))

useUploads.getState().setActive('DS-9001')
const scoped = estate.getEstate()
check('scope switch drops the seed estate', !scoped.scope.includesSeed && scoped.seedAssets.length > 0 && scoped.assets.length === assets.length, `${scoped.assets.length} assets, seed hidden · ${scoped.alerts.length} alerts`)

await server.close()
console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`)
process.exit(failures ? 1 : 0)
