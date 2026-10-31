import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppWindow, Cloud, MonitorSmartphone, type LucideIcon } from 'lucide-react'
import { Chart, chartFont } from '../../components/Chart'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { Counter } from '../../components/Counter'
import { CriticalityBadge, SeverityBadge, SimulatedBadge, UploadBadge } from '../../components/Badges'
import { EmptyState } from '../../components/EmptyState'
import {
  Activity,
  ArrowRight,
  ChevronDown,
  Database,
  Globe2,
  Info,
  Layers,
  Lock,
  Network,
  Radar,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
} from '../../components/Icons'
import { assets as seedAssets, DEMO_NOW } from '../../data/seed'
import { useLiveActiveAlerts, useLiveAlerts, useLiveSuppressedAlerts } from '../../lib/liveData'
import { useAuth, useFilters, useTheme } from '../../lib/store'
import { allUploadedAssets, useUploads } from '../../lib/uploads'
import { fmtScore, timeAgo } from '../../lib/format'
import { mean, median } from '../../lib/stats'
import { LEVEL_COLORS, hexA } from '../../lib/colors'
import type { Alert, Asset, AssetType, Criticality, RiskLevel } from '../../lib/types'
import './assets.css'

/* ---------- static maps ---------- */

const TYPE_META: Record<AssetType, { label: string; icon: LucideIcon; ink: string; soft: string }> = {
  server: { label: 'Server', icon: Server, ink: '#b4531f', soft: '#fdeee2' },
  app: { label: 'Application', icon: AppWindow, ink: '#3b5f8a', soft: '#eaf0f7' },
  endpoint: { label: 'Endpoint', icon: MonitorSmartphone, ink: '#6c5a8a', soft: '#f0ecf6' },
  network: { label: 'Network', icon: Network, ink: '#2f7a6b', soft: '#e7f3ef' },
  database: { label: 'Database', icon: Database, ink: '#8a5a35', soft: '#f5ede4' },
  cloud: { label: 'Cloud', icon: Cloud, ink: '#4a7290', soft: '#eaf1f5' },
}

const CRITICALITY_META: Record<Criticality, { ink: string; soft: string }> = {
  HIGH: { ink: '#c13f36', soft: '#fbeae7' },
  MEDIUM: { ink: '#8f7213', soft: '#f8f2da' },
  LOW: { ink: '#2f8f62', soft: '#e7f3ec' },
}

const LEVEL_SEGMENTS: { level: RiskLevel; color: string; label: string }[] = [
  { level: 'CRITICAL', color: 'var(--xp-level-critical)', label: 'Critical' },
  { level: 'HIGH', color: 'var(--xp-level-high)', label: 'High' },
  { level: 'MEDIUM', color: 'var(--xp-level-medium)', label: 'Medium' },
  { level: 'LOW', color: 'var(--xp-level-low)', label: 'Low' },
]

const LENSES = [
  { id: 'ACTIVE', label: 'Active' },
  { id: 'MATCHED', label: 'Matched' },
  { id: 'UNKNOWN', label: 'Unverified' },
  { id: 'SUPPRESSED', label: 'Suppressed' },
] as const

type Lens = (typeof LENSES)[number]['id']

const LENS_LABEL: Record<Lens, string> = {
  ACTIVE: 'active alerts ranked by score',
  MATCHED: 'alerts where the version falls in range',
  UNKNOWN: 'alerts waiting on a version check',
  SUPPRESSED: 'candidates stopped by the relevance gate',
}

/* ---------- helpers ---------- */

const alertsFor = (list: Alert[], assetId: string) => list.filter((a) => a.asset.id === assetId)

const topScore = (list: Alert[]) => Math.max(0, ...list.map((a) => a.score))

const topLevel = (list: Alert[]): RiskLevel | null =>
  (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskLevel[]).find((l) => list.some((a) => a.level === l)) ?? null

const pct = (part: number, total: number) => Math.round((part / Math.max(1, total)) * 100)

const pct1 = (part: number, total: number) => ((part / Math.max(1, total)) * 100).toFixed(1)

const arcPlot = (radius: number, deg: number) => {
  const rad = (deg * Math.PI) / 180
  return { x: 140 + radius * Math.cos(rad), y: 140 + radius * Math.sin(rad) }
}

const arcPath = (radius: number, start: number, end: number) => {
  const s = arcPlot(radius, start)
  const e = arcPlot(radius, end)
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
}

/* ---------- small pieces ---------- */

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

function TypeTile({ type }: { type: AssetType }) {
  const meta = TYPE_META[type]
  const Icon = meta.icon
  return (
    <span className="xp-type-tile" style={{ '--tile-ink': meta.ink, '--tile-soft': meta.soft } as CSSProperties}>
      <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
    </span>
  )
}

