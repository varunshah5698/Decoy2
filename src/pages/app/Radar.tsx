import { useMemo, useState } from 'react'
import { Chart, axisStyle } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { StatsPanel } from '../../components/StatsPanel'
import { SourceBadge, SeverityBadge } from '../../components/Badges'
import { ArrowRight, Info, Radar as RadarIcon, TrendingUp } from '../../components/Icons'
import { cveById, epssHistory, threatDaily } from '../../data/seed'
import { useTheme } from '../../lib/store'
import { fmtPct } from '../../lib/format'
import { mean, spearman, trendSlope } from '../../lib/stats'
import { LEVEL_COLORS, TEAL, hexA } from '../../lib/colors'
import type { RiskLevel } from '../../lib/types'

export default function RadarPage() {
  const theme = useTheme((s) => s.theme)
  const [focus, setFocus] = useState<string[]>(epssHistory.map((e) => e.id))

  const tracked = epssHistory.map((h) => {
    const cve = cveById[h.id]
    const current = h.points[h.points.length - 1].value
    const weekAgo = h.points[Math.max(0, h.points.length - 8)].value
    const delta = current - weekAgo
    const slope = trendSlope(h.points.map((p) => p.value))
    return { ...h, cve, current, weekAgo, delta, slope: slope.slope, r2: slope.r2 }
  })

  const maxRise = [...tracked].sort((a, b) => b.delta - a.delta)[0]

  const lineOption = useMemo(() => {
    const ax = axisStyle(theme)
    return {
      grid: { left: 40, right: 22, top: 30, bottom: 30 },
      legend: {
        data: epssHistory.map((e) => e.id),
        textStyle: { color: theme === 'dark' ? '#98a5b8' : '#596474', fontSize: 8, fontFamily: 'monospace' },
        itemWidth: 12,
        itemHeight: 3,
        top: 0,
      },
      xAxis: {
        type: 'category',
        data: epssHistory[0].points.map((p) => p.date),
        ...ax,
        boundaryGap: false,
        axisLabel: { ...ax.axisLabel, interval: 4 },
      },
      yAxis: { type: 'value', min: 0, max: 1, ...ax, axisLabel: { ...ax.axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmtPct(v) },
      series: epssHistory.map((h) => ({
        name: h.id,
        type: 'line',
        smooth: 0.35,
        symbol: 'none',
        lineStyle: { width: 1.6, color: h.color, opacity: focus.includes(h.id) ? 1 : 0.15 },
        itemStyle: { color: h.color },
        emphasis: { focus: 'series' },
        data: h.points.map((p) => Number(p.value.toFixed(4))),
      })),
    }
  }, [theme, focus])

  const accelOption = useMemo(() => {
    const ax = axisStyle(theme)
    return {
      grid: { left: 44, right: 20, top: 26, bottom: 42 },
      xAxis: { type: 'value', min: 0, max: 1, name: 'Current EPSS', nameLocation: 'middle', nameGap: 24, ...ax, axisLabel: { ...ax.axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
      yAxis: { type: 'value', name: '7-day change', nameGap: 30, ...ax, axisLabel: { ...ax.axisLabel, formatter: (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}pp` } },
      tooltip: {
        formatter: (p: any) => `${p.data[2]}<br/>EPSS ${(p.data[0] * 100).toFixed(1)}% · ${p.data[1] > 0 ? '+' : ''}${(p.data[1] * 100).toFixed(1)}pp`,
      },
      series: [
        {
          type: 'scatter',
          data: tracked.map((t) => [t.current, t.delta, t.id]),
          symbolSize: 18,
          itemStyle: {
            color: (p: any) => {
              const t = tracked.find((x) => x.id === p.data[2])
              const lvl = (t?.cve.severity ?? 'MEDIUM') as RiskLevel
              return hexA(LEVEL_COLORS[lvl], 0.8)
            },
            borderColor: 'rgba(5,8,14,0.5)',
          },
          label: {
            show: true,
            position: 'top',
            formatter: (p: any) => p.data[2].replace('CVE-', ''),
            color: theme === 'dark' ? '#98a5b8' : '#596474',
            fontSize: 7.5,
            fontFamily: 'monospace',
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(150,168,192,.25)', type: 'dashed' },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    }
  }, [theme, tracked])

  const kevOption = useMemo(() => {
    const ax = axisStyle(theme)
    const weeks = Array.from({ length: 4 }, (_, w) => {
      const slice = threatDaily.slice(w * 7, w * 7 + 7)
      return {
        label: `W${w + 1}`,
        value: slice.reduce((a, b) => a + b.kev, 0),
      }
    })
    return {
      grid: { left: 32, right: 12, top: 16, bottom: 24 },
      xAxis: { type: 'category', data: weeks.map((w) => w.label), ...ax },
      yAxis: { type: 'value', ...ax, minInterval: 1 },
      tooltip: { trigger: 'axis' },
      series: [
        {
          type: 'bar',
          barWidth: '46%',
          data: weeks.map((w, i) => ({
            value: w.value,
            itemStyle: { color: i === weeks.length - 1 ? hexA('#e3a455', 0.9) : hexA('#e3a455', 0.4), borderRadius: [3, 3, 0, 0] },
          })),
          label: { show: true, position: 'top', color: theme === 'dark' ? '#98a5b8' : '#596474', fontSize: 8, fontFamily: 'monospace' },
        },
      ],
    }
  }, [theme])

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 14 · EMERGING RADAR"
        title="What is moving, not just what is loud"
        description="EPSS movement, KEV additions, and acceleration across the demo snapshot. Trend is computed from stored series — no forecast is invented."
        actions={
          <span className="chip">
            <RadarIcon size={12} /> {tracked.length} tracked
          </span>
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
        <div className="kpi">
          <div className="kpi-label">Tracked CVEs</div>
          <div className="kpi-value">{tracked.length}</div>
          <div className="kpi-delta">EPSS series in demo</div>
        </div>
        <div className="kpi high-tone">
          <div className="kpi-label">Largest 7-day rise</div>
          <div className="kpi-value">{(maxRise.delta * 100).toFixed(1)}</div>
          <div className="kpi-delta">percentage points · {maxRise.id}</div>
        </div>
        <div className="kpi critical-tone">
          <div className="kpi-label">Mean EPSS</div>
          <div className="kpi-value">{fmtPct(mean(tracked.map((t) => t.current)))}</div>
          <div className="kpi-delta">tracked snapshot</div>
        </div>
        <div className="kpi amber-tone">
          <div className="kpi-label">KEV additions · 4 weeks</div>
          <div className="kpi-value">{threatDaily.reduce((a, b) => a + b.kev, 0)}</div>
          <div className="kpi-delta">demo KEV series</div>
        </div>
        <div className="kpi teal-tone">
          <div className="kpi-label">Fastest slope</div>
          <div className="kpi-value">
            +{(Math.max(...tracked.map((t) => t.slope)) * 100).toFixed(2)}
            <small>pp/day</small>
          </div>
          <div className="kpi-delta">ordinary least squares</div>
        </div>
      </div>

      <div className="dash-grid">
        <Panel
          className="col-8"
          title="EPSS trajectory"
          sub="30-day probability of exploitation · click a legend item to focus"
          action={
            <div className="inline-flex" style={{ flexWrap: 'wrap', gap: 6 }}>
              {epssHistory.map((e) => (
                <button
                  key={e.id}
                  className="chip"
                  style={{
                    fontSize: 8,
                    padding: '4px 7px',
                    color: focus.includes(e.id) ? e.color : 'var(--text-mute)',
                    borderColor: focus.includes(e.id) ? hexA(e.color, 0.5) : 'var(--line)',
                  }}
                  onClick={() => setFocus((f) => (f.includes(e.id) ? f.filter((x) => x !== e.id) : [...f, e.id]))}
                >
                  {e.id}
                </button>
              ))}
            </div>
          }
          noPad
        >
          <Chart option={lineOption} height={330} />
          <div className="chart-legend">
            <span className="inline-flex">
              <SourceBadge source="FIRST EPSS" />
              <span className="mono" style={{ fontSize: 8 }}>daily scored snapshot</span>
            </span>
            <span className="legend-item dim">Values interpolated only for display; deltas use stored endpoints.</span>
          </div>
        </Panel>

        <Panel className="col-4" title="Acceleration" sub="Current probability vs 7-day change" noPad>
          <Chart option={accelOption} height={330} />
          <div className="chart-legend" style={{ justifyContent: 'center' }}>
            <span className="legend-item dim">Above the line = rising</span>
          </div>
        </Panel>

        <Panel className="col-7" title="Watched records" sub="Ordered by acceleration, then current EPSS" noPad>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>CVE</th>
                  <th>Product</th>
                  <th className="right">EPSS now</th>
                  <th className="right">7-day Δ</th>
                  <th className="right">Slope/day</th>
                  <th>Signal</th>
                </tr>
              </thead>
              <tbody>
                {[...tracked].sort((a, b) => b.delta - a.delta).map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="cell-title mono">{t.id}</div>
                      <div className="cell-sub">{t.cve.title}</div>
                    </td>
                    <td className="cell-sub">
                      {t.cve.vendor} {t.cve.product}
                    </td>
                    <td className="right mono">{fmtPct(t.current)}</td>
                    <td className="right">
                      <span className={`delta-chip ${t.delta >= 0 ? 'bad' : 'good'}`}>
                        {t.delta >= 0 ? '▲' : '▼'} {Math.abs(t.delta * 100).toFixed(1)}pp
                      </span>
                    </td>
                    <td className="right mono">{(t.slope * 100).toFixed(2)}pp</td>
                    <td>
                      <SeverityBadge level={t.delta > 0.01 ? 'HIGH' : t.delta > 0 ? 'MEDIUM' : 'LOW'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-note">
            <span className="inline-flex">
              <TrendingUp size={11} /> Signal is derived from the sign and size of the 7-day change — it is not a forecast.
            </span>
          </div>
        </Panel>

        <Panel className="col-5" title="KEV additions by week" sub="Summed from the 30-day demo series" noPad>
          <Chart option={kevOption} height={250} />
          <div className="chart-legend">
            <span className="legend-item">
              <i style={{ background: '#e3a455' }} /> additions
            </span>
            <span className="legend-item dim">Additions are a count, not a severity claim.</span>
          </div>
        </Panel>

        <Panel className="col-12" title="Reading the radar" sub="Compute, don't predict" bodyClass="panel-body">
          <div className="insight-row">
            <div className="insight-cell">
              <Info size={15} style={{ color: 'var(--teal)' }} />
              <strong>What is computed</strong>
              <p>Endpoint difference over 7 days and an OLS slope across the 30-point series. Both are fully derived from stored values.</p>
            </div>
            <div className="insight-cell">
              <Info size={15} style={{ color: 'var(--amber)' }} />
              <strong>What is not</strong>
              <p>No future score is generated. A rising EPSS changes exploitation points through the formula; it does not change relevance.</p>
            </div>
            <div className="insight-cell">
              <Info size={15} style={{ color: 'var(--simulated)' }} />
              <strong>Snapshot</strong>
              <p>EPSS series are seeded demonstration data shaped around the real CVE records in the dataset.</p>
            </div>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'Mean current EPSS', value: fmtPct(mean(tracked.map((t) => t.current))), formula: 'mean over tracked CVEs', n: tracked.length },
            { name: 'Mean 7-day Δ', value: `${(mean(tracked.map((t) => t.delta)) * 100).toFixed(2)}pp`, formula: 'mean(EPSS_t − EPSS_t−7)', n: tracked.length },
            { name: 'EPSS ↔ 7-day Δ', value: spearman(tracked.map((t) => t.current), tracked.map((t) => t.delta)).toFixed(2), formula: 'Spearman rank correlation', n: tracked.length },
            { name: 'Max R²', value: Math.max(...tracked.map((t) => t.r2)).toFixed(2), formula: 'best linear fit across series', n: 30 },
            { name: 'Tracked in KEV', value: `${tracked.filter((t) => t.cve.kev).length}/${tracked.length}`, formula: 'KEV-listed ÷ tracked', n: tracked.length },
          ]}
        />
      </div>

      <div className="page-foot">
        <span className="inline-flex">
          <ArrowRight size={11} /> Rising EPSS is a reason to look sooner, not proof of exploitation.
        </span>
        <span className="mono">n={tracked.length} tracked · 30 points each</span>
      </div>
    </div>
  )
}
