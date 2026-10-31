import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { PageHeader, Panel } from '../../components/Panel'
import { Waterfall } from '../../components/Waterfall'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge, ConfidenceBadge, RelevanceBadge, SourceBadge, UploadBadge } from '../../components/Badges'
import { EmptyState } from '../../components/EmptyState'
import { AlertTriangle, Check, Download, Lock, Search, ShieldAlert, Sparkles, X } from '../../components/Icons'
import { DEMO_NOW } from '../../data/seed'
import { useAcks, useAuth, useFilters, useToast } from '../../lib/store'
import { fmtDate, fmtPct, fmtScore, timeAgo } from '../../lib/format'
import { mean } from '../../lib/stats'
import { relevanceLabel, relevanceReason } from '../../lib/scoring'
import { predict, topFeatureImportance, featureValueLabel, FEATURE_LABELS, ML_BANDS, MODEL_CARD } from '../../lib/ml'
import { useLiveActiveAlerts, useLiveAlerts, useLiveSuppressedAlerts } from '../../lib/liveData'
import type { Alert, RelevanceStatus, RiskLevel } from '../../lib/types'

type RelevanceFilter = 'ALL' | RelevanceStatus

export default function Alerts() {
  const [params, setParams] = useSearchParams()
  const query = useFilters((s) => s.query)
  const setQuery = useFilters((s) => s.setQuery)
  const toast = useToast((s) => s.show)
  const session = useAuth((s) => s.session)
  const admin = session?.role === 'ADMIN'
  const acks = useAcks((s) => s.acks)
  const ack = useAcks((s) => s.ack)

  const alerts = useLiveAlerts()
  const activeAlerts = useLiveActiveAlerts()
  const suppressedAlerts = useLiveSuppressedAlerts()

  const [level, setLevel] = useState<'ALL' | RiskLevel>('ALL')
  const [relevance, setRelevance] = useState<RelevanceFilter>('ALL')
  const [showSuppressed, setShowSuppressed] = useState(true)
  const [kevOnly, setKevOnly] = useState(false)

  const selectedId = params.get('alert')
  const selected = selectedId ? alerts.find((a) => a.id === selectedId) ?? null : null

  const open = (a: Alert) => {
    const next = new URLSearchParams(params)
    next.set('alert', a.id)
    setParams(next, { replace: true })
  }
  const close = () => {
    const next = new URLSearchParams(params)
    next.delete('alert')
    setParams(next, { replace: true })
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return alerts
      .filter((a) => (showSuppressed ? true : !a.suppressed))
      .filter((a) => (level === 'ALL' ? true : a.level === level))
      .filter((a) => (relevance === 'ALL' ? true : a.relevance === relevance))
      .filter((a) => (kevOnly ? a.cve.kev : true))
      .filter((a) =>
        q ? `${a.id} ${a.cve.id} ${a.cve.title} ${a.asset.name} ${a.asset.department}`.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => Number(a.suppressed) - Number(b.suppressed) || b.score - a.score)
  }, [alerts, level, relevance, showSuppressed, kevOnly, query])

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 02 · ALERT CENTER"
        title="Every alert earns its place"
        description="Version-aware correlation first, deterministic scoring second, language last. Suppressed candidates stay visible and explain why they were hidden."
        actions={
          <>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() =>
                toast(admin ? 'CSV export is disabled in demo mode' : 'Export requires an admin account')
              }
              disabled={!admin}
              title={admin ? 'Export the alert queue' : 'Admin access required'}
            >
              {admin ? <Download size={13} /> : <Lock size={13} />} Export
            </button>
            <span className="chip">
              <Sparkles size={12} /> {acks ? Object.keys(acks).length : 0} acknowledged
            </span>
          </>
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="kpi high-tone">
          <div className="kpi-label">Active alerts</div>
          <div className="kpi-value">{activeAlerts.length}</div>
          <div className="kpi-delta">version-relevant and scored</div>
        </div>
        <div className="kpi critical-tone">
          <div className="kpi-label">Critical</div>
          <div className="kpi-value">{activeAlerts.filter((a) => a.level === 'CRITICAL').length}</div>
          <div className="kpi-delta up">patch window this week</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Supressed candidates</div>
          <div className="kpi-value">{suppressedAlerts.length}</div>
          <div className="kpi-delta">kept visible, never deleted</div>
        </div>
        <div className="kpi teal-tone">
          <div className="kpi-label">Mean score</div>
          <div className="kpi-value">{fmtScore(mean(activeAlerts.map((a) => a.score)))}</div>
          <div className="kpi-delta">six-factor deterministic</div>
        </div>
      </div>

      <Panel
        title="Alert queue"
        sub={`${rows.length} of ${alerts.length} candidates after filters · suppression never deletes the record`}
        action={<span className="badge real">NVD · KEV · EPSS</span>}
        noPad
      >
        <div className="filters-bar">
          <div className="topbar-search" style={{ maxWidth: 300 }}>
            <Search size={13} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter CVE, asset, department…"
              aria-label="Filter alerts"
            />
          </div>
          <div className="seg">
            {(['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((l) => (
              <button key={l} className={level === l ? 'on' : undefined} onClick={() => setLevel(l)}>
                {l === 'ALL' ? 'All levels' : l}
              </button>
            ))}
          </div>
          <select
            className="select"
            style={{ width: 190 }}
            value={relevance}
            onChange={(e) => setRelevance(e.target.value as RelevanceFilter)}
            aria-label="Relevance status"
          >
            <option value="ALL">All relevance states</option>
            <option value="MATCHED">Version in range</option>
            <option value="VERSION_UNKNOWN">Version unverified</option>
            <option value="NOT_AFFECTED">Not affected</option>
            <option value="PRODUCT_ABSENT">Product absent</option>
          </select>
          <div className="filters-spacer" />
          <button
            className="chip"
            onClick={() => setKevOnly((v) => !v)}
            aria-pressed={kevOnly}
            style={kevOnly ? { borderColor: 'var(--amber)', color: 'var(--amber)' } : undefined}
          >
            <ShieldAlert size={12} /> KEV only
          </button>
          <button
            className="chip"
            onClick={() => setShowSuppressed((v) => !v)}
            aria-pressed={showSuppressed}
            style={showSuppressed ? { borderColor: 'var(--line-strong)' } : { opacity: 0.55 }}
          >
            {showSuppressed ? <Check size={12} /> : <X size={12} />} Suppressed
          </button>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No alert matches this filter" hint="Clear the search or switch relevance state." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 58 }}>Score</th>
                  <th>Alert</th>
                  <th>Level</th>
                  <th>Relevance</th>
                  <th>EPSS</th>
                  <th>KEV</th>
                  <th className="right">XGB p</th>
                  <th>Confidence</th>
                  <th className="right">Raised</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const isAcked = Boolean(acks[a.id])
                  return (
                    <tr
                      key={a.id}
                      className={`clickable${a.suppressed ? ' suppressed-row' : ''}`}
                      onClick={() => open(a)}
                      aria-label={`Open ${a.cve.id} alert`}
                    >
                      <td>
                        <span className={`score-cell ${a.suppressed ? 'suppressed' : a.level.toLowerCase()}`}>
                          {fmtScore(a.score)}
                        </span>
                      </td>
                      <td>
                        <div className="cell-title">
                          {a.cve.id} <span className="dim">·</span> {a.asset.name}
                          {isAcked && (
                            <span className="badge low" style={{ marginLeft: 8 }}>
                              ack
                            </span>
                          )}
                        </div>
                        <div className="cell-sub">{a.cve.title}</div>
                      </td>
                      <td>
                        <SeverityBadge level={a.level} suppressed={a.suppressed} />
                      </td>
                      <td>
                        <RelevanceBadge relevance={a.relevance} />
                      </td>
                      <td className="mono">{a.cve.epss == null ? '—' : fmtPct(a.cve.epss)}</td>
                      <td>{a.cve.kev ? <span className="badge high">KEV</span> : <span className="dim mono">—</span>}</td>
                      <td>
                        <MlProb alert={a} />
                      </td>
                      <td>
                        <span className="mono" style={{ fontSize: 9 }}>
                          {a.confidence}
                        </span>
                      </td>
                      <td className="right mono">{timeAgo(a.createdAt, DEMO_NOW)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-note">
          <span className="inline-flex">
            <AlertTriangle size={11} /> Suppressed rows display the score they would have received — the gate is
            explained, not hidden. XGB p is the model's KEV-membership prior; relevance still overrides it.
          </span>
          <span className="mono">{rows.length} records · {DEMO_NOW.toISOString().slice(0, 10)}</span>
        </div>
      </Panel>

      <div className="dash-grid mt-16">
        <StatsPanel
          className="col-7"
          stats={[
            {
              name: 'Suppression precision',
              value: `${((suppressedAlerts.length / alerts.length) * 100).toFixed(1)}%`,
              formula: 'suppressed ÷ correlation candidates',
              n: alerts.length,
              note: 'Would-have-scored retained for audit.',
            },
            {
              name: 'Matched coverage',
              value: `${activeAlerts.filter((a) => a.relevance === 'MATCHED').length}/${activeAlerts.length}`,
              formula: 'version-confirmed ÷ active alerts',
              n: activeAlerts.length,
            },
            {
              name: 'Score range',
              value: `${fmtScore(Math.min(...activeAlerts.map((a) => a.score)))}–${fmtScore(
                Math.max(...activeAlerts.map((a) => a.score)),
              )}`,
              formula: 'min–max over active alerts',
              n: activeAlerts.length,
            },
            {
              name: 'KEV share',
              value: `${(
                (activeAlerts.filter((a) => a.cve.kev).length / activeAlerts.length) *
                100
              ).toFixed(0)}%`,
              formula: 'KEV-listed ÷ active alerts',
              n: activeAlerts.length,
            },
          ]}
        />
        <Panel
          className="col-5"
          title="Why suppression exists"
          sub="A severity-only queue cannot tell these apart"
          bodyClass="panel-body"
        >
          <div style={{ display: 'grid', gap: 12 }}>
            {suppressedAlerts.map((a) => (
              <button
                key={a.id}
                onClick={() => open(a)}
                style={{
                  textAlign: 'left',
                  padding: 14,
                  borderRadius: 10,
                  border: '1px solid var(--line)',
                  background: 'rgba(255,255,255,0.015)',
                }}
              >
                <div className="inline-flex" style={{ justifyContent: 'space-between', width: '100%' }}>
                  <span className="mono">{a.cve.id}</span>
                  <span className="badge suppressed">would have scored {fmtScore(a.wouldHaveScored ?? 0)}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
                  {a.asset.name} · {relevanceReason[a.relevance]}
                </div>
              </button>
            ))}
            <p className="dim" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
              Each row keeps its original CVSS, EPSS, and KEV inputs. The relevance gate sets the score to
              zero but stores <span className="mono">suppressed_would_have_scored</span> for review.
            </p>
          </div>
        </Panel>
      </div>

      <Drawer open={Boolean(selected)} onClose={close} label={selected ? `${selected.cve.id} alert` : 'Alert detail'}>
        {selected && (
          <AlertDetail
            alert={selected}
            acks={acks}
            onClose={close}
            onAck={() => {
              ack(selected.id, session?.name ?? 'Analyst', 'Reviewed in demo session.')
              toast(`${selected.cve.id} acknowledged`)
            }}
          />
        )}
      </Drawer>
    </div>
  )
}

