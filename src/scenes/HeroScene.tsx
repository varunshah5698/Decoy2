import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'

interface Star {
  x: number
  y: number
  z: number
  r: number
  tw: number
}

interface Orb {
  p0x: number
  p0y: number
  cx: number
  cy: number
  target: number
  match: boolean
  progress: number
  speed: number
  trail: { x: number; y: number }[]
  done: boolean
  seed: number
}

interface Flash {
  x: number
  y: number
  t: number
  color: string
}

const TAU = Math.PI * 2
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

function project(x: number, y: number, z: number, rotY: number, tiltX: number) {
  const cosY = Math.cos(rotY)
  const sinY = Math.sin(rotY)
  const x1 = x * cosY + z * sinY
  const z1 = -x * sinY + z * cosY
  const cosX = Math.cos(tiltX)
  const sinX = Math.sin(tiltX)
  const y1 = y * cosX - z1 * sinX
  const z2 = y * sinX + z1 * cosX
  return { x: x1, y: y1, z: z2 }
}

export function HeroScene({ onCorrelate }: { onCorrelate?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (reduce) return
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0
    let visible = true
    let last = performance.now()
    let time = 0
    let spawnClock = 0
    let orbSeed = 1
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
    const stars: Star[] = []
    let orbs: Orb[] = []
    const flashes: Flash[] = []
    const rng = () => {
      orbSeed = (orbSeed * 16807) % 2147483647
      return (orbSeed - 1) / 2147483646
    }

    const assetCount = 13

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = rect.width
      h = rect.height
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      stars.length = 0
      const starCount = Math.round(Math.min(260, Math.max(110, (w * h) / 9000)))
      for (let i = 0; i < starCount; i += 1) {
        stars.push({
          x: rng() * w,
          y: rng() * h,
          z: rng(),
          r: rng() * 1.1 + 0.25,
          tw: rng() * TAU,
        })
      }
    }

    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()

    const onPointer = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
      },
      { threshold: 0.01 },
    )
    observer.observe(wrap)

    const onVisibility = () => {
      visible = !document.hidden && visible
      if (!document.hidden) last = performance.now()
    }
    document.addEventListener('visibilitychange', onVisibility)

    const spawnOrb = () => {
      const narrow = w < 900
      const cx = w * (narrow ? 0.62 : 0.7)
      const cy = h * 0.5
      const angle = rng() * TAU
      const dist = Math.max(w, h) * (0.56 + rng() * 0.16)
      const p0x = cx + Math.cos(angle) * dist
      const p0y = cy + Math.sin(angle) * dist * 0.72
      const target = Math.floor(rng() * assetCount)
      const match = rng() > 0.42
      const mx = (p0x + cx) / 2
      const my = (p0y + cy) / 2
      const perpX = -(p0y - cy)
      const perpY = p0x - cx
      const norm = Math.hypot(perpX, perpY) || 1
      const bend = (rng() - 0.5) * 150
      orbs.push({
        p0x,
        p0y,
        cx: mx + (perpX / norm) * bend,
        cy: my + (perpY / norm) * bend,
        target,
        match,
        progress: 0,
        speed: 0.16 + rng() * 0.1,
        trail: [],
        done: false,
        seed: rng() * TAU,
      })
      if (orbs.length > 12) orbs = orbs.slice(-12)
    }

    for (let i = 0; i < 4; i += 1) spawnOrb()

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (visible) time += dt

      const narrow = w < 900
      const cx = w * (narrow ? 0.62 : 0.7)
      const cy = h * 0.5
      const R = Math.min(narrow ? w * 0.28 : h * 0.29, 300)
      const rotY = time * 0.12
      const tilt = 0.32

      pointer.x = lerp(pointer.x, pointer.tx, 0.045)
      pointer.y = lerp(pointer.y, pointer.ty, 0.045)

      ctx.clearRect(0, 0, w, h)

      // ambient wash
      const wash = ctx.createRadialGradient(cx + pointer.x * 18, cy + pointer.y * 12, R * 0.2, cx, cy, R * 2.7)
      wash.addColorStop(0, 'rgba(62, 210, 193, 0.10)')
      wash.addColorStop(0.42, 'rgba(62, 210, 193, 0.035)')
      wash.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = wash
      ctx.fillRect(0, 0, w, h)

      // stars
      const scroll = window.scrollY
      for (const s of stars) {
        const tw = 0.24 + Math.sin(time * 1.4 + s.tw) * 0.18
        const y = (s.y - scroll * 0.06 + h * 2) % h
        ctx.beginPath()
        ctx.fillStyle = `rgba(180, 208, 218, ${tw * (0.35 + s.z * 0.65)})`
        ctx.arc(s.x, y, s.r, 0, TAU)
        ctx.fill()
      }

      const gcx = cx + pointer.x * 26
      const gcy = cy + pointer.y * 18

      // outer ring
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(62, 210, 193, 0.1)'
      ctx.lineWidth = 0.7
      ctx.arc(gcx, gcy, R * 1.82, 0, TAU)
      ctx.stroke()

      // crosshair ticks
      ctx.strokeStyle = 'rgba(150, 168, 192, 0.16)'
      for (let i = 0; i < 4; i += 1) {
        const a = (i * TAU) / 4 + Math.PI / 4
        ctx.beginPath()
        ctx.moveTo(gcx + Math.cos(a) * R * 1.78, gcy + Math.sin(a) * R * 1.78)
        ctx.lineTo(gcx + Math.cos(a) * R * 1.88, gcy + Math.sin(a) * R * 1.88)
        ctx.stroke()
      }

      // globe glow
      const glow = ctx.createRadialGradient(gcx, gcy, R * 0.1, gcx, gcy, R * 1.28)
      glow.addColorStop(0, 'rgba(62, 210, 193, 0.10)')
      glow.addColorStop(0.72, 'rgba(62, 210, 193, 0.035)')
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(gcx, gcy, R * 1.3, 0, TAU)
      ctx.fill()

      const toScreen = (x: number, y: number, z: number) => {
        const p = project(x, y, z, rotY, tilt)
        return { x: gcx + p.x * R, y: gcy + p.y * R, z: p.z }
      }

      // latitude lines
      for (let lat = -75; lat <= 75; lat += 15) {
        const phi = (lat * Math.PI) / 180
        const r = Math.cos(phi)
        const yy = Math.sin(phi)
        const segs = 56
        for (let i = 0; i < segs; i += 1) {
          const t0 = (i / segs) * TAU
          const t1 = ((i + 1) / segs) * TAU
          const a = toScreen(Math.cos(t0) * r, yy, Math.sin(t0) * r)
          const b = toScreen(Math.cos(t1) * r, yy, Math.sin(t1) * r)
          const depth = (a.z + 1) / 2
          ctx.beginPath()
          ctx.strokeStyle = `rgba(96, 190, 186, ${0.035 + depth * 0.17})`
          ctx.lineWidth = lat === 0 ? 0.9 : 0.55
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }

      // longitude lines
      for (let lon = 0; lon < 360; lon += 15) {
        const theta = (lon * Math.PI) / 180
        const segs = 40
        for (let i = 0; i < segs; i += 1) {
          const p0 = -Math.PI / 2 + (i / segs) * Math.PI
          const p1 = -Math.PI / 2 + ((i + 1) / segs) * Math.PI
          const a = toScreen(Math.cos(p0) * Math.cos(theta), Math.sin(p0), Math.cos(p0) * Math.sin(theta))
          const b = toScreen(Math.cos(p1) * Math.cos(theta), Math.sin(p1), Math.cos(p1) * Math.sin(theta))
          const depth = (a.z + 1) / 2
          ctx.beginPath()
          ctx.strokeStyle = `rgba(96, 190, 186, ${0.03 + depth * 0.13})`
          ctx.lineWidth = 0.5
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }

      // rim
      const rim = ctx.createLinearGradient(gcx - R, gcy - R, gcx + R, gcy + R)
      rim.addColorStop(0, 'rgba(62, 210, 193, 0.55)')
      rim.addColorStop(0.5, 'rgba(62, 210, 193, 0.12)')
      rim.addColorStop(1, 'rgba(62, 210, 193, 0.35)')
      ctx.beginPath()
      ctx.strokeStyle = rim
      ctx.lineWidth = 1
      ctx.arc(gcx, gcy, R, 0, TAU)
      ctx.stroke()

      // asset ring
      const assetPos: { x: number; y: number; z: number; bright: number }[] = []
      for (let i = 0; i < assetCount; i += 1) {
        const a = (i / assetCount) * TAU + time * 0.055
        const px = Math.cos(a) * 1.6
        const py = Math.sin(a * 2) * 0.11
        const pz = Math.sin(a) * 1.6
        const p = toScreen(px, py, pz)
        const bright = 0.45 + ((p.z + 1) / 2) * 0.55
        assetPos.push({ ...p, bright })
      }

      for (const ap of assetPos) {
        ctx.beginPath()
        ctx.strokeStyle = `rgba(227, 164, 85, ${0.045 * ap.bright})`
        ctx.lineWidth = 0.5
        ctx.moveTo(gcx, gcy)
        ctx.lineTo(ap.x, ap.y)
        ctx.stroke()
      }

      // orbs
      spawnClock += dt
      if (spawnClock > 1.35) {
        spawnClock = 0
        if (visible) spawnOrb()
      }

      for (const orb of orbs) {
        if (!orb.done && visible) orb.progress += dt * orb.speed
        const target = assetPos[orb.target]
        const t = Math.min(1, orb.progress)
        const e = easeOutCubic(t)
        const x = (1 - e) * (1 - e) * orb.p0x + 2 * (1 - e) * e * orb.cx + e * e * target.x
        const y = (1 - e) * (1 - e) * orb.p0y + 2 * (1 - e) * e * orb.cy + e * e * target.y

        if (!orb.done) {
          orb.trail.push({ x, y })
          if (orb.trail.length > 11) orb.trail.shift()
        }

        const fade = orb.match ? 1 : Math.max(0, 1 - Math.max(0, t - 0.55) / 0.4)
        const color = orb.match ? '227, 164, 85' : '150, 168, 192'

        for (let i = 0; i < orb.trail.length; i += 1) {
          const tr = orb.trail[i]
          const f = i / orb.trail.length
          ctx.beginPath()
          ctx.fillStyle = `rgba(${color}, ${f * 0.35 * fade})`
          ctx.arc(tr.x, tr.y, 1 + f * 1.6, 0, TAU)
          ctx.fill()
        }

        const pulse = 1 + Math.sin(time * 4 + orb.seed) * 0.18
        const og = ctx.createRadialGradient(x, y, 0, x, y, 13 * pulse)
        og.addColorStop(0, `rgba(${color}, ${0.95 * fade})`)
        og.addColorStop(0.35, `rgba(${color}, ${0.35 * fade})`)
        og.addColorStop(1, `rgba(${color}, 0)`)
        ctx.fillStyle = og
        ctx.beginPath()
        ctx.arc(x, y, 13 * pulse, 0, TAU)
        ctx.fill()

        ctx.beginPath()
        ctx.fillStyle = `rgba(${color}, ${fade})`
        ctx.arc(x, y, 2.1, 0, TAU)
        ctx.fill()

        if (t >= 1 && !orb.done) {
          orb.done = true
          if (orb.match) {
            flashes.push({ x: target.x, y: target.y, t: 0, color: '227, 164, 85' })
            onCorrelate?.()
          }
        }
      }
      orbs = orbs.filter((o) => !(o.done && o.progress > 1.15))

      for (const ap of assetPos) {
        ctx.beginPath()
        ctx.fillStyle = `rgba(233, 238, 245, ${0.35 + ap.bright * 0.4})`
        ctx.arc(ap.x, ap.y, 2.2, 0, TAU)
        ctx.fill()
        ctx.beginPath()
        ctx.strokeStyle = `rgba(62, 210, 193, ${0.18 + ap.bright * 0.25})`
        ctx.lineWidth = 0.7
        ctx.arc(ap.x, ap.y, 6.5, 0, TAU)
        ctx.stroke()
      }

      // flashes
      for (let i = flashes.length - 1; i >= 0; i -= 1) {
        const f = flashes[i]
        f.t += dt
        if (f.t > 1.5) {
          flashes.splice(i, 1)
          continue
        }
        const fxp = f.t / 1.5
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${f.color}, ${(1 - fxp) * 0.5})`
        ctx.lineWidth = 1
        ctx.arc(f.x, f.y, 7 + fxp * 52, 0, TAU)
        ctx.stroke()
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${f.color}, ${(1 - fxp) * 0.28})`
        ctx.arc(f.x, f.y, 3 + fxp * 24, 0, TAU)
        ctx.stroke()
      }

      // faint HUD arcs
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(227, 164, 85, 0.32)'
      ctx.lineWidth = 1.1
      const arcStart = time * 0.3
      ctx.arc(gcx, gcy, R * 1.52, arcStart, arcStart + 0.6)
      ctx.stroke()
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(62, 210, 193, 0.16)'
      ctx.arc(gcx, gcy, R * 1.6, -arcStart * 0.6, -arcStart * 0.6 + 1.1)
      ctx.stroke()

      raf = requestAnimationFrame(draw)
    }

    last = performance.now()
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointermove', onPointer)
    }
  }, [reduce, onCorrelate])

  if (reduce) return <HeroFallback />

  return (
    <div className="hero-canvas" ref={wrapRef} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  )
}

