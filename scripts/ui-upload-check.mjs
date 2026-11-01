/**
 * Drive the real Aegis Sentinel UI in headless Chrome over CDP.
 *
 * Logs in as the demo admin, uploads testdata/ through the Uploads page file input,
 * accepts both datasets, then screenshots the pages those datasets are supposed to
 * change. No dependencies beyond Node's built-in WebSocket and fetch.
 *
 *   node scripts/ui-upload-check.mjs [url]
 */

import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] ?? 'http://localhost:5175'
const PORT = 9333
const SHOTS = resolve('testdata/screenshots')
const ROOT = resolve(import.meta.dirname, '..')

mkdirSync(SHOTS, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.env.HOME}/tmp/aegis-cdp-profile`,
  '--window-size=1440,1000',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let ws
let seq = 0
const pending = new Map()
const connect = async () => {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page')
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
        ws.onmessage = (evt) => {
          const msg = JSON.parse(evt.data)
          const hit = pending.get(msg.id)
          if (hit) {
            pending.delete(msg.id)
            msg.error ? hit.reject(new Error(msg.error.message)) : hit.resolve(msg.result)
          }
        }
        return
      }
    } catch { /* chrome not up yet */ }
    await sleep(250)
  }
  throw new Error('chrome devtools endpoint never came up')
}

const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, { resolve: res, reject: rej })
    ws.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) => {
  const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? 'evaluate failed')
  return out.result.value
}

const waitFor = async (label, predicate, timeout = 25000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(predicate)) return true
    await sleep(300)
  }
  throw new Error(`timed out waiting for ${label}`)
}

const shot = async (name) => {
  // Viewport-only: captureBeyondViewport stitches fixed chrome into the middle of the
  // page, so a full-page frame would misrepresent the shell layout.
  await evaluate('window.scrollTo(0, 0)')
  await sleep(400)
  const file = `${SHOTS}/${name}.png`
  const image = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(file, Buffer.from(image.data, 'base64'))
  console.log(`shot → ${file}`)
}

const goto = async (url) => {
  await send('Page.navigate', { url })
  await waitFor(`load ${url}`, 'document.readyState === "complete"')
  await sleep(900)
}

const upload = async (file) => {
  await goto(`${BASE}/app/uploads`)
  await waitFor('the file input', 'Boolean(document.querySelector("input[type=file]"))')
  const { root } = await send('DOM.getDocument')
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
  if (!nodeId) throw new Error('no file input node')
  await send('DOM.setFileInputFiles', { nodeId, files: [resolve(ROOT, file)] })
  const name = file.split('/').pop()
  await waitFor(`the preview for ${name}`, `document.body.innerText.includes(${JSON.stringify(name)})`)
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].filter(x => /accept into estate/i.test(x.textContent));
    const target = b.find(x => !x.disabled) ?? b[0];
    target?.click();
    return b.length;
  })()`)
  await sleep(1200)
  const banner = await evaluate(`(() => {
    const m = document.body.innerText.match(/(\\d+\\/\\d+ columns auto-mapped|ACCEPTED[^\\n]*|PARTIAL[^\\n]*)/);
    return m ? m[0] : 'no acceptance banner';
  })()`)
  console.log(`accepted ${name} → ${banner}`)
}

/* ---------------------------------- run ---------------------------------- */

await connect()
await send('Page.enable')
await send('Runtime.enable')
await send('DOM.enable')
// headless=new ignores --window-size for the page metrics, so pin the desktop viewport.
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

if (process.env.SKIP_UPLOAD) {
  await goto(`${BASE}/app`)
  await waitFor('an authenticated shell', '!location.pathname.startsWith("/login")')
} else {
  await goto(`${BASE}/login`)
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /admin/i.test(x.textContent));
    b?.click();
    const s = [...document.querySelectorAll('button')].find((x) => /sign in/i.test(x.textContent));
    s?.click();
    return true;
  })()`)
  await waitFor('the console route', 'location.pathname.startsWith("/app")')
  console.log('session →', await evaluate('location.pathname'))
  await upload('testdata/cobalt-inventory.csv')
  await upload('testdata/cobalt-telemetry.jsonl')
  await goto(`${BASE}/app/uploads`)
  await sleep(1200)
  await shot('uploads-history')
}

for (const [route, name] of [['/app', 'dashboard'], ['/app/alerts', 'alerts'], ['/app/assets', 'assets'], ['/app/anomalies', 'anomalies'], ['/app/traffic', 'traffic'], ['/app/map', 'threat-map'], ['/app/cves', 'cves']]) {
  await goto(`${BASE}${route}`)
  await sleep(1400)
  const headline = await evaluate(`(() => {
    const t = document.querySelector('main')?.innerText ?? '';
    return t.replace(/\\s+/g, ' ').slice(0, 200);
  })()`)
  console.log(`\n${route} → ${headline}`)
  await shot(name)
}

const datasetScope = await evaluate(`(() => {
  const el = [...document.querySelectorAll('select, [role=combobox], button')].find(x => /dataset|seed|all datasets/i.test(x.textContent ?? x.value ?? ''));
  return el ? (el.value ?? el.textContent).trim().slice(0, 60) : 'switcher not found';
})()`)
console.log(`\nactive dataset control: ${datasetScope}`)

chrome.kill()
ws.close()
console.log('\ndone')