function MiniStat({
  icon,
  value,
  label,
  ink,
  soft,
  rule,
}: {
  icon: ReactNode
  value: ReactNode
  label: string
  ink: string
  soft: string
  rule: string
}) {
  return (
    <div className="xp-mini">
      <span className="xp-mini-ico" style={{ '--mini-ink': ink, '--mini-soft': soft } as CSSProperties}>
        {icon}
      </span>
      <div className="xp-mini-val">{value}</div>
      <div className="xp-mini-label">{label}</div>
      <span className="xp-mini-rule" style={{ '--mini-rule': rule } as CSSProperties} />
    </div>
  )
}

/* ---------- page ---------- */

export default function Assets() {
  const activeAlerts = useLiveActiveAlerts()
  const suppressedAlerts = useLiveSuppressedAlerts()
  const navigate = useNavigate()
  const session = useAuth((s) => s.session)
  const theme = useTheme((s) => s.theme)
  const query = useFilters((s) => s.query)
  const setQuery = useFilters((s) => s.setQuery)
  const [dept, setDept] = useState('ALL')
  const [criticality, setCriticality] = useState<'ALL' | Criticality>('ALL')
  const [exposure, setExposure] = useState<'ALL' | 'EXPOSED' | 'INTERNAL'>('ALL')
  const [selected, setSelected] = useState<Asset | null>(null)
  const [lens, setLens] = useState<Lens>('ACTIVE')

  const uploadDatasets = useUploads((s) => s.datasets)
  const uploadedAssets = useMemo(() => allUploadedAssets(uploadDatasets), [uploadDatasets])
  const inventory = useMemo(() => [...uploadedAssets, ...seedAssets], [uploadedAssets])
  const departments = useMemo(() => [...new Set(inventory.map((a) => a.department))], [inventory])

  const enriched = useMemo(
    () =>
      inventory.map((asset) => {
        const list = alertsFor(activeAlerts, asset.id)
        return {
          asset,
          alerts: list,
          top: topScore(list),
          level: topLevel(list),
          versioned: asset.software.every((s) => s.version !== 'unknown'),
        }
      }),
    [inventory, activeAlerts],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return enriched
      .filter((e) => (dept === 'ALL' ? true : e.asset.department === dept))
      .filter((e) => (criticality === 'ALL' ? true : e.asset.criticality === criticality))
      .filter((e) =>
        exposure === 'ALL' ? true : exposure === 'EXPOSED' ? e.asset.internetFacing : !e.asset.internetFacing,
      )
      .filter((e) =>
        q
          ? `${e.asset.name} ${e.asset.department} ${e.asset.software.map((s) => `${s.vendor} ${s.product} ${s.version}`).join(' ')}`
              .toLowerCase()
              .includes(q)
          : true,
      )
      .sort((a, b) => b.top - a.top)
  }, [enriched, dept, criticality, exposure, query])

  const exposed = inventory.filter((a) => a.internetFacing)
  const criticalAssets = inventory.filter((a) => a.criticality === 'HIGH')
  const versioned = inventory.filter((a) => a.software.every((s) => s.version !== 'unknown'))
  const perAsset = enriched.map((e) => e.alerts.length)

  const levelCounts = useMemo(() => {
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, CLEAN: 0 }
    enriched.forEach((e) => {
      if (e.level) counts[e.level] += 1
      else counts.CLEAN += 1
    })
    return counts
  }, [enriched])

  const gaugeSegments = useMemo(() => {
    const total = Math.max(1, inventory.length)
    const parts = [
      ...LEVEL_SEGMENTS.map((l) => ({ key: l.level, value: levelCounts[l.level], stroke: l.color })),
      { key: 'CLEAN', value: levelCounts.CLEAN, stroke: 'url(#xp-gauge-hatch)' },
    ]
    let cursor = 180
    return parts
      .filter((p) => p.value > 0)
      .map((part, index) => {
        const sweep = (part.value / total) * 180
        const start = cursor
        cursor += sweep
        const pad = Math.min(2.2, sweep / 3.5)
        return { ...part, start: start + pad, end: cursor - pad, index }
      })
  }, [inventory.length, levelCounts])

  const lensAlerts = useMemo(() => {
    if (lens === 'MATCHED') return activeAlerts.filter((a) => a.relevance === 'MATCHED')
    if (lens === 'UNKNOWN') return activeAlerts.filter((a) => a.relevance === 'VERSION_UNKNOWN')
    if (lens === 'SUPPRESSED') return suppressedAlerts
    return activeAlerts
  }, [lens, activeAlerts, suppressedAlerts])

  const daily = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const start = new Date(DEMO_NOW.getTime())
      start.setUTCHours(0, 0, 0, 0)
      start.setUTCDate(start.getUTCDate() - (7 - i))
      const end = start.getTime() + 86400000
      return {
        label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        count: lensAlerts.filter((a) => {
          const t = new Date(a.createdAt).getTime()
          return t >= start.getTime() && t < end
        }).length,
      }
    })
  }, [lensAlerts])

  const peakIndex = useMemo(() => daily.reduce((best, d, i) => (d.count > daily[best].count ? i : best), 0), [daily])
  const peak = daily[peakIndex]
  const windowLabel = `${daily[0].label} – ${daily[daily.length - 1].label}`

  const bands = useMemo(() => {
    const total = Math.max(1, lensAlerts.length)
    const critical = lensAlerts.filter((a) => a.level === 'CRITICAL').length
    const high = lensAlerts.filter((a) => a.level === 'HIGH').length
    const mediumLow = lensAlerts.filter((a) => a.level === 'MEDIUM' || a.level === 'LOW').length
    return [
      { key: 'critical', label: 'Critical', count: critical, color: 'var(--xp-level-critical)', foot: `${pct(critical, total)}% of this lens` },
      { key: 'high', label: 'High', count: high, color: 'var(--xp-level-high)', foot: `${pct(high, total)}% of this lens` },
      { key: 'rest', label: 'Medium & low', count: mediumLow, color: 'var(--xp-level-low)', foot: `${pct(mediumLow, total)}% of this lens` },
    ]
  }, [lensAlerts])

  const chartOption = useMemo(() => {
    const peakValue = peak.count
    const dark = theme === 'dark'
    const pointRing = dark ? '#121f2c' : '#fffdf9'
    const accent = dark ? '#ff6a36' : '#ff5a1f'
    const accentRgb = dark ? '255, 106, 54' : '255, 90, 31'
    return {
      grid: { left: 20, right: 16, top: 16, bottom: 22 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: daily.map((d) => d.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: dark ? '#7e93a8' : '#a29a8e',
          fontSize: 8,
          fontFamily: chartFont,
          margin: 12,
          interval: 1,
        },
      },
      yAxis: {
        type: 'value',
        show: false,
        min: 0,
        max: Math.max(3, Math.ceil(peakValue * 1.15)),
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: dark ? 'rgba(12, 23, 37, 0.97)' : 'rgba(16, 32, 54, 0.97)',
        borderColor: 'rgba(255, 255, 255, 0.16)',
        borderWidth: 1,
        padding: [9, 11],
        extraCssText: 'box-shadow: 0 20px 40px -18px rgba(4,10,18,.8); border-radius: 10px;',
        textStyle: { color: '#eef4fb', fontSize: 10.5, fontFamily: chartFont, lineHeight: 18 },
        axisPointer: { type: 'line', lineStyle: { color: `rgba(${accentRgb}, 0.4)`, type: 'dashed' } },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params
          const row = daily[p.dataIndex]
          return `<span style="font-family:monospace;font-size:8.5px;letter-spacing:.1em;color:#9db0c6">${row.label.toUpperCase()}</span><br/><b style="font-size:16px">${row.count}</b> <span style="color:#9db0c6">alerts</span>`
        },
      },
      series: [
        {
          type: 'line',
          data: daily.map((d) => d.count),
          smooth: 0.45,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: {
            width: 2.4,
            color: accent,
            shadowColor: `rgba(${accentRgb}, 0.28)`,
            shadowBlur: 12,
            shadowOffsetY: 9,
          },
          itemStyle: { color: accent, borderColor: pointRing, borderWidth: 2 },
          emphasis: { scale: 1.6, itemStyle: { color: accent } },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `rgba(${accentRgb}, 0.3)` },
                { offset: 0.55, color: `rgba(${accentRgb}, 0.1)` },
                { offset: 1, color: `rgba(${accentRgb}, 0)` },
              ],
            },
          },
          markPoint: {
            silent: true,
            symbol: 'circle',
            symbolSize: 10,
            itemStyle: {
              color: accent,
              borderColor: pointRing,
              borderWidth: 2.5,
              shadowColor: `rgba(${accentRgb}, 0.45)`,
              shadowBlur: 12,
            },
            label: { show: false },
            data: peakValue ? [{ xAxis: peak.label, yAxis: peakValue }] : [],
          },
        },
      ],
    }
  }, [daily, peak, theme])

  const topSystems = useMemo(
    () =>
      [...enriched]
        .filter((e) => e.top > 0)
        .sort((a, b) => b.top - a.top)
        .slice(0, 6),
    [enriched],
  )

  const cohorts = useMemo(() => {
    const rows = departments.map((department) => {
      const list = enriched.filter((e) => e.asset.department === department)
      const known = list.filter((e) => e.versioned).length
      const ratio = known / Math.max(1, list.length)
      let dots = Math.round(ratio * 10)
      if (known > 0) dots = Math.max(1, dots)
      if (known < list.length) dots = Math.min(9, dots)
      return { department, total: list.length, known, ratio, dots }
    })
    return rows.sort((a, b) => a.ratio - b.ratio || b.total - a.total)
  }, [departments, enriched])

  const certainty = pct1(versioned.length, inventory.length)
  const visibleCohorts = cohorts.slice(0, 8)

  const resetFilters = () => {
    setDept('ALL')
    setCriticality('ALL')
    setExposure('ALL')
    setQuery('')
  }

  return (
    <div className="exposure-page">
      <div className="xp-shell">
        <div className="xp-head">
          <div className="xp-head-copy">
            <span className="xp-eyebrow">Component 06 · Asset exposure</span>
            <h1>
              Your side of the <em>correlation</em>.
            </h1>
            <p>
              Seeded demo systems plus every inventory accepted in the Data Input Hub, with the software versions that
              drive correlation. Version is the hinge: a product name alone is not a match.
            </p>
          </div>
          <div className="xp-head-side">
            <span className="xp-org">
              <span className="xp-org-avatar">AD</span>
              <span className="xp-org-copy">
                <b>Aegis demo org</b>
                <small>
                  {inventory.length} systems · {departments.length} departments
                </small>
              </span>
            </span>
            <div className="xp-actions">
              <button type="button" className="xp-btn xp-btn-light" onClick={() => navigate('/app/cves')}>
                <Search size={13} /> CVE explorer
              </button>
              <button
                type="button"
                className="xp-btn xp-btn-dark"
                onClick={() => navigate('/app/uploads')}
                disabled={session?.role !== 'ADMIN'}
                title={session?.role !== 'ADMIN' ? 'Admin access required for ingestion' : undefined}
              >
                <Upload size={13} /> Upload inventory
              </button>
            </div>
          </div>
        </div>

        <div className="xp-grid">
          <section className="xp-card xp-gauge-card" aria-label="Exposure mix">
            <CardHead
              icon={<ShieldAlert size={16} />}
              title="Exposure mix"
              sub="Each system placed by its highest active alert"
              tone="orange"
              action={
                <InfoTip text="Each system is counted once, under its most severe active alert. Suppressed candidates never place a system." />
              }
            />
            <div className="xp-gauge-ring">
              <svg viewBox="0 0 280 164" role="img" aria-label={`${inventory.length} systems by exposure band`}>
                <defs>
                  <pattern id="xp-gauge-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" className="xp-hatch-fill" />
                    <line x1="0" y1="0" x2="0" y2="6" className="xp-hatch-line" strokeWidth="1.7" />
                  </pattern>
                </defs>
                <path d={arcPath(100, 180, 360)} fill="none" strokeWidth={24} strokeLinecap="round" className="xp-gauge-track" />
                {gaugeSegments.map((seg) => (
                  <path
                    key={seg.key}
                    d={arcPath(100, seg.start, seg.end)}
                    fill="none"
                    strokeWidth={24}
                    strokeLinecap="round"
                    pathLength={100}
                    strokeDasharray="100"
                    strokeDashoffset="100"
                    className="xp-gauge-arc"
                    style={{ stroke: seg.stroke, animationDelay: `${0.15 + seg.index * 0.09}s` }}
                  />
                ))}
              </svg>
              <div className="xp-gauge-center">
                <span className="xp-gauge-num">
                  <Counter to={inventory.length} duration={1100} />
                </span>
                <span className="xp-gauge-label">systems in scope</span>
              </div>
            </div>
            <div className="xp-gauge-legend">
              {LEVEL_SEGMENTS.map((l) => (
                <span key={l.level}>
                  <i style={{ background: l.color }} />
                  <b>{levelCounts[l.level]}</b> {l.label.toLowerCase()}
                </span>
              ))}
              <span>
                <i className="xp-gauge-clean" />
                <b>{levelCounts.CLEAN}</b> clean
              </span>
            </div>
            <div className="xp-gauge-band">
              <MiniStat
                icon={<Globe2 size={13} />}
                value={exposed.length}
                label="Internet-facing"
                ink="#c9521c"
                soft="#ffeadf"
                rule="var(--xp-orange)"
              />
              <MiniStat
                icon={<ShieldAlert size={13} />}
                value={criticalAssets.length}
                label="Criticality high"
                ink="#31465f"
                soft="#e9eef4"
                rule="var(--xp-level-high)"
              />
              <MiniStat
                icon={<ShieldCheck size={13} />}
                value={
                  <>
                    {versioned.length}
                    <small> / {inventory.length}</small>
                  </>
                }
                label="Version known"
                ink="var(--xp-green)"
                soft="#e7f3ec"
                rule="var(--xp-green)"
              />
            </div>
          </section>

          <section className="xp-card xp-pressure-card" aria-label="Alert pressure">
            <CardHead
              icon={<Activity size={16} />}
              title="Alert pressure"
              sub="Lenses swap the relevance gate over the last eight days"
              action={
                <div className="xp-tabs" role="tablist" aria-label="Alert lens">
                  {LENSES.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      role="tab"
                      aria-selected={lens === l.id}
                      className={lens === l.id ? 'xp-tab on' : 'xp-tab'}
                      onClick={() => setLens(l.id)}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="xp-pressure-body">
              <div className="xp-pressure-left">
                <span className="xp-big-num">
                  <Counter to={lensAlerts.length} duration={900} />
                </span>
                <span className="xp-big-label">{LENS_LABEL[lens]}</span>
                <span className="xp-big-meta">
                  {windowLabel} · {inventory.length} systems in scope
                </span>
                <div className="xp-big-actions">
                  <button type="button" className="xp-pill" onClick={() => navigate('/app/alerts')}>
                    Open alert queue <ArrowRight size={11} />
                  </button>
                </div>
                <div className="xp-bars">
                  {bands.map((b) => {
                    const share = pct(b.count, lensAlerts.length)
                    return (
                      <div key={b.key} style={{ '--xp-tone': b.color } as CSSProperties}>
                        <div className="xp-bar-head">
                          <span className="xp-bar-name">{b.label}</span>
                          <span className="xp-bar-pct">{share}%</span>
                        </div>
                        <div className="xp-bar-track">
                          <span className="xp-bar-fill" style={{ '--w': `${share}%` } as CSSProperties} />
                        </div>
                        <div className="xp-bar-foot">
                          {b.count} alerts · {b.foot}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="xp-chartbox">
                <div className="xp-callout" aria-hidden="true">
                  <div className="xp-callout-top">
                    <span>Daily alerts</span>
                    <span className="xp-callout-tag">Peak</span>
                  </div>
                  <div className="xp-callout-main">
                    <span className="xp-callout-num">{peak.count}</span>
                    <span className="xp-callout-unit">
                      alerts
                      <br />
                      {peak.label}
                    </span>
                  </div>
                  <div className="xp-callout-stack">
                    {bands.map((b) =>
                      b.count ? (
                        <i
                          key={b.key}
                          style={{
                            width: `${(b.count / Math.max(1, lensAlerts.length)) * 100}%`,
                            background: b.key === 'rest' ? 'var(--xp-callout-rest)' : b.color,
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                  <div className="xp-callout-legend">
                    {bands.map((b) => (
                      <span key={b.key}>
                        <i style={{ background: b.key === 'rest' ? 'var(--xp-callout-rest)' : b.color }} />
                        {b.label} {b.count}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="xp-chart">
                  <Chart option={chartOption} height={184} />
                </div>
                <div className="xp-chart-foot">
                  <div className="xp-chart-stat" style={{ '--xp-tone': 'var(--xp-orange)' } as CSSProperties}>
                    <span className="xp-chart-stat-label">Internet-facing</span>
                    <strong>
                      {pct(exposed.length, inventory.length)}% <small>{exposed.length}/{inventory.length}</small>
                    </strong>
                  </div>
                  <div className="xp-chart-stat" style={{ '--xp-tone': 'var(--xp-green)' } as CSSProperties}>
                    <span className="xp-chart-stat-label">Version known</span>
                    <strong>
                      {pct(versioned.length, inventory.length)}% <small>{versioned.length}/{inventory.length}</small>
                    </strong>
                  </div>
                  <div className="xp-chart-stat" style={{ '--xp-tone': 'var(--xp-level-high)' } as CSSProperties}>
                    <span className="xp-chart-stat-label">Criticality high</span>
                    <strong>
                      {pct(criticalAssets.length, inventory.length)}%{' '}
                      <small>{criticalAssets.length}/{inventory.length}</small>
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="xp-card xp-list-card" aria-label="Most exposed systems">
            <CardHead
              icon={<Radar size={16} />}
              title="Most exposed systems"
              sub="Top six by maximum active alert score"
            />
            <div className="xp-list-body">
              <div className="xp-list-head">
                <span>System</span>
                <span>Score</span>
                <span>Alerts</span>
                <span />
              </div>
              {topSystems.length === 0 ? (
                <div className="xp-empty">
                  <span className="xp-empty-icon">
                    <ShieldCheck size={16} />
                  </span>
                  <strong>No active alerts</strong>
                  <span>Every inventoried system is clean against the current demo feed.</span>
                </div>
              ) : (
                topSystems.map((e) => (
                  <button type="button" key={e.asset.id} className="xp-list-row" onClick={() => setSelected(e.asset)}>
                    <span className="xp-row-main">
                      <TypeTile type={e.asset.type} />
                      <span className="xp-row-copy">
                        <span className="xp-row-name">{e.asset.name}</span>
                        <span className="xp-row-sub">
                          {e.asset.id} · {e.asset.department}
                        </span>
                      </span>
                    </span>
                    <span className="xp-row-score">
                      <i style={{ background: LEVEL_COLORS[e.level ?? 'LOW'] }} />
                      {fmtScore(e.top)}
                    </span>
                    <span className="xp-row-alerts">{e.alerts.length}</span>
                    <span className="xp-row-arrow">
                      <ArrowRight size={12} />
                    </span>
                  </button>
                ))
              )}
              <div className="xp-list-foot">
                <span>Score = severity + exploit + asset</span>
                <button type="button" className="xp-pill" onClick={() => navigate('/app/scoring')}>
                  Score model <ArrowRight size={11} />
                </button>
              </div>
            </div>
          </section>

          <section className="xp-card xp-cohort-card" aria-label="Version certainty by team">
            <CardHead
              icon={<Layers size={16} />}
              title="Version certainty by team"
              sub="A verified version is what turns a name into a match"
              action={
                <InfoTip text="Version certainty counts systems where every installed product carries a known version. One cell represents roughly 10% of a team's systems." />
              }
            />
            <div className="xp-cohort-body">
              <div className="xp-cohort-hero">
                <div>
                  <span className="xp-cohort-num">
                    <Counter to={Number(certainty)} duration={1100} />
                    <small>%</small>
                  </span>
                  <div className="xp-cohort-label">of systems carry a verified version</div>
                  <div className="xp-cohort-note">
                    {inventory.length - versioned.length === 0
                      ? 'Every system carries a known version.'
                      : `${inventory.length - versioned.length} ${
                          inventory.length - versioned.length === 1 ? 'system hides' : 'systems hide'
                        } at least one product behind “unknown”.`}
                  </div>
                </div>
                <div className="xp-cohort-legend">
                  <span>
                    <i style={{ background: 'var(--xp-level-critical)' }} /> Version verified
                  </span>
                  <span>
                    <i style={{ background: 'var(--xp-level-high)' }} /> Needs verification
                  </span>
                </div>
              </div>
              <div className="xp-cohort-rows">
                {visibleCohorts.map((c) => (
                  <div className="xp-cohort-row" key={c.department}>
                    <span className="xp-cohort-dept" title={c.department}>
                      {c.department}
                    </span>
                    <span className="xp-dots" aria-hidden="true">
                      {Array.from({ length: 10 }, (_, i) => (
                        <span
                          key={i}
                          className={i < c.dots ? 'xp-dot verified' : 'xp-dot unverified'}
                          style={{ animationDelay: `${0.18 + i * 0.015}s` }}
                        />
                      ))}
                    </span>
                    <span className="xp-cohort-pct">{Math.round(c.ratio * 100)}%</span>
                  </div>
                ))}
                <div className="xp-cohort-foot">
                  Each cell ≈ 10% of a team · {cohorts.length > visibleCohorts.length
                    ? `${cohorts.length - visibleCohorts.length} more teams`
                    : `${versioned.length}/${inventory.length} verified`}
                </div>
              </div>
            </div>
          </section>

          <section className="xp-card xp-register-card" id="asset-register" aria-label="Asset register">
            <CardHead
              icon={<Server size={16} />}
              title="Asset register"
              sub={`${filtered.length} of ${inventory.length} systems · sorted by maximum score`}
              tone="orange"
              action={
                <span
                  className="xp-source-chip"
                  style={{ '--xp-tone': uploadedAssets.length ? 'var(--xp-orange)' : 'var(--xp-muted-2)' } as CSSProperties}
                  title="Seeded rows are SIMULATED; accepted uploads carry USER UPLOAD and persist in this browser."
                >
                  {uploadedAssets.length ? `Mixed · ${uploadedAssets.length} uploaded` : 'Simulated inventory'}
                </span>
              }
            />
            <div className="xp-register-body">
              <div className="xp-filters">
                <label className="xp-search">
                  <Search size={13} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search asset or software…"
                    aria-label="Search assets"
                  />
                </label>
                <span className="xp-selectwrap">
                  <select className="xp-select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
                    <option value="ALL">All departments</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={12} />
                </span>
                <div className="xp-seg" role="group" aria-label="Criticality">
                  {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={criticality === c ? 'on' : undefined}
                      aria-pressed={criticality === c}
                      onClick={() => setCriticality(c)}
                    >
                      {c === 'ALL' ? 'Any criticality' : c}
                    </button>
                  ))}
                </div>
                <div className="xp-seg" role="group" aria-label="Exposure">
                  {(['ALL', 'EXPOSED', 'INTERNAL'] as const).map((e) => (
                    <button
                      key={e}
                      type="button"
                      className={exposure === e ? 'on' : undefined}
                      aria-pressed={exposure === e}
                      onClick={() => setExposure(e)}
                    >
                      {e === 'ALL' ? 'Any exposure' : e === 'EXPOSED' ? 'Internet-facing' : 'Internal'}
                    </button>
                  ))}
                </div>
                <span className="xp-filters-count">
                  {filtered.length} / {inventory.length} systems
                </span>
              </div>

              {filtered.length === 0 ? (
                <div className="xp-empty xp-empty-register">
                  <span className="xp-empty-icon">
                    <SlidersHorizontal size={16} />
                  </span>
                  <strong>No system matches these filters</strong>
                  <span>Clear the department, criticality, or exposure filter to bring the register back.</span>
                  <button type="button" className="xp-pill" style={{ marginTop: 10 }} onClick={resetFilters}>
                    Reset filters
                  </button>
                </div>
              ) : (
                <div className="xp-table-wrap">
                  <table className="xp-table">
                    <thead>
                      <tr>
                        <th>Asset</th>
                        <th>Department</th>
                        <th>Software</th>
                        <th>Criticality</th>
                        <th>Exposure</th>
                        <th className="right">Alerts</th>
                        <th className="right">Top score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(({ asset: a, alerts: list, top, level }) => {
                        const risk = CRITICALITY_META[a.criticality]
                        const softwareLabel = a.software
                          .map((s) => `${s.vendor} ${s.product} ${s.version === 'unknown' ? 'unverified' : s.version}`)
                          .join(' · ')
                        return (
                          <tr key={a.id} onClick={() => setSelected(a)}>
                            <td>
                              <div className="xp-table-asset">
                                <TypeTile type={a.type} />
                                <button
                                  type="button"
                                  className="xp-asset-btn"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelected(a)
                                  }}
                                >
                                  <span className="xp-table-name">
                                    {a.name}
                                    {a.source === 'USER UPLOAD' && <i className="xp-mini-tag">upload</i>}
                                  </span>
                                  <span className="xp-table-sub">
                                    {a.id} · {TYPE_META[a.type].label}
                                  </span>
                                </button>
                              </div>
                            </td>
                            <td>{a.department}</td>
                            <td>
                              <span className="xp-soft" title={softwareLabel}>
                                {a.software.map((s, i) => (
                                  <span key={`${s.vendor}-${s.product}-${i}`}>
                                    {i > 0 && ' · '}
                                    {s.vendor} <b>{s.product}</b>{' '}
                                    {s.version === 'unknown' ? (
                                      <em className="xp-unknown">unverified</em>
                                    ) : (
                                      s.version
                                    )}
                                  </span>
                                ))}
                              </span>
                            </td>
                            <td>
                              <span
                                className="xp-risk-chip"
                                style={{ '--xp-risk-ink': risk.ink, '--xp-risk-soft': risk.soft } as CSSProperties}
                              >
                                <i /> {a.criticality}
                              </span>
                            </td>
                            <td>
                              {a.internetFacing ? (
                                <span className="xp-exposure-chip">
                                  <Globe2 size={10} /> Internet
                                </span>
                              ) : (
                                <span className="xp-internal">
                                  <Lock size={10} /> Internal
                                </span>
                              )}
                            </td>
                            <td className="right">
                              <span className="xp-count">{list.length}</span>
                            </td>
                            <td className="right">
                              {level ? (
                                <span className="xp-scorecell">
                                  <span className={`xp-scoreval ${level.toLowerCase()}`}>{fmtScore(top)}</span>
                                  <span className="xp-scoretrack">
                                    <i style={{ width: `${top}%`, background: LEVEL_COLORS[level] }} />
                                  </span>
                                </span>
                              ) : (
                                <span className="xp-dim">clean</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="xp-table-foot">
                <span className="xp-inline">
                  <Server size={11} /> Seeded rows are SIMULATED; accepted uploads carry USER UPLOAD and persist in this
                  browser.
                </span>
                <span className="mono">
                  {activeAlerts.length} active · {suppressedAlerts.length} suppressed
                </span>
              </div>
            </div>
          </section>

          <section className="xp-card xp-methods-card" aria-label="Statistics">
            <div className="xp-methods">
              <div className="xp-methods-head">
                <strong>How each number is built</strong>
                <span>Layer B statistics · seeded demo window · every figure is recomputed from the inventory.</span>
              </div>
              <div className="xp-method-grid">
                <div className="xp-method" title="Active alerts divided by the number of inventoried systems.">
                  <strong>{mean(perAsset).toFixed(2)}</strong>
                  <span>Mean alerts per asset</span>
                  <small>active alerts ÷ assets · n={inventory.length}</small>
                </div>
                <div className="xp-method" title="Median number of active alerts attached to a system.">
                  <strong>{median(perAsset).toFixed(1)}</strong>
                  <span>Median alerts per asset</span>
                  <small>median of counts · n={inventory.length}</small>
                </div>
                <div className="xp-method" title="Share of systems reachable from the internet.">
                  <strong>{pct(exposed.length, inventory.length)}%</strong>
                  <span>Internet-facing share</span>
                  <small>exposed ÷ assets · n={inventory.length}</small>
                </div>
                <div className="xp-method" title="Share of systems marked HIGH business criticality.">
                  <strong>{pct(criticalAssets.length, inventory.length)}%</strong>
                  <span>High-criticality share</span>
                  <small>HIGH ÷ assets · n={inventory.length}</small>
                </div>
                <div className="xp-method" title="Share of systems where every installed product has a known version.">
                  <strong>{certainty}%</strong>
                  <span>Version certainty</span>
                  <small>versioned ÷ assets · n={inventory.length}</small>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} label={selected ? selected.name : 'Asset'}>
        {selected && <AssetDetail asset={selected} onClose={() => setSelected(null)} />}
      </Drawer>
    </div>
  )
}

/* ---------- drawer ---------- */

function AssetDetail({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const alerts = useLiveAlerts()
  const list = alerts.filter((a) => a.asset.id === asset.id)
  const active = list.filter((a) => !a.suppressed)
  return (
    <>
      <DrawerHead
        overline={`${asset.id} · ${asset.type.toUpperCase()} · ${asset.department.toUpperCase()}`}
        title={asset.name}
        onClose={onClose}
        meta={
          <span className="inline-flex" style={{ flexWrap: 'wrap', gap: 8 }}>
            <CriticalityBadge level={asset.criticality} />
            {asset.internetFacing ? <span className="badge high">Internet-facing</span> : <span className="badge suppressed">Internal</span>}
            {asset.source === 'USER UPLOAD' ? <UploadBadge /> : <SimulatedBadge />}
          </span>
        }
      />
      <div className="drawer-body">
        <div className="drawer-section">
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            {asset.businessFunction}. Data sensitivity is {asset.sensitivity.toLowerCase()}.
          </p>
        </div>
        <div className="drawer-section">
          <h3>Installed software</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Product</th>
                  <th className="right">Version</th>
                </tr>
              </thead>
              <tbody>
                {asset.software.map((s) => (
                  <tr key={`${s.vendor}-${s.product}`}>
                    <td>{s.vendor}</td>
                    <td>{s.product}</td>
                    <td className="right mono">{s.version === 'unknown' ? 'unverified' : s.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="drawer-section">
          <h3>Correlated alerts</h3>
          {list.length === 0 ? (
            <EmptyState title="No correlation candidates" hint="No ingested CVE references this software." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {list.map((a) => (
                <div
                  key={a.id}
                  className="action-box"
                  style={{ borderColor: a.suppressed ? 'var(--line)' : hexA(LEVEL_COLORS[a.level], 0.3) }}
                >
                  <div className="inline-flex" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <strong style={{ fontSize: 12 }}>{a.cve.id}</strong>
                    <span className="inline-flex" style={{ gap: 6 }}>
                      <SeverityBadge level={a.level} suppressed={a.suppressed} />
                      <span className="mono">{fmtScore(a.score)}</span>
                    </span>
                  </div>
                  <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 5 }}>{a.cve.title}</p>
                  <div className="mono" style={{ marginTop: 5, fontSize: 8.5 }}>
                    {a.relevance} · raised {timeAgo(a.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="drawer-section">
          <h3>Exposure summary</h3>
          <div className="provenance-list">
            <div className="provenance-row">
              <Network size={12} className="check" />
              <span>Network position</span>
              <span className="time">{asset.internetFacing ? 'Internet-facing' : 'Internal only'}</span>
            </div>
            <div className="provenance-row">
              <Globe2 size={12} className="check" />
              <span>Correlated alerts</span>
              <span className="time">
                {active.length} active · {list.length - active.length} suppressed
              </span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm mt-16" onClick={onClose}>
            Close <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </>
  )
}
