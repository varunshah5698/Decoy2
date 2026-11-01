import { useMemo, useState } from 'react'
import { Chart, axisStyle } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { StatsPanel } from '../../components/StatsPanel'
import { SourceBadge } from '../../components/Badges'
import { Activity, AlertTriangle, Info, ShieldCheck } from '../../components/Icons'
import { useEstate } from '../../lib/estate'
import { useTheme } from '../../lib/store'
import { fmtInt, fmtScore } from '../../lib/format'
import { mean, median, quantile, stdev } from '../../lib/stats'
import { AMBER, LEVEL_COLORS, TEAL, hexA } from '../../lib/colors'
import type { LogWindow } from '../../lib/types'

const THRESHOLD = 0.2

export default function Anomalies() {
  const theme = useTheme((s) => s.theme)
  const estate = useEstate()
  const anomalyWindows = estate.anomalyWindows
  const fromUploads = estate.coverage.hasEvents
  const [selected, setSelected] = useState<LogWindow | null>(null)
  const [onlyAnomalies, setOnlyAnomalies] = useState(false)

  const rows = anomalyWindows.filter((w) => (onlyAnomalies ? w.anomaly : true))
  const anomalies = anomalyWindows.filter((w) => w.anomaly)
  const scores = anomalyWindows.map((w) => w.anomalyScore)
  const peakWindow = [...anomalies].sort((a, b) => b.anomalyScore - a.anomalyScore)[0]

  const scatterOption = useMemo(() => {
    const ax = axisStyle(theme)
    return {
      grid: { left: 40, right: 20, top: 28, bottom: 40 },
      xAxis: {
        type: 'value',
        name: 'Failed logins per window',
        nameLocation: 'middle',
        nameGap: 24,
        ...ax,
      },
      yAxis: {
        type: 'value',
        name: 'Anomaly score',
        nameGap: 30,
        min: -0.3,
        max: 0.6,
        ...ax,
      },
      tooltip: {
        formatter: (p: any) => {
          const w = anomalyWindows[p.data[4]]
          return `<strong>${w.label}</strong><br/>score ${fmtScore(w.anomalyScore)} · ${w.failedLogins} failures<br/>${w.distinctIps} IPs · ${w.rps} RPS`
        },
      },
      series: [
        {
          type: 'scatter',
          data: anomalyWindows.map((w, i) => [w.failedLogins, w.anomalyScore, w.rps, w.anomaly, i]),
          symbolSize: (v: any) => 8 + v[2] * 0.25,
          itemStyle: {
            color: (p: any) => (p.data[3] ? hexA(LEVEL_COLORS.CRITICAL, 0.85) : hexA(TEAL, 0.5)),
            borderColor: 'rgba(5,8,14,0.5)',
            borderWidth: 1,
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: hexA(AMBER, 0.6), type: 'dashed', width: 1 },
            label: {
              formatter: `threshold ${THRESHOLD}`,
              color: '#e3a455',
              fontSize: 8,
              fontFamily: 'monospace',
              position: 'insideEndTop',
            },
            data: [{ yAxis: THRESHOLD }],
          },
        },
      ],
    }
  }, [theme, anomalyWindows])

  const barOption = useMemo(() => {
    const ax = axisStyle(theme)
    return {
      grid: { left: 34, right: 12, top: 18, bottom: 44 },
      xAxis: {
        type: 'category',
        data: anomalyWindows.map((w) => w.label),
        ...ax,
        axisLabel: { ...ax.axisLabel, rotate: 48, fontSize: 7, interval: 0 },
      },
      yAxis: { type: 'value', min: -0.3, max: 0.6, ...ax },
      tooltip: {
        trigger: 'axis',
        formatter: (p: any) => `${p[0].name}<br/>score ${fmtScore(p[0].value)}`,
      },
      series: [
        {
          type: 'bar',
          barWidth: '58%',
          data: anomalyWindows.map((w) => ({
            value: w.anomalyScore,
            itemStyle: {
              color: w.anomaly ? hexA(LEVEL_COLORS.CRITICAL, 0.8) : hexA(TEAL, 0.42),
              borderRadius: w.anomalyScore >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2],
            },
          })),
        },
      ],
    }
  }, [theme, anomalyWindows])

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 09 · ANOMALY DETECTION"
        title="Behaviour that breaks the baseline"
        description="Auth logs are reduced to windows, features are compared with the baseline, and only deviations above the threshold are surfaced with their evidence."
        actions={
          <div className="inline-flex">
            <SourceBadge source={fromUploads ? 'USER UPLOAD' : 'SIMULATED'} />
            <span className="mono" style={{ fontSize: 9 }}>{fromUploads ? `${fmtInt(estate.coverage.events)} accepted rows` : 'seeded demo windows'}</span>
          </div>
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="kpi">
          <div className="kpi-label">Windows analysed</div>
          <div className="kpi-value">{anomalyWindows.length}</div>
          <div className="kpi-delta">6-hour buckets · {fromUploads ? 'accepted logs' : 'demo week'}</div>
        </div>
        <div className="kpi critical-tone">
          <div className="kpi-label">Anomalies flagged</div>
          <div className="kpi-value">{anomalies.length}</div>
          <div className="kpi-delta up">{((anomalies.length / anomalyWindows.length) * 100).toFixed(0)}% of windows</div>
        </div>
        <div className="kpi amber-tone">
          <div className="kpi-label">Peak score</div>
          <div className="kpi-value">{fmtScore(Math.max(...scores))}</div>
          <div className="kpi-delta">{peakWindow?.label ?? 'no window crosses the threshold'}</div>
        </div>
        <div className="kpi teal-tone">
          <div className="kpi-label">Baseline failure rate</div>
          <div className="kpi-value">
            {median(anomalyWindows.filter((w) => !w.anomaly).map((w) => w.failedLogins)).toFixed(0)}
            <small>per window</small>
          </div>
          <div className="kpi-delta">median of normal windows</div>
        </div>
      </div>

      <div className="dash-grid">
        <Panel className="col-7" title="Feature space" sub="Failed logins vs anomaly score · bubble size = requests per second" noPad>
          <Chart option={scatterOption} height={330} />
          <div className="chart-legend">
            <span className="legend-item">
              <i style={{ background: LEVEL_COLORS.CRITICAL }} /> flagged window
            </span>
            <span className="legend-item">
              <i style={{ background: TEAL }} /> within baseline
            </span>
            <span className="legend-item dim">Threshold is fixed at 0.2 for this demo.</span>
          </div>
        </Panel>

        <Panel
          className="col-5"
          title="Method"
          sub="What the score is, and what it is not"
          action={<Activity size={14} style={{ color: 'var(--text-mute)' }} />}
          bodyClass="panel-body"
        >
          <ol style={{ display: 'grid', gap: 12, counterReset: 'step' }}>
            {[
              ['Reduce logs', 'Group events into six-hour windows per destination asset.'],
              ['Build features', 'Failed logins, distinct source IPs, request rate, and country novelty.'],
              ['Score isolation', fromUploads
                ? 'Features are z-scored against the accepted window set — the same shape an IsolationForest consumes, computed in-browser with no live model call.'
                : 'The demo ships precomputed scores aligned with an IsolationForest run; no live model call is made.'],
              ['Apply threshold', 'A fixed 0.2 cut keeps the demo deterministic and auditable.'],
            ].map(([title, body], i) => (
              <li key={title} style={{ display: 'flex', gap: 12 }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    border: '1px solid var(--line-strong)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 8.5,
                    color: 'var(--amber)',
                  }}
                >
                  {i + 1}
                </span>
                <span>
                  <strong style={{ fontSize: 12 }}>{title}</strong>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-dim)', marginTop: 3 }}>{body}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="form-alert" style={{ margin: '16px 0 0' }}>
            <Info size={13} />
            <span>
              {fromUploads
                ? `Scores are derived from ${fmtInt(estate.coverage.events)} accepted log rows using the published feature weights. They are a transparent heuristic, not a trained-model claim.`
                : 'These window-level scores are demonstration data, not a claim that a model detected these events in a live environment. Accept a log dataset to compute them from your own rows.'}
            </span>
          </div>
        </Panel>

        <Panel className="col-12" title="Anomaly score by window" sub="Red bars cross the fixed threshold; negative values sit inside the baseline" noPad>
          <Chart option={barOption} height={260} />
        </Panel>

        <Panel
          className="col-12"
          title="Window register"
          sub={`${rows.length} windows · ${anomalies.length} flagged · evidence recorded per window`}
          action={
            <button
              className="chip"
              onClick={() => setOnlyAnomalies((v) => !v)}
              aria-pressed={onlyAnomalies}
              style={onlyAnomalies ? { color: 'var(--critical)', borderColor: 'rgba(229,84,90,.35)' } : undefined}
            >
              <AlertTriangle size={12} /> {onlyAnomalies ? 'Showing anomalies' : 'Show anomalies only'}
            </button>
          }
          noPad
        >
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Window</th>
                  <th className="right">Failed logins</th>
                  <th className="right">Distinct IPs</th>
                  <th className="right">RPS</th>
                  <th className="right">Country novelty</th>
                  <th className="right">Score</th>
                  <th>Finding</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="clickable" onClick={() => setSelected(w)}>
                    <td className="mono">{w.label}</td>
                    <td className="right mono">{w.failedLogins}</td>
                    <td className="right mono">{w.distinctIps}</td>
                    <td className="right mono">{w.rps}</td>
                    <td className="right mono">{w.countryNovelty}</td>
                    <td className="right">
                      <span className={w.anomaly ? 'score-cell critical' : 'score-cell low'} style={{ fontSize: 16 }}>
                        {fmtScore(w.anomalyScore)}
                      </span>
                    </td>
                    <td>
                      {w.anomaly ? (
                        <span className="badge critical">{w.reason}</span>
                      ) : (
                        <span className="mono dim" style={{ fontSize: 9 }}>within baseline</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-note">
            <span className="inline-flex">
              <ShieldCheck size={11} /> Missing optional log fields are tolerated; missing timestamp or event type rejects the row.
            </span>
            <span className="mono">n={rows.length}</span>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'Mean score', value: fmtScore(mean(scores)), formula: 'mean(score_i)', n: scores.length },
            { name: 'Median score', value: fmtScore(median(scores)), formula: 'median', n: scores.length },
            { name: '95th percentile', value: fmtScore(quantile(scores, 0.95)), formula: 'linear-interpolated p95', n: scores.length },
            { name: 'Score dispersion', value: `σ ${fmtScore(stdev(scores))}`, formula: 'sample standard deviation', n: scores.length },
            { name: 'Flag rate', value: `${((anomalies.length / anomalyWindows.length) * 100).toFixed(1)}%`, formula: `windows above ${THRESHOLD} ÷ all windows`, n: anomalyWindows.length },
          ]}
        />
      </div>

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} label="Anomaly window">
        {selected && (
          <>
            <DrawerHead
              overline={`${selected.id} · ${selected.anomaly ? 'FLAGGED' : 'WITHIN BASELINE'}`}
              title={selected.label}
              onClose={() => setSelected(null)}
              meta={
                <span className="inline-flex" style={{ gap: 8 }}>
                  <SourceBadge source={fromUploads ? 'USER UPLOAD' : 'SIMULATED'} />
                  <span className={`badge ${fromUploads ? 'real' : 'simulated'}`}>{fromUploads ? 'derived window' : 'demo window'}</span>
                </span>
              }
            />
            <div className="drawer-body">
              <div className="drawer-section">
                <p style={{ fontSize: 13, color: 'var(--text)' }}>
                  {selected.anomaly
                    ? selected.reason
                    : 'This window sits inside the learned baseline. No alert was raised.'}
                </p>
              </div>
              <div className="drawer-section">
                <h3>Features</h3>
                <div className="provenance-list">
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Failed logins</span>
                    <span className="time">{selected.failedLogins}</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Distinct source IPs</span>
                    <span className="time">{selected.distinctIps}</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Requests per second</span>
                    <span className="time">{selected.rps}</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Country novelty</span>
                    <span className="time">{selected.countryNovelty} new</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Isolation score</span>
                    <span className="time">{fmtScore(selected.anomalyScore)}</span>
                  </div>
                </div>
              </div>
              <div className="drawer-section">
                <h3>Suggested next step</h3>
                <div className="action-box">
                  <strong style={{ fontSize: 12 }}>
                    {selected.anomaly
                      ? selected.reason?.toLowerCase().includes('country')
                        ? 'Verify the user, revoke sessions, and challenge the sign-in from the new region.'
                        : selected.reason?.toLowerCase().includes('credential')
                          ? 'Rate-limit the login surface and force step-up authentication.'
                          : 'Correlate source IPs with the firewall log and confirm whether the burst was authorised.'
                      : 'No action. Keep this window as part of the baseline.'}
                  </strong>
                </div>
              </div>
            </div>
          </>
        )}
      </Drawer>
    </div>
  )
}
