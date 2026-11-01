import { useMemo } from 'react'
import { Chart, axisStyle } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { StatsPanel } from '../../components/StatsPanel'
import { SourceBadge } from '../../components/Badges'
import { Activity, BarChart3, Info, TrendingUp, Zap } from '../../components/Icons'
import { useEstate } from '../../lib/estate'
import { useTheme } from '../../lib/store'
import { fmtInt } from '../../lib/format'
import { mean, p95, stdev } from '../../lib/stats'
import { TEAL, hexA } from '../../lib/colors'

export default function Traffic() {
  const theme = useTheme((s) => s.theme)
  const estate = useEstate()
  const trafficSeries = estate.trafficSeries
  const rps = trafficSeries.map((t) => t.rps)
  const avg = mean(rps)
  const sigma = stdev(rps)
  const threshold = avg + 2 * sigma
  const peak = Math.max(...rps)
  const bursts = trafficSeries.filter((t) => t.anomaly)
  const bytes = trafficSeries.map((t) => t.bytes)

  const zRows = trafficSeries
    .map((t) => ({ ...t, z: (t.rps - avg) / sigma }))
    .filter((t) => t.z >= 2)
    .sort((a, b) => b.z - a.z)

  const burstBands = useMemo(() => {
    const bands: { xAxis: string }[][] = []
    let start: string | null = null
    let end: string | null = null
    for (const t of trafficSeries) {
      if (t.anomaly) {
        start = start ?? t.time
        end = t.time
      } else if (start && end) {
        bands.push([{ xAxis: start }, { xAxis: end }])
        start = null
        end = null
      }
    }
    if (start && end) bands.push([{ xAxis: start }, { xAxis: end }])
    return bands
  }, [trafficSeries])

  const zBins = useMemo(() => {
    const bins = [-3, -2, -1, 0, 1, 2, 3, 4]
    return bins.slice(0, -1).map((lo, i) => ({
      label: `${lo}–${bins[i + 1]}σ`,
      value: trafficSeries.filter((t) => {
        const z = (t.rps - avg) / sigma
        return z >= lo && z < bins[i + 1]
      }).length,
    }))
  }, [avg, sigma, trafficSeries])

  const zHistOption = useMemo(() => {
    const ax = axisStyle(theme)
    return {
      grid: { left: 32, right: 12, top: 18, bottom: 26 },
      xAxis: { type: 'category', data: zBins.map((b) => b.label), ...ax, axisLabel: { ...ax.axisLabel, fontSize: 8, interval: 0 } },
      yAxis: { type: 'value', ...ax, minInterval: 1 },
      tooltip: { trigger: 'axis' },
      series: [
        {
          type: 'bar',
          barWidth: '58%',
          data: zBins.map((b, i) => ({
            value: b.value,
            itemStyle: {
              color: i >= 5 ? hexA('#e5545a', 0.85) : i >= 4 ? hexA('#e08a2f', 0.7) : hexA(TEAL, 0.4),
              borderRadius: [3, 3, 0, 0],
            },
          })),
        },
      ],
    }
  }, [theme, zBins])

  const rpsOption = useMemo(() => {
    const ax = axisStyle(theme)
    return {
      grid: { left: 40, right: 20, top: 28, bottom: 28 },
      xAxis: {
        type: 'category',
        data: trafficSeries.map((t) => t.time),
        ...ax,
        boundaryGap: false,
        axisLabel: { ...ax.axisLabel, interval: 5 },
      },
      yAxis: { type: 'value', name: 'req/s', ...ax, nameGap: 26 },
      tooltip: {
        trigger: 'axis',
        formatter: (p: any[]) => {
          const idx = p[0]?.dataIndex ?? 0
          const t = trafficSeries[idx]
          return `${t.time}<br/>${t.rps} req/s · ${fmtInt(t.bytes)} bytes<br/>${t.failed} auth failures${t.anomaly ? '<br/><strong>burst window</strong>' : ''}`
        },
      },
      series: [
        {
          type: 'line',
          smooth: 0.3,
          symbol: 'none',
          data: rps,
          lineStyle: { color: TEAL, width: 1.7 },
          itemStyle: { color: TEAL },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: hexA(TEAL, 0.25) },
                { offset: 1, color: hexA(TEAL, 0) },
              ],
            },
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: hexA('#e3a455', 0.7), type: 'dashed' },
            label: { formatter: `μ+2σ = ${threshold.toFixed(0)}`, color: '#e3a455', fontSize: 8, fontFamily: 'monospace' },
            data: [{ yAxis: threshold }],
          },
          markArea: {
            silent: true,
            itemStyle: { color: hexA('#e5545a', 0.07) },
            data: burstBands,
          },
        },
      ],
    }
  }, [theme, threshold, trafficSeries, rps, burstBands])

  const bytesOption = useMemo(() => {
    const ax = axisStyle(theme)
    return {
      grid: { left: 42, right: 16, top: 18, bottom: 28 },
      xAxis: { type: 'category', data: trafficSeries.map((t) => t.time), ...ax, axisLabel: { ...ax.axisLabel, interval: 7, fontSize: 7.5 } },
      yAxis: { type: 'value', ...ax, axisLabel: { ...ax.axisLabel, formatter: (v: number) => `${Math.round(v / 1e6)}M` } },
      tooltip: { trigger: 'axis', formatter: (p: any) => `${p[0].name}<br/>${fmtInt(p[0].value)} bytes` },
      series: [
        {
          type: 'bar',
          barWidth: '64%',
          data: trafficSeries.map((t) => ({
            value: t.bytes,
            itemStyle: { color: t.anomaly ? hexA('#e5545a', 0.65) : hexA(TEAL, 0.28) },
          })),
        },
      ],
    }
  }, [theme, trafficSeries])

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 15 · TRAFFIC ANALYTICS"
        title="Volume, bursts, and the tail"
        description={`${trafficSeries.length} buckets of edge traffic across the current window. Bursts are detected with a simple μ+2σ rule — a transparent baseline, not a black box.`}
        actions={
          <div className="inline-flex">
            <SourceBadge source={estate.coverage.hasEvents ? 'USER UPLOAD' : 'SIMULATED'} />
            <span className="mono" style={{ fontSize: 9 }}>
              {estate.coverage.hasEvents ? `${fmtInt(estate.coverage.events)} accepted rows` : 'seeded edge log · demo'}
            </span>
          </div>
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
        <div className="kpi teal-tone">
          <div className="kpi-label">Mean throughput</div>
          <div className="kpi-value">
            {avg.toFixed(0)}
            <small>req/s</small>
          </div>
          <div className="kpi-delta">{trafficSeries.length} buckets</div>
        </div>
        <div className="kpi critical-tone">
          <div className="kpi-label">Peak</div>
          <div className="kpi-value">
            {fmtInt(peak)}
            <small>req/s</small>
          </div>
          <div className="kpi-delta up">{((peak / avg - 1) * 100).toFixed(0)}% above mean</div>
        </div>
        <div className="kpi high-tone">
          <div className="kpi-label">Burst windows</div>
          <div className="kpi-value">{bursts.length}</div>
          <div className="kpi-delta">flagged by μ+2σ</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Auth failures</div>
          <div className="kpi-value">{fmtInt(trafficSeries.reduce((a, b) => a + b.failed, 0))}</div>
          <div className="kpi-delta">across the window</div>
        </div>
        <div className="kpi amber-tone">
          <div className="kpi-label">Bytes served</div>
          <div className="kpi-value" style={{ fontSize: 24 }}>
            {(bytes.reduce((a, b) => a + b, 0) / 1e9).toFixed(2)}
            <small>GB</small>
          </div>
          <div className="kpi-delta">sum of buckets</div>
        </div>
      </div>

      <div className="dash-grid">
        <Panel
          className="col-8"
          title="Requests per second"
          sub="Shaded bands are detected bursts · dashed line is μ+2σ"
          action={<span className="mono">n={trafficSeries.length}</span>}
          noPad
        >
          <Chart option={rpsOption} height={330} />
          <div className="chart-legend">
            <span className="legend-item">
              <i style={{ background: TEAL }} /> throughput
            </span>
            <span className="legend-item">
              <i style={{ background: 'rgba(229,84,90,.45)' }} /> burst window
            </span>
            <span className="legend-item dim">Burst = value above mean + 2σ</span>
          </div>
        </Panel>

        <Panel className="col-4" title="Z-score distribution" sub="Bucket throughput standardised against the day" noPad>
          <Chart option={zHistOption} height={330} />
          <div className="chart-legend" style={{ justifyContent: 'center' }}>
            <span className="legend-item dim">Red bins are ≥ +2σ</span>
          </div>
        </Panel>

        <Panel className="col-7" title="Bytes per bucket" sub="Volume spike lags the request burst by design" noPad>
          <Chart option={bytesOption} height={250} />
        </Panel>

        <Panel className="col-5" title="Burst register" sub="Every bucket with z ≥ 2, highest first" noPad>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th className="right">RPS</th>
                  <th className="right">z</th>
                  <th className="right">Failures</th>
                  <th>Reading</th>
                </tr>
              </thead>
              <tbody>
                {zRows.map((r) => (
                  <tr key={r.time}>
                    <td className="mono">{r.time}</td>
                    <td className="right mono">{fmtInt(r.rps)}</td>
                    <td className="right">
                      <span className="score-cell critical" style={{ fontSize: 15 }}>
                        {r.z.toFixed(2)}
                      </span>
                    </td>
                    <td className="right mono">{r.failed}</td>
                    <td className="cell-sub">above μ+2σ · inspect upstream</td>
                  </tr>
                ))}
                {zRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="dim">No bucket exceeds μ+2σ.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="table-note">
            <span className="inline-flex">
              <Zap size={11} /> Threshold derived from this window only.
            </span>
          </div>
        </Panel>

        <Panel className="col-12" title="How this view is computed" sub="Three transparent operations" bodyClass="panel-body">
          <div className="insight-row">
            <div className="insight-cell">
              <Activity size={15} style={{ color: 'var(--teal)' }} />
              <strong>Bucket</strong>
              <p>
                Events are grouped across the accepted window. Throughput uses the logged requests-per-second column when the
                export carries it, otherwise requests ÷ bucket seconds.
              </p>
            </div>
            <div className="insight-cell">
              <BarChart3 size={15} style={{ color: 'var(--amber)' }} />
              <strong>Standardise</strong>
              <p>Each bucket is expressed as z = (x − μ) ÷ σ. The sample σ uses n − 1 in the denominator.</p>
            </div>
            <div className="insight-cell">
              <TrendingUp size={15} style={{ color: 'var(--simulated)' }} />
              <strong>Flag</strong>
              <p>A bucket at or above μ+2σ is surfaced. No machine-learning claim is attached to this rule.</p>
            </div>
          </div>
          <div className="form-alert" style={{ margin: '14px 0 0' }}>
            <Info size={13} />
            <span>
              {estate.coverage.hasEvents
                ? `These buckets are computed from ${fmtInt(estate.coverage.events)} accepted log rows.`
                : 'No log dataset accepted yet, so this is the seeded demo traffic and it says so. Accept a log file in the Data Input Hub to rebuild it.'}
            </span>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'Mean RPS', value: avg.toFixed(1), formula: 'mean(rps_i)', n: rps.length },
            { name: 'Standard deviation', value: sigma.toFixed(1), formula: 'sample σ, n−1', n: rps.length },
            { name: 'p95 RPS', value: p95(rps).toFixed(0), formula: '95th percentile', n: rps.length },
            { name: 'Peak z-score', value: ((peak - avg) / sigma).toFixed(2), formula: '(peak − μ) ÷ σ', n: rps.length },
            { name: 'Flag rate', value: `${((bursts.length / trafficSeries.length) * 100).toFixed(1)}%`, formula: 'μ+2σ buckets ÷ all buckets', n: trafficSeries.length },
          ]}
        />
      </div>
    </div>
  )
}
