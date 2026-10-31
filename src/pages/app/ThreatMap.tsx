import { useMemo, useState } from 'react'
import { geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import worldTopology from 'world-atlas/countries-110m.json'
import { Chart, axisStyle } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { StatsPanel } from '../../components/StatsPanel'
import { SourceBadge } from '../../components/Badges'
import { Globe2, Info, MapPin } from '../../components/Icons'
import { geoPoints } from '../../data/seed'
import { useTheme } from '../../lib/store'
import { fmtInt } from '../../lib/format'
import { entropy, sum } from '../../lib/stats'
import { LEVEL_COLORS, TEAL, hexA } from '../../lib/colors'

const W = 920
const H = 460
const CATEGORIES = ['ALL', 'Scanning', 'Brute force', 'Phishing', 'Malware C2'] as const

const CAT_COLORS: Record<string, string> = {
  Scanning: TEAL,
  'Brute force': '#e08a2f',
  Phishing: '#9b7bd4',
  'Malware C2': '#e5545a',
}

export default function ThreatMap() {
  const theme = useTheme((s) => s.theme)
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('ALL')
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)

  const world = useMemo(() => {
    const topo = worldTopology as any
    return feature(topo, topo.objects.countries) as any
  }, [])

  const { paths, projection } = useMemo(() => {
    const proj = geoNaturalEarth1().fitSize([W, H], { type: 'Sphere' } as any)
    const p = geoPath(proj)
    const countries = (world.features as any[]).map((f, i) => ({ id: f.id ?? `country-${i}`, d: p(f) ?? '' }))
    return { paths: countries, projection: proj }
  }, [world])

  const graticule = useMemo(() => geoPath(projection)(geoGraticule10()) ?? '', [projection])

  const filtered = category === 'ALL' ? geoPoints : geoPoints.filter((g) => g.category === category)
  const max = Math.max(...geoPoints.map((g) => g.count))

  const markers = filtered.map((g) => {
    const xy = projection([g.longitude, g.latitude]) ?? [0, 0]
    return { ...g, x: xy[0], y: xy[1] }
  })

  const hovered = hover ? geoPoints.find((g) => g.id === hover.id) : null
  const total = sum(geoPoints.map((g) => g.count))
  const top5 = [...geoPoints].sort((a, b) => b.count - a.count).slice(0, 5)
  const top5Share = sum(top5.map((g) => g.count)) / total

  const barsOption = useMemo(() => {
    const ax = axisStyle(theme)
    const rows = [...geoPoints].sort((a, b) => b.count - a.count).slice(0, 10)
    return {
      grid: { left: 92, right: 36, top: 8, bottom: 18 },
      xAxis: { type: 'value', ...ax, axisLabel: { ...ax.axisLabel, fontSize: 8, formatter: (v: number) => fmtInt(v) } },
      yAxis: {
        type: 'category',
        data: rows.map((r) => r.country),
        ...ax,
        splitLine: { show: false },
        axisLabel: { ...ax.axisLabel, fontSize: 8.5 },
      },
      tooltip: { formatter: (p: any) => `${p.name}<br/>${fmtInt(p.value)} simulated events` },
      series: [
        {
          type: 'bar',
          barWidth: '54%',
          data: rows.map((r) => ({
            value: r.count,
            itemStyle: { color: hexA(CAT_COLORS[r.category] ?? TEAL, 0.7), borderRadius: [0, 3, 3, 0] },
          })),
          label: { show: true, position: 'right', color: theme === 'dark' ? '#647184' : '#7d8796', fontSize: 8, fontFamily: 'monospace', formatter: (p: any) => fmtInt(p.value) },
        },
      ],
    }
  }, [theme])

  const catOption = useMemo(() => {
    const cats = CATEGORIES.filter((c) => c !== 'ALL') as readonly string[]
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} events ({d}%)' },
      series: [
        {
          type: 'pie',
          radius: ['54%', '76%'],
          center: ['50%', '46%'],
          itemStyle: { borderColor: theme === 'dark' ? '#0a1019' : '#fbf9f4', borderWidth: 3, borderRadius: 4 },
          label: { color: theme === 'dark' ? '#98a5b8' : '#596474', fontSize: 8.5, fontFamily: 'monospace', formatter: '{b}\n{d}%' },
          data: cats.map((c) => ({
            name: c,
            value: sum(geoPoints.filter((g) => g.category === c).map((g) => g.count)),
            itemStyle: { color: CAT_COLORS[c] },
          })),
        },
      ],
    }
  }, [theme])

  const catCounts = CATEGORIES.filter((c) => c !== 'ALL').map((c) => ({
    name: c,
    n: geoPoints.filter((g) => g.category === c).length,
  }))

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 12 · GLOBAL THREAT MAP"
        title="Where the noise originates"
        description="Country-level patterns from demonstration data. These points are illustrative only — they are not observed activity in this organisation."
        actions={
          <div className="inline-flex">
            <SourceBadge source="SIMULATED" />
            <span className="badge simulated">illustrative</span>
          </div>
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
        <div className="kpi">
          <div className="kpi-label">Simulated events</div>
          <div className="kpi-value">{fmtInt(total)}</div>
          <div className="kpi-delta">geo seed data</div>
        </div>
        <div className="kpi teal-tone">
          <div className="kpi-label">Countries</div>
          <div className="kpi-value">{geoPoints.length}</div>
          <div className="kpi-delta">origin points</div>
        </div>
        <div className="kpi amber-tone">
          <div className="kpi-label">Top country</div>
          <div className="kpi-value" style={{ fontSize: 19, lineHeight: 1.25 }}>
            {top5[0].country}
          </div>
          <div className="kpi-delta">{fmtInt(top5[0].count)} events</div>
        </div>
        <div className="kpi high-tone">
          <div className="kpi-label">Top-5 concentration</div>
          <div className="kpi-value">{(top5Share * 100).toFixed(1)}%</div>
          <div className="kpi-delta">share of all events</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Source entropy</div>
          <div className="kpi-value">{entropy(geoPoints.map((g) => g.country)).toFixed(2)}</div>
          <div className="kpi-delta">bits · higher = more spread</div>
        </div>
      </div>

      <div className="dash-grid">
        <Panel
          className="col-8"
          title="Origin distribution"
          sub="Natural Earth 110m boundaries · marker area scales with simulated volume"
          action={
            <div className="seg">
              {CATEGORIES.map((c) => (
                <button key={c} className={category === c ? 'on' : undefined} onClick={() => setCategory(c)}>
                  {c === 'ALL' ? 'All' : c}
                </button>
              ))}
            </div>
          }
          noPad
        >
          <div className="map-wrap">
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="World map of simulated event origins">
              <defs>
                <radialGradient id="map-glow">
                  <stop offset="0%" stopColor={TEAL} stopOpacity="0.45" />
                  <stop offset="100%" stopColor={TEAL} stopOpacity="0" />
                </radialGradient>
              </defs>
              <rect width={W} height={H} fill="transparent" />
              <path d={graticule} fill="none" stroke={theme === 'dark' ? 'rgba(150,168,192,.07)' : 'rgba(23,30,40,.06)'} strokeWidth={0.6} />
              {paths.map((c: { id: string; d: string }) => (
                <path
                  key={c.id}
                  d={c.d}
                  fill={theme === 'dark' ? 'rgba(120,140,165,0.09)' : 'rgba(70,85,100,0.09)'}
                  stroke={theme === 'dark' ? 'rgba(150,168,192,0.18)' : 'rgba(23,30,40,0.16)'}
                  strokeWidth={0.5}
                />
              ))}
              {markers.map((m) => {
                const r = 3 + Math.sqrt(m.count / max) * 14
                const active = hover?.id === m.id
                return (
                  <g key={m.id}>
                    <circle cx={m.x} cy={m.y} r={r * (active ? 2.6 : 2)} fill="url(#map-glow)" opacity={0.5} />
                    <circle
                      cx={m.x}
                      cy={m.y}
                      r={r}
                      fill={hexA(CAT_COLORS[m.category] ?? TEAL, active ? 0.9 : 0.58)}
                      stroke={CAT_COLORS[m.category] ?? TEAL}
                      strokeWidth={active ? 1.6 : 0.8}
                      className="map-marker"
                      onMouseEnter={() => setHover({ id: m.id, x: m.x, y: m.y })}
                      onMouseLeave={() => setHover(null)}
                      tabIndex={0}
                      role="button"
                      aria-label={`${m.country} ${m.count} events`}
                      onFocus={() => setHover({ id: m.id, x: m.x, y: m.y })}
                      onBlur={() => setHover(null)}
                    />
                  </g>
                )
              })}
            </svg>
            {hover && hovered && (
              <div
                className="map-tooltip"
                style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}
              >
                {hovered.country} · {fmtInt(hovered.count)} events
                <br />
                {hovered.category} · simulated
              </div>
            )}
          </div>
          <div className="chart-legend" style={{ padding: '14px 18px' }}>
            {Object.entries(CAT_COLORS).map(([k, v]) => (
              <span className="legend-item" key={k}>
                <i style={{ background: v, borderRadius: '50%' }} /> {k}
              </span>
            ))}
            <span className="legend-item dim">
              <Globe2 size={11} /> marker area = event volume
            </span>
          </div>
        </Panel>

        <div className="col-4" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <Panel title="By category" sub="Simulated events grouped by pattern" noPad>
            <Chart option={catOption} height={230} />
            <div className="chart-legend" style={{ justifyContent: 'center', paddingTop: 0 }}>
              {catCounts.map((c) => (
                <span className="legend-item" key={c.name}>
                  <i style={{ background: CAT_COLORS[c.name] }} /> {c.name} · {c.n}
                </span>
              ))}
            </div>
          </Panel>
          <Panel title="Reading this map" sub="What the data can and cannot support" bodyClass="panel-body">
            <div className="form-alert" style={{ margin: 0 }}>
              <Info size={13} />
              <span>
                Geolocation is demonstrative. It is not derived from your logs, and no real source IP is
                attributed to a country in this demo.
              </span>
            </div>
            <div className="provenance-list mt-12">
              <div className="provenance-row">
                <MapPin size={12} className="check" />
                <span>Country shapes</span>
                <span className="time">Natural Earth 110m</span>
              </div>
              <div className="provenance-row">
                <span className="check">✓</span>
                <span>Event points</span>
                <span className="time">SIMULATED seed</span>
              </div>
              <div className="provenance-row">
                <span className="miss">×</span>
                <span>Real telemetry</span>
                <span className="time">not present</span>
              </div>
            </div>
          </Panel>
        </div>

        <Panel className="col-5" title="Top origins" sub="10 countries · simulated event volume" noPad>
          <Chart option={barsOption} height={330} />
        </Panel>

        <Panel className="col-7" title="Country register" sub="Click a marker or scan the table" noPad>
          <div className="table-wrap" style={{ maxHeight: 330, overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Country</th>
                  <th>ISO</th>
                  <th>Category</th>
                  <th className="right">Events</th>
                  <th className="right">Share</th>
                </tr>
              </thead>
              <tbody>
                {[...geoPoints].sort((a, b) => b.count - a.count).map((g) => (
                  <tr
                    key={g.id}
                    onMouseEnter={() => setHover({ id: g.id, x: 0, y: 0 })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <td>
                      <div className="inline-flex">
                        <i style={{ width: 7, height: 7, borderRadius: '50%', background: CAT_COLORS[g.category] }} />
                        {g.country}
                      </div>
                    </td>
                    <td className="mono">{g.iso}</td>
                    <td className="cell-sub">{g.category}</td>
                    <td className="right mono">{fmtInt(g.count)}</td>
                    <td className="right mono">{((g.count / total) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-note">
            <span className="mono">Simulated · no real attribution</span>
            <span className="mono">{fmtInt(total)} events</span>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'Total events', value: fmtInt(total), formula: 'Σ count_i', n: geoPoints.length },
            { name: 'Mean per country', value: fmtInt(total / geoPoints.length), formula: 'total ÷ countries', n: geoPoints.length },
            { name: 'Top-5 share', value: `${(top5Share * 100).toFixed(1)}%`, formula: 'top-5 counts ÷ total', n: 5 },
            { name: 'Entropy', value: `${entropy(geoPoints.map((g) => g.country)).toFixed(2)} bits`, formula: '−Σ p log₂ p over country distribution', n: geoPoints.length },
            { name: 'Herfindahl index', value: (geoPoints.reduce((a, b) => a + (b.count / total) ** 2, 0) * 10000).toFixed(0), formula: '10,000 × Σ share²', n: geoPoints.length },
          ]}
        />
      </div>

      <div className="page-foot">
        <span className="inline-flex">
          <Info size={11} /> No claim is made that these origins targeted this organisation.
        </span>
        <span className="mono" style={{ color: LEVEL_COLORS.LOW }}>provenance: SIMULATED · Natural Earth public domain</span>
      </div>
    </div>
  )
}
