import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { alerts, assetById, assets, cves } from '../data/seed'
import { cx } from '../lib/format'

const TAU = Math.PI * 2

type Tone = 'noise' | 'critical' | 'match'
type Status = 'in' | 'reject' | 'out' | 'dead'

interface Packet {
  x: number
  y: number
  laneY: number
  vx: number
  vy: number
  depth: number
  tone: Tone
  status: Status
  age: number
  target: number
  label: string | null
  trail: { x: number; y: number }[]
  seed: number
}

interface Ripple {
  x: number
  y: number
  age: number
  tone: 'amber' | 'teal' | 'dim'
  size: number
}

interface Anchor {
  x: number
  y: number
}

interface Star {
  x: number
  y: number
  z: number
  r: number
  tw: number
}

interface Palette {
  teal: string
  amber: string
  red: string
  text: string
}

const sceneNodes = [
  { assetId: 'AST-HR-01', stack: 'Log4j 2.14.1', cve: 'CVE-2021-44228' },
  { assetId: 'AST-FIN-02', stack: 'Spring 5.3.17', cve: 'CVE-2023-20863' },
  { assetId: 'AST-CX-11', stack: 'Log4j 2.17.1', cve: null },
  { assetId: 'AST-ENG-09', stack: 'nginx 1.25.2', cve: 'CVE-2023-44487' },
].map((node) => ({
  ...node,
  name: assetById[node.assetId]?.name ?? node.assetId,
  score: node.cve
    ? (alerts.find((a) => a.cve.id === node.cve && a.relevance === 'MATCHED')?.score ?? 0)
    : 0,
}))

const cveIds = cves.map((c) => c.id)
const criticalCveIds = cves.filter((c) => c.severity === 'CRITICAL').map((c) => c.id)

