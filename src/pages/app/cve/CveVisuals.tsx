import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { clamp, fmtPct } from '../../../lib/format'
import { median } from '../../../lib/stats'
import { DEMO_NOW } from '../../../data/seed'
import type { Cve, RiskLevel } from '../../../lib/types'

/* ------------------------------------------------------------------ */
/* shared                                                              */
/* ------------------------------------------------------------------ */

const SEV_TONE: Record<RiskLevel, { core: string; mid: string; deep: string; glow: string; hi: string }> = {
  CRITICAL: { core: '#ff5d6c', mid: '#b81f3a', deep: '#3d0714', glow: 'rgba(255,93,108,0.5)', hi: '#ffd7dc' },
  HIGH: { core: '#ffa24c', mid: '#b4531b', deep: '#381604', glow: 'rgba(255,162,76,0.46)', hi: '#ffe6cc' },
  MEDIUM: { core: '#ffd45e', mid: '#9c760d', deep: '#2f2202', glow: 'rgba(255,212,94,0.36)', hi: '#fff4cf' },
  LOW: { core: '#54e6b2', mid: '#0d7a5c', deep: '#04261c', glow: 'rgba(84,230,178,0.4)', hi: '#d7fff0' },
}

export const cvssBin = (cve: Cve) =>
  cve.cvss == null ? null : clamp(Math.floor(cve.cvss), 0, 9)

const yearsSince = (iso: string) => Math.max(0, (DEMO_NOW.getTime() - new Date(iso).getTime()) / 31_557_600_000)

// deterministic per-CVE offset so near-identical scores don't stack into one column
const scatterJitter = (id: string, salt: number) => {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000) / 1000 - 0.5
}

/* ------------------------------------------------------------------ */
/* orbit — 3D bubble field                                             */
/* ------------------------------------------------------------------ */

type OrbitPoint = {
  cve: Cve
  years: number
  x: number
  y: number
  z: number
}

type PlacedPoint = OrbitPoint & {
  px: number
  py: number
  depth: number
  size: number
  order: number
  tone: (typeof SEV_TONE)[RiskLevel]
}

