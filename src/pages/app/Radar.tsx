import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Calendar } from 'lucide-react'
import { Chart, chartFont } from '../../components/Chart'
import { Sparkline } from '../../components/Sparkline'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  FlaskConical,
  Gauge,
  Grid3X3,
  Info,
  Radar as RadarIcon,
  ShieldAlert,
  TrendingUp,
} from '../../components/Icons'
import { DEMO_NOW, epssHistory, threatDaily } from '../../data/seed'
import { useLiveCves } from '../../lib/liveData'
import { useTheme } from '../../lib/store'
import { clamp, fmtDateTime, fmtPct } from '../../lib/format'
import { mean, spearman, trendSlope } from '../../lib/stats'
import { hexA } from '../../lib/colors'
import { MomentumVolume, MovementMatrix, SignalHeroChart, type RadarSeries } from './radar/RadarVisuals'
import './radar.css'

const shortId = (id: string) => id.replace('CVE-', '')
const signedPP = (value: number, digits = 1) =>
  `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(digits)}pp`

const KEV_WEEKS = [0, 1, 2, 3].map((w) => ({
  label: `W${w + 1}`,
  value: threatDaily.slice(w * 7, w * 7 + 7).reduce((acc, day) => acc + day.kev, 0),
}))
const KEV_TOTAL = KEV_WEEKS.reduce((acc, week) => acc + week.value, 0)
const KEV_PEAK = KEV_WEEKS.reduce((peak, week) => (week.value > peak.value ? week : peak), KEV_WEEKS[0])
const KEV_MAX = Math.max(1, ...KEV_WEEKS.map((week) => week.value))
const KEV_DAILY_MAX = Math.max(1, ...threatDaily.map((day) => day.kev))

type WatchTab = 'all' | 'accelerating' | 'cooling'
type SortKey = 'delta' | 'epss' | 'slope' | 'age'

type Palette = {
  ink: string
  dim: string
  muted: string
  line: string
  grid: string
  card: string
  orange: string
  green: string
  red: string
  gold: string
  series: [string, string, string, string]
}

const PALETTES: { light: Palette; dark: Palette } = {
  light: {
    ink: '#101d2d',
    dim: '#3b4757',
    muted: '#8b877f',
    line: 'rgba(16, 29, 45, 0.09)',
    grid: 'rgba(16, 29, 45, 0.07)',
    card: '#fffdf9',
    orange: '#ff5a1f',
    green: '#2f8f62',
    red: '#d8463c',
    gold: '#b8892f',
    series: ['#d8463c', '#ff5a1f', '#b8892f', '#2f8f62'],
  },
  dark: {
    ink: '#e9eff6',
    dim: '#c0cedd',
    muted: '#90a4b8',
    line: 'rgba(255, 255, 255, 0.09)',
    grid: 'rgba(255, 255, 255, 0.07)',
    card: '#121f2c',
    orange: '#ff6a36',
    green: '#58c795',
    red: '#ff8a80',
    gold: '#e6c34a',
    series: ['#ff8a80', '#ff6a36', '#e6c34a', '#58c795'],
  },
}

const signalFor = (series: RadarSeries) =>
  series.delta >= 0.05
    ? { label: 'Accelerating', tone: 'is-accelerating' }
    : series.delta > 0
      ? { label: 'Rising', tone: 'is-rising' }
      : { label: 'Cooling', tone: 'is-cooling' }

const tooltipSkin = (dark: boolean) => ({
  backgroundColor: dark ? 'rgba(9, 17, 27, 0.97)' : 'rgba(16, 32, 54, 0.97)',
  borderColor: 'rgba(255, 255, 255, 0.16)',
  borderWidth: 1,
  padding: [9, 11] as [number, number],
  extraCssText: 'box-shadow: 0 20px 40px -18px rgba(4,10,18,.8); border-radius: 10px;',
  textStyle: { color: '#eef4fb', fontSize: 10.5, fontFamily: chartFont, lineHeight: 18 },
})

