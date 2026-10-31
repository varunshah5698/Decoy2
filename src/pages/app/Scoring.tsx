import { useEffect, useMemo, useState } from 'react'
import { Chart, axisStyle } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { RadialGauge } from '../../components/RadialGauge'
import { Waterfall } from '../../components/Waterfall'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge } from '../../components/Badges'
import { ChevronDown, Info, SlidersHorizontal, Sparkles } from '../../components/Icons'
import { useTheme } from '../../lib/store'
import { fmtPct, fmtScore } from '../../lib/format'
import { mean, quantile, stdev } from '../../lib/stats'
import { scoreAlert, WEIGHTS, levelFromScore, relevanceLabel } from '../../lib/scoring'
import { ML_BANDS, MODEL_CARD, topFeatureImportance, FEATURE_LABELS } from '../../lib/ml'
import { useLiveActiveAlerts, useLiveAlerts, useLiveCounts, useLiveMl } from '../../lib/liveData'
import { LEVEL_COLORS, SUPPRESSED, TEAL, AMBER, hexA } from '../../lib/colors'
import type { Alert, Criticality, RelevanceStatus, RiskLevel } from '../../lib/types'

const WEIGHT_ROWS = [
  { factor: 'Severity', weight: WEIGHTS.severity, detail: '(CVSS ÷ 10) × 25', tone: '#e5545a' },
  { factor: 'Exploitation', weight: WEIGHTS.epss, detail: 'EPSS × 100 × 0.25', tone: '#e08a2f' },
  { factor: 'Known exploited', weight: WEIGHTS.kev, detail: 'flat 10 when listed in KEV', tone: '#e6c229' },
  { factor: 'Asset criticality', weight: WEIGHTS.criticality, detail: 'HIGH 25 · MEDIUM 15 · LOW 5', tone: '#3ed2c1' },
  { factor: 'Exposure', weight: WEIGHTS.exposure, detail: 'flat 5 when internet-facing', tone: '#9b7bd4' },
  { factor: 'Relevance', weight: WEIGHTS.relevance, detail: 'MATCHED 10 · VERSION_UNKNOWN 5', tone: '#3fae74' },
]