export function CveOrbit({
  entries,
  className,
  band,
  kevOnly,
  bin,
  onPick,
}: {
  entries: Cve[]
  className?: string
  band: 'ALL' | RiskLevel
  kevOnly: boolean
  bin: number | null
  onPick: (cve: Cve) => void
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ w: 720, h: 380 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const glowId = `cve-floor-${useId().replace(/:/g, '')}`

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = (w: number, h: number) => {
      if (!w || !h) return
      setStage((prev) => (Math.abs(prev.w - w) < 1.5 && Math.abs(prev.h - h) < 1.5 ? prev : { w, h }))
    }
    const rect = el.getBoundingClientRect()
    measure(rect.width, rect.height)
    const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width, entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const dataset = useMemo(() => {
    const points = entries
      .filter((cve) => cve.cvss != null && cve.epss != null)
      .map((cve) => ({ cve, years: yearsSince(cve.published) }))
    if (!points.length) {
      return { yearLo: 0, yearHi: 10, cvssLo: 0, cvssHi: 10, points: [] as OrbitPoint[] }
    }
    const ages = points.map((p) => p.years)
    const scores = points.map((p) => p.cve.cvss ?? 0)
    const cvssLo = Math.min(5, Math.floor(Math.min(...scores)))
    const cvssHi = Math.max(10, Math.ceil(Math.max(...scores)))
    const yearLo = Math.floor(Math.min(...ages))
    const yearHi = Math.max(Math.ceil(Math.max(...ages)), yearLo + 1)
    const norm = (value: number, lo: number, hi: number) =>
      hi - lo < 1e-9 ? 0.5 : clamp((value - lo) / (hi - lo), 0, 1)
    return {
      yearLo,
      yearHi,
      cvssLo,
      cvssHi,
      points: points.map<OrbitPoint>(({ cve, years }) => ({
        cve,
        years,
        // keep the volumetric cloud inside the wireframe so spheres never sit on the axis labels
        x: clamp(0.09 + norm(cve.cvss ?? 0, cvssLo, cvssHi) * 0.82 + scatterJitter(cve.id, 7) * 0.06, 0, 1),
        y: clamp(0.04 + norm(years, yearLo, yearHi) * 0.92 + scatterJitter(cve.id, 13) * 0.04, 0, 1),
        z: clamp(0.09 + (1 - (cve.epss ?? 0)) * 0.82 + scatterJitter(cve.id, 29) * 0.04, 0, 1),
      })),
    }
  }, [entries])

  const geometry = useMemo(() => {
    const { w, h } = stage
    const cx = w / 2
    const nearY = h - 50
    const sx = Math.min(w * 0.4, 300)
    const sy = sx * 0.4
    const vy = clamp(h * 0.37, 120, 205)
    const spread = 0.94
    const project = (x: number, y: number, z: number) => ({
      px: cx + (x - z) * sx * spread,
      py: nearY - (x + z) * sy * spread - y * vy,
      depth: x + z,
    })
    return { w, h, cx, nearY, sx, sy, vy, project }
  }, [stage])

  const points = useMemo<PlacedPoint[]>(() => {
    const scale = clamp(stage.w / 780, 0.62, 1.1)
    const placed = dataset.points.map((point) => {
      const projected = geometry.project(point.x, point.y, point.z)
      const risk = ((point.cve.cvss ?? 0) / 10) * (point.cve.epss ?? 0)
      const size = (16 + 36 * Math.sqrt(risk)) * scale
      const order = Math.round(120 + (2 - projected.depth) * 62 + (1 - size / 108) * 36)
      return { ...point, ...projected, size, order, ox: 0, oy: 0, tone: SEV_TONE[point.cve.severity] }
    })
    // relax near-coincident spheres a little so the dense cluster stays readable
    for (let pass = 0; pass < 7; pass += 1) {
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          const a = placed[i]
          const b = placed[j]
          let dx = b.px + b.ox - (a.px + a.ox)
          let dy = b.py + b.oy - (a.py + a.oy)
          let dist = Math.hypot(dx, dy)
          const minDist = (a.size + b.size) / 2 + 1
          if (dist >= minDist) continue
          if (dist < 0.001) {
            dx = 0
            dy = -1
            dist = 1
          }
          const push = (minDist - dist) / 2
          a.ox -= (dx / dist) * push
          a.oy -= (dy / dist) * push
          b.ox += (dx / dist) * push
          b.oy += (dy / dist) * push
        }
      }
      placed.forEach((point) => {
        point.ox = clamp(point.ox, -34, 34)
        point.oy = clamp(point.oy, -34, 34)
      })
    }
    return placed
      .map(({ ox, oy, ...point }) => ({
        ...point,
        px: clamp(point.px + ox, point.size / 2 + 4, stage.w - point.size / 2 - 4),
        py: clamp(point.py + oy, point.size / 2 + 4, stage.h - point.size / 2 - 16),
      }))
      .sort((a, b) => a.order - b.order)
  }, [dataset, geometry, stage])

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
      walls.push(seg(1, t, 0, 1, t, 1))
    }
    const floorEdge = [seg(0, 0, 0, 1, 0, 0), seg(1, 0, 0, 1, 0, 1), seg(1, 0, 1, 0, 0, 1), seg(0, 0, 1, 0, 0, 0)]
    const topEdge = [seg(0, 1, 0, 1, 1, 0), seg(1, 1, 0, 1, 1, 1), seg(1, 1, 1, 0, 1, 1), seg(0, 1, 1, 0, 1, 0)]
    const uprights = [seg(0, 0, 0, 0, 1, 0), seg(1, 0, 0, 1, 1, 0), seg(1, 0, 1, 1, 1, 1), seg(0, 0, 1, 0, 1, 1)]
    return { floor, walls, floorEdge, topEdge, uprights }
  }, [geometry])

  const hovered = hoverId ? points.find((p) => p.cve.id === hoverId) : undefined

  const isDim = (cve: Cve) =>
    (kevOnly && !cve.kev) ||
    (band !== 'ALL' && cve.severity !== band) ||
    (bin !== null && cvssBin(cve) !== bin)

  const ageBase = geometry.project(0, 0, 1)
  const ageTop = geometry.project(0, 1, 1)
  const epssNear = geometry.project(0, 0, 0)
  const epssFar = geometry.project(0, 0, 1)
  const cvssNear = geometry.project(0, 0, 0)
  const cvssFar = geometry.project(1, 0, 0)
  const epssMid = geometry.project(0, 0, 0.5)
  const kevCount = entries.filter((c) => c.kev).length
  const tipX = hovered ? clamp(hovered.px, 140, Math.max(140, stage.w - 140)) : 0
  const tipBelow = hovered ? hovered.py < 178 : false

  return (
    <section className={`cve-orbit-card ${className ?? ''}`.trim()}>
      <header className="cve-orbit-head">
        <div>
          <h2>Exploitation orbit</h2>
          <p>
            CVSS base, EPSS likelihood and disclosure age in one volume. Hover a sphere to inspect it; click to open
            the record.
          </p>
        </div>
        <span className="cve-orbit-badge">
          <span className="cve-orbit-spark" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M8 1.2 9.5 6 14.2 7.6 9.5 9.2 8 14 6.5 9.2 1.8 7.6 6.5 6Z" />
            </svg>
          </span>
          <span>
            <b>{kevCount}</b> of {entries.length} KEV
          </span>
        </span>
      </header>

      <div
        className={hoverId ? 'cve-orbit-stage is-hovering' : 'cve-orbit-stage'}
        ref={stageRef}
        role="group"
        aria-label={`3D CVE plot: CVSS base score, EPSS likelihood and disclosure age for ${dataset.points.length} CVEs`}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`)
          event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`)
        }}
      >
        <div className="cve-orbit-spot" aria-hidden="true" />
        <svg className="cve-orbit-grid" viewBox={`0 0 ${geometry.w} ${geometry.h}`} aria-hidden="true">
          <defs>
            <radialGradient id={`${glowId}-floor`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ff7b45" stopOpacity="0.34" />
              <stop offset="48%" stopColor="#ff3d7f" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#ff3d7f" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse
            cx={geometry.cx}
            cy={geometry.nearY - geometry.sy * 0.7}
            rx={geometry.sx * 1.06}
            ry={geometry.sy * 1.15}
            fill={`url(#${glowId}-floor)`}
          />
          {grid.walls.map((l, i) => (
            <line key={`wall-${i}`} className="cve-grid-wall" {...l} />
          ))}
          {grid.floor.map((l, i) => (
            <line key={`floor-${i}`} className="cve-grid-line" {...l} />
          ))}
          {grid.floorEdge.map((l, i) => (
            <line key={`floor-edge-${i}`} className="cve-grid-edge" {...l} />
          ))}
          {grid.topEdge.map((l, i) => (
            <line key={`top-edge-${i}`} className="cve-grid-edge-soft" {...l} />
          ))}
          {grid.uprights.map((l, i) => (
            <line key={`upright-${i}`} className="cve-grid-edge-soft" {...l} />
          ))}

          <line
            className="cve-orbit-axis"
            x1={ageBase.px}
            y1={ageBase.py}
            x2={ageTop.px}
            y2={ageTop.py}
          />
          {[0, 0.5, 1].map((t) => {
            const y = ageBase.py + (ageTop.py - ageBase.py) * t
            return (
              <g key={`age-${t}`}>
                <line className="cve-orbit-tick" x1={ageBase.px - 4} y1={y} x2={ageBase.px} y2={y} />
                <text className="cve-axis-label" x={ageBase.px - 9} y={y + 3} textAnchor="end">
                  {t === 0.5
                    ? `${((dataset.yearLo + dataset.yearHi) / 2).toFixed(1)}y`
                    : `${Math.round(dataset.yearLo + (dataset.yearHi - dataset.yearLo) * t)}y`}
                </text>
              </g>
            )
          })}
          <text className="cve-axis-name" x={ageBase.px - 9} y={ageTop.py - 12} textAnchor="end">
            AGE
          </text>

          <line
            className="cve-orbit-axis"
            x1={epssNear.px}
            y1={epssNear.py}
            x2={epssFar.px}
            y2={epssFar.py}
          />
          {[0, 0.5, 1].map((t) => {
            const x = epssNear.px + (epssFar.px - epssNear.px) * t
            const y = epssNear.py + (epssFar.py - epssNear.py) * t
            return (
              <g key={`epss-${t}`}>
                <line className="cve-orbit-tick" x1={x} y1={y + 4} x2={x} y2={y} />
                <text
                  className="cve-axis-label"
                  x={x - (t === 0 ? 6 : 0)}
                  y={y + 16}
                  textAnchor={t === 0 ? 'end' : 'middle'}
                >
                  {Math.round((1 - t) * 100)}%
                </text>
              </g>
            )
          })}
          <text className="cve-axis-name" x={epssMid.px - 4} y={epssMid.py + 28} textAnchor="middle">
            EPSS
          </text>

          {[0, 0.5, 1].map((t) => {
            const x = cvssNear.px + (cvssFar.px - cvssNear.px) * t
            const y = cvssNear.py + (cvssFar.py - cvssNear.py) * t
            return (
              <text
                key={`cvss-${t}`}
                className="cve-axis-label"
                x={x + (t === 0 ? 7 : 0)}
                y={y + 16}
                textAnchor={t === 0 ? 'start' : 'middle'}
              >
                {(dataset.cvssLo + (dataset.cvssHi - dataset.cvssLo) * t).toFixed(1)}
              </text>
            )
          })}
          <text className="cve-axis-name" x={cvssFar.px + 9} y={cvssFar.py - 6} textAnchor="start">
            CVSS
          </text>

          {hovered &&
            (() => {
              const base = geometry.project(hovered.x, 0, hovered.z)
              return (
                <g className="cve-hover-guide" aria-hidden="true" style={{ color: hovered.tone.core }}>
                  <line x1={hovered.px} y1={hovered.py} x2={base.px} y2={base.py} />
                  <ellipse
                    cx={base.px}
                    cy={base.py}
                    rx={hovered.size * 0.44}
                    ry={hovered.size * 0.18}
                  />
                </g>
              )
            })()}
        </svg>

        {points.map((point, i) => {
          const dim = isDim(point.cve)
          return (
            <button
              key={point.cve.id}
              type="button"
              className={[
                'cve-bubble',
                point.cve.kev ? 'is-kev' : '',
                dim ? 'is-dim' : '',
                hoverId === point.cve.id ? 'is-live' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={
                {
                  left: point.px,
                  top: point.py,
                  width: point.size,
                  height: point.size,
                  '--order': point.order,
                  '--bubble-core': point.tone.core,
                  '--bubble-mid': point.tone.mid,
                  '--bubble-deep': point.tone.deep,
                  '--bubble-glow': point.tone.glow,
                  '--bubble-hi': point.tone.hi,
                  '--in-delay': `${Math.min(i * 34, 480)}ms`,
                  '--float-delay': `${-(i * 0.73).toFixed(2)}s`,
                  '--float-dur': `${6 + (i % 5) * 0.45}s`,
                } as CSSProperties
              }
              aria-label={`${point.cve.id}. ${point.cve.title}. CVSS ${point.cve.cvss?.toFixed(1)}, EPSS ${fmtPct(
                point.cve.epss ?? 0,
              )}, ${point.years.toFixed(1)} years old${point.cve.kev ? ', CISA KEV listed' : ''}. Open record.`}
              onMouseEnter={() => setHoverId(point.cve.id)}
              onMouseLeave={() => setHoverId((current) => (current === point.cve.id ? null : current))}
              onFocus={() => setHoverId(point.cve.id)}
              onBlur={() => setHoverId((current) => (current === point.cve.id ? null : current))}
              onClick={() => onPick(point.cve)}
            >
              <span className="cve-bubble-float">
                <span className="cve-bubble-body" />
              </span>
            </button>
          )
        })}

        {hovered && (
          <div
            className={`cve-orbit-tip${tipBelow ? ' is-below' : ''}`}
            style={{ left: tipX, top: hovered.py }}
            aria-hidden="true"
          >
            <div className="cve-tip-top">
              <i style={{ background: hovered.tone.core, color: hovered.tone.core }} />
              <span className="cve-tip-id">{hovered.cve.id}</span>
              {hovered.cve.kev && <span className="cve-tip-kev">KEV</span>}
            </div>
            <div className="cve-tip-title">{hovered.cve.title}</div>
            <div className="cve-tip-metrics">
              <span>
                <small>CVSS</small>
                <b>{hovered.cve.cvss?.toFixed(1)}</b>
              </span>
              <span>
                <small>EPSS</small>
                <b>{fmtPct(hovered.cve.epss ?? 0)}</b>
              </span>
              <span>
                <small>AGE</small>
                <b>{hovered.years.toFixed(1)}y</b>
              </span>
            </div>
            <div className="cve-tip-foot">Open record</div>
          </div>
        )}
      </div>

      <footer className="cve-orbit-legend">
        {(Object.keys(SEV_TONE) as RiskLevel[]).map((level) => (
          <span className="cve-legend-sev" key={level}>
            <i style={{ background: SEV_TONE[level].core, color: SEV_TONE[level].core }} />
            {level}
          </span>
        ))}
        <span className="cve-legend-kev">
          <i />
          KEV orbit
        </span>
        <span className="cve-legend-size">Sphere size = CVSS × EPSS</span>
      </footer>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* spectrum — CVSS distribution                                        */
/* ------------------------------------------------------------------ */

const binTone = (bin: number) =>
  bin >= 9 ? SEV_TONE.CRITICAL : bin >= 7 ? SEV_TONE.HIGH : bin >= 4 ? SEV_TONE.MEDIUM : SEV_TONE.LOW

export function CveSpectrum({
  entries,
  activeBin,
  onBin,
  className,
}: {
  entries: Cve[]
  activeBin: number | null
  onBin: (bin: number | null) => void
  className?: string
}) {
  const [hoverBin, setHoverBin] = useState<number | null>(null)
  const bands = useMemo(
    () =>
      Array.from({ length: 10 }, (_, bin) => {
        const items = entries.filter((cve) => cvssBin(cve) === bin)
        return { bin, count: items.length, kev: items.filter((cve) => cve.kev).length }
      }),
    [entries],
  )
  const maxCount = Math.max(1, ...bands.map((band) => band.count))
  const midTick = maxCount > 1 ? Math.round(maxCount / 2) : 0
  const midPct = midTick > 0 && midTick < maxCount ? (midTick / maxCount) * 82 : null
  const total = entries.length
  const medianScore = total ? median(entries.map((cve) => cve.cvss ?? 0)) : null
  const criticalShare = total ? entries.filter((cve) => (cve.cvss ?? 0) >= 9).length / total : 0
  const focusBand = hoverBin !== null ? bands[hoverBin] : activeBin !== null ? bands[activeBin] : null
  const bandRange = (bin: number) => (bin === 9 ? '9–10' : `${bin}–${bin + 1}`)

  return (
    <section className={`cve-spectrum-card ${className ?? ''}`.trim()}>
      <header className="cve-spectrum-head">
        <div>
          <h2>CVSS spectrum</h2>
          <p>Base-score bands across the filtered corpus. Click a band to filter the register.</p>
        </div>
        <div className="cve-spectrum-total">
          <b>{total}</b>
          <span>records</span>
        </div>
      </header>

      <div className="cve-spectrum-tiles">
        <div className="cve-spectrum-tile">
          <small>Median score</small>
          <b>{medianScore == null || Number.isNaN(medianScore) ? '—' : medianScore.toFixed(1)}</b>
        </div>
        <div className="cve-spectrum-tile">
          <small>Critical share</small>
          <b>{total ? `${Math.round(criticalShare * 100)}%` : '—'}</b>
        </div>
      </div>

      <div className="cve-spectrum-figure">
        <div className="cve-spectrum-yaxis" aria-hidden="true">
          <span style={{ bottom: '82%' }}>{maxCount}</span>
          {midPct !== null && <span style={{ bottom: `${midPct}%` }}>{midTick}</span>}
          <span style={{ bottom: '0%' }}>0</span>
        </div>
        <div className="cve-spectrum-plot">
          <div className="cve-band-note" aria-hidden="true">
            {focusBand && focusBand.count > 0 ? (
              <>
                <b>{bandRange(focusBand.bin)}</b>
                <span>
                  {focusBand.count} record{focusBand.count === 1 ? '' : 's'}
                </span>
                <span className="cve-band-sep">·</span>
                <span>{focusBand.kev} KEV</span>
              </>
            ) : (
              <span className="is-idle">{focusBand ? 'No records in band' : 'Hover a band'}</span>
            )}
          </div>
          <div className="cve-spectrum-rules" aria-hidden="true">
            <i style={{ bottom: '82%' }} />
            {midPct !== null && <i style={{ bottom: `${midPct}%` }} />}
            <i style={{ bottom: '0%' }} />
          </div>
          <div
            className={`cve-spectrum-bars${activeBin !== null ? ' has-active' : ''}`}
            role="group"
            aria-label="CVSS base score distribution, one button per integer band"
          >
            {bands.map(({ bin, count }) => {
              const tone = binTone(bin)
              const height = (count / maxCount) * 82
              const selected = activeBin === bin
              return (
                <button
                  key={bin}
                  type="button"
                  className={`cve-bin${count === 0 ? ' is-empty' : ''}${selected ? ' is-selected' : ''}`}
                  style={
                    {
                      '--bar-hi': tone.hi,
                      '--bar-core': tone.core,
                      '--bar-mid': tone.mid,
                      '--bar-deep': tone.deep,
                      '--bar-glow': tone.glow,
                      '--h': `${height}%`,
                      '--i': bin,
                    } as CSSProperties
                  }
                  aria-pressed={selected}
                  aria-label={`CVSS ${bin} to ${bin === 9 ? '10.0' : bin + 1}: ${count} CVE${count === 1 ? '' : 's'}`}
                  onMouseEnter={() => setHoverBin(bin)}
                  onMouseLeave={() => setHoverBin((current) => (current === bin ? null : current))}
                  onFocus={() => setHoverBin(bin)}
                  onBlur={() => setHoverBin((current) => (current === bin ? null : current))}
                  onClick={() => onBin(selected ? null : bin)}
                >
                  <span className="cve-bin-count">{count}</span>
                  <span className="cve-bin-bar" />
                </button>
              )
            })}
          </div>
          <div className="cve-spectrum-ticks" aria-hidden="true">
            {bands.map(({ bin }) => (
              <span key={bin}>{bin === 9 ? '9+' : bin}</span>
            ))}
          </div>
        </div>
      </div>

      <footer className="cve-spectrum-foot">
        <div className="cve-spectrum-keys" aria-hidden="true">
          <span>
            <i style={{ background: SEV_TONE.LOW.core }} /> Low
          </span>
          <span>
            <i style={{ background: SEV_TONE.MEDIUM.core }} /> Med
          </span>
          <span>
            <i style={{ background: SEV_TONE.HIGH.core }} /> High
          </span>
          <span>
            <i style={{ background: SEV_TONE.CRITICAL.core }} /> Crit
          </span>
        </div>
        <span className={`cve-spectrum-hint${activeBin !== null ? ' is-active' : ''}`}>
          {activeBin === null ? 'Click a band to isolate scores' : `Band ${activeBin}${activeBin === 9 ? '+' : `–${activeBin + 1}`} active · click again to clear`}
        </span>
      </footer>
    </section>
  )
}
