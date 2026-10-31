import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import { useTheme } from '../lib/store'

type SceneStatus = 'idle' | 'success' | 'error'

const TAU = Math.PI * 2
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

const TONES = {
  dark: {
    teal: '62, 210, 193',
    tealEdge: '96, 190, 186',
    amber: '227, 164, 85',
    red: '229, 84, 90',
    ink: '233, 238, 245',
    orbit: '150, 168, 192',
    haloCore: 0.1,
    haloError: 0.08,
    haloMid: 0.03,
    orbitLine: 0.07,
    shieldLine: 0.34,
    shieldShadow: 0.45,
    errorLine: 0.35,
    errorFlicker: 0.45,
    panelFill: 0.05,
    panelBreathe: 0.018,
    panelStroke: 0.08,
    panelEdge: 0.12,
    amberFill: 0.08,
    amberStroke: 0.18,
    amberSweep: 0.22,
    glyph: 0.22,
    tickMajor: 0.22,
    tickMinor: 0.1,
  },
  light: {
    teal: '10, 111, 102',
    tealEdge: '7, 84, 79',
    amber: '140, 85, 16',
    red: '178, 58, 47',
    ink: '22, 32, 29',
    orbit: '84, 97, 91',
    haloCore: 0.06,
    haloError: 0.1,
    haloMid: 0.02,
    orbitLine: 0.16,
    shieldLine: 0.62,
    shieldShadow: 0.2,
    errorLine: 0.6,
    errorFlicker: 0.6,
    panelFill: 0.1,
    panelBreathe: 0.028,
    panelStroke: 0.22,
    panelEdge: 0.34,
    amberFill: 0.14,
    amberStroke: 0.4,
    amberSweep: 0.38,
    glyph: 0.38,
    tickMajor: 0.4,
    tickMinor: 0.2,
  },
} as const

interface Panel {
  x: number
  y: number
  size: number
  dist: number
  delay: number
  seed: number
}

