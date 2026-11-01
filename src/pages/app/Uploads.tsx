import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chart } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { StatsPanel } from '../../components/StatsPanel'
import { UploadBadge } from '../../components/Badges'
import { AlertTriangle, ArrowRight, Check, Download, FileSearch, Lock, ShieldCheck, Upload, X } from '../../components/Icons'
import { sampleAssetsCsv, sampleLogsCsv, uploadedDatasets } from '../../data/seed'
import { useAuth, useTheme, useToast } from '../../lib/store'
import { useLoginCapture } from '../../lib/loginFeed'
import { LOGIN_CSV_FILE, LOGIN_JSON_FILE, PORTAL_HOME, useLoginIntel } from '../../lib/loginIntel'
import { parseObjects, rowsToAssets, rowsToLogSummary, useUploads, type UploadedDataset } from '../../lib/uploads'
import { useDataScope, useScopeInfo } from '../../lib/dataScope'
import { cx, fmtInt, plural, timeAgo } from '../../lib/format'
import { TEAL, UPLOAD, hexA } from '../../lib/colors'

type Kind = 'assets' | 'logs'

type HistoryEntry = {
  id: string
  name: string
  type: string
  status: string
  rows: number
  accepted: number
  rejected: number
  uploadedBy: string
  uploadedAt: string
  source: string
  live?: boolean
  risk?: UploadedDataset['risk']
  logs?: UploadedDataset['logs']
  files?: UploadedDataset['files']
}

const FIELDS: Record<Kind, { key: string; label: string; required?: boolean; aliases: string[] }[]> = {
  assets: [
    { key: 'asset_name', label: 'asset_name', required: true, aliases: ['asset', 'name', 'hostname', 'system'] },
    { key: 'asset_type', label: 'asset_type', aliases: ['type', 'category'] },
    { key: 'owner_department', label: 'owner_department', aliases: ['department', 'dept', 'owner', 'team'] },
    { key: 'criticality', label: 'criticality', aliases: ['business_criticality', 'importance', 'tier'] },
    { key: 'business_function', label: 'business_function', aliases: ['function', 'purpose'] },
    { key: 'internet_facing', label: 'internet_facing', aliases: ['exposed', 'external', 'public'] },
    { key: 'data_sensitivity', label: 'data_sensitivity', aliases: ['sensitivity', 'classification'] },
    { key: 'software_vendor', label: 'software_vendor', aliases: ['vendor', 'publisher'] },
    { key: 'software_product', label: 'software_product', aliases: ['product', 'software'] },
    { key: 'software_version', label: 'software_version', aliases: ['version', 'installed_version'] },
  ],
  logs: [
    { key: 'timestamp', label: 'timestamp', required: true, aliases: ['time', 'ts', 'datetime', 'event_time'] },
    { key: 'event_type', label: 'event_type', required: true, aliases: ['event', 'type', 'action'] },
    { key: 'source_ip', label: 'source_ip', aliases: ['ip', 'src_ip', 'client_ip'] },
    { key: 'dest_asset', label: 'dest_asset', aliases: ['destination', 'asset', 'target'] },
    { key: 'username', label: 'username', aliases: ['user', 'account', 'principal'] },
    { key: 'user_agent', label: 'user_agent', aliases: ['agent', 'ua'] },
    { key: 'country_code', label: 'country_code', aliases: ['country', 'geo'] },
    { key: 'protocol', label: 'protocol', aliases: ['proto'] },
    { key: 'bytes', label: 'bytes', aliases: ['size', 'response_bytes'] },
  ],
}

const EVENT_TYPES = ['LOGIN_SUCCESS', 'LOGIN_FAIL', 'HTTP_REQUEST', 'FIREWALL_ALLOW', 'FIREWALL_DENY', 'EXPLOIT_SIGNATURE', 'OTHER']
const MAX_BYTES = 10 * 1024 * 1024

const normalize = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

const sanitizeCell = (value: string) => (/^[=+\-@\t\r]/.test(value.trim()) ? `'${value}` : value)

function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

