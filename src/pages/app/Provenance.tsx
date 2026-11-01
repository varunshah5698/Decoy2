import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel } from '../../components/Panel'
import { Waterfall } from '../../components/Waterfall'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge, SourceBadge } from '../../components/Badges'
import { EvidenceChain, EV_LANES, buildEvidenceGraph, type Truth } from '../../components/EvidenceChain'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Check,
  Database,
  GitBranch,
  Info,
  Layers,
  RefreshCw,
  Sparkles,
} from '../../components/Icons'
import { DEMO_NOW, sourceHealth } from '../../data/seed'
import { useLiveAlerts } from '../../lib/liveData'
import { latestLiveFetch, useLiveFeeds } from '../../lib/liveFeeds'
import { useScopeInfo } from '../../lib/dataScope'
import { fmtDate, fmtDateTime } from '../../lib/format'
import type { Alert } from '../../lib/types'
import './provenance.css'

const fnv = (input: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const at = (a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)]
  const [x0, y0] = at(a0)
  const [x1, y1] = at(a1)
  return `M${x0} ${y0} A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

const hoursSince = (iso: string) => Math.max(0, (DEMO_NOW.getTime() - new Date(iso).getTime()) / 3_600_000)

const FILTERS: { key: 'all' | Truth; label: string }[] = [
  { key: 'all', label: 'All nodes' },
  { key: 'public', label: 'Public' },
  { key: 'simulated', label: 'Simulated' },
  { key: 'gap', label: 'Gaps' },
]

const TRUTH_TONE: Record<Truth, { bg: string; fg: string; label: string }> = {
  public: { bg: 'rgba(15,143,131,.12)', fg: '#0f8f83', label: 'PUBLIC RECORD' },
  simulated: { bg: 'rgba(114,87,204,.14)', fg: '#7257cc', label: 'SIMULATED' },
  gap: { bg: 'rgba(217,58,65,.12)', fg: '#d93a41', label: 'MISSING INPUT' },
}

export default function Provenance() {
  const alerts = useLiveAlerts()
  if (!alerts.length) return <ProvenanceEmpty />
  return <ProvenanceWorkspace alerts={alerts} />
}

function ProvenanceEmpty() {
  const navigate = useNavigate()
  const scopeInfo = useScopeInfo()
  return (
    <div className="page prov-root">
      <header className="prov-head">
        <div>
          <span className="prov-head-eyebrow">
            <GitBranch size={12} /> Component 13 · Provenance graph
          </span>
          <h1>Every alert can be traced</h1>
          <p>{scopeInfo.label} has no correlation candidates yet, so there is no evidence chain to open.</p>
        </div>
      </header>
      <Panel
        className="col-12"
        title="No provenance records"
        sub="Switch dataset or add versioned software to build a chain"
      >
        <div className="xp-empty">
          <span className="xp-empty-icon">
            <GitBranch size={16} />
          </span>
          <strong>Nothing to trace in this scope</strong>
          <span>Accepted assets need a software version inside a CVE range before an alert — and its chain — exists.</span>
        </div>
        <div className="inline-flex mt-16" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/uploads')}>
            Data Input Hub <ArrowRight size={13} />
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/app/alerts')}>
            Alert queue <ArrowRight size={13} />
          </button>
        </div>
      </Panel>
    </div>
  )
}

function ProvenanceWorkspace({ alerts }: { alerts: Alert[] }) {
  const [selectedId, setSelectedId] = useState(alerts[0].id)
  const [filter, setFilter] = useState<'all' | Truth>('all')
  const [activeId, setActiveId] = useState<string | null>('alert')
  const alert = alerts.find((a) => a.id === selectedId) ?? alerts[0]

  useEffect(() => {
    if (!alerts.some((a) => a.id === selectedId)) setSelectedId(alerts[0].id)
  }, [alerts, selectedId])

  const patch = useLiveFeeds((s) => s.patches[alert.cve.id])
  const lastFetch = latestLiveFetch(useLiveFeeds((s) => s.meta))

  const hash = useMemo(
    () =>
      fnv(
        JSON.stringify({
          cve: alert.cve.id,
          asset: alert.asset.id,
          score: alert.score,
          breakdown: alert.breakdown,
        }),
      ),
    [alert],
  )

  const { nodes, edges } = useMemo(() => buildEvidenceGraph(alert), [alert])
  const active = nodes.find((n) => n.id === activeId) ?? null

  const counts = {
    public: nodes.filter((n) => n.truth === 'public').length,
    simulated: nodes.filter((n) => n.truth === 'simulated').length,
    gap: nodes.filter((n) => n.truth === 'gap').length,
  }

  const present = [
    alert.cve.cvss != null,
    alert.cve.epss != null,
    alert.cve.kev,
    alert.version !== 'unknown' && alert.version !== 'not installed',
    Boolean(alert.cve.range.endExcluding || alert.cve.range.endIncluding),
  ]
  const presentCount = present.filter(Boolean).length
  const completeness = Math.round((presentCount / present.length) * 100)
  const missing = present.length - presentCount

  /* Semicircle split by how much of the chain rests on a public record. */
  const sweep = 178
  let cursor = 181
  const gaugeArcs = (['public', 'simulated', 'gap'] as const).flatMap((key) => {
    const share = counts[key] / nodes.length
    if (!share) return []
    const span = share * sweep - 3
    const d = arc(100, 104, 82, cursor, cursor + Math.max(1, span))
    cursor += share * sweep
    return [{ key, d }]
  })

  const fields = [
    { key: 'alert_id', value: alert.id, from: 'system' },
    { key: 'cve_id', value: alert.cve.id, from: 'NVD' },
    { key: 'cvss_base', value: alert.cve.cvss?.toFixed(1) ?? 'missing', from: 'NVD' },
    { key: 'epss', value: alert.cve.epss == null ? 'missing' : alert.cve.epss.toFixed(4), from: 'FIRST EPSS' },
    { key: 'in_kev', value: String(alert.cve.kev), from: 'CISA KEV' },
    { key: 'installed_version', value: alert.version, from: 'SIMULATED inventory' },
    { key: 'relevance_status', value: alert.relevance, from: 'correlation engine' },
    { key: 'risk_score', value: String(alert.score), from: 'scoreAlert()' },
    { key: 'risk_level', value: alert.level, from: 'scoreAlert()' },
    { key: 'summary_text', value: alert.summary.slice(0, 30) + '…', from: 'template writer' },
  ]

  const laneStats = EV_LANES.map((lane, i) => {
    const inLane = nodes.filter((n) => n.lane === i)
    const live = inLane.filter((n) => n.truth === 'public').length
    return {
      name: lane.label,
      total: inLane.length,
      live,
      share: inLane.length ? Math.round((live / inLane.length) * 100) : 0,
    }
  })

  return (
    <div className="page prov-root">
      <header className="prov-head">
        <div>
          <span className="prov-head-eyebrow">
            <GitBranch size={12} /> Component 13 · Provenance graph
          </span>
          <h1>Every alert can be traced</h1>
          <p>
            Open the chain from the public record to the installed version to the computed score. Missing inputs stay
            visible instead of being smoothed over.
          </p>
          <div className="prov-identity">
            <span className="prov-identity-record">
              {alert.id} · {alert.cve.id} <span className="dim">→</span> {alert.asset.name}
              <span className="prov-identity-time"> · {fmtDate(alert.createdAt)}</span>
            </span>
            <span className="inline-flex" style={{ flexWrap: 'wrap', gap: 7 }}>
              <SourceBadge source="NVD" />
              <SourceBadge source="FIRST EPSS" />
              {alert.cve.kev && <SourceBadge source="CISA KEV" />}
              <SourceBadge source="SIMULATED" />
              <SeverityBadge level={alert.level} suppressed={alert.suppressed} />
            </span>
          </div>
        </div>
        <div className="prov-head-side">
          <select className="select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} aria-label="Choose alert">
            {alerts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} · {a.cve.id} · {a.asset.name}
              </option>
            ))}
          </select>
          <span className="prov-pill" title="FNV-1a over the demo payload · not a signature">
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--teal)' }}>{hash}</span>
          </span>
        </div>
      </header>

      <div className="dash-grid">
        <Panel
          className="col-12"
          title={
            <>
              <span className="prov-ico">
                <GitBranch size={13} />
              </span>
              Evidence chain
            </>
          }
          sub={`${nodes.length} nodes · hover to trace the path, click to inspect`}
          action={
            <div className="prov-seg" role="group" aria-label="Filter nodes by origin">
              {FILTERS.map((f) => (
                <button
                  type="button"
                  key={f.key}
                  className={filter === f.key ? 'on' : undefined}
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                >
                  {f.label}
                </button>
              ))}
            </div>
          }
          bodyClass="panel-body"
        >
          <EvidenceChain nodes={nodes} edges={edges} activeId={activeId} onSelect={setActiveId} filter={filter} />

          <div className="prov-lanes">
            {laneStats.map((l) => (
              <div className="prov-lane" key={l.name}>
                <span className="prov-lane-name">
                  <i
                    style={{
                      background:
                        l.name === 'SOURCE'
                          ? '#131f35'
                          : l.name === 'INTELLIGENCE'
                            ? '#f2622e'
                            : l.name === 'RULE'
                              ? '#0f8f83'
                              : l.name === 'WARNING'
                                ? '#d93a41'
                                : '#7257cc',
                    }}
                  />
                  {l.name}
                </span>
                <span className="prov-lane-stat">
                  {l.share}% <small>{l.live} of {l.total} public</small>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="dash-grid" style={{ marginTop: 14 }}>
        <div className="col-3 prov-stack">
          <Panel
            title={
              <>
                <span className="prov-ico">
                  <BarChart3 size={13} />
                </span>
                Evidence completeness
              </>
            }
            sub={`${alert.id} · ${alert.cve.id}`}
            bodyClass="panel-body"
          >
            <div className="prov-gauge">
              <svg viewBox="0 0 200 118" role="img" aria-label={`${completeness}% of key inputs present`}>
                <path d={arc(100, 104, 82, 181, 359)} fill="none" stroke="#eef1f5" strokeWidth={18} strokeLinecap="round" />
                {gaugeArcs.map((a) => (
                  <path
                    key={a.key}
                    d={a.d}
                    fill="none"
                    stroke={a.key === 'public' ? '#131f35' : a.key === 'simulated' ? '#7257cc' : '#f2622e'}
                    strokeWidth={18}
                    strokeLinecap="round"
                  />
                ))}
                <text className="prov-gauge-value" x="100" y="96" textAnchor="middle">
                  {completeness}%
                </text>
                <text className="prov-gauge-caption" x="100" y="114" textAnchor="middle">
                  key inputs present
                </text>
              </svg>
              <div className="prov-gauge-legend">
                {(['public', 'simulated', 'gap'] as const).map((key) => (
                  <button
                    type="button"
                    key={key}
                    className={filter === key ? 'on' : undefined}
                    onClick={() => setFilter((cur) => (cur === key ? 'all' : key))}
                    aria-pressed={filter === key}
                  >
                    <span>{key === 'gap' ? 'Gaps' : key === 'public' ? 'Public' : 'Simulated'}</span>
                    <b>{counts[key]}</b>
                  </button>
                ))}
              </div>
            </div>
          </Panel>

          <Panel
            title={
              <>
                <span className="prov-ico">
                  <Database size={13} />
                </span>
                Sources &amp; freshness
              </>
            }
            sub="Recording feeds behind this chain"
            action={
              <span className="mono" style={{ color: 'var(--pv-accent)' }}>
                <RefreshCw size={10} style={{ verticalAlign: -1 }} /> 1h
              </span>
            }
            bodyClass="panel-body"
          >
            <div className="prov-rows">
              {sourceHealth.map((s) => (
                <div className="prov-row" key={s.source}>
                  <span className="prov-row-label">
                    <i
                      className="prov-tick"
                      style={{ background: s.kind === 'real' ? 'var(--teal)' : s.status === 'DEGRADED' ? 'var(--critical)' : 'var(--simulated)' }}
                    />
                    {s.source}
                  </span>
                  <span className="prov-row-num">{s.records.toLocaleString('en-US')}</span>
                  <span className="prov-row-count">{hoursSince(s.lastSuccess).toFixed(1)}h</span>
                </div>
              ))}
            </div>
            <div className="table-note" style={{ padding: '12px 0 0' }}>
              <span className="inline-flex">
                <Info size={11} /> {sourceHealth.filter((s) => s.kind === 'real').length} of {sourceHealth.length} feeds
                are live public data.
              </span>
            </div>
          </Panel>
        </div>

        <Panel
          className="col-9"
          title={
            <>
              <span className="prov-ico">
                <Layers size={13} />
              </span>
              Node inspector
            </>
          }
          sub="What this node contributes"
          bodyClass="panel-body"
        >
          {active ? (
            <>
              <div className="prov-inspect-kicker">
                <span className="prov-inspect-title">{active.title}</span>
                <span
                  className="prov-inspect-kind"
                  style={{ background: TRUTH_TONE[active.truth].bg, color: TRUTH_TONE[active.truth].fg }}
                >
                  {TRUTH_TONE[active.truth].label}
                </span>
              </div>
              <div className="mono" style={{ color: 'var(--text-dim)' }}>
                {active.value}
              </div>
              <p className="prov-inspect-note">{active.note}</p>

              {active.segments && (
                <div className="prov-bars">
                  {active.segments.map((s) => (
                    <div className="prov-bar-row" key={s.label}>
                      <span className="prov-bar-top">
                        <span>{s.label}</span>
                        <b>{Math.round(s.share * 100)}%</b>
                      </span>
                      <span className="prov-bar-track">
                        <span
                          className="prov-bar-fill"
                          style={{
                            width: `${Math.max(2, s.share * 100)}%`,
                            background: s.tone === 'accent' ? 'var(--pv-accent)' : s.tone === 'navy' ? 'var(--pv-navy)' : '#a8b1c0',
                          }}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="prov-rows" style={{ marginTop: 16 }}>
                {[
                  ['Alert', alert.id],
                  ['CVE', alert.cve.id],
                  ['Asset', alert.asset.name],
                  ['Formula', `v${alert.breakdown.formula_version}`],
                ].map(([k, v]) => (
                  <div className="prov-row" key={k}>
                    <span className="prov-row-label">
                      <Check size={12} style={{ color: 'var(--teal)' }} />
                      {k}
                    </span>
                    <span className="prov-row-count" style={{ gridColumn: 'span 2' }}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="prov-empty">
              <Sparkles size={16} />
              Click any node on the chain to read its evidence.
            </div>
          )}
        </Panel>

        <Panel className="col-5" title="Field lineage" sub="Every stored field, and who produced it" noPad>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                  <th>Produced by</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.key}>
                    <td className="mono" style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text)' }}>
                      {f.key}
                    </td>
                    <td className="mono" style={{ textTransform: 'none', letterSpacing: 0, color: f.value === 'missing' ? 'var(--critical)' : 'var(--text-dim)' }}>
                      {f.value}
                    </td>
                    <td className="cell-sub" style={{ marginTop: 0 }}>
                      {f.from}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-note">
            <span className="inline-flex">
              <Sparkles size={11} /> Only text fields come from the writer. Numeric fields are frozen after scoring.
            </span>
          </div>
        </Panel>

        <Panel className="col-7" title="Input completeness" sub="Missing optional inputs are surfaced, not hidden" noPad>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Input</th>
                  <th>State</th>
                  <th>Timestamp</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { name: 'CVE base record', ok: true, time: patch?.nvdAt ?? alert.cve.modified, source: 'NVD' },
                  { name: 'CVSS metrics', ok: alert.cve.cvss != null, time: patch?.nvdAt ?? alert.cve.modified, source: 'NVD' },
                  { name: 'EPSS score', ok: alert.cve.epss != null, time: patch?.epssAt ?? DEMO_NOW.toISOString(), source: 'FIRST EPSS' },
                  { name: 'KEV membership', ok: alert.cve.kev, time: patch?.kevAt ?? alert.cve.kevDue ?? alert.cve.modified, source: 'CISA KEV' },
                  { name: 'Affected range', ok: Boolean(alert.cve.range.endExcluding || alert.cve.range.endIncluding), time: alert.cve.modified, source: 'NVD CPE' },
                  { name: 'Installed version', ok: alert.version !== 'unknown' && alert.version !== 'not installed', time: DEMO_NOW.toISOString(), source: 'SIMULATED' },
                ].map((r) => (
                  <tr key={r.name}>
                    <td className="cell-title">{r.name}</td>
                    <td>
                      {r.ok ? (
                        <span className="badge low">
                          <Check size={9} /> present
                        </span>
                      ) : (
                        <span className="badge critical">
                          <AlertTriangle size={9} /> missing
                        </span>
                      )}
                    </td>
                    <td className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{fmtDateTime(r.time)}</td>
                    <td>
                      <SourceBadge source={r.source} simulated={r.source === 'SIMULATED'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-note">
            <span className="mono">{missing === 0 ? 'No gaps in this record' : `${missing} input(s) missing for this record`}</span>
            <span className="mono">{lastFetch ? `live pull ${fmtDateTime(lastFetch)}` : `snapshot ${DEMO_NOW.toISOString().slice(0, 16).replace('T', ' ')}Z`}</span>
          </div>
        </Panel>

        <Panel className="col-5" title="Score provenance" sub="Recomputed from the stored breakdown" bodyClass="panel-body">
          <Waterfall alert={alert} compact />
          <div className="table-note" style={{ borderTop: '1px solid var(--line)', marginTop: 8, padding: '12px 0 0' }}>
            <span className="mono">inputs: CVSS · EPSS · KEV · criticality · exposure · relevance</span>
          </div>
        </Panel>

        <Panel className="col-7" title="Writer boundary" sub="What the language layer may and may not touch" bodyClass="panel-body">
          <div className="prov-writer">
            <div className="action-box" style={{ borderColor: 'rgba(15,143,131,.3)', borderRadius: 16 }}>
              <div className="inline-flex">
                <Check size={13} className="check" />
                <strong style={{ fontSize: 12.5 }}>May write</strong>
              </div>
              <p style={{ fontSize: 12.5, lineHeight: 1.65, color: 'var(--text-dim)', marginTop: 5 }}>
                Summary, impact statement, recommended action, and the reasoning paragraph. The demo uses a
                deterministic template provider; Ollama or Gemini can replace it behind the same interface.
              </p>
            </div>
            <div className="action-box" style={{ borderColor: 'rgba(217,58,65,.28)', borderRadius: 16 }}>
              <div className="inline-flex">
                <AlertTriangle size={13} className="miss" />
                <strong style={{ fontSize: 12.5 }}>May never write</strong>
              </div>
              <p style={{ fontSize: 12.5, lineHeight: 1.65, color: 'var(--text-dim)', marginTop: 5 }}>
                relevance_status, risk_level, numeric score, or suppression state. Those belong to the deterministic
                engine and are verified by tests.
              </p>
            </div>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          title="Chain statistics"
          sub="Recomputed from the selected record"
          stats={[
            { name: 'Inputs present', value: `${presentCount}/${present.length}`, formula: 'required input completeness flags', n: present.length },
            { name: 'Chain nodes', value: String(nodes.length), formula: 'source, intelligence, rule, warning, inventory', n: nodes.length },
            { name: 'Public records', value: String(counts.public), formula: 'nodes backed by a live public feed', n: counts.public },
            { name: 'Score integrity', value: alert.breakdown.total_capped === alert.score ? 'verified' : 'mismatch', formula: 'stored score = recomputed breakdown', n: 1 },
            { name: 'Suppression', value: alert.suppressed ? 'applied' : 'not applied', formula: 'relevance gate state', n: 1 },
          ]}
        />
      </div>
    </div>
  )
}
