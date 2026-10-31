import { useMemo, useState } from 'react'
import { Chart, axisStyle } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { RadialGauge } from '../../components/RadialGauge'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge, SimulatedBadge } from '../../components/Badges'
import { FlaskConical, RefreshCw, ShieldCheck, Sparkles } from '../../components/Icons'
import { assets, DEMO_NOW } from '../../data/seed'
import { useLiveActiveAlerts, useLivePosture } from '../../lib/liveData'
import { useTheme } from '../../lib/store'
import { fmtScore } from '../../lib/format'
import { mean } from '../../lib/stats'
import { scoreAlert } from '../../lib/scoring'
import { LEVEL_COLORS, TEAL, hexA } from '../../lib/colors'
import type { Criticality } from '../../lib/types'

export default function Simulator() {
  const theme = useTheme((s) => s.theme)
  const activeAlerts = useLiveActiveAlerts()
  const posture = useLivePosture()
  const [assetId, setAssetId] = useState('AST-HR-01')
  const [patched, setPatched] = useState(false)
  const [exposed, setExposed] = useState<boolean | null>(null)
  const [criticality, setCriticality] = useState<Criticality | 'baseline'>('baseline')

  const asset = assets.find((a) => a.id === assetId) ?? assets[0]
  const beforeExposed = asset.internetFacing
  const beforeCrit = asset.criticality
  const effectiveExposed = exposed ?? beforeExposed
  const effectiveCrit = criticality === 'baseline' ? beforeCrit : criticality

  const scenario = useMemo(
    () =>
      activeAlerts.map((a) => {
        if (a.asset.id !== asset.id)
          return {
            alert: a,
            before: a.score,
            after: a.score,
            levelBefore: a.level,
            levelAfter: a.level,
            suppressedAfter: false,
            wouldHave: undefined as number | undefined,
          }
        const next = scoreAlert({
          cve: a.cve,
          criticality: effectiveCrit,
          internetFacing: effectiveExposed,
          relevance: patched ? 'NOT_AFFECTED' : a.relevance,
        })
        return {
          alert: a,
          before: a.score,
          after: next.score,
          levelBefore: a.level,
          levelAfter: next.level,
          suppressedAfter: next.suppressed,
          wouldHave: next.wouldHaveScored,
        }
      }),
    [asset.id, patched, effectiveExposed, effectiveCrit, activeAlerts],
  )

  const afterCounts = {
    critical: scenario.filter((s) => !s.suppressedAfter && s.levelAfter === 'CRITICAL').length,
    high: scenario.filter((s) => !s.suppressedAfter && s.levelAfter === 'HIGH').length,
  }
  const afterPosture = Math.max(0, 100 - 15 * afterCounts.critical - 6 * afterCounts.high)
  const assetRows = scenario.filter((s) => s.alert.asset.id === asset.id)
  const assetBefore = assetRows.reduce((a, b) => a + b.before, 0)
  const assetAfter = assetRows.reduce((a, b) => a + b.after, 0)

  const compareOption = useMemo(() => {
    const ax = axisStyle(theme)
    const rows = [...scenario].sort((a, b) => b.before - a.before).slice(0, 8)
    return {
      grid: { left: 36, right: 16, top: 30, bottom: 56 },
      xAxis: {
        type: 'category',
        data: rows.map((r) => r.alert.cve.id.replace('CVE-', '')),
        ...ax,
        axisLabel: { ...ax.axisLabel, rotate: 32, fontSize: 7.5, interval: 0 },
      },
      yAxis: { type: 'value', min: 0, max: 100, ...ax },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      series: [
        {
          name: 'Baseline',
          type: 'bar',
          barWidth: '30%',
          data: rows.map((r) => ({
            value: r.before,
            itemStyle: { color: hexA(TEAL, 0.42), borderRadius: [3, 3, 0, 0] },
          })),
        },
        {
          name: 'Scenario',
          type: 'bar',
          barWidth: '30%',
          data: rows.map((r) => ({
            value: r.after,
            itemStyle: {
              color: r.after === r.before ? hexA(TEAL, 0.3) : r.after < r.before ? hexA('#3fae74', 0.78) : hexA('#e5545a', 0.78),
              borderRadius: [3, 3, 0, 0],
            },
          })),
        },
      ],
    }
  }, [scenario, theme])

  const reset = () => {
    setPatched(false)
    setExposed(null)
    setCriticality('baseline')
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 10 · WHAT-IF SIMULATOR"
        title="Change one thing, watch the queue"
        description="Patch, expose, or reclassify an asset in a scenario overlay. Stored alerts never move; only this computed view does."
        actions={
          <>
            <button className="btn btn-ghost btn-sm" onClick={reset}>
              <RefreshCw size={13} /> Reset scenario
            </button>
            <span className="chip">
              <SimulatedBadge /> scenario overlay
            </span>
          </>
        }
      />

      <div className="sim-grid">
        <div className="sim-controls">
          <Panel title="Scenario controls" sub="Deterministic recomputation from the base seed" noPad>
            <div style={{ padding: '14px 16px', display: 'grid', gap: 12 }}>
              <div className="control-block">
                <label htmlFor="sim-asset">Target asset</label>
                <select id="sim-asset" className="select" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.criticality}
                    </option>
                  ))}
                </select>
              </div>

              <div className="control-block">
                <label htmlFor="sim-crit">Criticality override</label>
                <select
                  id="sim-crit"
                  className="select"
                  value={criticality}
                  onChange={(e) => setCriticality(e.target.value as Criticality | 'baseline')}
                >
                  <option value="baseline">Baseline · {beforeCrit}</option>
                  <option value="HIGH">HIGH · 25 pts</option>
                  <option value="MEDIUM">MEDIUM · 15 pts</option>
                  <option value="LOW">LOW · 5 pts</option>
                </select>
              </div>

              <div className="control-block" style={{ display: 'grid', gap: 12 }}>
                <div className="inline-flex" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12 }}>Patch to fixed version</span>
                  <button className={`switch${patched ? ' on' : ''}`} onClick={() => setPatched((v) => !v)} aria-label="Toggle patch" aria-pressed={patched} />
                </div>
                <div className="inline-flex" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12 }}>Internet-facing</span>
                  <button
                    className={`switch${effectiveExposed ? ' on' : ''}`}
                    onClick={() => setExposed(effectiveExposed ? false : true)}
                    aria-label="Toggle internet exposure"
                    aria-pressed={effectiveExposed}
                  />
                </div>
                <p className="dim" style={{ fontSize: 10.5 }}>
                  {patched
                    ? 'The relevance gate becomes NOT_AFFECTED and the score is zeroed, with the would-have-scored value retained.'
                    : 'Patch is off: relevance stays as stored.'}
                </p>
              </div>

              <div className="action-box" style={{ borderColor: 'rgba(155,123,212,.28)' }}>
                <div className="inline-flex">
                  <FlaskConical size={13} style={{ color: 'var(--simulated)' }} />
                  <strong style={{ fontSize: 11.5 }}>Overlay only</strong>
                </div>
                <p style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 5 }}>
                  Base alerts and their acknowledgements are untouched. Reset removes every override.
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Posture · before / after" sub="Index = 100 − (15 × critical + 6 × high)" noPad>
            <div className="gauge-pair" style={{ padding: '12px 14px 16px' }}>
              <div style={{ display: 'grid', justifyItems: 'center', gap: 4 }}>
                <RadialGauge value={posture} size={142} stroke={6} color="#e5545a" ticks={34}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 25, lineHeight: 1 }}>{posture}</div>
                    <div className="mono" style={{ fontSize: 7.5, marginTop: 3 }}>BASELINE</div>
                  </div>
                </RadialGauge>
                <span className="mono" style={{ fontSize: 8 }}>critical {activeAlerts.filter((a) => a.level === 'CRITICAL').length} · high {activeAlerts.filter((a) => a.level === 'HIGH').length}</span>
              </div>
              <div style={{ display: 'grid', justifyItems: 'center', gap: 4 }}>
                <RadialGauge value={afterPosture} size={142} stroke={6} color={afterPosture >= posture ? '#3fae74' : '#e5545a'} ticks={34}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 25, lineHeight: 1 }}>{afterPosture}</div>
                    <div className="mono" style={{ fontSize: 7.5, marginTop: 3 }}>SCENARIO</div>
                  </div>
                </RadialGauge>
                <span className="mono" style={{ fontSize: 8 }}>critical {afterCounts.critical} · high {afterCounts.high}</span>
              </div>
            </div>
            <div style={{ padding: '0 16px 16px' }}>
              <span className={`delta-chip ${afterPosture >= posture ? 'good' : 'bad'}`} style={{ width: '100%', justifyContent: 'center' }}>
                {afterPosture >= posture ? '▲' : '▼'} {Math.abs(afterPosture - posture)} posture points
              </span>
            </div>
          </Panel>
        </div>

        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginBottom: 0 }}>
            <div className="kpi">
              <div className="kpi-label">Affected alerts</div>
              <div className="kpi-value">{assetRows.length}</div>
              <div className="kpi-delta">{asset.name}</div>
            </div>
            <div className={`kpi ${assetAfter < assetBefore ? 'teal-tone' : assetAfter > assetBefore ? 'critical-tone' : ''}`}>
              <div className="kpi-label">Sum of scores</div>
              <div className="kpi-value">{fmtScore(assetAfter)}</div>
              <div className="kpi-delta">
                baseline {fmtScore(assetBefore)} · Δ {assetAfter - assetBefore >= 0 ? '+' : ''}
                {fmtScore(assetAfter - assetBefore)}
              </div>
            </div>
            <div className="kpi amber-tone">
              <div className="kpi-label">Relevance after</div>
              <div className="kpi-value" style={{ fontSize: 20, lineHeight: 1.15 }}>
                {patched ? 'NOT AFFECTED' : assetRows[0]?.alert.relevance ?? 'MATCHED'}
              </div>
              <div className="kpi-delta">{patched ? 'patched in scenario' : 'unchanged gate'}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Mean active score</div>
              <div className="kpi-value">{fmtScore(mean(activeAlerts.map((a) => a.score)))}</div>
              <div className="kpi-delta">baseline active set</div>
            </div>
          </div>

          <Panel title="Before vs scenario · top scores" sub="Green bar = score reduced by the scenario · red = increased" noPad>
            <Chart option={compareOption} height={286} />
            <div className="chart-legend">
              <span className="legend-item">
                <i style={{ background: 'rgba(62,210,193,.5)' }} /> baseline
              </span>
              <span className="legend-item">
                <i style={{ background: '#3fae74' }} /> reduced
              </span>
              <span className="legend-item">
                <i style={{ background: '#e5545a' }} /> increased
              </span>
            </div>
          </Panel>

          <Panel
            title={`Alerts on ${asset.name}`}
            sub="Every row recomputed independently with the scenario overrides"
            action={<span className="badge simulated">what-if</span>}
            noPad
          >
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>CVE</th>
                    <th>Baseline</th>
                    <th>Scenario</th>
                    <th className="right">Δ</th>
                    <th>Level after</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {assetRows.map((r) => {
                    const delta = r.after - r.before
                    return (
                      <tr key={r.alert.id}>
                        <td className="mono">{r.alert.cve.id}</td>
                        <td>
                          <span className={`score-cell ${r.levelBefore.toLowerCase()}`} style={{ fontSize: 15 }}>
                            {fmtScore(r.before)}
                          </span>
                        </td>
                        <td>
                          <span className={`score-cell ${r.levelAfter.toLowerCase()}`} style={{ fontSize: 15, opacity: 0.9 }}>
                            {fmtScore(r.after)}
                          </span>
                        </td>
                        <td className="right">
                          <span className={`delta-chip ${delta < 0 ? 'good' : delta > 0 ? 'bad' : ''}`}>
                            {delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${fmtScore(delta)}`}
                          </span>
                        </td>
                        <td>
                          <SeverityBadge level={r.levelAfter} suppressed={r.suppressedAfter} />
                        </td>
                        <td className="cell-sub">
                          {patched
                            ? `relevance gate → NOT_AFFECTED${r.wouldHave != null ? ` · would have scored ${fmtScore(r.wouldHave)}` : ''}`
                            : `${effectiveCrit} criticality · ${effectiveExposed ? 'internet' : 'internal'}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="table-note">
              <span className="inline-flex">
                <ShieldCheck size={11} /> No write occurs. Base data remains exactly as seeded.
              </span>
              <span className="mono">scenario clock {DEMO_NOW.toISOString().slice(11, 16)}Z</span>
            </div>
          </Panel>

          <StatsPanel
            stats={[
              { name: 'Posture delta', value: `${afterPosture - posture >= 0 ? '+' : ''}${afterPosture - posture}`, formula: 'scenario index − baseline index', n: activeAlerts.length },
              { name: 'Score delta · asset', value: `${assetAfter - assetBefore >= 0 ? '+' : ''}${fmtScore(assetAfter - assetBefore)}`, formula: 'Σ scenario − Σ baseline on target asset', n: assetRows.length },
              { name: 'Suppressed by patch', value: String(assetRows.filter((r) => r.suppressedAfter).length), formula: 'rows where relevance gate fires', n: assetRows.length },
              { name: 'Critical alerts', value: `${afterCounts.critical} vs ${activeAlerts.filter((a) => a.level === 'CRITICAL').length}`, formula: 'scenario vs baseline', n: activeAlerts.length },
              { name: 'Asset exposure', value: effectiveExposed ? 'internet-facing' : 'internal', formula: 'exposure_points 5 when true', n: 1 },
            ]}
          />
        </div>
      </div>

      <div className="page-foot">
        <span className="inline-flex">
          <Sparkles size={11} /> Scenario values are computed, never persisted. All inputs trace to the seeded demo.
        </span>
        <span className="mono">formula v1.1 · deterministic</span>
      </div>
    </div>
  )
}
