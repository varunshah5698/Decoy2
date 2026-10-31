import { useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Chart, axisStyle, chartFont, chartTokens } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { StatsPanel } from '../../components/StatsPanel'
import { SourceBadge, LiveDot } from '../../components/Badges'
import { EmptyState } from '../../components/EmptyState'
import { Sparkline } from '../../components/Sparkline'
import { RadialGauge } from '../../components/RadialGauge'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Database,
  ExternalLink,
  FileSearch,
  Gauge as GaugeIcon,
  RefreshCw,
  Rss,
  Search,
  ShieldAlert,
  ShieldCheck,
  Swords,
} from '../../components/Icons'
import { DEMO_NOW, intelItems, sourceHealth } from '../../data/seed'
import { useTheme } from '../../lib/store'
import { cx, fmtDate, fmtDateTime, fmtInt, timeAgo } from '../../lib/format'
import { AMBER, SIMULATED, SUPPRESSED, TEAL, hexA } from '../../lib/colors'
import { latestLiveFetch, useLiveFeeds, type LiveSource } from '../../lib/liveFeeds'
import type { IntelItem } from '../../lib/types'

const SOURCE_KEYS = ['NVD', 'CISA KEV', 'FIRST EPSS', 'MITRE ATT&CK', 'CERT-In'] as const
type SourceKey = (typeof SOURCE_KEYS)[number]
type SourceFilter = 'ALL' | SourceKey

const SOURCES: readonly SourceFilter[] = ['ALL', ...SOURCE_KEYS]

const SOURCE_META: Record<SourceKey, { icon: LucideIcon; color: string; tone: string; impact: string }> = {
  NVD: { icon: Database, color: TEAL, tone: 'teal', impact: 'Version gate' },
  'CISA KEV': { icon: ShieldAlert, color: AMBER, tone: 'amber', impact: 'Exploit weight' },
  'FIRST EPSS': { icon: GaugeIcon, color: '#8fd8cd', tone: 'teal', impact: 'Probability score' },
  'MITRE ATT&CK': { icon: Swords, color: SIMULATED, tone: 'simulated', impact: 'Technique map' },
  'CERT-In': { icon: FileSearch, color: SUPPRESSED, tone: 'muted', impact: 'Adapter sample' },
}

const sourceMeta = (source: string) =>
  source in SOURCE_META
    ? SOURCE_META[source as SourceKey]
    : { icon: Rss, color: TEAL, tone: 'teal', impact: 'Context update' }

const TOTAL_ITEMS = intelItems.length

const SOURCE_ROWS = SOURCE_KEYS.map((source) => {
  const meta = SOURCE_META[source]
  const count = intelItems.filter((item) => item.source === source).length
  return { source, count, ...meta }
}).sort((a, b) => b.count - a.count)

const countFor = (source: SourceFilter) =>
  source === 'ALL' ? TOTAL_ITEMS : (SOURCE_ROWS.find((row) => row.source === source)?.count ?? 0)

const TIMELINE = Array.from({ length: 12 }, (_, i) => {
  const start = DEMO_NOW.getTime() - (11 - i) * 8 * 3600 * 1000
  const end = start + 8 * 3600 * 1000
  const items = intelItems.filter((item) => {
    const t = new Date(item.published).getTime()
    return t >= start && t < end
  })
  const d = new Date(start + 4 * 3600 * 1000)
  return {
    label: d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', hour12: false }),
    real: items.filter((item) => !item.simulated).length,
    simulated: items.filter((item) => item.simulated).length,
  }
})

const BUCKET_TOTALS = TIMELINE.map((bucket) => bucket.real + bucket.simulated)
const AVG_PER_BUCKET = BUCKET_TOTALS.reduce((a, b) => a + b, 0) / TIMELINE.length

const LIVE_SOURCE_KEYS: Record<string, LiveSource | undefined> = {
  NVD: 'NVD',
  'CISA KEV': 'CISA KEV',
  'FIRST EPSS': 'FIRST EPSS',
}

