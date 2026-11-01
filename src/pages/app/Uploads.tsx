import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chart } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { StatsPanel } from '../../components/StatsPanel'
import { UploadBadge } from '../../components/Badges'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Database,
  Download,
  FileSearch,
  Layers,
  Lock,
  Plus,
  ShieldCheck,
  Upload,
  X,
  Zap,
} from '../../components/Icons'
import { sampleAssetsCsv, sampleLogsCsv, uploadedDatasets } from '../../data/seed'
import { useAuth, useTheme, useToast } from '../../lib/store'
import {
  ALL_DATASETS,
  EVENT_TYPES,
  MAX_ASSETS,
  MAX_EVENTS,
  autoMap,
  detectPreset,
  fieldFor,
  parseObjects,
  rowsToAssets,
  rowsToEvents,
  summarizeEvents,
  useUploads,
  type UploadedDataset,
} from '../../lib/uploads'
import { useEstate } from '../../lib/estate'
import { fmtInt, timeAgo, cx } from '../../lib/format'
import { TEAL, UPLOAD, hexA } from '../../lib/colors'

type Kind = 'assets' | 'logs'
type HistoryRow = Omit<UploadedDataset, 'status'> & { status: string }

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

/** The seeded demo history is display-only; it still needs the row shape the table renders. */
const LEGACY_ROWS: HistoryRow[] = uploadedDatasets.map((row) => ({
  ...row,
  type: row.type as 'Assets' | 'Logs',
  source: 'USER UPLOAD',
  assets: [],
  status: String(row.status),
}))

const AFFECTED_PAGES = [
  'Dashboard',
  'Alert Center',
  'Risk Scoring',
  'Asset Exposure',
  'CVE Explorer',
  'Network Graph',
  'Attack Profiles',
  'Provenance',
  'Threat Intel',
  'Emerging Radar',
  'Global Map',
  'Traffic',
  'Anomaly',
  'ATT&CK',
  'Simulator',
  'AI Analyst',
]