export function ShieldScene({ status = 'idle' }: { status?: SceneStatus }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<SceneStatus>(status)
  const statusAt = useRef(0)
  const reduce = useReducedMotion()
  const theme = useTheme((s) => s.theme)

  useEffect(() => {
    statusRef.current = status
    statusAt.current = performance.now()
  }, [status])

  useEffect(() => {
    if (reduce) return
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const C = TONES[theme]

    let w = 0
    let h = 0
    let raf = 0
    let start = 0
    let panels: Panel[] = []
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const hexPoints = (x: number, y: number, size: number) =>
      Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i + Math.PI / 6
        return [x + Math.cos(a) * size, y + Math.sin(a) * size] as const
      })

    const shieldPath = (cx: number, cy: number, R: number) => {
      const p = new Path2D()
      p.moveTo(cx, cy - R * 1.02)
      p.bezierCurveTo(cx + R * 0.34, cy - R * 0.9, cx + R * 0.77, cy - R * 0.82, cx + R * 0.86, cy - R * 0.6)
      p.lineTo(cx + R * 0.86, cy + R * 0.06)
      p.bezierCurveTo(cx + R * 0.86, cy + R * 0.52, cx + R * 0.52, cy + R * 0.82, cx, cy + R * 1.04)
      p.bezierCurveTo(cx - R * 0.52, cy + R * 0.82, cx - R * 0.86, cy + R * 0.52, cx - R * 0.86, cy + R * 0.06)
      p.lineTo(cx - R * 0.86, cy - R * 0.6)
      p.bezierCurveTo(cx - R * 0.77, cy - R * 0.82, cx - R * 0.34, cy - R * 0.9, cx, cy - R * 1.02)
      p.closePath()
      return p
    }

    let shield = new Path2D()

    const buildPanels = (cx: number, cy: number, R: number) => {
      panels = []
      const size = Math.max(12, R * 0.085)
      const stepX = size * 1.5
      const stepY = size * Math.sqrt(3)
      const rows = Math.ceil((R * 1.2) / stepY) + 2
      for (let q = -rows; q <= rows; q += 1) {
        for (let r = -rows; r <= rows; r += 1) {
          const x = cx + stepX * q
          const y = cy + stepY * (r + q / 2)
          const dist = Math.hypot(x - cx, y - cy)
          if (dist > R * 1.05) continue
          if (!ctx.isPointInPath(shield, x, y)) continue
          panels.push({
            x,
            y,
            size: size * 0.94,
            dist,
            delay: 0.1 + (dist / R) * 1.25,
            seed: Math.random() * TAU,
          })
        }
      }
    }

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = rect.width
      h = rect.height
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      shield = shieldPath(w / 2, h * 0.5, Math.min(w, h) * 0.24)
      buildPanels(w / 2, h * 0.5, Math.min(w, h) * 0.24)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()

    const onPointer = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect()
      pointer.tx = (e.clientX - rect.left) / rect.width - 0.5
      pointer.ty = (e.clientY - rect.top) / rect.height - 0.5
    }
    wrap.addEventListener('pointermove', onPointer, { passive: true })

    const draw = (now: number) => {
      if (!start) start = now
      const t = (now - start) / 1000
      const since = (now - statusAt.current) / 1000
      const status = statusRef.current

      pointer.x += (pointer.tx - pointer.x) * 0.04
      pointer.y += (pointer.ty - pointer.y) * 0.04

      const cx = w / 2 + pointer.x * 18
      const cy = h * 0.5 + pointer.y * 14
      const R = Math.min(w, h) * 0.24

      ctx.clearRect(0, 0, w, h)

      // soft halo
      const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.5)
      halo.addColorStop(
        0,
        status === 'error' ? `rgba(${C.red}, ${C.haloError})` : `rgba(${C.teal}, ${C.haloCore})`,
      )
      halo.addColorStop(0.55, `rgba(${C.teal}, ${C.haloMid})`)
      halo.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = halo
      ctx.fillRect(0, 0, w, h)

      // orbit streams
      const orbits = [
        { rx: R * 1.55, ry: R * 0.52, speed: 0.28, count: 5, color: C.teal },
        { rx: R * 1.75, ry: R * 0.62, speed: -0.19, count: 4, color: C.orbit },
        { rx: R * 1.32, ry: R * 1.15, speed: 0.16, count: 3, color: C.amber },
      ]
      for (const orbit of orbits) {
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${C.orbit}, ${C.orbitLine})`
        ctx.lineWidth = 0.6
        ctx.ellipse(cx, cy, orbit.rx, orbit.ry, -0.6, 0, TAU)
        ctx.stroke()
        for (let i = 0; i < orbit.count; i += 1) {
          const a = t * orbit.speed + (i / orbit.count) * TAU
          let px = cx + Math.cos(a) * orbit.rx
          let py = cy + Math.sin(a) * orbit.ry
          if (status === 'success') {
            const conv = clamp01(since / 1.1)
            px = px + (cx - px) * conv
            py = py + (cy - py) * conv
          }
          const size = 1.4 + (i % 3) * 0.6
          if (theme === 'light') {
            const halo = ctx.createRadialGradient(px, py, 0, px, py, size * 3.4)
            halo.addColorStop(0, `rgba(${orbit.color}, 0.14)`)
            halo.addColorStop(1, `rgba(${orbit.color}, 0)`)
            ctx.fillStyle = halo
            ctx.beginPath()
            ctx.arc(px, py, size * 3.4, 0, TAU)
            ctx.fill()
            ctx.fillStyle = `rgba(${orbit.color}, 0.72)`
            ctx.beginPath()
            ctx.arc(px, py, Math.max(0.9, size * 0.78), 0, TAU)
            ctx.fill()
          } else {
            const grad = ctx.createRadialGradient(px, py, 0, px, py, size * 6)
            grad.addColorStop(0, `rgba(${orbit.color}, 0.9)`)
            grad.addColorStop(1, `rgba(${orbit.color}, 0)`)
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.arc(px, py, size * 6, 0, TAU)
            ctx.fill()
          }
        }
      }

      // shield glow outline
      ctx.save()
      ctx.shadowColor = status === 'error' ? `rgba(${C.red}, 0.5)` : `rgba(${C.teal}, ${C.shieldShadow})`
      ctx.shadowBlur = 26
      ctx.strokeStyle =
        status === 'error'
          ? `rgba(${C.red}, ${C.errorLine + Math.sin(since * 30) * 0.25})`
          : `rgba(${C.teal}, ${C.shieldLine})`
      ctx.lineWidth = 1.2
      ctx.stroke(shield)
      ctx.restore()

      // hex panels
      panels.forEach((panel, idx) => {
        let p = clamp01((t - panel.delay) / 0.85)
        p = easeOut(p)
        if (p <= 0) return
        const shimmer = status === 'success' ? clamp01((since * 1.6 - idx * 0.012) * 1.2) : 0
        const lit = shimmer > 0 ? clamp01(shimmer) : 0
        const breathe = C.panelFill + Math.sin(t * 1.2 + panel.seed) * C.panelBreathe
        const scale = 0.45 + p * 0.55
        const pts = hexPoints(panel.x, panel.y, panel.size * scale)
        ctx.beginPath()
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
        ctx.closePath()
        if (lit > 0) {
          ctx.fillStyle = `rgba(${C.amber}, ${C.amberFill + lit * 0.2})`
          ctx.strokeStyle = `rgba(${C.amber}, ${C.amberStroke + lit * 0.5})`
        } else {
          ctx.fillStyle = `rgba(${C.teal}, ${breathe * p})`
          ctx.strokeStyle = `rgba(${C.tealEdge}, ${C.panelStroke + p * C.panelEdge})`
        }
        ctx.lineWidth = 0.7
        ctx.fill()
        ctx.stroke()
        if (p < 1) {
          ctx.beginPath()
          ctx.strokeStyle = `rgba(${C.amber}, ${(1 - p) * C.amberSweep})`
          ctx.arc(panel.x, panel.y, panel.size * (1.4 - p * 0.4), 0, TAU)
          ctx.stroke()
        }
      })

      // success pulse
      if (status === 'success' && since < 1.6) {
        const k = clamp01(since / 1.6)
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${C.amber}, ${(1 - k) * 0.5})`
        ctx.lineWidth = 1.2
        ctx.arc(cx, cy, R * (0.6 + k * 1.5), 0, TAU)
        ctx.stroke()
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${C.teal}, ${(1 - k) * 0.35})`
        ctx.arc(cx, cy, R * (0.9 + k * 1.1), 0, TAU)
        ctx.stroke()
      }

      // error flicker
      if (status === 'error' && since < 0.8) {
        ctx.save()
        ctx.globalAlpha = (1 - since / 0.8) * C.errorFlicker
        ctx.strokeStyle = `rgba(${C.red}, 0.9)`
        ctx.lineWidth = 2
        ctx.stroke(shield)
        ctx.restore()
      }

      // inner emblem
      ctx.beginPath()
      ctx.strokeStyle = `rgba(${C.ink}, ${C.glyph})`
      ctx.lineWidth = 0.8
      const emblem = R * 0.16
      ctx.arc(cx, cy, emblem, 0, TAU)
      ctx.stroke()
      ctx.beginPath()
      ctx.fillStyle = `rgba(${C.teal}, 0.7)`
      ctx.arc(cx, cy, 2.2, 0, TAU)
      ctx.fill()

      // tick ring
      for (let i = 0; i < 60; i += 1) {
        const a = (i / 60) * TAU + t * 0.04
        const major = i % 5 === 0
        const len = major ? 7 : 3
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${C.orbit}, ${major ? C.tickMajor : C.tickMinor})`
        ctx.lineWidth = 0.7
        ctx.moveTo(cx + Math.cos(a) * (R * 1.92), cy + Math.sin(a) * (R * 1.92))
        ctx.lineTo(cx + Math.cos(a) * (R * 1.92 + len), cy + Math.sin(a) * (R * 1.92 + len))
        ctx.stroke()
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      wrap.removeEventListener('pointermove', onPointer)
    }
  }, [reduce, theme])

  if (reduce) return <ShieldFallback status={status} />

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  )
}