function CardHead({
  icon,
  title,
  sub,
  action,
  tone,
}: {
  icon: ReactNode
  title: string
  sub: string
  action?: ReactNode
  tone?: 'orange'
}) {
  return (
    <header className="xp-card-head">
      <div className="xp-card-titlewrap">
        <span className={tone === 'orange' ? 'xp-card-icon orange' : 'xp-card-icon'}>{icon}</span>
        <div style={{ minWidth: 0 }}>
          <div className="xp-card-title">{title}</div>
          <div className="xp-card-sub">{sub}</div>
        </div>
      </div>
      {action}
    </header>
  )
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="xp-info" title={text} aria-label={text} role="img">
      <Info size={12} />
    </span>
  )
}

export default function RadarPage() {
  const theme = useTheme((s) => s.theme)
  const dark = theme === 'dark'
  const palette = dark ? PALETTES.dark : PALETTES.light

  const liveCves = useLiveCves()
  const cveMap = useMemo(() => new Map(liveCves.map((c) => [c.id, c])), [liveCves])

  const tracked = useMemo<RadarSeries[]>(
    () =>
      epssHistory.flatMap((history, index) => {
        const cve = cveMap.get(history.id)
        if (!cve) return []
        const seriesCurrent = history.points[history.points.length - 1].value
        const current = cve.epss ?? seriesCurrent
        const weekAgo = history.points[Math.max(0, history.points.length - 8)].value
        const slope = trendSlope(history.points.map((p) => p.value))
        const ageMs = DEMO_NOW.getTime() - new Date(cve.published).getTime()
        return [
          {
            ...history,
            color: palette.series[index] ?? history.color,
            cve,
            current,
            weekAgo,
            delta: current - weekAgo,
            slope: slope.slope,
            r2: slope.r2,
            today: current - history.points[history.points.length - 2].value,
            ageYears: ageMs / (365.25 * 86400000),
          },
        ]
      }),
    [palette, cveMap],
  )

  const maxRise = useMemo(() => [...tracked].sort((a, b) => b.delta - a.delta)[0], [tracked])
  const [selectedId, setSelectedId] = useState(maxRise.id)
  const [span, setSpan] = useState<7 | 14 | 30>(30)
  const [tab, setTab] = useState<WatchTab>('all')
  const [sort, setSort] = useState<SortKey>('delta')

  const selected = tracked.find((series) => series.id === selectedId) ?? maxRise
  const meanCurrent = mean(tracked.map((series) => series.current))
  const meanDelta = mean(tracked.map((series) => series.delta))
  const maxSlope = Math.max(...tracked.map((series) => series.slope))
  const kevTracked = tracked.filter((series) => series.cve.kev).length
  const meanSeries = tracked[0].points.map((_, index) => mean(tracked.map((series) => series.points[index].value)))

  const tabs: { key: WatchTab; label: string; count: number }[] = [
    { key: 'all', label: 'All tracked', count: tracked.length },
    {
      key: 'accelerating',
      label: 'Accelerating',
      count: tracked.filter((series) => series.delta >= 0.05).length,
    },
    { key: 'cooling', label: 'Cooling today', count: tracked.filter((series) => series.today < 0).length },
  ]

  const rows = useMemo(() => {
    const filtered = tracked.filter((series) =>
      tab === 'all' ? true : tab === 'accelerating' ? series.delta >= 0.05 : series.today < 0,
    )
    return [...filtered].sort((a, b) => {
      if (sort === 'epss') return b.current - a.current
      if (sort === 'slope') return b.slope - a.slope
      if (sort === 'age') return a.ageYears - b.ageYears
      return b.delta - a.delta
    })
  }, [tracked, tab, sort])

  const kevOption = useMemo(() => {
    const p = dark ? PALETTES.dark : PALETTES.light
    return {
      grid: { left: 32, right: 12, top: 22, bottom: 24 },
      xAxis: {
        type: 'category',
        data: KEV_WEEKS.map((week) => week.label),
        axisLine: { lineStyle: { color: p.line } },
        axisTick: { show: false },
        axisLabel: { color: p.muted, fontFamily: chartFont, fontSize: 8.5 },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        max: Math.ceil(KEV_MAX * 1.3),
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: p.grid, type: 'dashed' } },
        axisLabel: { color: p.muted, fontFamily: chartFont, fontSize: 8.5 },
      },
      tooltip: {
        ...tooltipSkin(dark),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: hexA(p.orange, 0.06) } },
        valueFormatter: (value: number) => `${value} additions`,
      },
      series: [
        {
          type: 'bar',
          barWidth: '50%',
          barGap: '-100%',
          silent: true,
          itemStyle: { color: hexA(p.ink, 0.05), borderRadius: [5, 5, 0, 0] },
          data: KEV_WEEKS.map(() => Math.ceil(KEV_MAX * 1.3)),
        },
        {
          type: 'bar',
          barWidth: '50%',
          data: KEV_WEEKS.map((week) => ({
            value: week.value,
            itemStyle: {
              borderRadius: [5, 5, 0, 0],
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: hexA(p.orange, week.label === KEV_PEAK.label ? 0.95 : 0.55) },
                  { offset: 1, color: hexA(p.orange, week.label === KEV_PEAK.label ? 0.24 : 0.07) },
                ],
              },
            },
          })),
          label: {
            show: true,
            position: 'top',
            color: p.muted,
            fontSize: 8.5,
            fontFamily: chartFont,
          },
        },
      ],
    }
  }, [dark])

  const trajOption = useMemo(() => {
    const p = dark ? PALETTES.dark : PALETTES.light
    const dates = tracked[0].points.map((point) => point.date)
    return {
      grid: { left: 40, right: 50, top: 18, bottom: 26 },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: p.line } },
        axisTick: { show: false },
        axisLabel: { color: p.muted, fontFamily: chartFont, fontSize: 8.5, interval: 5 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: p.grid, type: 'dashed' } },
        axisLabel: {
          color: p.muted,
          fontFamily: chartFont,
          fontSize: 8.5,
          formatter: (value: number) => `${Math.round(value * 100)}%`,
        },
      },
      tooltip: {
        ...tooltipSkin(dark),
        trigger: 'axis',
        axisPointer: { lineStyle: { color: hexA(p.muted, 0.45), type: 'dashed' } },
        valueFormatter: (value: number) => fmtPct(value),
      },
      series: tracked.map((series) => {
        const focused = series.id === selected.id
        return {
          name: series.id,
          type: 'line',
          smooth: 0.32,
          symbol: 'none',
          z: focused ? 6 : 2,
          lineStyle: {
            width: focused ? 2.6 : 1.2,
            color: series.color,
            opacity: focused ? 1 : 0.18,
            shadowBlur: focused ? 12 : 0,
            shadowColor: hexA(series.color, 0.5),
          },
          itemStyle: { color: series.color },
          areaStyle: focused
            ? {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: hexA(series.color, 0.2) },
                    { offset: 1, color: hexA(series.color, 0) },
                  ],
                },
              }
            : undefined,
          endLabel: focused
            ? {
                show: true,
                formatter: fmtPct(series.current),
                color: series.color,
                fontSize: 9,
                fontFamily: chartFont,
              }
            : undefined,
          emphasis: { focus: 'none' },
          data: series.points.map((point) => Number(point.value.toFixed(4))),
        }
      }),
    }
  }, [dark, tracked, selected])

  return (
    <div className="radar-page">
      <div className="xp-shell">
        <div className="xp-head">
          <div className="xp-head-copy">
            <span className="xp-eyebrow">Component 14 · Emerging radar</span>
            <h1>
              What is moving, <em>not just loud</em>.
            </h1>
            <p>
              EPSS movement, KEV additions, and acceleration across the demo snapshot. Every signal is computed
              from stored series — no forecast or future score is invented.
            </p>
          </div>
          <div className="xp-head-side">
            <span className="xp-org">
              <span className="xp-org-avatar">ER</span>
              <span className="xp-org-copy">
                <b>Radar watch</b>
                <small>
                  {tracked.length} series · {kevTracked} in KEV · 30 stored days
                </small>
              </span>
            </span>
            <div className="xp-actions">
              <span className="rdr-snap">
                <i />
                Snapshot · {fmtDateTime(DEMO_NOW.toISOString())}
              </span>
              <button type="button" className="xp-btn xp-btn-dark" onClick={() => setSelectedId(maxRise.id)}>
                <TrendingUp size={13} />
                Focus largest mover
              </button>
            </div>
          </div>
        </div>

        <div className="xp-grid">
          <section
            className="xp-card rdr-mover"
            style={{ '--tone': selected.color } as CSSProperties}
            aria-label="Focused EPSS series"
          >
            <CardHead
              icon={<TrendingUp size={16} />}
              title={selected.id === maxRise.id ? 'Largest 7-day mover' : 'Focused series'}
              sub={`${selected.id} · stored daily scores`}
              tone="orange"
              action={
                <div className="rdr-mover-tools">
                  <label className="rdr-window">
                    <Calendar size={11} />
                    <select
                      value={span}
                      onChange={(event) => setSpan(Number(event.target.value) as 7 | 14 | 30)}
                      aria-label="Chart window"
                    >
                      <option value={30}>Last 30 days</option>
                      <option value={14}>Last 14 days</option>
                      <option value={7}>Last 7 days</option>
                    </select>
                    <ChevronDown size={10} className="rdr-window-caret" />
                  </label>
                  <InfoTip text="Focus follows the watched table, the volume orbs and the trajectory chips. The chart window only changes the stored points shown here." />
                </div>
              }
            />
            <div className="rdr-mover-body">
              <div className="rdr-mover-value">
                <strong>{(selected.current * 100).toFixed(1)}</strong>
                <small>%</small>
              </div>
              <div className="rdr-mover-delta">
                <span className={`rdr-delta ${selected.delta >= 0 ? 'is-hot' : 'is-cool'}`}>
                  {selected.delta >= 0 ? '▲' : '▼'} {Math.abs(selected.delta * 100).toFixed(1)}pp
                </span>
                <em>vs {fmtPct(selected.weekAgo)} seven days ago</em>
              </div>
              <div className="rdr-mover-id">
                <i />
                <span>{selected.id}</span>
                <em>{selected.cve.title}</em>
              </div>

              <SignalHeroChart points={selected.points} tone={selected.color} span={span} cveId={selected.id} />

              <div className="rdr-mover-facts">
                <div className="rdr-fact">
                  <span>CVSS</span>
                  <b>{selected.cve.cvss?.toFixed(1) ?? '—'}</b>
                </div>
                <div className="rdr-fact">
                  <span>Percentile</span>
                  <b>
                    {selected.cve.epssPercentile !== null
                      ? `${(selected.cve.epssPercentile * 100).toFixed(1)}th`
                      : '—'}
                  </b>
                </div>
                <div className="rdr-fact">
                  <span>Disclosed</span>
                  <b>{selected.ageYears.toFixed(1)} yr</b>
                </div>
                <div className="rdr-fact">
                  <span>KEV</span>
                  <b>
                    {selected.cve.kev ? (
                      <>
                        <Check size={11} /> Listed
                      </>
                    ) : (
                      'Not listed'
                    )}
                  </b>
                </div>
              </div>
            </div>
          </section>

          <section className="xp-card rdr-pulse" aria-label="Pulse">
            <CardHead
              icon={<Gauge size={16} />}
              title="Pulse"
              sub="Four readings · same snapshot"
              action={<InfoTip text="Each reading is recomputed from the same stored 30-point series shown below. Nothing is projected forward." />}
            />
            <div className="rdr-pulse-body">
              <div className="rdr-pulse-cell">
                <span className="rdr-pulse-label">
                  <RadarIcon size={10} /> Mean EPSS
                </span>
                <span className="rdr-pulse-value">
                  {fmtPct(meanCurrent)}
                  <small>tracked</small>
                </span>
                <div className="rdr-pulse-spark">
                  <Sparkline values={meanSeries} fluid height={26} color={palette.green} strokeWidth={1.4} />
                </div>
              </div>
              <div className="rdr-pulse-cell">
                <span className="rdr-pulse-label">
                  <TrendingUp size={10} /> 7-day net
                </span>
                <span className={`rdr-pulse-value ${meanDelta >= 0 ? 'is-up' : ''}`}>
                  {signedPP(meanDelta)}
                  <small>avg</small>
                </span>
                <div className="rdr-pulse-meter">
                  <i style={{ width: `${clamp((meanDelta / 0.1) * 100, 4, 100)}%` }} />
                  <b />
                </div>
              </div>
              <div className="rdr-pulse-cell">
                <span className="rdr-pulse-label">
                  <Gauge size={10} /> Fastest slope
                </span>
                <span className="rdr-pulse-value">
                  +{(maxSlope * 100).toFixed(2)}
                  <small>pp/day</small>
                </span>
                <div className="rdr-pulse-bars" aria-hidden="true">
                  {tracked.map((series) => (
                    <i
                      key={series.id}
                      style={
                        {
                          height: `${clamp((series.slope / maxSlope) * 100, 12, 100)}%`,
                          '--tone': series.color,
                        } as CSSProperties
                      }
                    />
                  ))}
                </div>
              </div>
              <div className="rdr-pulse-cell">
                <span className="rdr-pulse-label">
                  <ShieldGlyph /> KEV coverage
                </span>
                <span className="rdr-pulse-value">
                  {kevTracked}/{tracked.length}
                  <small>listed</small>
                </span>
                <div className="rdr-pulse-dots" aria-hidden="true">
                  {tracked.map((series) => (
                    <i key={series.id} className={series.cve.kev ? 'on' : undefined} />
                  ))}
                  <span>CISA</span>
                </div>
              </div>
            </div>
          </section>

          <section className="xp-card rdr-kev" aria-label="KEV additions">
            <CardHead
              icon={<ShieldAlert size={16} />}
              title="KEV additions"
              sub="Weekly sum · demo series"
              action={
                <span className="xp-source-chip" style={{ '--xp-tone': 'var(--xp-orange)' } as CSSProperties}>
                  CISA KEV
                </span>
              }
            />
            <div className="rdr-kev-body">
              <div className="rdr-kev-total">
                <strong>{KEV_TOTAL}</strong>
                <span>additions · 4 weeks</span>
                <em>
                  peak {KEV_PEAK.label} · {KEV_PEAK.value}
                </em>
              </div>
              <div className="rdr-kev-chart">
                <Chart option={kevOption} height="100%" />
              </div>
              <div className="rdr-kev-strip" aria-hidden="true">
                {threatDaily.map((day, index) => (
                  <i
                    key={day.label}
                    className={index === threatDaily.length - 1 ? 'is-last' : undefined}
                    style={{ height: `${clamp((day.kev / KEV_DAILY_MAX) * 100, 8, 100)}%` }}
                    title={`${day.label} · ${day.kev}`}
                  />
                ))}
              </div>
              <div className="rdr-kev-foot">
                <span>
                  <i /> daily additions
                </span>
                <span>30 stored days</span>
              </div>
            </div>
          </section>

          <MomentumVolume
            series={tracked}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onReset={() => setSelectedId(maxRise.id)}
          />

          <section className="xp-card rdr-traj" aria-label="Trajectory">
            <CardHead
              icon={<RadarIcon size={16} />}
              title="Trajectory"
              sub="30 stored daily scores · focus follows selection"
              action={
                <span className="xp-source-chip" style={{ '--xp-tone': 'var(--xp-green)' } as CSSProperties}>
                  FIRST EPSS
                </span>
              }
            />
            <div className="rdr-traj-body">
              <div className="rdr-traj-chips">
                {tracked.map((series) => (
                  <button
                    key={series.id}
                    type="button"
                    className={`rdr-series-chip${series.id === selectedId ? ' is-on' : ''}`}
                    style={{ '--tone': series.color } as CSSProperties}
                    onClick={() => setSelectedId(series.id)}
                    aria-pressed={series.id === selectedId}
                  >
                    <i />
                    {shortId(series.id)}
                    <b>{fmtPct(series.current)}</b>
                  </button>
                ))}
              </div>
              <div className="rdr-traj-plot">
                <Chart option={trajOption} height="100%" />
              </div>
              <div className="chart-legend">
                <span className="legend-item rdr-traj-note">
                  <span className="rdr-dot" style={{ background: palette.green }} />
                  <span className="mono" style={{ fontSize: 8 }}>
                    daily scored snapshot
                  </span>
                </span>
                <span className="rdr-traj-end">
                  focus · {shortId(selected.id)} <b>{fmtPct(selected.current)}</b>
                </span>
              </div>
            </div>
          </section>

          <section className="xp-card rdr-watch" aria-label="Watched records">
            <CardHead
              icon={<Grid3X3 size={16} />}
              title="Watched records"
              sub="EPSS movement for the four tracked CVEs · focus drives the cards above"
              action={<InfoTip text="Every column is derived from the stored series: current score, seven-day difference, today's change and an OLS momentum slope. Focus updates the headline cards." />}
            />
            <div className="rdr-watch-bar">
              <div className="rdr-tabs" role="group" aria-label="Filter watched records">
                {tabs.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`rdr-tab${tab === item.key ? ' is-on' : ''}`}
                    onClick={() => setTab(item.key)}
                    aria-pressed={tab === item.key}
                  >
                    {item.label}
                    <span>{item.count}</span>
                  </button>
                ))}
              </div>
              <div className="rdr-watch-tools">
                <span className="rdr-watch-count">
                  {rows.length} of {tracked.length} shown
                </span>
                <label className="rdr-sort">
                  Sort
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as SortKey)}
                    aria-label="Sort watched records"
                  >
                    <option value="delta">7-day Δ</option>
                    <option value="epss">EPSS now</option>
                    <option value="slope">Momentum</option>
                    <option value="age">Newest</option>
                  </select>
                  <ChevronDown size={10} />
                </label>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="rdr-empty">
                <b>No series match this filter</b>
                <span>Every tracked series left this band in the stored window — switch back to All tracked.</span>
              </div>
            ) : (
              <div className="table-wrap rdr-watch-tablewrap">
                <table className="rdr-table">
                  <thead>
                    <tr>
                      <th>Signal</th>
                      <th className="rdr-col-product">Product</th>
                      <th>EPSS now</th>
                      <th className="right">7-day Δ</th>
                      <th className="right rdr-col-today">Today</th>
                      <th className="rdr-col-momentum">Momentum</th>
                      <th>Status</th>
                      <th className="right" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((series) => {
                      const signal = signalFor(series)
                      return (
                        <tr key={series.id} className={series.id === selectedId ? 'is-selected' : undefined}>
                          <td className="rdr-col-signal">
                            <div className="rdr-watch-cve">
                              <span
                                className="rdr-sev-orb"
                                style={{ '--tone': series.color } as CSSProperties}
                                aria-hidden="true"
                              />
                              <div className="rdr-watch-cve-copy">
                                <div className="rdr-watch-id">{series.id}</div>
                                <div className="cell-sub">{series.cve.title}</div>
                              </div>
                            </div>
                          </td>
                          <td className="rdr-product rdr-col-product">
                            <b>{series.cve.vendor}</b>
                            <span>{series.cve.product}</span>
                          </td>
                          <td className="rdr-col-epss">
                            <div className="rdr-epss" style={{ '--tone': series.color } as CSSProperties}>
                              <div className="rdr-epss-bar">
                                <i style={{ width: `${series.current * 100}%` }} />
                              </div>
                              <div className="rdr-epss-line">
                                <b>{fmtPct(series.current)}</b>
                                <span>
                                  {series.cve.epssPercentile !== null
                                    ? `p${(series.cve.epssPercentile * 100).toFixed(1)}`
                                    : '—'}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="right rdr-col-delta">
                            <span className={`rdr-delta ${series.delta >= 0 ? 'is-hot' : 'is-cool'}`}>
                              {series.delta >= 0 ? '▲' : '▼'} {Math.abs(series.delta * 100).toFixed(1)}pp
                            </span>
                          </td>
                          <td className="right rdr-col-today">
                            <span
                              className={`rdr-today ${
                                series.today > 0.0005 ? 'is-up' : series.today < -0.0005 ? 'is-down' : 'is-flat'
                              }`}
                            >
                              {series.today > 0.0005 ? '▲' : series.today < -0.0005 ? '▼' : '·'}{' '}
                              {Math.abs(series.today * 100).toFixed(2)}pp
                            </span>
                          </td>
                          <td className="rdr-col-momentum">
                            <div className="rdr-momentum">
                              <div className="rdr-momentum-track">
                                <i style={{ width: `${clamp((series.slope / maxSlope) * 100, 5, 100)}%` }} />
                              </div>
                              <span>
                                {(series.slope * 100).toFixed(2)} pp/day · R² {series.r2.toFixed(2)}
                              </span>
                            </div>
                          </td>
                          <td className="rdr-col-status">
                            <span className={`rdr-pill ${signal.tone}`}>{signal.label}</span>
                          </td>
                          <td className="right rdr-col-action">
                            <button
                              type="button"
                              className={`rdr-focus${series.id === selectedId ? ' is-on' : ''}`}
                              onClick={() => setSelectedId(series.id)}
                              aria-pressed={series.id === selectedId}
                            >
                              {series.id === selectedId ? 'Focused' : 'Focus'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="rdr-watch-note">
              <span className="inline-flex">
                <Info size={11} /> Signal is computed from stored endpoints — it is not a forecast.
              </span>
              <span>
                <b>{rows.length}</b> of {tracked.length} tracked · 30 points each
              </span>
            </div>
          </section>

          <section className="xp-card rdr-matrix-panel" aria-label="Movement matrix">
            <CardHead
              icon={<Grid3X3 size={16} />}
              title="Movement matrix"
              sub="Daily EPSS change · last 30 stored days"
              action={<span className="xp-source-chip">day-over-day</span>}
            />
            <div className="rdr-matrix-body">
              <MovementMatrix series={tracked} onSelect={setSelectedId} />
            </div>
          </section>

          <section className="xp-card rdr-method-panel" aria-label="Reading the radar">
            <CardHead
              icon={<FlaskConical size={16} />}
              title="Reading the radar"
              sub="Compute, don't predict"
            />
            <div className="rdr-method">
              <div className="rdr-method-row">
                <span className="rdr-method-icon">
                  <Info size={13} />
                </span>
                <div>
                  <strong>What is computed</strong>
                  <p>
                    Endpoint difference over 7 days and an OLS slope across the 30-point series. Both are fully
                    derived from stored values.
                  </p>
                </div>
              </div>
              <div className="rdr-method-row">
                <span className="rdr-method-icon">
                  <AlertTriangle size={13} />
                </span>
                <div>
                  <strong>What is not</strong>
                  <p>
                    No future score is generated. A rising EPSS changes exploitation points through the formula; it
                    does not change relevance.
                  </p>
                </div>
              </div>
              <div className="rdr-method-row">
                <span className="rdr-method-icon">
                  <FlaskConical size={13} />
                </span>
                <div>
                  <strong>Snapshot</strong>
                  <p>
                    History is seeded demonstration data shaped around the real CVE records; current values use the
                    live FIRST EPSS pull when it is available.
                  </p>
                </div>
              </div>
              <div className="rdr-method-note">
                <ArrowRight size={12} />
                Rising EPSS is a reason to look sooner, not proof of exploitation.
              </div>
            </div>
          </section>

          <section className="xp-card xp-methods-card" aria-label="Radar statistics">
            <div className="xp-methods">
              <div className="xp-methods-head">
                <strong>How each number is built</strong>
                <span>
                  Layer B statistics · same stored snapshot · every figure is recomputed from the tracked series.
                </span>
              </div>
              <div className="xp-method-grid">
                <div className="xp-method" title="Mean of the current EPSS across the tracked series.">
                  <strong>{fmtPct(meanCurrent)}</strong>
                  <span>Mean current EPSS</span>
                  <small>mean over tracked CVEs · n={tracked.length}</small>
                </div>
                <div className="xp-method" title="Mean of the seven-day EPSS difference across the tracked series.">
                  <strong>{(meanDelta * 100).toFixed(2)}pp</strong>
                  <span>Mean 7-day Δ</span>
                  <small>mean(EPSS_t − EPSS_t−7) · n={tracked.length}</small>
                </div>
                <div className="xp-method" title="Spearman rank correlation between the current score and the seven-day change.">
                  <strong>
                    {spearman(
                      tracked.map((s) => s.current),
                      tracked.map((s) => s.delta),
                    ).toFixed(2)}
                  </strong>
                  <span>EPSS ↔ 7-day Δ</span>
                  <small>Spearman rank correlation · n={tracked.length}</small>
                </div>
                <div className="xp-method" title="Best linear fit across the four tracked series.">
                  <strong>{Math.max(...tracked.map((s) => s.r2)).toFixed(2)}</strong>
                  <span>Max R²</span>
                  <small>best linear fit across series · n=30</small>
                </div>
                <div className="xp-method" title="Tracked series that are listed in the CISA KEV catalogue.">
                  <strong>
                    {kevTracked}/{tracked.length}
                  </strong>
                  <span>Tracked in KEV</span>
                  <small>KEV-listed ÷ tracked · n={tracked.length}</small>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function ShieldGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M6 1.2 10 2.6v3.1c0 2.4-1.7 4.3-4 5.1-2.3-.8-4-2.7-4-5.1V2.6Z" />
    </svg>
  )
}