const LOG_SIGNALS = [
  'event_type',
  'event',
  'action',
  'timestamp',
  'time',
  'ts',
  'datetime',
  'event_time',
  'source_ip',
  'src_ip',
  'client_ip',
  'dest_asset',
  'destination',
  'user_agent',
]

const detectKind = (head: string[]): Kind =>
  head.some((h) => LOG_SIGNALS.includes(normalize(h))) ? 'logs' : 'assets'

export default function Uploads() {
  const theme = useTheme((s) => s.theme)
  const session = useAuth((s) => s.session)
  const toast = useToast((s) => s.show)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  const datasets = useUploads((s) => s.datasets)
  const addDataset = useUploads((s) => s.add)
  const login = useLoginCapture()
  const scopeInfo = useScopeInfo()
  const setScopeId = useDataScope((s) => s.setScopeId)
  const portalUrl = PORTAL_HOME

  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [kind, setKind] = useState<Kind>('assets')
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [drag, setDrag] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastAccepted, setLastAccepted] = useState<UploadedDataset | null>(null)

  const role = session?.role ?? 'ANALYST'
  const canUpload = role === 'ADMIN'

  const load = async (f: File) => {
    setError(null)
    setFile(f)
    setLastAccepted(null)
    setHeaders([])
    setRows([])
    setMapping({})
    if (f.size > MAX_BYTES) {
      setError('File exceeds the 10 MB demo limit.')
      return
    }
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (!['csv', 'tsv', 'json', 'jsonl', 'ndjson'].includes(ext)) {
      setError(
        ext === 'xlsx' || ext === 'xlsm'
          ? 'XLSX parsing runs in the backend. This browser demo accepts CSV, TSV, JSON, and JSONL.'
          : 'Unsupported file type. Allowed: CSV, TSV, JSON, JSONL.',
      )
      return
    }
    try {
      const text = await f.text()
      let parsed: string[][]
      if (ext === 'json' || ext === 'jsonl' || ext === 'ndjson') {
        parsed = parseObjects(text)
      } else {
        parsed = parseDelimited(text, ext === 'tsv' ? '\t' : ',')
      }
      if (parsed.length < 2) {
        setError('The file needs a header row and at least one data row.')
        return
      }
      const head = parsed[0].map((h) => h.trim().replace(/^\uFEFF/, ''))
      const body = parsed.slice(1)
      const detected = detectKind(head)
      const auto: Record<string, string> = {}
      FIELDS[detected].forEach((field) => {
        const hit = head.find((h) => {
          const n = normalize(h)
          return n === field.key || field.aliases.includes(n)
        })
        if (hit) auto[field.key] = hit
      })
      setHeaders(head)
      setRows(body)
      setKind(detected)
      setMapping(auto)
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'No records found'
          ? 'No JSON records found. Upload an array of objects or a { "data": [...] } wrapper.'
          : 'Could not parse this file. Check that it is valid CSV, JSON, or JSONL.',
      )
    }
  }

  const validation = useMemo(() => {
    if (!headers.length) return null
    const fields = FIELDS[kind]
    const required = fields.filter((f) => f.required)
    const missingColumns = required.filter((f) => !mapping[f.key]).map((f) => f.label)
    let rejected = 0
    let sanitized = 0
    const rejectedRows: { row: number; reason: string }[] = []
    const acceptedRows: string[][] = []
    rows.forEach((r, idx) => {
      const get = (key: string) => {
        const col = mapping[key]
        return col ? (r[headers.indexOf(col)] ?? '').trim() : ''
      }
      r.forEach((c) => {
        if (/^[=+\-@]/.test(c.trim())) sanitized += 1
      })

      let reason: string | null = null
      const missing = required.filter((f) => !get(f.key))
      if (missing.length) {
        reason = `missing ${missing.map((f) => f.label).join(', ')}`
      } else if (kind === 'assets' && get('criticality')) {
        const c = get('criticality').toUpperCase()
        if (!['HIGH', 'MEDIUM', 'LOW'].includes(c)) {
          reason = `criticality "${get('criticality')}" not in HIGH/MEDIUM/LOW`
        }
      } else if (kind === 'logs') {
        const ts = get('timestamp')
        if (Number.isNaN(Date.parse(ts)) && Number.isNaN(Number(ts))) {
          reason = 'timestamp is not ISO-8601 or epoch'
        } else if (!EVENT_TYPES.includes(get('event_type').toUpperCase())) {
          reason = `event_type "${get('event_type')}" not recognised`
        }
      }

      if (reason) {
        rejected += 1
        rejectedRows.push({ row: idx + 2, reason })
      } else {
        acceptedRows.push(r)
      }
    })
    return {
      total: rows.length,
      accepted: acceptedRows.length,
      rejected,
      sanitized,
      missingColumns,
      rejectedRows: rejectedRows.slice(0, 5),
      acceptedRows,
    }
  }, [headers, rows, mapping, kind])

  const history = useMemo<HistoryEntry[]>(
    () => (login.dataset ? [login.dataset, ...datasets, ...uploadedDatasets] : [...datasets, ...uploadedDatasets]),
    [datasets, login.dataset],
  )

  const resetCapture = async () => {
    if (!window.confirm('Clear the live portal capture and its dataset?')) return
    try {
      await useLoginIntel.getState().resetRemote()
      toast('Live capture cleared · the dataset will rebuild on the next sign-in')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The portal could not reset the capture.')
    }
  }

  const activate = (dataset: UploadedDataset) => {
    setScopeId(dataset.id)
    toast(`Workspace dataset switched to ${dataset.name}`)
  }

  const accept = () => {
    if (!file || !validation || validation.missingColumns.length) return
    if (!canUpload) {
      toast('Only the ADMIN role can accept uploads in this demo')
      return
    }
    const used = history.map((h) => Number(String(h.id).replace(/\D/g, '')) || 0)
    const id = `DS-${Math.max(1103, ...used) + 1}`
    const assets = kind === 'assets' ? rowsToAssets(validation.acceptedRows, headers, mapping, id) : []
    const logs = kind === 'logs' ? rowsToLogSummary(validation.acceptedRows, headers, mapping) : undefined
    const entry: UploadedDataset = {
      id,
      name: file.name,
      type: kind === 'assets' ? 'Assets' : 'Logs',
      status: validation.rejected > 0 ? 'PARTIAL' : 'ACCEPTED',
      rows: validation.total,
      accepted: validation.accepted,
      rejected: validation.rejected,
      uploadedBy: session?.email ?? 'admin@aegis.demo',
      uploadedAt: new Date().toISOString(),
      source: 'USER UPLOAD',
      assets,
      logs,
    }
    addDataset(entry)
    setLastAccepted(entry)
    if (kind === 'assets' && assets.length) {
      setScopeId(entry.id)
      toast(`${assets.length} ${plural(assets.length, 'asset')} added · workspace switched to ${file.name}`)
    } else {
      toast(`${entry.accepted} log rows accepted from ${file.name}`)
    }
  }

  const download = (name: string, content: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const historyOption = useMemo(() => {
    return {
      grid: { left: 110, right: 28, top: 12, bottom: 18 },
      xAxis: {
        type: 'value',
        axisLabel: { color: theme === 'dark' ? '#647184' : '#7d8796', fontSize: 8, fontFamily: 'monospace' },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category',
        data: history.map((h) => h.name.slice(0, 22)),
        axisLabel: { color: theme === 'dark' ? '#98a5b8' : '#596474', fontSize: 8, fontFamily: 'monospace' },
        axisLine: { lineStyle: { color: 'rgba(150,168,192,.14)' } },
        axisTick: { show: false },
      },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      series: [
        {
          name: 'Accepted',
          type: 'bar',
          stack: 'r',
          barWidth: '54%',
          data: history.map((h) => h.accepted),
          itemStyle: { color: hexA(UPLOAD, 0.7) },
        },
        {
          name: 'Rejected',
          type: 'bar',
          stack: 'r',
          data: history.map((h) => h.rejected),
          itemStyle: { color: hexA('#e5545a', 0.7), borderRadius: [0, 3, 3, 0] },
        },
      ],
    }
  }, [history, theme])

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 16 · DATA INPUT HUB"
        title="Bring your own truth"
        description="Uppercase your inventory and logs through a mapped, validated pipeline. Every file is untrusted; every accepted row carries its filename, time, and uploader."
        actions={
          <div className="inline-flex">
            {canUpload ? <span className="badge low">ADMIN · upload enabled</span> : <span className="badge high">Read-only for {role}</span>}
            <UploadBadge />
          </div>
        }
      />

      <div className="upload-steps">
        {[
          { n: 1, label: 'Upload', done: Boolean(file) },
          { n: 2, label: 'Map columns', done: Boolean(Object.keys(mapping).length) },
          { n: 3, label: 'Validate', done: Boolean(validation && validation.missingColumns.length === 0) },
          { n: 4, label: 'Accept', done: datasets.length > 0 },
        ].map((s) => (
          <div className={`upload-step${s.done ? ' done' : ''}`} key={s.n}>
            <span className="upload-step-num">{s.done ? <Check size={11} /> : String(s.n).padStart(2, '0')}</span>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {lastAccepted && (
        <div className="form-success" role="status">
          <Check size={14} />
          {lastAccepted.type === 'Assets' ? (
            <>
              <span>
                {lastAccepted.assets.length} {plural(lastAccepted.assets.length, 'asset')}{' '}
                {lastAccepted.assets.length === 1 ? 'is' : 'are'} now in the workspace inventory
                {scopeInfo.id === lastAccepted.id ? ' · this dataset is in view' : ''}.
              </span>
              {scopeInfo.id !== lastAccepted.id && (
                <button className="panel-link" onClick={() => activate(lastAccepted)}>
                  Use as workspace dataset <ArrowRight size={11} />
                </button>
              )}
              <button className="panel-link" onClick={() => navigate('/app/assets')}>
                Open asset register <ArrowRight size={11} />
              </button>
            </>
          ) : (
            <>
              <span>{lastAccepted.accepted} log rows accepted and summarised for the Ask Aegis context.</span>
              <span className="mono">inventory scope unchanged</span>
            </>
          )}
        </div>
      )}

      <div className="dash-grid">
        <Panel
          className="col-12"
          title="Live capture · Northwind portal"
          sub={
            login.dataset
              ? `${login.dataset.rows} sign-in requests auto-fetched · ${login.failed} failed · ${login.granted} granted`
              : 'Waiting for the decoy portal — it feeds itself in as a dataset'
          }
          action={<span className="badge real">LIVE DATASET</span>}
          bodyClass="panel-body"
        >
          {login.dataset ? (
            <div className="live-capture-hub">
              <div className="lch-metrics">
                <div className={cx('lch-metric', login.failed > 0 && 'hot')}>
                  <b>{login.failed}</b>
                  <span>failed logins</span>
                </div>
                <div className="lch-metric">
                  <b>{login.granted}</b>
                  <span>granted</span>
                </div>
                <div className="lch-metric">
                  <b>{login.analysis.metrics.attempts}</b>
                  <span>requests</span>
                </div>
                <div className="lch-metric">
                  <b>{login.accounts}</b>
                  <span>accounts</span>
                </div>
                <div className="lch-metric">
                  <b>{login.sources}</b>
                  <span>source IPs</span>
                </div>
                <div className={cx('lch-risk', login.analysis.level.toLowerCase())}>
                  <b>{login.analysis.score}</b>
                  <span>{login.analysis.level} risk</span>
                </div>
              </div>

              <div className="lch-body">
                <p className="lch-note">
                  <strong>{login.dataset.name}</strong> is a <code>Logs</code> dataset with no inventory scope. Every
                  failed request is counted and flagged individually on the anomaly board; the cumulative risk score
                  rebuilds on every 2-second poll.
                </p>
                <div className="lch-files">
                  <span className="mono">{login.dataset.files?.json}</span>
                  <span className="mono">{login.dataset.files?.csv}</span>
                </div>
              </div>

              <div className="lch-actions">
                <a className="btn btn-ghost btn-sm" href={LOGIN_JSON_FILE} download="login-events.json">
                  <Download size={12} /> JSON
                </a>
                <a className="btn btn-ghost btn-sm" href={LOGIN_CSV_FILE} download="login-events.csv">
                  <Download size={12} /> CSV
                </a>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/anomalies')}>
                  <FileSearch size={12} /> Evidence
                </button>
                {canUpload && (
                  <button className="btn btn-ghost btn-sm" onClick={() => void resetCapture()}>
                    <X size={12} /> Reset capture
                  </button>
                )}
                <a className="btn btn-primary btn-sm" href={portalUrl} target="_blank" rel="noreferrer">
                  Open portal <ArrowRight size={12} />
                </a>
              </div>
            </div>
          ) : (
            <div className="live-capture-hub empty">
              <div className="lch-metrics">
                <div className="lch-metric">
                  <b>0</b>
                  <span>failed logins</span>
                </div>
                <div className="lch-metric">
                  <b>0</b>
                  <span>requests</span>
                </div>
                <div className="lch-metric">
                  <b>—</b>
                  <span>risk score</span>
                </div>
              </div>
              <div className="lch-body">
                <p className="lch-note">
                  No capture yet. Open the decoy portal, fail a sign-in a few times, and the request log becomes{' '}
                  <strong>Northwind portal logins · live</strong> here on the next poll. Nothing needs uploading.
                </p>
              </div>
              <div className="lch-actions">
                <a className="btn btn-primary btn-sm" href={portalUrl} target="_blank" rel="noreferrer">
                  Open decoy portal <ArrowRight size={12} />
                </a>
              </div>
            </div>
          )}
        </Panel>

        <Panel
          className="col-8"
          title="Source file"
          sub="CSV · TSV · JSON · JSONL · 10 MB maximum · extension allowlist"
          action={<span className="mono">untrusted input</span>}
          bodyClass="panel-body"
        >
          <div
            className={`dropzone${drag ? ' drag' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              const f = e.dataTransfer.files[0]
              if (f) void load(f)
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') inputRef.current?.click()
            }}
            aria-label="Upload inventory or log file"
          >
            <div className="dz-icon">
              <Upload size={20} />
            </div>
            <h3>{file ? file.name : 'Drop an inventory or log file'}</h3>
            <p>
              {file
                ? `${fmtInt(file.size)} bytes · ${kind === 'assets' ? 'inventory' : 'log'} shape detected`
                : 'or click to browse. Nothing leaves this browser in the demo.'}
            </p>
            <div className="formats">
              <span className="badge real">CSV</span>
              <span className="badge real">TSV</span>
              <span className="badge real">JSONL</span>
              <span className="badge suppressed">XLSX · backend</span>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,.json,.jsonl,.ndjson,.xlsx,.xlsm"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void load(f)
              }}
            />
          </div>

          {error && (
            <div className="form-alert" style={{ marginTop: 14 }}>
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          <div className="inline-flex mt-16" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => download('asset_inventory_sample.csv', sampleAssetsCsv)}>
              <Download size={12} /> Inventory sample
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => download('auth_logs_sample.csv', sampleLogsCsv)}>
              <Download size={12} /> Log sample
            </button>
            <span className="mono" style={{ fontSize: 8.5, alignSelf: 'center' }}>
              Samples are labelled and contain no real customer data.
            </span>
          </div>
        </Panel>

        <Panel className="col-4" title="Upload security" sub="Applied before a single row is trusted" bodyClass="panel-body">
          <div style={{ display: 'grid', gap: 9 }}>
            {[
              ['Extension allowlist', 'Only CSV, TSV, JSON, JSONL reach the parser.'],
              ['Size ceiling', '10 MB in this demo; enforced again server-side.'],
              ['Formula injection', 'Cells starting = + - @ are neutralised and counted.'],
              ['Row validation', 'Required fields missing → row rejected with a reason.'],
              ['Quarantine', 'Rejected files never overwrite accepted datasets.'],
              ['Role gate', 'Only ADMIN can accept an upload in the demo.'],
            ].map(([title, body]) => (
              <div className="inline-flex" key={title} style={{ alignItems: 'flex-start', gap: 9 }}>
                <ShieldCheck size={13} style={{ color: 'var(--teal)', marginTop: 2, flexShrink: 0 }} />
                <div>
                  <strong style={{ fontSize: 11.5 }}>{title}</strong>
                  <div style={{ fontSize: 10.5, color: 'var(--text-mute)' }}>{body}</div>
                </div>
              </div>
            ))}
          </div>
          {!canUpload && (
            <div className="form-alert" style={{ marginTop: 14 }}>
              <Lock size={13} />
              <span>
                Signed in as {role}. You can parse and validate; switch to the admin demo account to accept.
              </span>
            </div>
          )}
        </Panel>

        {validation && (
          <>
            <Panel
              className="col-7"
              title="Schema mapping"
              sub={`Detected ${kind === 'assets' ? 'inventory' : 'log'} shape · required fields marked`}
              action={
                <div className="seg">
                  {(['assets', 'logs'] as Kind[]).map((k) => (
                    <button key={k} className={kind === k ? 'on' : undefined} onClick={() => setKind(k)}>
                      {k}
                    </button>
                  ))}
                </div>
              }
              bodyClass="panel-body"
            >
              <div className="mapping-grid">
                {FIELDS[kind].map((field) => (
                  <label key={field.key} className="mapping-row">
                    <span>
                      {field.label}
                      {field.required && <span style={{ color: 'var(--critical)' }}> *</span>}
                    </span>
                    <select
                      className="select"
                      value={mapping[field.key] ?? ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value }))}
                    >
                      <option value="">— not mapped —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="inline-flex mt-12" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span className="mono" style={{ fontSize: 8.5 }}>{Object.keys(mapping).length} mapped</span>
                <span className="mono" style={{ fontSize: 8.5, color: validation.missingColumns.length ? 'var(--high)' : 'var(--low)' }}>
                  {validation.missingColumns.length
                    ? `missing required: ${validation.missingColumns.join(', ')}`
                    : 'all required fields mapped'}
                </span>
              </div>
            </Panel>

            <Panel
              className="col-5"
              title="Validation"
              sub="Rejected rows carry a reason; nothing is silently dropped"
              action={<span className="badge upload">USER UPLOAD</span>}
              noPad
            >
              <div style={{ padding: '14px 18px', display: 'grid', gap: 10 }}>
                {[
                  ['Rows read', fmtInt(validation.total), 'var(--text)'],
                  ['Accepted', fmtInt(validation.accepted), 'var(--low)'],
                  ['Rejected', fmtInt(validation.rejected), validation.rejected ? 'var(--critical)' : 'var(--text-mute)'],
                  ['Cells sanitised', fmtInt(validation.sanitized), validation.sanitized ? 'var(--amber)' : 'var(--text-mute)'],
                ].map(([k, v, c]) => (
                  <div className="factor-line" key={k}>
                    <span>{k}</span>
                    <strong style={{ color: c }}>{v}</strong>
                  </div>
                ))}
                {validation.rejectedRows.map((r) => (
                  <div className="form-alert" key={r.row} style={{ margin: 0 }}>
                    <X size={12} />
                    <span style={{ fontSize: 10.5 }}>
                      Row {r.row}: {r.reason}
                    </span>
                  </div>
                ))}
              </div>
              <div className="table-note" style={{ borderTop: '1px solid var(--line)' }}>
                <span className="mono">accepted rows keep source, file, and timestamp</span>
              </div>
              <div style={{ padding: '12px 18px 16px' }}>
                <button
                  className="btn btn-primary btn-sm full"
                  disabled={!canUpload || validation.missingColumns.length > 0 || validation.accepted === 0}
                  onClick={accept}
                  title={!canUpload ? 'Admin role required' : undefined}
                >
                  <Check size={13} /> Accept {validation.accepted} rows
                </button>
              </div>
            </Panel>

            <Panel className="col-12" title="Preview · first 6 rows" sub="Formula-like cells are displayed with a leading apostrophe" noPad>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 6).map((r, i) => (
                      <tr key={i}>
                        {headers.map((_, j) => (
                          <td key={j} className="cell-sub">
                            {sanitizeCell(r[j] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        )}

        <Panel
          className="col-7"
          title="Dataset history"
          sub={`${history.length} ${plural(history.length, 'dataset')} · accepted and rejected kept separate`}
          action={<span className="badge upload">USER UPLOAD</span>}
          noPad
        >
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>View</th>
                  <th className="right">Rows</th>
                  <th className="right">Accepted</th>
                  <th className="right">Rejected</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const dataset = h as UploadedDataset
                  const canScope = Array.isArray(dataset.assets) && dataset.assets.length > 0
                  const inView = canScope && scopeInfo.id === h.id
                  return (
                    <tr key={h.id}>
                      <td>
                        <div className="cell-title">
                          {h.name} {h.live && <span className="badge real">LIVE</span>}
                        </div>
                        <div className="cell-sub">
                          {h.id} · {h.uploadedBy}
                          {h.live && h.risk ? ` · ${h.risk.level} ${h.risk.score}/100` : ''}
                          {h.live && h.logs ? ` · ${h.logs.failedLogins} failed` : ''}
                        </div>
                      </td>
                      <td className="cell-sub">{h.type}</td>
                      <td>
                        {h.live ? (
                          <span className="badge real">AUTO-FETCH</span>
                        ) : (
                          <span className={`badge ${h.status === 'ACCEPTED' ? 'low' : h.status === 'PARTIAL' ? 'medium' : 'critical'}`}>
                            {h.status}
                          </span>
                        )}
                      </td>
                      <td>
                        {canScope ? (
                          inView ? (
                            <span className="badge low">IN VIEW</span>
                          ) : (
                            <button type="button" className="panel-link" onClick={() => activate(dataset)}>
                              Use <ArrowRight size={10} />
                            </button>
                          )
                        ) : h.live ? (
                          <button type="button" className="panel-link" onClick={() => navigate('/app/anomalies')}>
                            Evidence <ArrowRight size={10} />
                          </button>
                        ) : (
                          <span className="dim mono">—</span>
                        )}
                      </td>
                      <td className="right mono">{fmtInt(h.rows)}</td>
                      <td className="right mono">{fmtInt(h.accepted)}</td>
                      <td className="right mono">{fmtInt(h.rejected)}</td>
                      <td className="mono">{timeAgo(h.uploadedAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="table-note">
            <span className="inline-flex">
              <FileSearch size={11} /> Accepted asset datasets are switchable from the dataset control in the top bar; threat intel stays live.
            </span>
            <span className="mono">quarantine never auto-promotes</span>
          </div>
        </Panel>

        <Panel className="col-5" title="Rows by dataset" sub="Accepted vs rejected, current demo history" noPad>
          <Chart option={historyOption} height={250} />
          <div className="chart-legend">
            <span className="legend-item">
              <i style={{ background: UPLOAD }} /> accepted
            </span>
            <span className="legend-item">
              <i style={{ background: '#e5545a' }} /> rejected
            </span>
            <span className="legend-item dim">Legacy .xlsm rejected before parsing.</span>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'Datasets held', value: String(history.length), formula: 'accepted + seeded demo records', n: history.length },
            { name: 'Rows accepted', value: fmtInt(history.reduce((a, b) => a + b.accepted, 0)), formula: 'Σ accepted rows', n: history.length },
            { name: 'Rows rejected', value: fmtInt(history.reduce((a, b) => a + b.rejected, 0)), formula: 'Σ rejected rows', n: history.length },
            { name: 'Acceptance rate', value: `${((history.reduce((a, b) => a + b.accepted, 0) / Math.max(1, history.reduce((a, b) => a + b.rows, 0))) * 100).toFixed(1)}%`, formula: 'accepted ÷ rows read', n: history.length },
            { name: 'Current file', value: file ? file.name.slice(0, 26) : 'none', formula: 'last parsed file · browser only', n: file ? rows.length : 0 },
          ]}
        />
      </div>

      <div className="page-foot">
        <span className="inline-flex">
          <Lock size={11} /> Files are parsed in your browser. Accepted inventory is kept in this browser's local storage and never sent to a server.
        </span>
        <span className="mono" style={{ color: TEAL }}>provenance: USER UPLOAD</span>
      </div>
    </div>
  )
}
