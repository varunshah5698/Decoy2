import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToString } from 'react-dom/server'

globalThis.localStorage ??= {
  store: new Map(),
  getItem(k) { return this.store.get(k) ?? null },
  setItem(k, v) { this.store.set(k, v) },
  removeItem(k) { this.store.delete(k) },
  clear() { this.store.clear() },
}
globalThis.sessionStorage ??= globalThis.localStorage
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const uploads = await server.ssrLoadModule('/src/lib/uploads.ts')
const estate = await server.ssrLoadModule('/src/lib/estate.ts')
const { MemoryRouter } = await server.ssrLoadModule('react-router-dom')

const delimited = (text) => {
  const rows = []
  let row = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1 }
      else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const load = (path, kind) => {
  const parsed = /\.jsonl?$/.test(path) ? uploads.parseObjects(readFileSync(path, 'utf8')) : delimited(readFileSync(path, 'utf8'))
  const headers = parsed[0].map((h) => h.trim())
  return { headers, rows: parsed.slice(1), mapping: uploads.autoMap(headers, uploads.fieldFor(kind)) }
}

const inv = load('testdata/cobalt-inventory.csv', 'assets')
const log = load('testdata/cobalt-telemetry.csv', 'logs')
const assets = uploads.rowsToAssets(inv.rows, inv.headers, inv.mapping, 'DS-9001')
const events = uploads.rowsToEvents(log.rows, log.headers, log.mapping, 'DS-9002')

const store = uploads.useUploads.getState()
store.clear()
store.add({ id: 'DS-9001', name: 'cobalt-inventory.csv', type: 'Assets', status: 'ACCEPTED', rows: inv.rows.length, accepted: assets.length, rejected: 0, uploadedBy: 'admin@aegis.demo', uploadedAt: new Date().toISOString(), source: 'USER UPLOAD', assets, preset: '45/45 columns auto-mapped' })
store.add({ id: 'DS-9002', name: 'cobalt-telemetry.csv', type: 'Logs', status: 'ACCEPTED', rows: log.rows.length, accepted: events.length, rejected: 0, uploadedBy: 'admin@aegis.demo', uploadedAt: new Date().toISOString(), source: 'USER UPLOAD', assets: [], events, logs: uploads.summarizeEvents(events), preset: '39/40 columns auto-mapped' })

const st = estate.getEstate()
console.log(`estate → ${st.assets.length} assets · ${st.alerts.length} alerts · ${st.events.length} events · scope "${st.scope.label}"`)

const pages = ['Dashboard', 'Alerts', 'Scoring', 'Assets', 'Cves', 'Intel', 'Graph', 'Attacks', 'Anomalies', 'Mitre', 'ThreatMap', 'Provenance', 'Radar', 'Traffic', 'Uploads', 'AiAnalyst', 'Simulator']
let failed = 0
for (const page of pages) {
  let mod
  try {
    mod = await server.ssrLoadModule(`/src/pages/app/${page}.tsx`)
  } catch (err) {
    console.log(`LOAD-FAIL   ${page}: ${String(err.message).slice(0, 90)}`)
    failed += 1
    continue
  }
  try {
    const html = renderToString(
      React.createElement(MemoryRouter, { initialEntries: [`/${page.toLowerCase()}`] }, React.createElement(mod.default)),
    )
    console.log(`rendered    ${page}: ${(html.length / 1024).toFixed(1)} KB`)
  } catch (err) {
    console.log(`RENDER-FAIL ${page}: ${String(err.message).slice(0, 120)}`)
    failed += 1
  }
}
await server.close()
console.log(failed ? `${failed} page(s) failed` : 'every page rendered against the uploaded estate')
process.exit(failed ? 1 : 0)