export function ShieldFallback({ status = 'idle' }: { status?: SceneStatus }) {
  const theme = useTheme((s) => s.theme)
  const light = theme === 'light'
  const teal = light ? '#0a6f66' : '#3ed2c1'
  const amber = light ? '#8c5510' : '#e3a455'
  const stroke = status === 'error' ? (light ? '#b23a2f' : '#e5545a') : teal
  const orbitInk = light ? 'rgba(84, 97, 91, 0.42)' : 'rgba(62, 210, 193, 0.15)'
  const orbitAmber = light ? 'rgba(140, 85, 16, 0.3)' : 'rgba(227, 164, 85, 0.12)'
  const fill = light ? 'rgba(10, 111, 102, 0.06)' : 'rgba(62, 210, 193, 0.03)'
  return (
    <div style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
      <svg viewBox="0 0 600 700" style={{ width: '100%', height: '100%' }}>
        <defs>
          <linearGradient id="shieldFb" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor={stroke} stopOpacity={light ? 0.85 : 0.5} />
            <stop offset="1" stopColor={amber} stopOpacity={light ? 0.55 : 0.3} />
          </linearGradient>
        </defs>
        <ellipse cx="300" cy="350" rx="240" ry="120" stroke={orbitInk} fill="none" />
        <ellipse cx="300" cy="350" rx="260" ry="300" stroke={orbitAmber} fill="none" />
        <path
          d="M300 120 C370 140 440 150 455 200 L455 355 C455 450 380 510 300 545 C220 510 145 450 145 355 L145 200 C160 150 230 140 300 120 Z"
          fill={fill}
          stroke="url(#shieldFb)"
          strokeWidth="1.4"
        />
        {Array.from({ length: 60 }, (_, i) => {
          const row = Math.floor(i / 10)
          const col = i % 10
          return (
            <circle
              key={i}
              cx={190 + col * 24 + (row % 2) * 12}
              cy={220 + row * 34}
              r="1.4"
              fill={teal}
              opacity={light ? 0.5 : 0.3}
            />
          )
        })}
      </svg>
    </div>
  )
}