export default function Uploads() {
  const theme = useTheme((s) => s.theme)
  const session = useAuth((s) => s.session)
  const toast = useToast((s) => s.show)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  const datasets = useUploads((s) => s.datasets)
  const addDataset = useUploads((s) => s.add)
  const removeDataset = useUploads((s) => s.remove)
  const activeId = useUploads((s) => s.activeId)
  const setActive = useUploads((s) => s.setActive)
  const estate = useEstate()

  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [kind, setKind] = useState<Kind>('assets')
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [preset, setPreset] = useState<{ matched: number; total: number } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [drag, setDrag] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastAccepted, setLastAccepted] = useState<UploadedDataset | null>(null)

  const role = session?.role ?? 'ANALYST'
  const canUpload = role === 'ADMIN'

  const allFields = fieldFor(kind)
  const fields = showAll ? allFields : allFields.filter((f) => f.core)

  const load = async (f: File) => {
    setError(null)
    setFile(f)
    setLastAccepted(null)
    setHeaders([])
    setRows([])
    setMapping({})
    setPreset(null)
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
      setHeaders(head)
      setRows(body)
      setKind(detected)
      setMapping(autoMap(head, fieldFor(detected)))
      setPreset(detectPreset(head, detected))
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
    const specs = fieldFor(kind)
    const required = specs.filter((f) => f.required)
    const missingColumns = required.filter((f) => !mapping[f.key]).map((f) => f.label)
    const indexes = new Map(headers.map((h, i) => [h, i]))
    let rejected = 0
    let sanitized = 0
    const rejectedRows: { row: number; reason: string }[] = []
    const acceptedRows: string[][] = []
    const assetKeys = new Set<string>()
    rows.forEach((r, idx) => {
      const get = (key: string) => {
        const col = mapping[key]
        if (!col) return ''
        const i = indexes.get(col)
        return i === undefined ? '' : String(r[i] ?? '').trim()
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
        if (kind === 'assets') assetKeys.add(get('asset_id') || get('asset_name'))
      }
    })
    const uniqueAssets = kind === 'assets' ? assetKeys.size : 0
    const events = kind === 'logs' ? acceptedRows.length : 0
    return {
      total: rows.length,
      accepted: acceptedRows.length,
      rejected,
      sanitized,
      missingColumns,
      rejectedRows: rejectedRows.slice(0, 5),
      acceptedRows,
      uniqueAssets,
      events,
      overBudget: uniqueAssets > MAX_ASSETS || events > MAX_EVENTS,
    }
  }, [headers, rows, mapping, kind])

  const history = useMemo<HistoryRow[]>(() => [...datasets, ...LEGACY_ROWS], [datasets])

  const accept = () => {
    if (!file || !validation || validation.missingColumns.length) return
    if (!canUpload) {
      toast('Only the ADMIN role can accept uploads in this demo')
      return
    }
    const used = history.map((h) => Number(String(h.id).replace(/\D/g, '')) || 0)
    const id = `DS-${Math.max(1103, ...used) + 1}`
    const assets = kind === 'assets' ? rowsToAssets(validation.acceptedRows, headers, mapping, id) : []
    const events = kind === 'logs' ? rowsToEvents(validation.acceptedRows, headers, mapping, id) : null
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
      ...(events ? { events, logs: summarizeEvents(events) } : {}),
      ...(preset ? { preset: `${preset.matched}/${preset.total} columns auto-mapped` } : {}),
    }
    addDataset(entry)
    // A scoped view would otherwise hide the file that was just accepted.
    if (activeId !== ALL_DATASETS) setActive(entry.id)
    setLastAccepted(entry)
    toast(
      kind === 'assets'
        ? `${assets.length} assets joined the estate from ${file.name}; every page re-derived`
        : `${events?.length ?? 0} events joined the estate from ${file.name}; behaviour, traffic and map rebuilt`,
    )
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

  const gaps = estate.coverage.uncovered
  const impacts = [
    {
      label: 'Estate assets',
      value: fmtInt(estate.assets.length),
      note: estate.scope.includesSeed
        ? `${estate.seedAssets.length} seeded · ${fmtInt(estate.coverage.uploadedAssets)} uploaded`
        : `${fmtInt(estate.coverage.uploadedAssets)} uploaded · demo seed excluded`,
      color: 'var(--text)',
      icon: Database,
    },
    {
      label: 'CVE records',
      value: fmtInt(estate.cves.length),
      note: `offline corpus · ${estate.coverage.corpusProducts} products · live-patched`,
      color: 'var(--text)',
      icon: Layers,
    },
    {
      label: 'Exposure paths',
      value: fmtInt(estate.paths.length),
      note: `${fmtInt(estate.coverage.matchedPaths)} matched · ${fmtInt(estate.coverage.gatedPaths)} gated`,
      color: 'var(--text)',
      icon: Zap,
    },
    {
      label: 'Alert queue',
      value: fmtInt(estate.alerts.length),
      note: estate.coverage.queueTruncated ? 'capped per asset for the browser' : 'every exposed asset represented',
      color: 'var(--text)',
      icon: ShieldCheck,
    },
    {
      label: 'Log events',
      value: fmtInt(estate.coverage.events),
      note: estate.coverage.hasEvents
        ? 'drives traffic, anomaly, map, ATT&CK'
        : estate.scope.all
          ? 'no log dataset accepted yet'
          : 'this scope has no log rows · traffic pages fall back to the demo',
      color: 'var(--text)',
      icon: FileSearch,
    },
    {
      label: 'Posture',
      value: String(estate.posture),
      note: `recomputed for ${estate.scope.all ? 'the merged estate' : estate.scope.label}`,
      color: estate.posture >= 70 ? 'var(--low)' : estate.posture >= 45 ? 'var(--medium)' : 'var(--high)',
      icon: ShieldCheck,
    },
  ]

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 16 · DATA INPUT HUB"
        title="Bring your own truth"
        description="Uppercase your inventory and logs through a mapped, validated pipeline. Accepted rows join the single estate every other page reads — correlation, scoring, intel, traffic, all of it. Every file is untrusted; every accepted row carries its filename, time, and uploader."
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
          { n: 4, label: 'Accept into estate', done: datasets.length > 0 },
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
                {fmtInt(lastAccepted.assets.length)} assets are in the estate. Asset exposure, risk scoring, the network graph and
                Ask Aegis all read them now.
              </span>
              <button className="panel-link" onClick={() => navigate('/app/assets')}>
                Open asset register <ArrowRight size={11} />
              </button>
            </>
          ) : (
            <span>
              {fmtInt(lastAccepted.events?.length ?? 0)} events are in the estate. Traffic, anomaly detection, the global map and
              ATT&amp;CK all read them now.
            </span>
          )}
          <button
            className="panel-link"
            onClick={() => {
              setActive(lastAccepted.id)
              toast(`${lastAccepted.name} is now the scope of every page`)
            }}
          >
            <Layers size={11} /> Analyse this file alone <ArrowRight size={11} />
          </button>
          <button className="panel-link" onClick={() => navigate('/app')}>
            Open dashboard <ArrowRight size={11} />
          </button>
        </div>
      )}

      <div className="scope-strip">
        <span className="scope-strip-label">
          <Layers size={12} /> Every page analyses
        </span>
        <button
          className={cx('scope-chip', estate.scope.all && 'on')}
          onClick={() => setActive(ALL_DATASETS)}
          title="Merge every accepted dataset with the demo seed"
        >
          <span>All datasets</span>
          {fmtInt(estate.assets.length)} assets
        </button>
        {datasets.map((d) => (
          <button
            key={d.id}
            className={cx('scope-chip', activeId === d.id && 'on')}
            onClick={() => setActive(d.id)}
            title={`Analyse ${d.name} on its own`}
          >
            {d.type === 'Logs' ? <FileSearch size={11} /> : <Database size={11} />}
            <span>{d.name}</span>
            {d.type === 'Logs'
              ? fmtInt(d.events?.length ?? d.logs?.total ?? 0) + ' events'
              : fmtInt(d.assets.length) + ' assets'}
          </button>
        ))}
        {!datasets.length && (
          <span className="scope-strip-label">no dataset accepted · demo seed only</span>
        )}
      </div>

      <div className="dash-grid">
        <Panel
          className="col-12"
          title="Workspace impact"
          sub="What the estate holds right now — this is exactly what every other page renders"
          action={
            <span className={cx('badge', estate.scope.all ? (datasets.length ? 'upload' : 'simulated') : 'upload')}>
              {estate.scope.all ? (datasets.length ? 'ALL DATASETS MERGED' : 'SEEDED ONLY') : `SCOPE · ${estate.scope.label.slice(0, 24)}`}
            </span>
          }
          bodyClass="panel-body"
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            {impacts.map((tile) => {
              const Icon = tile.icon
              return (
                <div key={tile.label} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '11px 13px' }}>
                  <div className="inline-flex" style={{ gap: 6, color: 'var(--text-mute)' }}>
                    <Icon size={12} />
                    <span className="mono" style={{ fontSize: 8.5, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                      {tile.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 21, fontFamily: 'var(--font-mono)', color: tile.color, marginTop: 5 }}>{tile.value}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-mute)', lineHeight: 1.35 }}>{tile.note}</div>
                </div>
              )
            })}
          </div>

          <div className="inline-flex mt-12" style={{ flexWrap: 'wrap', gap: 6 }}>
            <span className="mono" style={{ fontSize: 8.5, color: 'var(--text-mute)', alignSelf: 'center' }}>
              feeding
            </span>
            {AFFECTED_PAGES.map((page) => (
              <span className="badge real" key={page}>
                {page}
              </span>
            ))}
          </div>

          {(estate.coverage.unverifiedPaths > 0 || gaps.length > 0) && (
            <div className="form-alert" style={{ marginTop: 14 }}>
              <AlertTriangle size={13} />
              <span>
                {fmtInt(estate.coverage.unverifiedPaths)} exposure path(s) have an unverified installed version, and{' '}
                {gaps.length
                  ? `${gaps
                      .slice(0, 3)
                      .map((gap) => `${gap.product} (${fmtInt(gap.assets)} assets)`)
                      .join(', ')}${gaps.length > 3 ? ` +${gaps.length - 3} more` : ''}`
                  : 'no product'}{' '}
                has no CVE configuration in the corpus. Those assets are reported as a coverage gap, never as clean.
              </span>
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
                ? `${fmtInt(file.size)} bytes · ${kind === 'assets' ? 'inventory' : 'log'} shape detected · ${fmtInt(headers.length)} columns`
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

          {preset && (
            <div className="form-success" style={{ marginTop: 14 }}>
              <Check size={13} />
              <span>
                Wide export detected: {preset.matched} of {preset.total} fields mapped straight from the header row. Override any
                column below, or accept as-is.
              </span>
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
              ['Browser budget', `≤ ${fmtInt(MAX_ASSETS)} assets and ≤ ${fmtInt(MAX_EVENTS)} events per dataset.`],
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
              <div className="inline-flex" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <span className="mono" style={{ fontSize: 8.5, color: 'var(--text-mute)' }}>
                  {showAll ? `all ${allFields.length} fields` : 'core fields'} · {fmtInt(headers.length)} columns available
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)}>
                  <Plus size={11} /> {showAll ? 'Core fields only' : `Show all ${allFields.length} fields`}
                </button>
              </div>
              <div className="mapping-grid">
                {fields.map((field) => (
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
                  [
                    kind === 'assets' ? 'Unique assets' : 'Events',
                    fmtInt(kind === 'assets' ? validation.uniqueAssets : validation.events),
                    'var(--teal)',
                  ],
                  ['Rejected', fmtInt(validation.rejected), validation.rejected ? 'var(--critical)' : 'var(--text-mute)'],
                  ['Cells sanitised', fmtInt(validation.sanitized), validation.sanitized ? 'var(--amber)' : 'var(--text-mute)'],
                ].map(([k, v, c]) => (
                  <div className="factor-line" key={k}>
                    <span>{k}</span>
                    <strong style={{ color: c }}>{v}</strong>
                  </div>
                ))}
                {validation.overBudget && (
                  <div className="form-alert" style={{ margin: 0 }}>
                    <AlertTriangle size={12} />
                    <span style={{ fontSize: 10.5 }}>
                      This file is larger than the browser budget; rows past the cap are dropped and the dataset is labelled as
                      truncated.
                    </span>
                  </div>
                )}
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
                  <Check size={13} /> Accept {fmtInt(validation.accepted)} rows into the estate
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
          sub={`${history.length} datasets · accepted and rejected kept separate`}
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
                  <th className="right">Rows</th>
                  <th className="right">Accepted</th>
                  <th className="right">Rejected</th>
                  <th>Uploaded</th>
                  <th>Scope</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const live = datasets.some((d) => d.id === h.id)
                  return (
                    <tr key={h.id}>
                      <td>
                        <div className="cell-title">{h.name}</div>
                        <div className="cell-sub">
                          {h.id} · {h.uploadedBy}
                          {h.preset ? ` · ${h.preset}` : ''}
                        </div>
                        {h.truncated && <div className="cell-sub" style={{ color: 'var(--amber)' }}>{h.truncated}</div>}
                      </td>
                      <td className="cell-sub">{h.type}</td>
                      <td>
                        <span className={`badge ${h.status === 'ACCEPTED' ? 'low' : h.status === 'PARTIAL' ? 'medium' : 'critical'}`}>
                          {h.status}
                        </span>
                      </td>
                      <td className="right mono">{fmtInt(h.rows)}</td>
                      <td className="right mono">{fmtInt(h.accepted)}</td>
                      <td className="right mono">{fmtInt(h.rejected)}</td>
                      <td className="mono">{timeAgo(h.uploadedAt)}</td>
                      <td>
                        {live &&
                          (activeId === h.id ? (
                            <span className="badge upload">in scope</span>
                          ) : (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                setActive(h.id)
                                toast(`${h.name} is now the scope of every page`)
                              }}
                              title="Re-derive every page from this dataset alone"
                            >
                              <Layers size={11} /> Analyse
                            </button>
                          ))}
                      </td>
                      <td className="right">
                        {live && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              removeDataset(h.id)
                              toast(`${h.name} dropped from the estate; every page re-derived without it`)
                            }}
                            title="Remove this dataset and re-derive the estate"
                          >
                            <X size={11} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="table-note">
            <span className="inline-flex">
              <FileSearch size={11} /> Accepted rows join the estate that asset exposure, scoring, graphs, intel, traffic and Ask
              Aegis all read.
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
          sub="Computed from the live estate plus the seeded demo history · not a production claim"
          stats={[
            { name: 'Datasets held', value: String(history.length), formula: 'accepted + seeded demo records', n: history.length },
            { name: 'Rows accepted', value: fmtInt(history.reduce((a, b) => a + b.accepted, 0)), formula: 'Σ accepted rows', n: history.length },
            { name: 'Rows rejected', value: fmtInt(history.reduce((a, b) => a + b.rejected, 0)), formula: 'Σ rejected rows', n: history.length },
            { name: 'Acceptance rate', value: `${((history.reduce((a, b) => a + b.accepted, 0) / Math.max(1, history.reduce((a, b) => a + b.rows, 0))) * 100).toFixed(1)}%`, formula: 'accepted ÷ rows read', n: history.length },
            { name: 'Estate assets', value: fmtInt(estate.assets.length), formula: 'seeded + uploaded inventory rows', n: estate.assets.length },
            { name: 'Estate events', value: fmtInt(estate.coverage.events), formula: 'Σ accepted log rows', n: estate.coverage.events },
            { name: 'Current file', value: file ? file.name.slice(0, 26) : 'none', formula: 'last parsed file · browser only', n: file ? rows.length : 0 },
          ]}
        />
      </div>

      <div className="page-foot">
        <span className="inline-flex">
          <Lock size={11} /> Files are parsed in your browser. Accepted rows are kept in this browser's IndexedDB and feed the
          estate every page reads; nothing is sent to a server.
        </span>
        <span className="mono" style={{ color: TEAL }}>provenance: USER UPLOAD</span>
      </div>
    </div>
  )
}