const REAL_SOURCES = sourceHealth.filter((source) => source.kind === 'real').length
const REAL_ITEMS = intelItems.filter((item) => !item.simulated).length
const SIMULATED_ITEMS = TOTAL_ITEMS - REAL_ITEMS
const MAX_RECORDS = Math.max(...sourceHealth.map((source) => source.records))

const CATEGORY_ROWS = Object.entries(
  intelItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] ?? 0) + 1
    return acc
  }, {}),
)
  .map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count)

const recordWidth = (records: number) =>
  Math.max(5, (Math.log10(records) / Math.log10(MAX_RECORDS)) * 100)

const ageWidth = (age: number) => Math.min(100, (age / 72) * 100)

function ageTone(age: number) {
  if (age > 48) return 'bad'
  if (age > 24) return 'warn'
  return ''
}

export default function Intel() {
  const theme = useTheme((state) => state.theme)
  const [source, setSource] = useState<SourceFilter>('ALL')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'new' | 'old'>('new')
  const [selected, setSelected] = useState<IntelItem | null>(null)
  const streamRef = useRef<HTMLDivElement | null>(null)
  const syncing = useLiveFeeds((s) => s.syncing)
  const syncPhase = useLiveFeeds((s) => s.phase)
  const liveMeta = useLiveFeeds((s) => s.meta)
  const syncAll = useLiveFeeds((s) => s.syncAll)
  const lastLive = latestLiveFetch(liveMeta)

  const freshness = useMemo(
    () =>
      sourceHealth.map((source) => {
        const key = LIVE_SOURCE_KEYS[source.source]
        const live = key ? liveMeta[key] : undefined
        return {
          ...source,
          status: live ? (live.status === 'ok' ? 'OK' : 'DEGRADED') : source.status,
          lastSuccess: live?.fetchedAt ?? source.lastSuccess,
          live: Boolean(live),
          age: live
            ? (Date.now() - new Date(live.fetchedAt).getTime()) / 3600000
            : (DEMO_NOW.getTime() - new Date(source.lastSuccess).getTime()) / 3600000,
        }
      }),
    [liveMeta],
  )
  const freshSources = freshness.filter((source) => source.age <= 24).length
  const freshShare = Math.round((freshSources / freshness.length) * 100)
  const degraded = freshness.filter((source) => source.status !== 'OK')
  const degradedNames = degraded.map((source) => source.source)
  const medianAge = [...freshness].map((source) => source.age).sort((a, b) => a - b)[
    Math.floor(freshness.length / 2)
  ]

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return intelItems
      .filter((item) => source === 'ALL' || item.source === source)
      .filter((item) =>
        q ? `${item.title} ${item.summary} ${item.category} ${item.source}`.toLowerCase().includes(q) : true,
      )
      .slice()
      .sort((a, b) => {
        const diff = new Date(b.published).getTime() - new Date(a.published).getTime()
        return sort === 'new' ? diff : -diff
      })
  }, [source, search, sort])

  const mixOption = useMemo(() => {
    const t = chartTokens(theme)
    return {
      title: {
        text: String(TOTAL_ITEMS),
        subtext: 'cached items',
        left: 'center',
        top: '37%',
        textStyle: {
          fontFamily: "'Space Grotesk Variable', sans-serif",
          fontSize: 27,
          fontWeight: 500,
          color: t.tooltipText,
        },
        subtextStyle: {
          fontFamily: chartFont,
          fontSize: 8,
          letterSpacing: 1,
          color: t.muted,
        },
      },
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => `${p.marker}${p.name}<br/><strong>${p.value}</strong> items · ${p.percent}%`,
      },
      series: [
        {
          type: 'pie',
          radius: ['62%', '84%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          selectedMode: false,
          animationType: 'scale',
          label: { show: false },
          labelLine: { show: false },
          itemStyle: {
            borderColor: theme === 'dark' ? '#0a1019' : '#fbf9f4',
            borderWidth: 3,
            borderRadius: 3,
          },
          emphasis: {
            scale: true,
            scaleSize: 7,
            itemStyle: { shadowBlur: 26, shadowColor: hexA(TEAL, 0.4) },
          },
          data: SOURCE_ROWS.map((row) => ({
            name: row.source,
            value: row.count,
            itemStyle: { color: row.color },
            emphasis: {
              itemStyle: { shadowBlur: 26, shadowColor: hexA(row.color, 0.65) },
            },
          })),
        },
      ],
    }
  }, [theme])

  const categoryOption = useMemo(() => {
    const t = chartTokens(theme)
    const ax = axisStyle(theme)
    return {
      grid: { left: 128, right: 30, top: 8, bottom: 4 },
      xAxis: { type: 'value', show: false, max: Math.max(...CATEGORY_ROWS.map((row) => row.count)) + 1 },
      yAxis: {
        type: 'category',
        data: CATEGORY_ROWS.map((row) => row.name),
        inverse: true,
        ...ax,
        axisLabel: { ...ax.axisLabel, fontSize: 8, width: 106, overflow: 'break', lineHeight: 10.5 },
        axisLine: { show: false },
        splitLine: { show: false },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any[]) =>
          `${params[0].name}<br/><strong>${params[0].value}</strong> item${params[0].value === 1 ? '' : 's'}`,
      },
      series: [
        {
          type: 'bar',
          barWidth: 9,
          animationDelay: (idx: number) => 90 + idx * 55,
          data: CATEGORY_ROWS.map((row, index) => ({
            value: row.count,
            itemStyle: {
              borderRadius: [0, 4, 4, 0],
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 1,
                y2: 0,
                colorStops: [
                  { offset: 0, color: hexA(index === 0 ? AMBER : TEAL, 0.22) },
                  { offset: 1, color: hexA(index === 0 ? AMBER : TEAL, 0.95) },
                ],
              },
            },
            emphasis: {
              itemStyle: { shadowBlur: 18, shadowColor: hexA(index === 0 ? AMBER : TEAL, 0.6) },
            },
          })),
          label: {
            show: true,
            position: 'right',
            color: t.text,
            fontSize: 9,
            fontFamily: chartFont,
            formatter: '{c}',
          },
          emphasis: { focus: 'self' },
        },
      ],
    }
  }, [theme])

  const timelineOption = useMemo(() => {
    const ax = axisStyle(theme)
    const t = chartTokens(theme)
    const barGradient = (color: string) => ({
      type: 'linear',
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: hexA(color, 0.9) },
        { offset: 1, color: hexA(color, 0.24) },
      ],
    })
    return {
      grid: { left: 32, right: 16, top: 28, bottom: 38 },
      xAxis: {
        type: 'category',
        data: TIMELINE.map((bucket) => bucket.label),
        ...ax,
        axisLabel: { ...ax.axisLabel, fontSize: 7.5, rotate: 30, margin: 10 },
      },
      yAxis: { type: 'value', ...ax, minInterval: 1 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any[]) => {
          const real = params.find((p) => p.seriesName === 'Real public source')?.value ?? 0
          const simulated = params.find((p) => p.seriesName === 'Simulated / sample')?.value ?? 0
          return `${params[0].axisValue}<br/>Real <strong>${real}</strong> · Simulated <strong>${simulated}</strong><br/>Total <strong>${real + simulated}</strong>`
        },
      },
      series: [
        {
          name: 'Real public source',
          type: 'bar',
          stack: 'items',
          data: TIMELINE.map((bucket) => bucket.real),
          barWidth: '52%',
          animationDelay: (idx: number) => 80 + idx * 42,
          itemStyle: { color: barGradient(TEAL), borderRadius: [0, 0, 0, 0] },
          emphasis: { itemStyle: { shadowBlur: 16, shadowColor: hexA(TEAL, 0.45) } },
        },
        {
          name: 'Simulated / sample',
          type: 'bar',
          stack: 'items',
          data: TIMELINE.map((bucket) => bucket.simulated),
          animationDelay: (idx: number) => 80 + idx * 42,
          itemStyle: { color: barGradient(SIMULATED), borderRadius: [3, 3, 0, 0] },
          emphasis: { itemStyle: { shadowBlur: 16, shadowColor: hexA(SIMULATED, 0.45) } },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: hexA(AMBER, 0.5), type: 'dashed', width: 1 },
            label: {
              formatter: `avg ${AVG_PER_BUCKET.toFixed(1)}`,
              color: t.muted,
              fontSize: 8,
              fontFamily: chartFont,
              position: 'insideEndTop',
            },
            data: [{ yAxis: AVG_PER_BUCKET }],
          },
        },
      ],
    }
  }, [theme])

  const sourceMapOption = useMemo(() => {
    const ax = axisStyle(theme)
    const t = chartTokens(theme)
    return {
      grid: { left: 48, right: 26, top: 30, bottom: 40 },
      xAxis: {
        type: 'value',
        min: 0,
        max: 84,
        name: 'hours since pull',
        nameLocation: 'middle',
        nameGap: 25,
        ...ax,
        axisLabel: { ...ax.axisLabel, fontSize: 8, formatter: (value: number) => `${value}h` },
      },
      yAxis: {
        type: 'log',
        min: 10,
        name: 'records',
        nameGap: 12,
        ...ax,
        axisLabel: {
          ...ax.axisLabel,
          fontSize: 8,
          formatter: (value: number) =>
            value >= 1e6 ? `${Math.round(value / 1e6)}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : `${value}`,
        },
      },
      tooltip: {
        formatter: (p: any) => {
          const [age, records, items, name] = p.data.value
          return `<strong>${name}</strong><br/>${Number(age).toFixed(1)}h since pull<br/>${fmtInt(records)} records · ${items} items`
        },
      },
      series: [
        {
          type: 'scatter',
          data: freshness.map((item) => {
            const meta = sourceMeta(item.source)
            const color = item.kind === 'simulated' ? SIMULATED : meta.color
            const items = SOURCE_ROWS.find((row) => row.source === item.source)?.count ?? 0
            return {
              value: [item.age, item.records, items, item.source],
              itemStyle: {
                color,
                borderColor: theme === 'dark' ? '#0a1019' : '#fbf9f4',
                borderWidth: 2,
                shadowBlur: 16,
                shadowColor: hexA(color, 0.4),
              },
              label: {
                position: item.source === 'CERT-In' ? 'left' : 'right',
              },
            }
          }),
          symbolSize: (value: number[]) => 14 + Math.sqrt(value[2]) * 5.5,
          label: {
            show: true,
            position: 'top',
            distance: 7,
            color: t.text,
            fontSize: 8,
            fontFamily: chartFont,
            formatter: (p: any) => p.data.value[3],
          },
          labelLayout: { hideOverlap: true },
          animationDuration: 1000,
          animationDelay: (idx: number) => idx * 120,
          emphasis: {
            scale: 1.45,
            focus: 'self',
            itemStyle: { shadowBlur: 30, shadowColor: hexA(TEAL, 0.55) },
          },
          blur: { itemStyle: { opacity: 0.35 }, label: { opacity: 0.3 } },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: hexA(AMBER, 0.5), type: 'dashed', width: 1 },
            label: {
              formatter: '24h target',
              color: t.muted,
              fontSize: 8,
              fontFamily: chartFont,
              position: 'insideEndTop',
              rotate: 0,
            },
            data: [{ xAxis: 24 }],
          },
        },
      ],
    }
  }, [theme, freshness])

  const openSource = (next: string) => {
    setSource(next as SourceFilter)
    setSearch('')
    window.setTimeout(() => streamRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  return (
    <div className="page intel-lab">
      <PageHeader
        eyebrow="COMPONENT 08 · THREAT INTEL FEED"
        title="Intelligence with receipts"
        description="Every item carries its source, its timestamp, and a visible distinction between real public feeds and demonstration content."
        actions={
          <div className="intel-head-tools">
            <span className="intel-live-state">
              <i className={lastLive ? 'is-live' : undefined} />
              {syncing
                ? `syncing ${syncPhase ?? ''}`
                : lastLive
                  ? `live · pulled ${timeAgo(lastLive)}`
                  : 'seed snapshot'}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void syncAll({ force: true })}
              disabled={syncing}
              aria-busy={syncing}
            >
              <RefreshCw size={13} className={syncing ? 'spin' : undefined} />
              {syncing ? 'Syncing' : 'Sync live feeds'}
            </button>
          </div>
        }
      />

      <div className="kpi-grid cols-4">
        <div className="kpi teal-tone">
          <div className="kpi-label">Real public sources</div>
          <div className="kpi-value">
            {REAL_SOURCES}
            <small>of {sourceHealth.length}</small>
          </div>
          <div className="kpi-dots" aria-hidden="true">
            {sourceHealth.map((item) => (
              <i key={item.source} className={item.kind === 'simulated' ? 'sim' : 'on'} />
            ))}
          </div>
          <div className="kpi-delta">NVD · CISA KEV · FIRST EPSS</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Items in window</div>
          <div className="kpi-value">{TOTAL_ITEMS}</div>
          <div className="kpi-delta">
            {REAL_ITEMS} real · {SIMULATED_ITEMS} simulated
          </div>
          <span className="kpi-spark">
            <Sparkline values={BUCKET_TOTALS} width={68} height={24} color={TEAL} />
          </span>
        </div>
        <div className="kpi amber-tone">
          <div className="kpi-label">Median source age</div>
          <div className="kpi-value">
            {medianAge.toFixed(1)}
            <small>h</small>
          </div>
          <div className="kpi-delta">time since last successful pull</div>
          <div className="kpi-meter" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (medianAge / 24) * 100)}%` }} />
            <b />
          </div>
          <div className="kpi-note">
            <span>{medianAge.toFixed(1)}h old</span>
            <span>24h target</span>
          </div>
        </div>
        <div className="kpi high-tone">
          <div className="kpi-label">Degraded sources</div>
          <div className="kpi-value">{degraded.length}</div>
          <div className="kpi-delta">
            {degradedNames.length ? (
              <span style={{ color: 'var(--amber)', whiteSpace: 'nowrap' }}>{degradedNames.join(' · ')}</span>
            ) : (
              'All adapters report OK'
            )}
          </div>
        </div>
      </div>

      <div className="dash-grid">
        <Panel className="col-4" title="Source mix" sub="Items in the cached window" noPad spotlight>
          <Chart option={mixOption} height={200} />
          <div className="legend-list">
            {SOURCE_ROWS.map((row) => (
              <div className="legend-line" key={row.source}>
                <i style={{ background: row.color }} />
                <span>{row.source}</span>
                <b>{row.count}</b>
                <em>{Math.round((row.count / TOTAL_ITEMS) * 100)}%</em>
              </div>
            ))}
          </div>
          <div className="chart-note">5 adapters · 2 carry clearly labelled simulated items.</div>
        </Panel>

        <Panel className="col-4" title="What changed" sub="Items by change type" noPad spotlight>
          <Chart option={categoryOption} height={238} />
          <div className="chart-note">
            Vulnerability enrichment accounts for {CATEGORY_ROWS[0]?.count ?? 0} of {TOTAL_ITEMS} items. Simulated
            categories stay visible instead of being folded into the real-feed count.
          </div>
        </Panel>

        <Panel className="col-4" title="Freshness" sub="Last successful pull · 24h target" noPad spotlight>
          <div className="gauge-body">
            <RadialGauge
              value={freshSources}
              max={freshness.length}
              size={150}
              stroke={7}
              color={TEAL}
              track={theme === 'dark' ? 'rgba(150,168,192,0.14)' : 'rgba(23,30,40,0.12)'}
            >
              <div className="gauge-center">
                <strong>{freshShare}%</strong>
                <span>fresh ≤ 24h</span>
              </div>
            </RadialGauge>
            <div className="freshness-list">
              {freshness.map((item) => (
                <div className="freshness-row" key={item.source}>
                  <i
                    className="status-dot"
                    style={{
                      background:
                        item.status === 'OK'
                          ? 'var(--teal)'
                          : item.status === 'DEGRADED'
                            ? 'var(--amber)'
                            : 'var(--simulated)',
                    }}
                  />
                  <strong>{item.source}</strong>
                  <span className={`age ${ageTone(item.age)}`}>{item.age.toFixed(1)}h</span>
                </div>
              ))}
            </div>
          </div>
          <div className="chart-note">Computed from the last successful pull, not a live network probe.</div>
        </Panel>

        <Panel
          className="col-7"
          title="Ingestion timeline"
          sub="Items per 8-hour bucket · stacked by provenance class"
          noPad
          spotlight
        >
          <Chart option={timelineOption} height={244} />
          <div className="chart-legend" style={{ paddingTop: 0 }}>
            <span className="legend-item">
              <i style={{ background: TEAL }} /> real public source
            </span>
            <span className="legend-item">
              <i style={{ background: SIMULATED }} /> simulated / sample
            </span>
            <span className="legend-item dim">dashed line = bucket average</span>
          </div>
        </Panel>

        <Panel
          className="col-5"
          title="Source map"
          sub="Freshness × record footprint × items in window"
          noPad
          spotlight
        >
          <Chart option={sourceMapOption} height={244} />
          <div className="chart-legend" style={{ paddingTop: 0 }}>
            <span className="legend-item">
              <i style={{ background: TEAL }} /> real adapter
            </span>
            <span className="legend-item">
              <i style={{ background: SIMULATED }} /> simulated adapter
            </span>
            <span className="legend-item dim">bubble size = cached items</span>
          </div>
        </Panel>

        <Panel
          className="col-12"
          title="Source health"
          sub="Last successful update · record counts · provenance class"
          action={
            <span className={lastLive ? 'badge real' : 'badge simulated'}>
              {lastLive ? `Live pull · ${timeAgo(lastLive)}` : 'Seed snapshot'}
            </span>
          }
          noPad
        >
          <div className="ops-table-wrap">
            <table className="ops-table health">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Provenance</th>
                  <th>Records</th>
                  <th>Freshness</th>
                  <th>Status</th>
                  <th className="right">Action</th>
                </tr>
              </thead>
              <tbody>
                {freshness.map((item) => {
                  const meta = sourceMeta(item.source)
                  const Icon = meta.icon
                  const simulated = item.kind === 'simulated'
                  const statusTone =
                    item.status === 'OK' ? 'teal' : item.status === 'DEGRADED' ? 'amber' : 'simulated'
                  return (
                    <tr key={item.source} onClick={() => openSource(item.source)}>
                      <td>
                        <div className="ops-ident">
                          <span className={cx('ops-tile', simulated ? 'simulated' : meta.tone)}>
                            <Icon size={15} strokeWidth={1.7} />
                          </span>
                          <div className="ops-ident-copy">
                            <span className="ops-source-name" style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>
                              {item.source}
                            </span>
                            <span className="ops-sub mono">
                              {item.note}
                              {item.live ? ' · browser pull' : ''}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={cx('ops-pill', simulated ? 'simulated' : 'teal')}>
                          <i />
                          {simulated ? 'Simulated' : 'Real feed'}
                        </span>
                      </td>
                      <td>
                        <div className="ops-metric">
                          <span className="ops-meter">
                            <i
                              style={{
                                width: `${recordWidth(item.records)}%`,
                                background: simulated ? 'var(--simulated)' : 'var(--teal)',
                              }}
                            />
                          </span>
                          <span className="ops-metric-value strong">{fmtInt(item.records)}</span>
                        </div>
                        <span className="ops-sub mono" style={{ marginTop: 3 }}>
                          log scale
                        </span>
                      </td>
                      <td>
                        <div className="ops-metric">
                          <span className="ops-meter">
                            <i
                              style={{
                                width: `${ageWidth(item.age)}%`,
                                background:
                                  item.age > 48 ? 'var(--critical)' : item.age > 24 ? 'var(--amber)' : 'var(--teal)',
                              }}
                            />
                          </span>
                          <span className={`ops-metric-value ${ageTone(item.age)}`}>{item.age.toFixed(1)}h</span>
                        </div>
                        <span className="ops-sub mono" style={{ marginTop: 3 }}>
                          since last pull
                        </span>
                      </td>
                      <td>
                        <span className={cx('ops-pill', statusTone)}>
                          <i />
                          {item.status}
                        </span>
                      </td>
                      <td className="right">
                        <button
                          className="ops-action"
                          onClick={(event) => {
                            event.stopPropagation()
                            openSource(item.source)
                          }}
                          aria-label={`Filter the stream to ${item.source}`}
                        >
                          View items <ArrowRight size={11} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="ops-table-foot">
            <span className="inline-flex">
              <ShieldCheck size={11} /> Health is a computed age check, not a live network probe.
            </span>
            <span className="mono">
              {lastLive ? `live pull ${fmtDateTime(lastLive)}` : `demo clock ${DEMO_NOW.toISOString().slice(11, 16)}Z`}
            </span>
          </div>
        </Panel>

        <div className="col-12" ref={streamRef} style={{ scrollMarginTop: 86 }}>
          <Panel
            className="col-12"
            title="Intelligence stream"
            sub={`${filtered.length} of ${TOTAL_ITEMS} items · ${source === 'ALL' ? 'all sources' : source}`}
            action={<span className="badge real">Live feeds · cached offline</span>}
            noPad
          >
            <div className="ops-tabs" role="tablist" aria-label="Filter intelligence items by source">
              {SOURCES.map((item) => (
                <button
                  key={item}
                  role="tab"
                  aria-selected={source === item}
                  className={cx('ops-tab', source === item && 'on')}
                  onClick={() => setSource(item)}
                >
                  {item === 'ALL' ? 'All sources' : item}
                  <span className="ops-tab-count">{countFor(item)}</span>
                </button>
              ))}
            </div>
            <div className="ops-toolbar">
              <div className="topbar-search">
                <Search size={13} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search items, categories, sources…"
                  aria-label="Search intelligence items"
                />
              </div>
              <button
                className="chip"
                onClick={() => setSort((value) => (value === 'new' ? 'old' : 'new'))}
                aria-label={`Sort ${sort === 'new' ? 'newest first' : 'oldest first'}`}
              >
                <ChevronDown
                  size={12}
                  style={{ transform: sort === 'old' ? 'rotate(180deg)' : undefined, transition: 'transform .18s ease' }}
                />
                {sort === 'new' ? 'Newest first' : 'Oldest first'}
              </button>
              <div className="ops-toolbar-spacer" />
              <span className="ops-result">
                {filtered.length} of {TOTAL_ITEMS}
              </span>
              <LiveDot label={lastLive ? 'browser cache' : 'offline cache'} />
            </div>
            {filtered.length === 0 ? (
              <EmptyState title="No items match" hint="Clear the search or pick another source tab." />
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table stream">
                  <thead>
                    <tr>
                      <th>Intelligence item</th>
                      <th>Category</th>
                      <th>Impact</th>
                      <th>Provenance</th>
                      <th>Published</th>
                      <th className="right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const meta = sourceMeta(item.source)
                      const Icon = meta.icon
                      return (
                        <tr key={item.id} onClick={() => setSelected(item)}>
                          <td className="ops-cell-main">
                            <div className="ops-ident">
                              <span className={cx('ops-tile', item.simulated ? 'simulated' : meta.tone)}>
                                <Icon size={15} strokeWidth={1.7} />
                              </span>
                              <div className="ops-ident-copy">
                                <span className="ops-name">{item.title}</span>
                                <span className="ops-sub">{item.summary}</span>
                              </div>
                            </div>
                          </td>
                          <td>{item.category}</td>
                          <td>
                            <span style={{ color: 'var(--text-mute)', fontSize: 10.5 }}>{meta.impact}</span>
                          </td>
                          <td>
                            <span className={cx('ops-pill', item.simulated ? 'simulated' : 'teal')}>
                              <i />
                              {item.simulated ? 'Simulated' : 'Real feed'}
                            </span>
                          </td>
                          <td>
                            <div className="ops-ident-copy">
                              <span className="ops-metric-value strong">{timeAgo(item.published, DEMO_NOW)}</span>
                              <span className="ops-sub mono">{fmtDate(item.published)}</span>
                            </div>
                          </td>
                          <td className="right">
                            <button
                              className="ops-action"
                              onClick={(event) => {
                                event.stopPropagation()
                                setSelected(item)
                              }}
                              aria-label={`Open ${item.id}`}
                            >
                              Open item <ArrowRight size={11} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="ops-table-foot">
              <span className="inline-flex">
                <Rss size={11} /> Real feed items link to their public source. Sample items are marked SIMULATED.
              </span>
              <span className="mono">n={filtered.length}</span>
            </div>
          </Panel>
        </div>

        <StatsPanel
          className="col-12"
          stats={[
            {
              name: 'Items per source',
              value: (TOTAL_ITEMS / SOURCE_KEYS.length).toFixed(1),
              formula: 'items ÷ 5 sources',
              n: TOTAL_ITEMS,
            },
            {
              name: 'Real-data share',
              value: `${((REAL_ITEMS / TOTAL_ITEMS) * 100).toFixed(1)}%`,
              formula: 'real ÷ all items',
              n: TOTAL_ITEMS,
            },
            {
              name: 'Simulated share',
              value: `${((SIMULATED_ITEMS / TOTAL_ITEMS) * 100).toFixed(1)}%`,
              formula: 'simulated ÷ all items',
              n: TOTAL_ITEMS,
            },
            {
              name: 'Fresh sources',
              value: `${freshShare}%`,
              formula: 'last pull ≤ 24h ÷ all sources',
              n: freshness.length,
            },
            {
              name: 'Records held',
              value: fmtInt(sourceHealth.reduce((total, item) => total + item.records, 0)),
              formula: 'sum of per-source record counts',
              n: sourceHealth.length,
            },
          ]}
        />
      </div>

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} label="Intelligence item">
        {selected && (
          <>
            <DrawerHead
              overline={`${selected.id} · ${selected.category.toUpperCase()}`}
              title={selected.title}
              onClose={() => setSelected(null)}
              meta={
                <span className="inline-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <SourceBadge source={selected.source} simulated={selected.simulated} />
                  <span className="mono" style={{ fontSize: 9 }}>
                    {fmtDate(selected.published)}
                  </span>
                </span>
              }
            />
            <div className="drawer-body">
              <div className="drawer-section">
                <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text)' }}>{selected.summary}</p>
              </div>
              <div className="drawer-section">
                <h3>Provenance</h3>
                <div className="provenance-list">
                  <div className="provenance-row">
                    <Check size={12} className="check" />
                    <span>Source</span>
                    <span className="time">{selected.source}</span>
                  </div>
                  <div className="provenance-row">
                    <Check size={12} className="check" />
                    <span>Published</span>
                    <span className="time">{new Date(selected.published).toLocaleString('en-US')}</span>
                  </div>
                  <div className="provenance-row">
                    <Database size={12} className="check" />
                    <span>Changes</span>
                    <span className="time">{sourceMeta(selected.source).impact}</span>
                  </div>
                  <div className="provenance-row">
                    <Database size={12} className="check" />
                    <span>Stored as</span>
                    <span className="time">
                      cached feed item · {selected.simulated ? 'SIMULATED sample' : 'real public record'}
                    </span>
                  </div>
                </div>
              </div>
              {selected.url && (
                <div className="drawer-section">
                  <h3>Original source</h3>
                  <a href={selected.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                    Open public record <ExternalLink size={12} />
                  </a>
                </div>
              )}
              <div className="drawer-section">
                <h3>What it changes in Aegis</h3>
                <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {selected.source === 'NVD'
                    ? 'NVD enrichment refreshes the affected range used by the version-aware gate.'
                    : selected.source === 'CISA KEV'
                      ? 'A KEV addition adds the 10-point exploitation weight and can raise the minimum level for matched alerts.'
                      : selected.source === 'FIRST EPSS'
                        ? 'EPSS updates shift the exploitation component without touching asset context.'
                        : selected.category === 'Adversary behaviour'
                          ? 'ATT&CK mappings connect observed behaviour to techniques shown in the matrix.'
                          : 'Sample advisory content exercises the CERT-In adapter with clearly fake identifiers.'}
                </p>
              </div>
            </div>
          </>
        )}
      </Drawer>
    </div>
  )
}
