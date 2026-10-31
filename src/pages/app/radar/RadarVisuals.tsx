import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react'
import { clamp, fmtPct } from '../../../lib/format'
import { hexA } from '../../../lib/colors'
import { DEMO_NOW } from '../../../data/seed'
import { useTheme } from '../../../lib/store'
import type { Cve } from '../../../lib/types'

export type RadarSeries = {
  id: string
  color: string
  cve: Cve
  points: { date: string; value: number }[]
  current: number
  weekAgo: number
  delta: number
  slope: number
  r2: number
  today: number
  ageYears: number
}

const shortId = (id: string) => id.replace('CVE-', '')
const signedPP = (value: number, digits = 1) =>
  `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(digits)}pp`

/* ------------------------------------------------------------------ */
/* hero — single-series probability area                               */
/* ------------------------------------------------------------------ */

function smoothPath(points: { x: number; y: number }[]) {
  if (points.length < 2) return ''
  let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }
  return d
}

export function SignalHeroChart({
  points,
  tone,
  span,
  cveId,
}: {
  points: { date: string; value: number }[]
  tone: string
  span: 7 | 14 | 30
  cveId: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const gradientId = useId().replace(/:/g, '')
  const data = useMemo(() => points.slice(-span), [points, span])
  const W = 600
  const PAD = 12
  const xAt = (i: number) => PAD + (i / (data.length - 1 || 1)) * (W - PAD * 2)
  const yAt = (v: number) => 10 + (1 - v) * 78
  const vertices = data.map((p, i) => ({ x: xAt(i), y: yAt(p.value) }))
  const line = smoothPath(vertices)
  const area = `${line} L${W - PAD},100 L${PAD},100 Z`
  const active = hover ?? data.length - 1
  const reading = data[active]
  const dotX = xAt(active)
  const dotY = yAt(reading.value)
  const endAnchored = active >= Math.ceil((data.length - 1) * 0.92)
  const startAnchored = active <= Math.floor((data.length - 1) * 0.08)
  const lowTag = dotY > 64

  const track = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    setHover(Math.round(ratio * (data.length - 1)))
  }

  return (
    <div className="rdr-hero" style={{ '--tone': tone } as CSSProperties}>
      <div className="rdr-hero-yaxis" aria-hidden="true">
        <span>100%</span>
        <span>50%</span>
        <span>0%</span>
      </div>
      <div
        className="rdr-hero-plot"
        onPointerMove={track}
        onPointerDown={track}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${cveId} EPSS over the last ${span} days: ${fmtPct(data[0].value)} on ${data[0].date} to ${fmtPct(
          data[data.length - 1].value,
        )} on ${data[data.length - 1].date}.`}
      >
        <svg viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`rdr-hero-fill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity="0.38" />
              <stop offset="58%" stopColor={tone} stopOpacity="0.12" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[10, 49, 88].map((y) => (
            <line key={y} className="rdr-hero-grid" x1="0" x2={W} y1={y} y2={y} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={area} fill={`url(#rdr-hero-fill-${gradientId})`} />
          <path
            d={line}
            className="rdr-hero-line"
            style={{ stroke: tone }}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span className="rdr-hero-cursor-line" style={{ left: `${(dotX / W) * 100}%` }} aria-hidden="true" />
        <span
          className="rdr-hero-cursor-dot"
          style={{ left: `${(dotX / W) * 100}%`, top: `${dotY}%`, borderColor: tone }}
          aria-hidden="true"
        />
        <span
          className={`rdr-hero-tag${endAnchored ? ' is-end' : startAnchored ? ' is-start' : ''}${
            lowTag ? ' is-low' : ''
          }`}
          style={{ left: `${(dotX / W) * 100}%`, top: `${dotY}%` }}
          aria-hidden="true"
        >
          <b>{fmtPct(reading.value)}</b>
          {hover !== null && <em>{reading.date}</em>}
        </span>
      </div>
      <div className="rdr-hero-dates" aria-hidden="true">
        <span>{data[0].date}</span>
        <span>{data[Math.floor((data.length - 1) / 2)].date}</span>
        <span>{data[data.length - 1].date}</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* momentum volume — 3D glass bubble field                             */
/* ------------------------------------------------------------------ */

const shortFormat = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}pp`

export function MomentumVolume({
  series,
  selectedId,
  onSelect,
  onReset,
}: {
  series: RadarSeries[]
  selectedId: string
  onSelect: (id: string) => void
  onReset: () => void
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const glowId = `rdr-floor-${useId().replace(/:/g, '')}`
  const dark = useTheme((state) => state.theme) === 'dark'
  const hot = dark ? '#ff6a36' : '#ff5a1f'
  const [stage, setStage] = useState({ w: 820, h: 330 })
  const [hoverId, setHoverId] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = (w: number, h: number) => {
      if (!w || !h) return
      setStage((prev) => (Math.abs(prev.w - w) < 1.5 && Math.abs(prev.h - h) < 1.5 ? prev : { w, h }))
    }
    const rect = el.getBoundingClientRect()
    measure(rect.width, rect.height)
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width, entry.contentRect.height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const meanCurrent = series.reduce((acc, s) => acc + s.current, 0) / series.length
  const meanPrior = series.reduce((acc, s) => acc + s.weekAgo, 0) / series.length
  const meanDelta = meanCurrent - meanPrior

  const dataset = useMemo(() => {
    const ageMax = Math.max(1, Math.ceil(Math.max(...series.map((s) => s.ageYears))))
    const trails = series.map((s) => {
      const items: { x: number; d: number; date: string }[] = []
      for (let i = 7; i < s.points.length; i += 2) {
        items.push({
          x: s.points[i].value,
          d: s.points[i].value - s.points[i - 7].value,
          date: s.points[i].date,
        })
      }
      const last = s.points[s.points.length - 1]
      const before = s.points[s.points.length - 8]
      items.push({ x: last.value, d: last.value - before.value, date: last.date })
      return items
    })
    const moves = trails.flatMap((t) => t.map((p) => p.d))
    const moveLo = Math.min(0, ...moves)
    const moveHi = Math.max(0.02, ...moves) * 1.08
    return { ageMax, trails, moveLo, moveHi }
  }, [series])

  const geometry = useMemo(() => {
    const { w, h } = stage
    const cx = w / 2 + (w < 520 ? 14 : 0)
    const floorY = h - 46
    const sx = clamp(w * 0.44, 120, 430)
    const sy = sx * 0.2
    const vy = clamp(h * 0.34, 82, 126)
    const project = (x: number, y: number, z: number) => ({
      px: cx + (x - z) * sx,
      py: floorY - (x + z) * sy - y * vy,
      depth: x + z,
    })
    return { w, h, cx, floorY, sx, sy, vy, project }
  }, [stage])

  const points = useMemo(() => {
    const scale = clamp(stage.w / 880, 0.6, 1.05)
    const pxX = (v: number) => 0.07 + clamp(v, 0, 1) * 0.86
    // oldest disclosures sit near the viewer; newer ones recede toward the back
    const pxZ = (age: number) => 0.93 - clamp(age / dataset.ageMax, 0, 1) * 0.86
    const pyY = (d: number) => (d - dataset.moveLo) / (dataset.moveHi - dataset.moveLo)
    const placed = series.map((s, seriesIndex) => {
      const x = pxX(s.current)
      const z = pxZ(s.ageYears)
      const y = pyY(s.delta)
      const projected = geometry.project(x, y, z)
      const size = (16 + 42 * Math.pow(clamp(s.current, 0, 1), 1.6)) * scale
      const floorPoint = geometry.project(x, 0, z)
      const trail = dataset.trails[seriesIndex].map((item, index) => {
        const p = geometry.project(pxX(item.x), pyY(item.d), z)
        return { ...item, ...p, t: index / Math.max(1, dataset.trails[seriesIndex].length - 1) }
      })
      return {
        series: s,
        x,
        y,
        z,
        size,
        floorPoint,
        trail,
        ...projected,
        order: Math.round(80 + (2 - projected.depth) * 60 + (1 - size / 80) * 30),
      }
    })
    return placed.sort((a, b) => a.order - b.order)
  }, [series, dataset, geometry, stage.w])

  const grid = useMemo(() => {
    const { project } = geometry
    const seg = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
      const a = project(x1, y1, z1)
      const b = project(x2, y2, z2)
      return { x1: a.px, y1: a.py, x2: b.px, y2: b.py }
    }
    const floor: ReturnType<typeof seg>[] = []
    const walls: ReturnType<typeof seg>[] = []
    for (let i = 0; i <= 5; i += 1) {
      const t = i / 5
      floor.push(seg(t, 0, 0, t, 0, 1))
      floor.push(seg(0, 0, t, 1, 0, t))
      walls.push(seg(t, 0, 1, t, 1, 1))
      walls.push(seg(1, 0, t, 1, 1, t))
      walls.push(seg(0, t, 1, 1, t, 1))
    }
    const edges = [
      seg(0, 0, 0, 1, 0, 0),
      seg(1, 0, 0, 1, 0, 1),
      seg(1, 0, 1, 0, 0, 1),
      seg(0, 0, 1, 0, 0, 0),
      seg(0, 0, 1, 0, 1, 1),
      seg(1, 0, 1, 1, 1, 1),
      seg(1, 0, 0, 1, 1, 0),
      seg(0, 1, 1, 1, 1, 1),
      seg(1, 1, 0, 1, 1, 1),
    ]
    return { floor, walls, edges }
  }, [geometry])

  const axes = useMemo(() => {
    const { project } = geometry
    const yFoot = project(0.07, 0, 0.93)
    const yTop = project(0.07, 1, 0.93)
    const xLeft = project(0.07, 0, 0.07)
    const xRight = project(0.93, 0, 0.07)
    const zNear = project(0.93, 0, 0.07)
    const zFar = project(0.93, 0, 0.93)
    return { yFoot, yTop, xLeft, xRight, zNear, zFar }
  }, [geometry])

  const hovered = hoverId ? points.find((p) => p.series.id === hoverId) : undefined
  const tipX = hovered ? clamp(hovered.px, 126, Math.max(126, stage.w - 126)) : 0
  const tipBelow = hovered ? hovered.py < 150 : false

  return (
    <section className="xp-card rdr-volume">
      <header className="rdr-volume-head">
        <div className="rdr-volume-heading">
          <span className="xp-card-icon orange">
            <VolumeGlyph />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="xp-card-title">Momentum volume</div>
            <div className="xp-card-sub">Current EPSS × 7-day move × disclosure age</div>
          </div>
        </div>
        <div className="rdr-volume-side">
          <span className="rdr-volume-badge">
            {series.filter((s) => s.cve.kev).length}/{series.length} KEV
          </span>
          <button
            type="button"
            className="rdr-volume-reset"
            onClick={onReset}
            aria-label="Reset the volume to the largest riser"
            title="Reset to the largest riser"
          >
            <SparkGlyph />
          </button>
        </div>
      </header>
      <div className="rdr-volume-copy">
        <div className="rdr-volume-figure">
          <strong>{fmtPct(meanCurrent)}</strong>
          <span className={`rdr-volume-delta ${meanDelta >= 0 ? 'is-up' : 'is-down'}`}>
            {meanDelta >= 0 ? '↑' : '↓'} {Math.abs(meanDelta * 100).toFixed(1)}pp
          </span>
        </div>
        <p className="rdr-volume-sub">
          Compared to <b>{fmtPct(meanPrior)}</b> seven days ago · {series.length} tracked series
        </p>
      </div>

      <div
        className={`rdr-volume-stage${hoverId ? ' is-hovering' : ''}`}
        ref={stageRef}
        role="group"
        aria-label={`3D momentum volume: current EPSS, seven-day change and disclosure age for ${series.length} tracked CVEs.`}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`)
          event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`)
        }}
      >
        <div className="rdr-volume-spot" aria-hidden="true" />
        <svg className="rdr-volume-grid" viewBox={`0 0 ${geometry.w} ${geometry.h}`} aria-hidden="true">
          <defs>
            <radialGradient id={`${glowId}-floor`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={hot} stopOpacity="0.22" />
              <stop offset="52%" stopColor={hot} stopOpacity="0.08" />
              <stop offset="100%" stopColor={hot} stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse
            cx={geometry.cx}
            cy={geometry.floorY - geometry.sy * 0.8}
            rx={geometry.sx * 1.08}
            ry={geometry.sy * 1.7}
            fill={`url(#${glowId}-floor)`}
          />
          {grid.walls.map((line, index) => (
            <line key={`wall-${index}`} className="rdr-grid-wall" {...line} />
          ))}
          {grid.floor.map((line, index) => (
            <line key={`floor-${index}`} className="rdr-grid-line" {...line} />
          ))}
          {grid.edges.map((line, index) => (
            <line key={`edge-${index}`} className="rdr-grid-edge" {...line} />
          ))}

          <line className="rdr-volume-axis" x1={axes.yFoot.px} y1={axes.yFoot.py} x2={axes.yTop.px} y2={axes.yTop.py} />
          <line className="rdr-volume-axis" x1={axes.xLeft.px} y1={axes.xLeft.py} x2={axes.xRight.px} y2={axes.xRight.py} />
          <line className="rdr-volume-axis" x1={axes.zNear.px} y1={axes.zNear.py} x2={axes.zFar.px} y2={axes.zFar.py} />

          {[0, 0.5, 1].map((t) => {
            const p = geometry.project(0.07, t, 0.93)
            const value = dataset.moveLo + (dataset.moveHi - dataset.moveLo) * t
            return (
              <g key={`y-${t}`}>
                <line className="rdr-axis-tick" x1={p.px - 4} y1={p.py} x2={p.px} y2={p.py} />
                <text className="rdr-axis-label" x={p.px - 8} y={p.py + 3} textAnchor="end">
                  {shortFormat(value)}
                </text>
              </g>
            )
          })}
          <text className="rdr-axis-name" x={axes.yTop.px - 8} y={axes.yTop.py - 12} textAnchor="end">
            7-DAY Δ
          </text>

          {[0, 0.5, 1].map((t) => {
            const p = geometry.project(0.07 + t * 0.86, 0, 0.07)
            return (
              <g key={`x-${t}`}>
                <line className="rdr-axis-tick" x1={p.px} y1={p.py} x2={p.px} y2={p.py + 4} />
                <text className="rdr-axis-label" x={p.px} y={p.py + 16} textAnchor="middle">
                  {Math.round(t * 100)}%
                </text>
              </g>
            )
          })}
          <text className="rdr-axis-name" x={geometry.cx - geometry.sx * 0.1} y={geometry.floorY + 31} textAnchor="middle">
            EPSS NOW
          </text>

          {[0, 0.5].map((t) => {
            const p = geometry.project(0.93, 0, 0.07 + t * 0.86)
            return (
              <text key={`z-${t}`} className="rdr-axis-label" x={p.px - 8} y={p.py + 4} textAnchor="end">
                {Math.round(dataset.ageMax * (1 - t))}y
              </text>
            )
          })}
          <text className="rdr-axis-name" x={axes.zNear.px + 9} y={axes.zNear.py + 4} textAnchor="start">
            AGE
          </text>

          {points.map((point) => (
            <g key={`trail-${point.series.id}`} style={{ color: point.series.color }}>
              <polyline
                className={`rdr-trail${hoverId === point.series.id ? ' is-live' : ''}`}
                points={point.trail.map((p) => `${p.px},${p.py}`).join(' ')}
              />
              {point.trail.map((p, index) => (
                <circle
                  key={index}
                  className="rdr-trail-bead"
                  cx={p.px}
                  cy={p.py}
                  r={1.6 + p.t * 1.5}
                  opacity={0.14 + p.t * 0.5}
                />
              ))}
              <line
                className="rdr-stem"
                x1={point.px}
                y1={point.py}
                x2={point.floorPoint.px}
                y2={point.floorPoint.py}
              />
              <ellipse
                className="rdr-stem-foot"
                cx={point.floorPoint.px}
                cy={point.floorPoint.py}
                rx={point.size * 0.36}
                ry={point.size * 0.11}
              />
            </g>
          ))}
        </svg>

        {points.map((point) => (
          <button
            key={point.series.id}
            type="button"
            className={`rdr-orb${selectedId === point.series.id ? ' is-selected' : ''}${
              hoverId === point.series.id ? ' is-live' : ''
            }`}
            style={
              {
                left: point.px,
                top: point.py,
                width: point.size,
                height: point.size,
                '--tone': point.series.color,
                '--order': point.order,
                '--float': `${-(point.order % 7) * 0.55}s`,
                '--float-dur': `${6 + (point.order % 4) * 0.5}s`,
              } as CSSProperties
            }
            aria-pressed={selectedId === point.series.id}
            aria-label={`${point.series.id}. ${point.series.cve.title}. EPSS ${fmtPct(
              point.series.current,
            )}, seven-day change ${signedPP(point.series.delta)}, disclosure age ${point.series.ageYears.toFixed(
              1,
            )} years. Focus this series.`}
            onMouseEnter={() => setHoverId(point.series.id)}
            onMouseLeave={() => setHoverId((current) => (current === point.series.id ? null : current))}
            onFocus={() => setHoverId(point.series.id)}
            onBlur={() => setHoverId((current) => (current === point.series.id ? null : current))}
            onClick={() => onSelect(point.series.id)}
          >
            <span className="rdr-orb-float">
              <span className="rdr-orb-halo" />
              <span className="rdr-orb-body" />
              <span className="rdr-orb-glint" />
            </span>
            <span className="rdr-orb-tag">
              <b>{shortId(point.series.id)}</b>
              <span>{signedPP(point.series.delta)}</span>
            </span>
          </button>
        ))}

        {hovered && (
          <div
            className={`rdr-orb-tip${tipBelow ? ' is-below' : ''}`}
            style={{ left: tipX, top: hovered.py + (tipBelow ? hovered.size / 2 + 10 : -hovered.size / 2 - 10) }}
            aria-hidden="true"
          >
            <div className="rdr-tip-head">
              <i style={{ background: hovered.series.color }} />
              <span>{hovered.series.id}</span>
              {hovered.series.cve.kev && <em>KEV</em>}
            </div>
            <div className="rdr-tip-title">{hovered.series.cve.title}</div>
            <div className="rdr-tip-metrics">
              <span>
                <small>EPSS</small>
                <b>{fmtPct(hovered.series.current)}</b>
              </span>
              <span>
                <small>7-DAY</small>
                <b>{signedPP(hovered.series.delta)}</b>
              </span>
              <span>
                <small>SLOPE</small>
                <b>{(hovered.series.slope * 100).toFixed(2)}pp/d</b>
              </span>
            </div>
          </div>
        )}
      </div>

      <footer className="rdr-volume-foot">
        <div className="rdr-volume-legend">
          {series.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`rdr-series-chip${s.id === selectedId ? ' is-on' : ''}`}
              style={{ '--tone': s.color } as CSSProperties}
              onClick={() => onSelect(s.id)}
              aria-pressed={s.id === selectedId}
            >
              <i />
              {shortId(s.id)}
              <b>{fmtPct(s.current)}</b>
            </button>
          ))}
        </div>
        <div className="rdr-volume-note">
          <span>Sphere size = current EPSS · trails = stored 30-day path</span>
          <span>
            mean 7-day move <b className={meanDelta >= 0 ? 'is-up' : 'is-down'}>{signedPP(meanDelta)}</b> ·{' '}
            {series.filter((s) => s.cve.kev).length} of {series.length} in CISA KEV
          </span>
        </div>
      </footer>
    </section>
  )
}

function SparkGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M8 1.2 9.5 6 14.2 7.6 9.5 9.2 8 14 6.5 9.2 1.8 7.6 6.5 6Z" />
    </svg>
  )
}

function VolumeGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M8 1.8 13.4 4.8v6L8 13.8 2.6 10.8v-6Z" />
      <path d="M2.8 4.9 8 7.8l5.2-2.9M8 7.8v5.8" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* movement matrix — day-over-day heat                                 */
/* ------------------------------------------------------------------ */

export function MovementMatrix({ series, onSelect }: { series: RadarSeries[]; onSelect: (id: string) => void }) {
  const dark = useTheme((state) => state.theme) === 'dark'
  const hot = dark ? '#ff6a36' : '#ff5a1f'
  const cool = dark ? '#58c795' : '#2f8f62'
  const [hover, setHover] = useState<{ row: number; day: number } | null>(null)
  const rows = useMemo(
    () =>
      series.map((s) => {
        const daily = s.points.map((p, i) => (i === 0 ? 0 : p.value - s.points[i - 1].value))
        return { series: s, daily, maxAbs: Math.max(...daily.map((v) => Math.abs(v)), 1e-5) }
      }),
    [series],
  )
  const globalMax = Math.max(...rows.map((r) => r.maxAbs), 1e-5)
  const dates = series[0]?.points.map((p) => p.date) ?? []
  const active = hover ? { row: rows[hover.row], value: rows[hover.row].daily[hover.day], date: dates[hover.day] } : null
  const signed = (v: number) => `${v >= 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(2)}pp`

  return (
    <div className="rdr-mx rdr-matrix">
      <div className="rdr-mx-top">
        <div className="rdr-mx-scale" aria-hidden="true">
          <span className="is-cool"><i /> cooling</span>
          <span className="is-flat">flat</span>
          <span className="is-hot">rising <i /></span>
        </div>
        <div className={`rdr-mx-readout${active ? ' is-live' : ''}`} aria-live="polite">
          {active ? (
            <>
              <b>{active.date}</b>
              <span className={active.value >= 0 ? 'is-hot' : 'is-cool'}>{signed(active.value)}</span>
              <em>{shortId(active.row.series.id)}</em>
            </>
          ) : (
            <span className="is-idle">Hover a day</span>
          )}
        </div>
      </div>

      <div className="rdr-mx-rows">
        {rows.map((row, rowIndex) => (
          <div className="rdr-mx-row" key={row.series.id}>
            <button
              type="button"
              className="rdr-mx-label"
              onClick={() => onSelect(row.series.id)}
              title={`Focus ${row.series.id}`}
            >
              <i style={{ background: row.series.color }} />
              {shortId(row.series.id)}
            </button>
            <div
              className="rdr-mx-cells"
              onPointerLeave={() => setHover((current) => (current?.row === rowIndex ? null : current))}
              aria-hidden="true"
            >
              {row.daily.map((value, day) => {
                const magnitude = Math.abs(value) / globalMax
                const alpha = value === 0 ? 0.05 : 0.1 + Math.pow(magnitude, 0.72) * 0.68
                return (
                  <i
                    key={day}
                    className={hover?.row === rowIndex && hover.day === day ? 'is-hover' : undefined}
                    style={{ background: hexA(value >= 0 ? hot : cool, alpha) }}
                    onMouseEnter={() => setHover({ row: rowIndex, day })}
                    title={`${row.series.id} · ${dates[day]} · ${signed(value)}`}
                  />
                )
              })}
            </div>
            <span className="rdr-mx-value">{fmtPct(row.series.current)}</span>
          </div>
        ))}
      </div>

      <div className="rdr-mx-foot">
        <span>{dates[0]}</span>
        <span>grid = stored daily change · alpha = magnitude</span>
        <span>{dates[dates.length - 1]}</span>
      </div>
    </div>
  )
}
