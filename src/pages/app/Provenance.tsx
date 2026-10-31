import { useMemo, useState } from 'react'
import { PageHeader, Panel } from '../../components/Panel'
import { Waterfall } from '../../components/Waterfall'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge, SourceBadge } from '../../components/Badges'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { AlertTriangle, Check, Database, GitBranch, Info, RefreshCw, Sparkles } from '../../components/Icons'
import { DEMO_NOW } from '../../data/seed'
import { useLiveAlerts } from '../../lib/liveData'
import { latestLiveFetch, useLiveFeeds } from '../../lib/liveFeeds'
import { useTheme } from '../../lib/store'
import { fmtDate, fmtDateTime, fmtScore } from '../../lib/format'
import { relevanceLabel } from '../../lib/scoring'
import type { Alert } from '../../lib/types'

const fnv = (input: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export default function Provenance() {
  const theme = useTheme((s) => s.theme)
  const alerts = useLiveAlerts()
  const [selectedId, setSelectedId] = useState(alerts[0].id)
  const [inspect, setInspect] = useState<{ label: string; value: string; note: string } | null>(null)
  const alert = alerts.find((a) => a.id === selectedId) ?? alerts[0]
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

  const chain = [
    {
      icon: <Database size={15} />,
      label: 'NVD record',
      meta: `${alert.cve.id} · rev ${fmtDate(alert.cve.modified)}`,
      tone: 'real',
      note: 'Public record with CVSS vector, weaknesses, references, and CPE configurations.',
    },
    {
      icon: <Database size={15} />,
      label: 'CPE normalize',
      meta: `${alert.cve.vendor} ${alert.cve.product}`,
      tone: 'real',
      note: 'Vendor and product are canonicalized; the version range is extracted from CPE match rows.',
    },
    {
      icon: <Sparkles size={15} />,
      label: 'EPSS + KEV',
      meta: `${alert.cve.epss == null ? 'EPSS missing' : `${(alert.cve.epss * 100).toFixed(1)}% EPSS`} · ${alert.cve.kev ? 'KEV' : 'no KEV'}`,
      tone: 'real',
      note: 'Exploitation likelihood and known-exploited membership are attached to the CVE.',
    },
    {
      icon: <Database size={15} />,
      label: 'Inventory',
      meta: `${alert.asset.name} · ${alert.version}`,
      tone: 'simulated',
      note: 'Installed software and asset context. Demo inventory is SIMULATED; production uses USER UPLOAD.',
    },
    {
      icon: <GitBranch size={15} />,
      label: 'Relevance gate',
      meta: relevanceLabel[alert.relevance],
      tone: alert.suppressed ? 'muted' : 'teal',
      note: 'Version comparison decides whether the record survives. Suppression never deletes.',
    },
    {
      icon: <Check size={15} />,
      label: 'Deterministic score',
      meta: `${fmtScore(alert.score)} · ${alert.level}`,
      tone: 'amber',
      note: 'Six factors, fixed weights, formula v1.1. No model is permitted to change this number.',
    },
  ]

  const fields = [
    { key: 'alert_id', value: alert.id, from: 'system' },
    { key: 'cve_id', value: alert.cve.id, from: 'NVD' },
    { key: 'cvss_base', value: alert.cve.cvss?.toFixed(1) ?? 'missing', from: 'NVD' },
    { key: 'epss', value: alert.cve.epss == null ? 'missing' : alert.cve.epss.toFixed(4), from: 'FIRST EPSS' },
    { key: 'in_kev', value: String(alert.cve.kev), from: 'CISA KEV' },
    { key: 'installed_version', value: alert.version, from: 'SIMULATED inventory' },
    { key: 'relevance_status', value: alert.relevance, from: 'correlation engine' },
    { key: 'risk_score', value: fmtScore(alert.score), from: 'scoreAlert()' },
    { key: 'risk_level', value: alert.level, from: 'scoreAlert()' },
    { key: 'summary_text', value: alert.summary.slice(0, 58) + '…', from: 'template writer' },
  ]

  const present = [
    alert.cve.cvss != null,
    alert.cve.epss != null,
    alert.cve.kev,
    alert.version !== 'unknown' && alert.version !== 'not installed',
    Boolean(alert.cve.range.endExcluding || alert.cve.range.endIncluding),
  ]
  const presentCount = present.filter(Boolean).length

  const missing = present.filter((p) => !p).length

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 13 · PROVENANCE GRAPH"
        title="Every alert can be traced"
        description="Open the chain from public record to installed version to computed score. Missing inputs stay visible instead of being smoothed over."
        actions={
          <select className="select" style={{ width: 300 }} value={selectedId} onChange={(e) => setSelectedId(e.target.value)} aria-label="Choose alert">
            {alerts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} · {a.cve.id} · {a.asset.name}
              </option>
            ))}
          </select>
        }
      />

      <div className="provenance-head">
        <div>
          <span className="mono">ALERT {alert.id}</span>
          <h2>
            {alert.cve.id} <span className="dim">→</span> {alert.asset.name}
          </h2>
          <div className="inline-flex" style={{ flexWrap: 'wrap', gap: 7, marginTop: 8 }}>
            <SourceBadge source="NVD" />
            <SourceBadge source="FIRST EPSS" />
            {alert.cve.kev && <SourceBadge source="CISA KEV" />}
            <SourceBadge source="SIMULATED" />
            <SeverityBadge level={alert.level} suppressed={alert.suppressed} />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono">PAYLOAD HASH</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: 'var(--teal)', letterSpacing: '0.08em' }}>
            {hash}
          </div>
          <div className="mono" style={{ fontSize: 8, marginTop: 4 }}>
            FNV-1a over the demo payload · not a signature
          </div>
        </div>
      </div>

      <Panel
        title="Derivation chain"
        sub="Six nodes · each is clickable for its evidence"
        action={<span className="mono">formula v{alert.breakdown.formula_version}</span>}
        bodyClass="panel-body"
      >
        <div className="flow-grid">
          {chain.map((c, i) => (
            <div className="flow-step" key={c.label}>
              <button
                className="flow-node"
                onClick={() =>
                  setInspect({
                    label: c.label,
                    value: c.meta,
                    note: c.note,
                  })
                }
              >
                <span className={`flow-icon ${c.tone}`}>{c.icon}</span>
                <strong>{c.label}</strong>
                <span className="mono">{c.meta}</span>
              </button>
              {i < chain.length - 1 && <span className="flow-arrow" aria-hidden="true">→</span>}
            </div>
          ))}
        </div>
        <div className="table-note">
          <span className="inline-flex">
            <Info size={11} /> Red or grey nodes indicate a gate or a missing input. Nothing is silently zero-filled.
          </span>
          <span className="mono">{presentCount}/5 key inputs present</span>
        </div>
      </Panel>

      <div className="dash-grid mt-16">
        <Panel className="col-7" title="Field lineage" sub="Every stored field, and who produced it" noPad>
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
                    <td className="mono">{f.key}</td>
                    <td className="mono" style={{ color: f.value === 'missing' ? 'var(--high)' : undefined }}>
                      {f.value}
                    </td>
                    <td className="cell-sub">{f.from}</td>
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

        <Panel className="col-5" title="Score provenance" sub="Recomputed from the stored breakdown" bodyClass="panel-body">
          <Waterfall alert={alert} compact />
          <div className="table-note" style={{ borderTop: '1px solid var(--line)', marginTop: 8 }}>
            <span className="mono">inputs: CVSS · EPSS · KEV · criticality · exposure · relevance</span>
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
                    <td>{r.name}</td>
                    <td>
                      {r.ok ? (
                        <span className="badge low">
                          <Check size={9} /> present
                        </span>
                      ) : (
                        <span className="badge high">
                          <AlertTriangle size={9} /> missing
                        </span>
                      )}
                    </td>
                    <td className="mono">{fmtDateTime(r.time)}</td>
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

        <Panel className="col-5" title="Writer boundary" sub="What the language layer may and may not touch" bodyClass="panel-body">
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="action-box" style={{ borderColor: 'rgba(62,210,193,.28)' }}>
              <div className="inline-flex">
                <Check size={13} className="check" />
                <strong style={{ fontSize: 12 }}>May write</strong>
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 5 }}>
                Summary, impact statement, recommended action, and the reasoning paragraph. The demo uses a
                deterministic template provider; Ollama or Gemini can replace it behind the same interface.
              </p>
            </div>
            <div className="action-box" style={{ borderColor: 'rgba(229,84,90,.25)' }}>
              <div className="inline-flex">
                <AlertTriangle size={13} className="miss" />
                <strong style={{ fontSize: 12 }}>May never write</strong>
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 5 }}>
                relevance_status, risk_level, numeric score, or suppression state. Those belong to the
                deterministic engine and are verified by tests.
              </p>
            </div>
            <div className="form-alert" style={{ margin: 0 }}>
              <RefreshCw size={13} />
              <span>
                Cached LLM output is keyed by (cve, asset, formula version) and falls back to the template on any
                failure.
              </span>
            </div>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'Inputs present', value: `${presentCount}/5`, formula: 'required input completeness flags', n: 5 },
            { name: 'Field rows', value: String(fields.length), formula: 'stored fields in this record', n: fields.length },
            { name: 'Score integrity', value: alert.breakdown.total_capped === alert.score ? 'verified' : 'mismatch', formula: 'stored score = recomputed breakdown', n: alert.breakdown.formula_version === '1.1' ? 1 : 0 },
            { name: 'Suppression', value: alert.suppressed ? 'applied' : 'not applied', formula: 'relevance gate state', n: 1 },
            { name: 'Payload hash', value: hash, formula: 'FNV-1a over {cve, asset, score, breakdown}', n: 1 },
          ]}
        />
      </div>

      <Drawer open={Boolean(inspect)} onClose={() => setInspect(null)} label="Provenance node">
        {inspect && (
          <>
            <DrawerHead overline="PROVENANCE NODE" title={inspect.label} onClose={() => setInspect(null)} />
            <div className="drawer-body">
              <div className="drawer-section">
                <div className="action-box">
                  <div className="mono" style={{ fontSize: 11, color: 'var(--teal)' }}>{inspect.value}</div>
                  <p style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 8 }}>{inspect.note}</p>
                </div>
              </div>
              <div className="drawer-section">
                <h3>Record context</h3>
                <div className="provenance-list">
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Alert</span>
                    <span className="time">{alert.id}</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>CVE</span>
                    <span className="time">{alert.cve.id}</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Asset</span>
                    <span className="time">{alert.asset.name}</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Formula version</span>
                    <span className="time">{alert.breakdown.formula_version}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </Drawer>
    </div>
  )
}