export function HeroFallback() {
  return (
    <div className="hero-canvas" aria-hidden="true">
      <svg viewBox="0 0 800 700" style={{ width: '100%', height: '100%' }}>
        <defs>
          <radialGradient id="fbGlow" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#3ed2c1" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#3ed2c1" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="560" cy="350" r="300" fill="url(#fbGlow)" />
        <g stroke="#3ed2c1" fill="none" opacity="0.4">
          {Array.from({ length: 9 }, (_, i) => (
            <ellipse key={`lat-${i}`} cx="560" cy="350" rx="180" ry={180 - i * 20} opacity={0.7 - i * 0.05} />
          ))}
          {Array.from({ length: 9 }, (_, i) => (
            <ellipse key={`lon-${i}`} cx="560" cy="350" rx={18 + i * 20} ry="180" opacity={0.5 - i * 0.03} />
          ))}
        </g>
        <circle cx="560" cy="350" r="180" stroke="#3ed2c1" fill="none" opacity="0.6" />
        <ellipse cx="560" cy="350" rx="288" ry="120" stroke="#e3a455" fill="none" opacity="0.3" strokeDasharray="3 8" />
        {Array.from({ length: 13 }, (_, i) => {
          const a = (i / 13) * Math.PI * 2
          const x = 560 + Math.cos(a) * 288
          const y = 350 + Math.sin(a) * 120
          const match = i % 3 !== 0
          return (
            <g key={i}>
              {match && <line x1={x} y1={y} x2="560" y2="350" stroke="#e3a455" opacity="0.18" />}
              <circle cx={x} cy={y} r="3" fill={match ? '#e3a455' : '#8a96a8'} />
            </g>
          )
        })}
        {[
          [740, 170],
          [300, 250],
          [660, 620],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="4" fill={i === 1 ? '#8a96a8' : '#e3a455'} opacity="0.8" />
        ))}
      </svg>
    </div>
  )
}