function toRgb(value: string, fallback: string) {
  const raw = value.trim() || fallback
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`
  }
  const rgb = raw.match(/rgba?\(([^)]+)\)/)
  if (rgb) {
    return rgb[1]
      .split(',')
      .slice(0, 3)
      .map((v) => Math.round(Number.parseFloat(v)))
      .join(', ')
  }
  return fallback
}

function readPalette(): Palette {
  if (typeof window === 'undefined') {
    return { teal: '62, 210, 193', amber: '227, 164, 85', red: '229, 84, 90', text: '152, 165, 184' }
  }
  const style = getComputedStyle(document.documentElement)
  return {
    teal: toRgb(style.getPropertyValue('--teal'), '62, 210, 193'),
    amber: toRgb(style.getPropertyValue('--amber'), '227, 164, 85'),
    red: toRgb(style.getPropertyValue('--critical'), '229, 84, 90'),
    text: toRgb(style.getPropertyValue('--text-dim'), '152, 165, 184'),
  }
}

interface Hit {
  index: number
  cve: string
  asset: string
  score: number
}

export function HeroScene() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scanRef = useRef<HTMLSpanElement>(null)
  const scopeRef = useRef<HTMLSpanElement>(null)
  const filteredRef = useRef<HTMLSpanElement>(null)
  const hitTimer = useRef<number | undefined>(undefined)
  const reduce = useReducedMotion()
  const [hit, setHit] = useState<Hit | null>(null)

  const reportHit = useCallback((index: number) => {
    const node = sceneNodes[index]
    if (!node?.cve) return
    setHit({ index, cve: node.cve, asset: node.name, score: node.score })
    window.clearTimeout(hitTimer.current)
    hitTimer.current = window.setTimeout(() => setHit(null), 4200)
  }, [])

  useEffect(() => () => window.clearTimeout(hitTimer.current), [])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0
    let time = 0
    let last = performance.now()
    let visible = true
    let disposed = false
    let spawnClock = 0
    let matchCooldown = 1.8
    let gateFlash = 0
    let scanned = 0
    let matched = 0
    let packets: Packet[] = []
    let ripples: Ripple[] = []
    let anchors: Anchor[] = []
    let domAnchors = false
    let copyEdge = 0
    const stars: Star[] = []
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
    let palette = readPalette()
    let seed = 918273
    const rng = () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }

    const gate = () => {
      const tiny = w < 700
      const narrow = w < 1080
      return {
        cx: w * (tiny ? 0.8 : w >= 1260 ? 0.68 : 0.72) + pointer.x * (tiny ? 6 : 12),
        cy: h * (tiny ? 0.3 : 0.455) + pointer.y * (tiny ? 5 : 10),
        rx: tiny ? 34 : Math.min(w * (narrow ? 0.1 : 0.078), narrow ? 96 : 112),
        ry: tiny ? 118 : Math.min(h * (narrow ? 0.26 : 0.29), narrow ? 190 : 262),
      }
    }

    const updateCounts = () => {
      if (scanRef.current) scanRef.current.textContent = scanned.toLocaleString('en-US')
      if (scopeRef.current) scopeRef.current.textContent = matched.toLocaleString('en-US')
      if (filteredRef.current) filteredRef.current.textContent = (scanned - matched).toLocaleString('en-US')
    }

    const measureAnchors = () => {
      const wrapRect = wrap.getBoundingClientRect()
      const copy = wrap.parentElement?.querySelector<HTMLElement>('.hero-copy')
      copyEdge = copy ? copy.getBoundingClientRect().right - wrapRect.left : 0
      const nodes = Array.from(wrap.querySelectorAll<HTMLElement>('[data-scene-node]'))
      domAnchors = nodes.length === sceneNodes.length && nodes.every((el) => el.getBoundingClientRect().width > 0)
      anchors = domAnchors
        ? nodes.map((el) => {
            const rect = el.getBoundingClientRect()
            return {
              x: rect.left - wrapRect.left + 3,
              y: rect.top - wrapRect.top + rect.height / 2,
            }
          })
        : sceneNodes.map((_, i) =>
            w >= 700
              ? {
                  x: w - Math.max(22, w * 0.02),
                  y: h * 0.455 + (i - (sceneNodes.length - 1) / 2) * 44,
                }
              : {
                  x: w + 90,
                  y: h * 0.3 + (i - (sceneNodes.length - 1) / 2) * 28,
                },
          )
    }

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = rect.width
      h = rect.height
      if (!w || !h) return
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      stars.length = 0
      const count = Math.round(Math.min(170, Math.max(80, (w * h) / 14000)))
      for (let i = 0; i < count; i += 1) {
        stars.push({
          x: rng() * w,
          y: rng() * h,
          z: rng(),
          r: rng() * 0.9 + 0.2,
          tw: rng() * TAU,
        })
      }
      measureAnchors()
      if (reduce) drawFrame()
    }

    const spawnPacket = (initial = false) => {
      const g = gate()
      const depth = rng()
      const critical = rng() < 0.16
      const pool = critical ? criticalCveIds : cveIds
      const x = initial
        ? g.cx - (50 + rng() * 520)
        : g.cx - (w < 1080 ? 160 + rng() * 230 : 240 + rng() * 360)
      packets.push({
        x,
        y: g.cy + (rng() - 0.5) * g.ry * 1.8,
        laneY: g.cy + (rng() - 0.5) * g.ry * 1.35,
        vx: 54 + depth * 46,
        vy: 0,
        depth,
        tone: critical ? 'critical' : 'noise',
        status: 'in',
        age: 0,
        target: -1,
        label: rng() < 0.42 ? pool[Math.floor(rng() * pool.length)] : null,
        trail: [],
        seed: rng() * TAU,
      })
      if (packets.length > 52) packets = packets.slice(-52)
    }

    const crossGate = (packet: Packet, g: ReturnType<typeof gate>) => {
      scanned += 1
      if (matchCooldown <= 0) {
        const candidates = sceneNodes.map((node, i) => (node.cve ? i : -1)).filter((i) => i >= 0)
        const target = candidates[Math.floor(rng() * candidates.length)]
        packet.status = 'out'
        packet.tone = 'match'
        packet.target = target
        packet.label = sceneNodes[target].cve
        packet.trail = []
        packet.age = 0
        matched += 1
        matchCooldown = 4.8 + rng() * 2.8
        gateFlash = 1
        ripples.push({ x: g.cx, y: packet.y, age: 0, tone: 'amber', size: 1.6 })
      } else {
        packet.status = 'reject'
        packet.target = -1
        packet.age = 0
        packet.vx = -(14 + rng() * 36)
        packet.vy = (rng() - 0.5) * 130
        ripples.push({ x: g.cx, y: packet.y, age: 0, tone: 'dim', size: 0.75 })
      }
      updateCounts()
    }

    const update = (dt: number) => {
      const g = gate()
      time += dt
      matchCooldown -= dt
      gateFlash = Math.max(0, gateFlash - dt * 1.35)
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2.6)
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2.6)

      spawnClock += dt
      if (spawnClock > 0.18 + rng() * 0.22) {
        spawnClock = 0
        spawnPacket()
      }

      for (const packet of packets) {
        packet.age += dt
        if (packet.status === 'in') {
          packet.y += (packet.laneY - packet.y) * Math.min(1, dt * 1.15)
          packet.y += Math.sin(time * 1.3 + packet.seed) * 7 * dt
          packet.x += packet.vx * dt
          packet.trail.push({ x: packet.x, y: packet.y })
          if (packet.trail.length > 9) packet.trail.shift()
          if (packet.x >= g.cx) crossGate(packet, g)
        } else if (packet.status === 'reject') {
          packet.x += packet.vx * dt
          packet.y += packet.vy * dt
          packet.vy += 55 * dt
          if (packet.age > 0.85) packet.status = 'dead'
        } else if (packet.status === 'out') {
          const anchor = anchors[packet.target] ?? { x: g.cx + 260, y: packet.y }
          const k = Math.min(1, dt * 1.7)
          packet.x += (anchor.x - packet.x) * k
          packet.y += (anchor.y - packet.y) * k
          packet.trail.push({ x: packet.x, y: packet.y })
          if (packet.trail.length > 12) packet.trail.shift()
          const dx = anchor.x - packet.x
          const dy = anchor.y - packet.y
          if (Math.hypot(dx, dy) < 24 || packet.age > 5) {
            reportHit(packet.target)
            ripples.push({ x: anchor.x, y: anchor.y, age: 0, tone: 'amber', size: 1.2 })
            packet.status = 'dead'
          }
        }
      }

      packets = packets.filter((packet) => packet.status !== 'dead' && packet.x > -320)
      for (const ripple of ripples) ripple.age += dt
      ripples = ripples.filter((ripple) => ripple.age < (ripple.tone === 'amber' ? 1.1 : 0.7))
    }

    const drawGate = (g: ReturnType<typeof gate>) => {
      const { cx, cy, rx, ry } = g
      const tiny = w < 700
      const bx = cx + rx * 0.52
      const by = cy - ry * 0.05
      const brx = rx * 0.82
      const bry = ry * 0.92
      const flash = gateFlash

      ctx.save()
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU)
      ctx.clip()
      const membrane = ctx.createRadialGradient(cx, cy, 8, cx, cy, ry)
      membrane.addColorStop(0, `rgba(${palette.teal}, ${0.05 + flash * 0.05})`)
      membrane.addColorStop(0.7, `rgba(${palette.teal}, 0.016)`)
      membrane.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = membrane
      ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2)
      ctx.restore()

      for (let i = 0; i < 18; i += 1) {
        const a = (i / 18) * TAU + time * 0.04
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${palette.teal}, ${0.065 + flash * 0.08})`
        ctx.lineWidth = 0.6
        ctx.moveTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)
        ctx.lineTo(bx + Math.cos(a) * brx, by + Math.sin(a) * bry)
        ctx.stroke()
      }

      ctx.beginPath()
      ctx.strokeStyle = `rgba(${palette.teal}, 0.18)`
      ctx.lineWidth = 0.7
      ctx.ellipse(bx, by, brx, bry, 0, 0, TAU)
      ctx.stroke()

      if (!tiny) {
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${palette.teal}, 0.16)`
        ctx.lineWidth = 0.6
        ctx.ellipse(cx, cy, rx * 1.26, ry * 1.2, 0, 0, TAU)
        ctx.stroke()

        for (let i = 0; i < 64; i += 1) {
          const a = (i / 64) * TAU
          const major = i % 8 === 0
          const inner = major ? 1.29 : 1.315
          const outer = major ? 1.39 : 1.345
          ctx.beginPath()
          ctx.strokeStyle = `rgba(${palette.teal}, ${major ? 0.34 : 0.14})`
          ctx.lineWidth = major ? 0.9 : 0.5
          ctx.moveTo(cx + Math.cos(a) * rx * inner, cy + Math.sin(a) * ry * inner)
          ctx.lineTo(cx + Math.cos(a) * rx * outer, cy + Math.sin(a) * ry * outer)
          ctx.stroke()
        }
      }

      const rim = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry)
      rim.addColorStop(0, `rgba(${palette.teal}, ${0.62 + flash * 0.25})`)
      rim.addColorStop(0.55, `rgba(${palette.teal}, ${0.2 + flash * 0.15})`)
      rim.addColorStop(1, `rgba(${palette.amber}, ${0.42 + flash * 0.2})`)
      ctx.beginPath()
      ctx.strokeStyle = rim
      ctx.lineWidth = 1.2
      ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU)
      ctx.stroke()

      ctx.beginPath()
      ctx.strokeStyle = `rgba(${palette.teal}, 0.12)`
      ctx.lineWidth = 0.7
      ctx.ellipse(cx, cy, rx * 0.84, ry * 0.9, 0, 0, TAU)
      ctx.stroke()

      const scanT = (time * 0.15) % 1
      const scanY = cy - ry + scanT * ry * 2
      const fit = Math.max(0, 1 - ((scanY - cy) / ry) ** 2)
      const half = rx * Math.sqrt(fit)
      if (half > 3) {
        const line = ctx.createLinearGradient(cx - half, 0, cx + half, 0)
        line.addColorStop(0, `rgba(${palette.teal}, 0)`)
        line.addColorStop(0.5, `rgba(${palette.teal}, ${0.58 + flash * 0.2})`)
        line.addColorStop(1, `rgba(${palette.teal}, 0)`)
        ctx.strokeStyle = line
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(cx - half, scanY)
        ctx.lineTo(cx + half, scanY)
        ctx.stroke()

        const echo = ctx.createLinearGradient(cx - half, scanY - 10, cx + half, scanY + 10)
        echo.addColorStop(0, `rgba(${palette.teal}, 0)`)
        echo.addColorStop(0.5, `rgba(${palette.teal}, 0.09)`)
        echo.addColorStop(1, `rgba(${palette.teal}, 0)`)
        ctx.fillStyle = echo
        ctx.beginPath()
        ctx.ellipse(cx, scanY, half, 11, 0, 0, TAU)
        ctx.fill()
      }

      ctx.beginPath()
      ctx.strokeStyle = `rgba(${palette.amber}, 0.4)`
      ctx.lineWidth = 0.7
      ctx.moveTo(cx - 7, cy)
      ctx.lineTo(cx + 7, cy)
      ctx.moveTo(cx, cy - 7)
      ctx.lineTo(cx, cy + 7)
      ctx.stroke()
      ctx.beginPath()
      ctx.fillStyle = `rgba(${palette.amber}, 0.95)`
      ctx.arc(cx, cy, 1.7, 0, TAU)
      ctx.fill()

      if (!tiny) {
        const arcStart = time * 0.22
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${palette.amber}, 0.38)`
        ctx.lineWidth = 1
        ctx.ellipse(cx, cy, rx * 1.48, ry * 1.42, 0, arcStart, arcStart + 0.55)
        ctx.stroke()
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${palette.teal}, 0.22)`
        ctx.ellipse(cx, cy, rx * 1.58, ry * 1.5, 0, -arcStart * 0.6, -arcStart * 0.6 + 0.9)
        ctx.stroke()
      }
    }

    const drawPacket = (packet: Packet) => {
      const isMatch = packet.tone === 'match'
      const life = packet.status === 'reject' ? Math.max(0, 1 - packet.age / 0.85) : 1
      if (life <= 0) return
      const fadeStart = w >= 1260 && copyEdge ? copyEdge + 12 : 0
      const fade = fadeStart
        ? Math.max(0, Math.min(1, (packet.x - fadeStart) / 72))
        : 1
      if (fade <= 0.01) return
      const color = isMatch ? palette.amber : packet.tone === 'critical' ? palette.red : palette.text
      const alpha = (0.24 + packet.depth * 0.52) * life
      const size = 0.7 + packet.depth * 0.7
      ctx.save()
      ctx.globalAlpha = fade

      for (let i = 0; i < packet.trail.length; i += 1) {
        const point = packet.trail[i]
        const f = i / packet.trail.length
        ctx.beginPath()
        ctx.fillStyle = `rgba(${color}, ${f * (isMatch ? 0.4 : 0.22) * life})`
        ctx.arc(point.x, point.y, (isMatch ? 1.6 : 0.8) * f + 0.35, 0, TAU)
        ctx.fill()
      }

      if (isMatch || packet.tone === 'critical' || packet.depth > 0.5) {
        const radius = isMatch ? 20 : 8
        const glow = ctx.createRadialGradient(packet.x, packet.y, 0, packet.x, packet.y, radius)
        glow.addColorStop(0, `rgba(${color}, ${(isMatch ? 0.65 : 0.22) * life})`)
        glow.addColorStop(1, `rgba(${color}, 0)`)
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(packet.x, packet.y, radius, 0, TAU)
        ctx.fill()
      }

      if (isMatch) {
        ctx.beginPath()
        ctx.fillStyle = `rgba(${color}, ${0.98 * life})`
        ctx.moveTo(packet.x, packet.y - 3.4)
        ctx.lineTo(packet.x + 3.4, packet.y)
        ctx.lineTo(packet.x, packet.y + 3.4)
        ctx.lineTo(packet.x - 3.4, packet.y)
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.fillStyle = `rgba(${color}, ${Math.min(1, alpha + 0.2)})`
        ctx.fillRect(packet.x - 7.5 * size, packet.y - 0.6, 7.5 * size, 1.2)
        ctx.beginPath()
        ctx.arc(packet.x, packet.y, 1 + packet.depth * 1.1, 0, TAU)
        ctx.fill()
      }

      if (packet.label) {
        const clearOfCopy =
          w >= 1260 || w < 700 || !copyEdge || packet.x > copyEdge + 6
        if (clearOfCopy) {
          ctx.font = '8.5px "JetBrains Mono Variable", ui-monospace, monospace'
          ctx.textAlign = 'left'
          ctx.fillStyle = `rgba(${color}, ${(isMatch ? 0.95 : 0.46) * life})`
          ctx.fillText(packet.label, packet.x + 9, packet.y - 6)
        }
      }
      ctx.restore()
    }

    const drawFrame = () => {
      const g = gate()
      const scroll = window.scrollY
      ctx.clearRect(0, 0, w, h)

      const wash = ctx.createRadialGradient(g.cx, g.cy, 20, g.cx, g.cy, g.ry * 2.1)
      wash.addColorStop(0, `rgba(${palette.teal}, ${0.13 + gateFlash * 0.06})`)
      wash.addColorStop(0.5, `rgba(${palette.teal}, 0.04)`)
      wash.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = wash
      ctx.fillRect(0, 0, w, h)

      const invGlow = ctx.createRadialGradient(w * 0.9, h * 0.5, 10, w * 0.9, h * 0.5, Math.min(w * 0.3, 360))
      invGlow.addColorStop(0, `rgba(${palette.amber}, 0.085)`)
      invGlow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = invGlow
      ctx.fillRect(0, 0, w, h)

      for (const s of stars) {
        const twinkle = 0.24 + Math.sin(time * 1.2 + s.tw) * 0.14
        const y = (s.y - scroll * 0.055 + h * 2) % h
        ctx.beginPath()
        ctx.fillStyle = `rgba(${palette.text}, ${twinkle * (0.34 + s.z * 0.66)})`
        ctx.arc(s.x, y, s.r, 0, TAU)
        ctx.fill()
      }

      drawGate(g)

      for (const packet of packets) drawPacket(packet)

      for (const ripple of ripples) {
        const life = ripple.tone === 'amber' ? 1.1 : 0.7
        const t = ripple.age / life
        if (t > 1) continue
        const color = ripple.tone === 'amber' ? palette.amber : ripple.tone === 'teal' ? palette.teal : palette.text
        const radius = 4 + t * 62 * ripple.size
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${color}, ${(1 - t) * (ripple.tone === 'dim' ? 0.24 : 0.5)})`
        ctx.lineWidth = 1
        ctx.ellipse(ripple.x, ripple.y, radius * 0.55, radius, 0, 0, TAU)
        ctx.stroke()
      }

      if (!domAnchors && w >= 700) {
        anchors.forEach((anchor) => {
          ctx.beginPath()
          ctx.strokeStyle = `rgba(${palette.teal}, 0.32)`
          ctx.lineWidth = 0.7
          ctx.moveTo(anchor.x, anchor.y - 4)
          ctx.lineTo(anchor.x + 4, anchor.y)
          ctx.lineTo(anchor.x, anchor.y + 4)
          ctx.lineTo(anchor.x - 4, anchor.y)
          ctx.closePath()
          ctx.stroke()
        })
      }
    }

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (visible && !document.hidden) {
        update(dt)
        drawFrame()
      }
      raf = requestAnimationFrame(loop)
    }

    const pointerMove = (event: PointerEvent) => {
      pointer.tx = (event.clientX / window.innerWidth - 0.5) * 2
      pointer.ty = (event.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('pointermove', pointerMove, { passive: true })

    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
      },
      { threshold: 0.01 },
    )
    intersection.observe(wrap)

    const themeObserver = new MutationObserver(() => {
      palette = readPalette()
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()
    document.fonts?.ready.then(() => {
      if (!disposed) measureAnchors()
    })

    if (reduce) {
      for (let i = 0; i < 12; i += 1) spawnPacket(true)
      const g = gate()
      const target = 0
      const anchor = anchors[target] ?? { x: w - Math.max(22, w * 0.02), y: g.cy }
      packets.push({
        x: g.cx + (anchor.x - g.cx) * 0.42,
        y: g.cy + (anchor.y - g.cy) * 0.3,
        laneY: g.cy,
        vx: 0,
        vy: 0,
        depth: 0.85,
        tone: 'match',
        status: 'out',
        age: 1,
        target,
        label: sceneNodes[target].cve,
        trail: [
          { x: g.cx + 14, y: g.cy + 4 },
          { x: g.cx + 60, y: g.cy + 12 },
          { x: g.cx + 110, y: g.cy + 26 },
        ],
        seed: 0.4,
      })
      gateFlash = 0.55
      ripples.push({ x: g.cx, y: g.cy, age: 0, tone: 'amber', size: 1.4 })
      setHit({
        index: target,
        cve: sceneNodes[target].cve as string,
        asset: sceneNodes[target].name,
        score: sceneNodes[target].score,
      })
      drawFrame()
    } else {
      for (let i = 0; i < 10; i += 1) spawnPacket(true)
      last = performance.now()
      raf = requestAnimationFrame(loop)
    }

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      intersection.disconnect()
      themeObserver.disconnect()
      window.removeEventListener('pointermove', pointerMove)
    }
  }, [reduce, reportHit])

  return (
    <div className={cx('hero-canvas', reduce && 'is-still')} ref={wrapRef} aria-hidden="true">
      <canvas ref={canvasRef} />

      <div className="hs-gate-label">
        <span className="hs-kicker">Version gate</span>
        <span className="hs-sub">installed version ∈ affected range</span>
        <div className="hs-stats">
          <span>
            scanned <b ref={scanRef}>0</b>
          </span>
          <span>
            in scope <b ref={scopeRef} className="is-scope">0</b>
          </span>
          <span>
            filtered <b ref={filteredRef}>0</b>
          </span>
        </div>
      </div>

      <div className="hs-inventory">
        <div className="hs-inv-head">
          <span className="hs-kicker">Your inventory</span>
          <span className="hs-sub">{assets.length} assets · version-checked</span>
          <span className={cx('hs-match', hit && 'live')}>
            {hit ? (
              <>
                <b>{hit.cve}</b>
                <i>→</i>
                <span>{hit.asset}</span>
                <em>{hit.score.toFixed(1)}</em>
              </>
            ) : (
              <span className="hs-match-idle">watching the stream</span>
            )}
          </span>
        </div>
        {sceneNodes.map((node, index) => (
          <div
            className={cx('hs-asset', hit?.index === index && 'hit')}
            data-scene-node={node.assetId}
            key={node.assetId}
          >
            <span className="hs-asset-led" />
            <span className="hs-asset-copy">
              <b>{node.name}</b>
              <small>{node.stack}</small>
            </span>
            <span className={cx('hs-asset-flag', !node.cve && 'is-patched')}>
              {hit?.index === index ? 'matched' : node.cve ? '' : 'patched'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