function MlProb({ alert }: { alert: Alert }) {
  const ml = predict(alert)
  const pct = Math.round(ml.probability * 100)
  if (alert.suppressed) {
    return (
      <div
        className="ml-prob gated"
        title={`Version-relevance gate applied · audit prior ${(ml.probability * 100).toFixed(1)}%`}
      >
        <span className="ml-prob-gated mono">gated</span>
      </div>
    )
  }
  return (
    <div className={`ml-prob ${ml.band.toLowerCase()}`} title={`XGBoost ${(ml.probability * 100).toFixed(1)}% · ${ml.band.toLowerCase()} band`}>
      <span className="ml-prob-value mono">{pct}%</span>
      <span className="ml-prob-track" aria-hidden="true">
        <i style={{ width: `${Math.max(3, pct)}%` }} />
      </span>
    </div>
  )
}

function MlDetail({ alert }: { alert: Alert }) {
  const ml = predict(alert)
  const pct = (ml.probability * 100).toFixed(1)
  return (
    <div className="ml-detail">
      <div className="ml-detail-head">
        <div className="ml-detail-score">
          <strong>{pct}%</strong>
          <span className={`ml-band ${ml.band.toLowerCase()}`}>{ml.band}</span>
        </div>
        <span className="mono">KEV-membership prior · {MODEL_CARD.version}</span>
      </div>
      <div className="ml-detail-track" aria-hidden="true">
        <i style={{ width: `${ml.probability * 100}%` }} />
        <span
          className="ml-threshold"
          style={{ left: `${ML_BANDS.elevated * 100}%` }}
          title={`ELEVATED band starts at ${(ML_BANDS.elevated * 100).toFixed(1)}%`}
        />
      </div>
      <div className="ml-inputs">
        {topFeatureImportance.map((f) => (
          <div className="ml-input" key={f.feature}>
            <span>{FEATURE_LABELS[f.feature] ?? f.feature}</span>
            <strong>{featureValueLabel(f.feature, ml.features[f.feature] ?? 0)}</strong>
            <small className="mono">{f.share.toFixed(0)}% gain</small>
          </div>
        ))}
      </div>
      <p className="dim ml-detail-note">
        A real gradient-boosted model ({MODEL_CARD.rounds} trees, test AUC {MODEL_CARD.test.auc.toFixed(3)},
        fitted on {MODEL_CARD.dataset.rows.toLocaleString('en-US')} live NVD/EPSS records) scores KEV-membership
        likelihood as a second opinion. The six-factor deterministic score remains authoritative.
      </p>
      {alert.suppressed && (
        <p className="ml-detail-gate">
          The relevance gate overrides the model here: the product or version is not affected, so the alert stays
          suppressed even though a prior is retained for audit.
        </p>
      )}
    </div>
  )
}