export default function Scoring() {
  const theme = useTheme((s) => s.theme)
  const alerts = useLiveAlerts()
  const activeAlerts = useLiveActiveAlerts()
  const counts = useLiveCounts()
  const liveMl = useLiveMl()
  const base = alerts[0]
  const [selectedId, setSelectedId] = useState(base.id)
  const assetAlert = alerts.find((a) => a.id === selectedId) ?? base

  const [cvss, setCvss] = useState(assetAlert.cve.cvss ?? 0)
  const [epss, setEpss] = useState(assetAlert.cve.epss ?? 0)
  const [kev, setKev] = useState(assetAlert.cve.kev)
  const [criticality, setCriticality] = useState<Criticality>(assetAlert.asset.criticality)
  const [internetFacing, setInternetFacing] = useState(assetAlert.asset.internetFacing)
  const [relevance, setRelevance] = useState<RelevanceStatus>(assetAlert.relevance)

  useEffect(() => {
    setCvss(assetAlert.cve.cvss ?? 0)
    setEpss(assetAlert.cve.epss ?? 0)
    setKev(assetAlert.cve.kev)
    setCriticality(assetAlert.asset.criticality)
    setInternetFacing(assetAlert.asset.internetFacing)
    setRelevance(assetAlert.relevance)
  }, [assetAlert])

  const result = useMemo(
    () =>
      scoreAlert({
        cve: { ...assetAlert.cve, cvss, epss, kev },
        criticality,
        internetFacing,
        relevance,
      }),
    [assetAlert.cve, cvss, epss, kev, criticality, internetFacing, relevance],
  )

  const preview: Alert = {
    ...assetAlert,
    score: result.score,
    level: result.level,
    suppressed: result.suppressed,
    wouldHaveScored: result.wouldHaveScored,
    dataIncomplete: result.dataIncomplete,
    breakdown: result.breakdown,
  }

  const histogramOption = useMemo(() => {
    const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const data = bins.slice(0, -1).map((lo, i) => {
      const hi = bins[i + 1]
      return activeAlerts.filter((a) => a.score >= lo && (i === bins.length - 2 ? a.score <= hi : a.score < hi)).length
    })
    const ax = axisStyle(theme)
    return {
      grid: { left: 32, right: 12, top: 22, bottom: 26 },
      xAxis: {
        type: 'category',
        data: bins.slice(0, -1).map((b, i) => `${b}–${bins[i + 1]}`),
        ...ax,
        axisLabel: { ...ax.axisLabel, interval: 0, fontSize: 7.5 },
      },
      yAxis: { type: 'value', ...ax, minInterval: 1 },
      tooltip: { trigger: 'axis' },
      series: [
        {
          type: 'bar',
          data: data.map((v, i) => ({
            value: v,
            itemStyle: {
              color: [SUPPRESSED, SUPPRESSED, SUPPRESSED, SUPPRESSED, LEVEL_COLORS.MEDIUM, LEVEL_COLORS.MEDIUM, LEVEL_COLORS.HIGH, LEVEL_COLORS.HIGH, LEVEL_COLORS.CRITICAL, LEVEL_COLORS.CRITICAL][i],
              borderRadius: [3, 3, 0, 0],
              opacity: 0.85,
            },
          })),
          barWidth: '62%',
        },
      ],
    }
  }, [theme, activeAlerts])

  const scatterOption = useMemo(() => {
    const ax = axisStyle(theme)
    return {
      grid: { left: 36, right: 18, top: 30, bottom: 40 },
      xAxis: {
        type: 'value',
        min: 0,
        max: 10,
        name: 'CVSS base',
        ...ax,
        nameLocation: 'middle',
        nameGap: 24,
      },
      yAxis: { type: 'value', min: 0, max: 100, name: 'Risk score', ...ax, nameGap: 28 },
      tooltip: {
        formatter: (p: any) =>
          `${p.data[3]}<br/>CVSS ${p.data[0]} · score ${p.data[1]}<br/>EPSS ${(p.data[2] * 100).toFixed(1)}%`,
      },
      series: [
        {
          type: 'scatter',
          data: activeAlerts.map((a) => [
            a.cve.cvss ?? 0,
            a.score,
            a.cve.epss ?? 0,
            `${a.cve.id} · ${a.asset.name}`,
            a.level,
          ]),
          symbolSize: (val: any) => 7 + (val[2] ?? 0) * 26,
          itemStyle: {
            color: (p: any) => hexA(LEVEL_COLORS[p.data[4] as RiskLevel] ?? TEAL, 0.72),
            borderColor: 'rgba(5,8,14,0.55)',
            borderWidth: 1,
          },
          label: { show: false },
          emphasis: { scale: 1.35 },
        },
      ],
    }
  }, [theme, activeAlerts])

  const scores = activeAlerts.map((a) => a.score)
  const cvssRanked = [...activeAlerts].sort((a, b) => (b.cve.cvss ?? 0) - (a.cve.cvss ?? 0))
  const modelRanked = [...activeAlerts].sort((a, b) => b.score - a.score)
  const moved = modelRanked
    .map((a, i) => ({ a, model: i + 1, naive: cvssRanked.findIndex((x) => x.id === a.id) + 1 }))
    .filter((r) => r.model !== r.naive)
    .slice(0, 5)

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 03 · RISK SCORING"
        title="A formula you can audit"
        description="Move any input and watch the score recompute. The deterministic core owns the number; AI only writes the prose around it."
        actions={
          <span className="chip">
            <Sparkles size={12} /> formula v1.1
          </span>
        }
      />

      <div className="dash-grid">
        <Panel
          className="col-4"
          title="Score builder"
          sub="Recompute from any alert's real inputs"
          action={<SlidersHorizontal size={13} style={{ color: 'var(--text-mute)' }} />}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <div className="control-block">
              <label htmlFor="score-alert">Start from alert</label>
              <select
                id="score-alert"
                className="select"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {alerts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.cve.id} · {a.asset.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="control-block">
              <label htmlFor="range-cvss">
                CVSS base · {cvss.toFixed(1)}
                <span className="dim" style={{ float: 'right', textTransform: 'none', letterSpacing: 0 }}>
                  severity {(cvss / 10 * 25).toFixed(1)} pts
                </span>
              </label>
              <input
                id="range-cvss"
                className="range"
                type="range"
                min={0}
                max={10}
                step={0.1}
                value={cvss}
                onChange={(e) => setCvss(Number(e.target.value))}
              />
            </div>

            <div className="control-block">
              <label htmlFor="range-epss">
                EPSS · {fmtPct(epss)}
                <span className="dim" style={{ float: 'right', textTransform: 'none', letterSpacing: 0 }}>
                  exploitation {(epss * 25).toFixed(1)} pts
                </span>
              </label>
              <input
                id="range-epss"
                className="range"
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={epss}
                onChange={(e) => setEpss(Number(e.target.value))}
              />
            </div>

            <div className="control-block">
              <label htmlFor="score-criticality">Asset criticality</label>
              <select
                id="score-criticality"
                className="select"
                value={criticality}
                onChange={(e) => setCriticality(e.target.value as Criticality)}
              >
                <option value="HIGH">HIGH · 25 pts</option>
                <option value="MEDIUM">MEDIUM · 15 pts</option>
                <option value="LOW">LOW · 5 pts</option>
              </select>
            </div>

            <div className="control-block">
              <label htmlFor="score-relevance">Relevance status</label>
              <select
                id="score-relevance"
                className="select"
                value={relevance}
                onChange={(e) => setRelevance(e.target.value as RelevanceStatus)}
              >
                {(['MATCHED', 'VERSION_UNKNOWN', 'NOT_AFFECTED', 'PRODUCT_ABSENT'] as RelevanceStatus[]).map((r) => (
                  <option key={r} value={r}>
                    {relevanceLabel[r]}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                className="chip"
                onClick={() => setKev((v) => !v)}
                aria-pressed={kev}
                style={kev ? { color: 'var(--amber)', borderColor: 'rgba(227,164,85,.4)' } : { opacity: 0.6 }}
              >
                KEV listed {kev ? '+10' : '+0'}
              </button>
              <button
                className="chip"
                onClick={() => setInternetFacing((v) => !v)}
                aria-pressed={internetFacing}
                style={internetFacing ? { color: 'var(--teal)', borderColor: 'rgba(62,210,193,.4)' } : { opacity: 0.6 }}
              >
                Internet-facing {internetFacing ? '+5' : '+0'}
              </button>
            </div>

            {result.dataIncomplete && (
              <div className="form-alert" style={{ margin: 0 }}>
                <Info size={13} />
                <span>Incomplete data: a CVSS or EPSS value is missing. The UI keeps the gap visible.</span>
              </div>
            )}
          </div>
        </Panel>

        <Panel className="col-8" title="Live result" sub="All six factors, recomputed on every change" noPad>
          <div style={{ display: 'grid', gridTemplateColumns: '210px minmax(0,1fr)', gap: 12, padding: '16px 20px 20px', alignItems: 'center' }}>
            <div style={{ display: 'grid', justifyItems: 'center', gap: 8 }}>
              <RadialGauge
                value={result.score}
                size={176}
                stroke={7}
                color={result.suppressed ? SUPPRESSED : LEVEL_COLORS[result.level]}
                ticks={44}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, lineHeight: 1, letterSpacing: '-0.04em' }}>
                    {fmtScore(result.score)}
                  </div>
                  <div className="mono" style={{ marginTop: 5, fontSize: 8 }}>
                    {result.suppressed ? 'SUPPRESSED' : result.level}
                  </div>
                </div>
              </RadialGauge>
              <SeverityBadge level={result.level} suppressed={result.suppressed} />
              <div className="mono" style={{ fontSize: 8.5, textAlign: 'center' }}>
                {result.suppressed
                  ? `would have scored ${fmtScore(result.wouldHaveScored ?? 0)}`
                  : `raw ${result.breakdown.total_raw.toFixed(1)} → capped ${result.score.toFixed(1)}`}
              </div>
            </div>
            <div>
              <Waterfall alert={preview} />
            </div>
          </div>
          <div className="table-note" style={{ borderTop: '1px solid var(--line)' }}>
            <span className="inline-flex">
              <Info size={11} /> Level bands: CRITICAL ≥ 85 · HIGH ≥ 65 · MEDIUM ≥ 40 · LOW &lt; 40
            </span>
            <span className="mono">round(min(raw, 100), 1)</span>
          </div>
        </Panel>

        <Panel
          className="col-7"
          title="Factor reference"
          sub="Weights sum to 100 before the cap"
          noPad
        >
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Factor</th>
                  <th>Weight</th>
                  <th>Computation</th>
                  <th className="right">Share</th>
                </tr>
              </thead>
              <tbody>
                {WEIGHT_ROWS.map((r) => (
                  <tr key={r.factor}>
                    <td>
                      <span className="inline-flex">
                        <i style={{ width: 7, height: 7, borderRadius: 2, background: r.tone }} />
                        {r.factor}
                      </span>
                    </td>
                    <td className="mono">{r.weight}</td>
                    <td className="cell-sub">{r.detail}</td>
                    <td className="right mono">{(r.weight).toFixed(0)}%</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td className="mono">
                    <strong>100</strong>
                  </td>
                  <td className="cell-sub">cap at 100, round to one decimal</td>
                  <td className="right mono">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="table-note">
            <span className="mono">KEV floor raises MATCHED alerts to ≥ HIGH · HIGH criticality to CRITICAL</span>
          </div>
        </Panel>

        <Panel className="col-5" title="Threshold ladder" sub="Where the current score sits" bodyClass="panel-body">
          <div className="ladder">
            {[
              { level: 'CRITICAL', band: '≥ 85', color: LEVEL_COLORS.CRITICAL },
              { level: 'HIGH', band: '65 – 84.9', color: LEVEL_COLORS.HIGH },
              { level: 'MEDIUM', band: '40 – 64.9', color: LEVEL_COLORS.MEDIUM },
              { level: 'LOW', band: '< 40', color: LEVEL_COLORS.LOW },
            ].map((b) => {
              const active = levelFromScore(result.score) === b.level
              return (
                <div
                  className="ladder-row"
                  key={b.level}
                  style={{
                    borderColor: active ? b.color : 'var(--line)',
                    background: active ? hexA(b.color, 0.08) : 'transparent',
                  }}
                >
                  <span className="inline-flex">
                    <i style={{ width: 8, height: 8, borderRadius: '50%', background: b.color }} />
                    <strong style={{ fontSize: 11.5 }}>{b.level}</strong>
                  </span>
                  <span className="mono">{b.band}</span>
                  {active && <span className="badge" style={{ color: b.color, borderColor: b.color }}>current</span>}
                </div>
              )
            })}
          </div>
          <p className="dim" style={{ fontSize: 11.5, marginTop: 12 }}>
            KEV floors can raise the label above the band implied by the numeric score. That precedence is
            deliberate and tested.
          </p>
        </Panel>

        <Panel
          className="col-6"
          title="Score distribution"
          sub="Active demo alerts · 10-point bins"
          noPad
        >
          <Chart option={histogramOption} height={244} />
        </Panel>

        <Panel
          className="col-6"
          title="CVSS vs computed risk"
          sub="Bubble area = EPSS · ordering is not severity alone"
          noPad
        >
          <Chart option={scatterOption} height={244} />
        </Panel>

        <Panel
          className="col-12"
          title="XGBoost second opinion"
          sub={`${MODEL_CARD.dataset.rows.toLocaleString('en-US')} live rows · ${MODEL_CARD.rounds} trees · exported and scored in the browser`}
          action={<span className="badge real">trained · {MODEL_CARD.version}</span>}
          noPad
        >
          <div className="ml-model-grid">
            <div className="ml-model-left">
              <div className="ml-metric-grid">
                {[
                  { label: 'Test AUC', value: MODEL_CARD.test.auc.toFixed(3), note: 'held-out 18%' },
                  { label: 'CV AUC', value: MODEL_CARD.cv.auc.toFixed(3), note: `${MODEL_CARD.cv.folds}-fold` },
                  { label: 'Log loss', value: MODEL_CARD.test.logloss.toFixed(3), note: 'test' },
                  { label: 'Brier', value: MODEL_CARD.test.brier.toFixed(3), note: 'calibration' },
                  { label: 'Rounds', value: String(MODEL_CARD.rounds), note: `early stop ${MODEL_CARD.params.earlyStoppingRounds}` },
                  { label: 'Positive rate', value: `${MODEL_CARD.dataset.positiveRate.toFixed(2)}%`, note: 'KEV label' },
                ].map((m) => (
                  <div className="ml-metric" key={m.label}>
                    <span className="mono">{m.label}</span>
                    <strong>{m.value}</strong>
                    <small>{m.note}</small>
                  </div>
                ))}
              </div>

              <div className="ml-importance">
                <div className="ml-importance-head">
                  <span>Feature gain</span>
                  <span className="mono">share of total</span>
                </div>
                {topFeatureImportance.map((f) => (
                  <div className="ml-importance-row" key={f.feature}>
                    <span>{FEATURE_LABELS[f.feature] ?? f.feature}</span>
                    <span className="ml-importance-track" aria-hidden="true">
                      <i style={{ width: `${Math.max(2, f.share)}%` }} />
                    </span>
                    <small className="mono">{f.share.toFixed(1)}%</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="ml-model-right">
              <div className="ml-live-head">
                <span className="mono">Live predictions · active alerts</span>
                <span className="mono">
                  mean {(liveMl.portfolio.mean * 100).toFixed(0)}% · elevated {liveMl.portfolio.elevated}
                </span>
              </div>
              <div className="ml-live-list">
                {liveMl.active.slice(0, 6).map(({ alert, prediction }) => (
                  <div className="ml-live-row" key={alert.id}>
                    <div className="ml-live-id">
                      <span className="mono">{alert.cve.id}</span>
                      <small>{alert.asset.name}</small>
                    </div>
                    <span className="ml-live-track" aria-hidden="true">
                      <i
                        style={{
                          width: `${Math.max(2, prediction.probability * 100)}%`,
                          background: prediction.band === 'ELEVATED' ? LEVEL_COLORS.CRITICAL : prediction.band === 'WATCH' ? AMBER : TEAL,
                        }}
                      />
                    </span>
                    <span className={`ml-band ${prediction.band.toLowerCase()}`}>
                      {(prediction.probability * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
              <p className="dim ml-detail-note">
                {MODEL_CARD.disclaimer} Bands: ELEVATED ≥ {(ML_BANDS.elevated * 100).toFixed(1)}%, WATCH ≥{' '}
                {(ML_BANDS.watch * 100).toFixed(1)}%. The deterministic score still decides the queue; the model is
                a cross-check.
              </p>
            </div>
          </div>
          <div className="table-note">
            <span className="mono">train: python3 ml/train_live_xgb.py · export parity ≤ 1e-05 vs booster.predict</span>
            <span className="mono">Fitted on live NVD, EPSS and KEV · KEV label excluded</span>
          </div>
        </Panel>

        <Panel
          className="col-12"
          title="What the six-factor model reorders"
          sub="Largest rank moves between a CVSS-only queue and the six-factor score · not the XGBoost prior"
          noPad
        >
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Alert</th>
                  <th className="right">CVSS-only rank</th>
                  <th className="right">Model rank</th>
                  <th className="right">Movement</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {moved.map(({ a, model, naive }) => {
                  const delta = naive - model
                  return (
                    <tr key={a.id}>
                      <td>
                        <div className="cell-title">
                          {a.cve.id} <span className="dim">·</span> {a.asset.name}
                        </div>
                        <div className="cell-sub">{a.cve.title}</div>
                      </td>
                      <td className="right mono">#{naive}</td>
                      <td className="right mono">#{model}</td>
                      <td className="right">
                        <span className={`delta-chip ${delta > 0 ? 'good' : 'bad'}`}>
                          {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
                        </span>
                      </td>
                      <td className="cell-sub">
                        {a.asset.criticality === 'HIGH' ? 'critical asset' : 'asset context'}
                        {a.asset.internetFacing ? ' · internet-facing' : ' · internal'}
                        {a.cve.kev ? ' · KEV' : ''}
                        {a.relevance !== 'MATCHED' ? ` · ${relevanceLabel[a.relevance].toLowerCase()}` : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel className="col-12" title="Worked example · Log4Shell on the HR portal" sub="Unit-test fixture reproduced live" bodyClass="panel-body">
          <div className="example-grid">
            <div className="example-cell">
              <span className="mono">severity</span>
              <strong>25.0</strong>
              <small>CVSS 10.0 → (10 ÷ 10) × 25</small>
            </div>
            <div className="example-cell">
              <span className="mono">exploitation</span>
              <strong>24.4</strong>
              <small>EPSS 0.9755 × 25 = 24.3875</small>
            </div>
            <div className="example-cell">
              <span className="mono">KEV</span>
              <strong>10.0</strong>
              <small>listed in CISA KEV</small>
            </div>
            <div className="example-cell">
              <span className="mono">asset</span>
              <strong>25.0</strong>
              <small>criticality HIGH</small>
            </div>
            <div className="example-cell">
              <span className="mono">exposure</span>
              <strong>5.0</strong>
              <small>internet-facing</small>
            </div>
            <div className="example-cell">
              <span className="mono">relevance</span>
              <strong>10.0</strong>
              <small>version in range</small>
            </div>
            <div className="example-cell total">
              <span className="mono">total</span>
              <strong>99.4</strong>
              <small>CRITICAL · shown to one decimal</small>
            </div>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'Mean score', value: fmtScore(mean(scores)), formula: 'mean(score_i)', n: scores.length },
            { name: 'Median', value: fmtScore(quantile(scores, 0.5)), formula: '50th percentile', n: scores.length },
            { name: 'p95', value: fmtScore(quantile(scores, 0.95)), formula: '95th percentile, linear interpolation', n: scores.length },
            { name: 'Dispersion', value: `σ ${fmtScore(stdev(scores))}`, formula: 'sample standard deviation', n: scores.length },
            {
              name: 'Suppressed candidates',
              value: String(counts.suppressed),
              formula: `of ${counts.total} candidates · excluded from these n`,
              n: counts.total,
            },
          ]}
        />
      </div>
    </div>
  )
}