function AlertDetail({
  alert,
  acks,
  onAck,
  onClose,
}: {
  alert: Alert
  acks: Record<string, { by: string; at: string; note?: string }>
  onAck: () => void
  onClose: () => void
}) {
  const installed = alert.version
  const provenance = [
    {
      label: 'NVD record',
      ok: true,
      value: `last modified ${fmtDate(alert.cve.modified)}`,
    },
    {
      label: 'CPE affected range',
      ok: alert.relevance !== 'PRODUCT_ABSENT',
      value:
        alert.cve.range.startIncluding || alert.cve.range.endExcluding
          ? `${alert.cve.range.startIncluding ?? '*'} → ${alert.cve.range.endExcluding ? `< ${alert.cve.range.endExcluding}` : alert.cve.range.endIncluding ? `≤ ${alert.cve.range.endIncluding}` : '*'}`
          : 'range not published',
    },
    {
      label: 'FIRST EPSS',
      ok: alert.cve.epss != null,
      value: alert.cve.epss == null ? 'score missing' : `${fmtPct(alert.cve.epss)} · ${alert.cve.epssPercentile}th pct`,
    },
    {
      label: 'CISA KEV membership',
      ok: alert.cve.kev,
      value: alert.cve.kev ? `due ${alert.cve.kevDue ? fmtDate(alert.cve.kevDue) : 'n/a'}` : 'not listed',
    },
    {
      label: 'Asset inventory',
      ok: true,
      value: `${alert.asset.name} · ${alert.asset.department}`,
    },
    {
      label: 'Installed version',
      ok: alert.relevance === 'MATCHED',
      value: installed === 'unknown' ? 'version unverified' : installed,
    },
  ]

  return (
    <>
      <DrawerHead
        overline={`${alert.id} · ${alert.relevance === 'MATCHED' ? 'VERSION-CONFIRMED' : relevanceLabel[alert.relevance].toUpperCase()}`}
        title={
          <span className="inline-flex" style={{ gap: 10, flexWrap: 'wrap' }}>
            {alert.cve.id} <SeverityBadge level={alert.level} suppressed={alert.suppressed} />
          </span>
        }
        onClose={onClose}
        meta={
          <span className="inline-flex" style={{ flexWrap: 'wrap', gap: 8 }}>
            <SourceBadge source="NVD" />
            {alert.cve.kev && <SourceBadge source="CISA KEV" />}
            <span className="badge simulated">Asset inventory · simulated</span>
            <ConfidenceBadge confidence={alert.confidence} />
          </span>
        }
      />
      <div className="drawer-body">
        <div className="drawer-section">
          <p style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.65 }}>{alert.summary}</p>
          <div className="drawer-meta">
            <span>{alert.asset.name}</span>
            <span>{installed === 'unknown' ? 'version unverified' : `installed ${installed}`}</span>
            <span>{timeAgo(alert.createdAt, DEMO_NOW)}</span>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Score derivation</h3>
          <Waterfall alert={alert} />
        </div>

        <div className="drawer-section">
          <h3>Exploitation model · XGBoost</h3>
          <MlDetail alert={alert} />
        </div>

        <div className="drawer-section">
          <h3>Relevance gate</h3>
          <div className="action-box" style={{ borderColor: alert.suppressed ? 'var(--line)' : 'rgba(62,210,193,.28)' }}>
            <div className="inline-flex" style={{ justifyContent: 'space-between', width: '100%' }}>
              <strong style={{ fontSize: 12 }}>{relevanceLabel[alert.relevance]}</strong>
              <span className="mono">{alert.suppressed ? 'score zeroed' : 'score retained'}</span>
            </div>
            <p style={{ marginTop: 6, fontSize: 12, color: 'var(--text-dim)' }}>{relevanceReason[alert.relevance]}</p>
            {alert.suppressed && (
              <p style={{ marginTop: 6, fontSize: 11, color: 'var(--medium)' }} className="mono">
                suppressed_would_have_scored = {fmtScore(alert.wouldHaveScored ?? 0)}
              </p>
            )}
          </div>
        </div>

        <div className="drawer-section">
          <h3>Impact</h3>
          <p>{alert.impact}</p>
        </div>

        <div className="drawer-section">
          <h3>Recommended action</h3>
          <div className="action-box">
            <strong style={{ fontSize: 12 }}>{alert.action}</strong>
            {alert.cve.kevDue && (
              <p className="mono" style={{ marginTop: 6, color: 'var(--amber)' }}>
                CISA remediation due {fmtDate(alert.cve.kevDue)}
              </p>
            )}
          </div>
        </div>

        <div className="drawer-section">
          <h3>Provenance</h3>
          <div className="provenance-list">
            {provenance.map((p) => (
              <div className="provenance-row" key={p.label}>
                {p.ok ? <Check size={12} className="check" /> : <AlertTriangle size={12} className="miss" />}
                <span>{p.label}</span>
                <span className="time">{p.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="drawer-section">
          <h3>Extracted entities</h3>
          <div className="entity-tags">
            {[alert.cve.product, installed !== 'unknown' ? installed : 'version-unverified', ...alert.cve.cwe]
              .filter(Boolean)
              .map((e) => (
                <span className="entity-tag" key={e}>
                  {e}
                </span>
              ))}
            <span className="entity-tag">{alert.cve.vendor}</span>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Sources</h3>
          <div className="inline-flex" style={{ flexWrap: 'wrap', gap: 6 }}>
            <SourceBadge source="NVD" />
            <SourceBadge source="FIRST EPSS" />
            {alert.cve.kev && <SourceBadge source="CISA KEV" />}
            <SourceBadge source="SIMULATED" />
            <UploadBadge />
          </div>
          <p className="dim mt-8" style={{ fontSize: 11 }}>
            Asset inventory in this demo is labelled SIMULATED. In a deployment it is replaced by the
            customer&apos;s USER UPLOAD and carries filename, upload time, and uploader.
          </p>
        </div>

        <div className="drawer-section">
          <h3>Acknowledgement</h3>
          {acks[alert.id] ? (
            <div className="action-box">
              <div className="inline-flex">
                <Check size={13} className="check" />
                <strong style={{ fontSize: 12 }}>Acknowledged by {acks[alert.id].by}</strong>
              </div>
              <p className="mono" style={{ marginTop: 6 }}>
                {new Date(acks[alert.id].at).toLocaleString('en-US')}
                {acks[alert.id].note ? ` · ${acks[alert.id].note}` : ''}
              </p>
            </div>
          ) : (
            <div className="action-box">
              <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                Acknowledging records who reviewed the alert and when. It does not change the score.
              </p>
              <button className="btn btn-primary btn-sm mt-12" onClick={onAck}>
                <Check size={13} /> Acknowledge alert
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="drawer-foot">
        <span className="mono">alert {alert.id}</span>
        <span className="mono">formula v{alert.breakdown.formula_version}</span>
      </div>
    </>
  )
}
