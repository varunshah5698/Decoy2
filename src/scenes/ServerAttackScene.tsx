import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import { alerts, assetById } from '../data/seed'
import { cx } from '../lib/format'

const TAU = Math.PI * 2
const RACK = { w: 250, h: 430, d: 170 }

interface MatchNode {
  assetId: string
  cveId: string
  product: string
  version: string
  fix: string
  name: string
  score: number
}

const matchNodes: MatchNode[] = [
  { assetId: 'AST-HR-01', cveId: 'CVE-2021-44228', product: 'Log4j', version: '2.14.1', fix: '2.17.1' },
  { assetId: 'AST-FIN-04', cveId: 'CVE-2023-34362', product: 'MOVEit', version: '2023.0.1', fix: '2023.0.3' },
  { assetId: 'AST-ENG-09', cveId: 'CVE-2023-44487', product: 'nginx', version: '1.25.2', fix: '1.25.5' },
  { assetId: 'AST-FIN-02', cveId: 'CVE-2023-20863', product: 'Spring', version: '5.3.17', fix: '5.3.27' },
].map((node) => {
  const asset = assetById[node.assetId]
  const alert = alerts.find((a) => a.cve.id === node.cveId && a.relevance === 'MATCHED')
  return {
    ...node,
    name: asset?.name ?? node.assetId,
    score: alert?.score ?? 0,
  }
})

const feedIds = alerts.filter((a) => !a.suppressed).map((a) => a.cve.id)

interface Packet {
  sx: number
  sy: number
  cx: number
  cy: number
  ex: number
  ey: number
  p: number
  speed: number
  depth: number
  tone: 'noise' | 'crit' | 'match'
  node: MatchNode | null
  label: string | null
  age: number
  dead: boolean
  trail: { x: number; y: number }[]
}

interface Ripple {
  x: number
  y: number
  age: number
  life: number
  tone: 'teal' | 'amber'
  size: number
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  tone: 'teal' | 'amber' | 'red'
}

interface Dust {
  x: number
  y: number
  z: number
  r: number
  phase: number
}

export function ServerAttackScene() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduce = useReducedMotion()

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
    let disposed = false
    let visible = true
    let time = 0
    let last = performance.now()

    let cx = 0
    let cy = 0
    let scale = 1
    let yaw = -0.52
    let pitch = 0.16
    let matched = 0
    let matchCooldown = 3.4
    let spawnClock = 0
    let flash = 0
    let breachBeam = 0
    let hotUnit = -1
    let hotAge = 0

    let packets: Packet[] = []
    let ripples: Ripple[] = []
    let sparks: Spark[] = []
    const dust: Dust[] = []
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
    let scrollShift = 0
    let seed = 481516
    const rng = () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }

    const project = (x: number, y: number, z: number) => {
      const cyaw = Math.cos(yaw)
      const syaw = Math.sin(yaw)
      const x1 = x * cyaw - z * syaw
      const z1 = x * syaw + z * cyaw
      const cp = Math.cos(pitch)
      const sp = Math.sin(pitch)
      const y1 = y * cp - z1 * sp
      const z2 = y * sp + z1 * cp
      const persp = 1250 / (1250 + z2)
      return { x: cx + x1 * persp * scale, y: cy + y1 * persp * scale, z: z2, s: persp * scale }
    }

    const shield = () => {
      const center = project(0, 0, RACK.d / 2 + 46)
      return {
        x: center.x,
        y: center.y,
        rx: RACK.w * 0.74 * center.s,
        ry: RACK.h * 0.58 * center.s,
      }
    }

    const hostiles = () => {
      if (w < 900) return []
      const gate = shield()
      const primary = {
        x: gate.x - gate.rx * 1.54,
        y: gate.y - gate.ry * 0.9,
        label: '185.220.101.42',
        meta: 'tor exit · exploit relay',
        phase: 0.15,
      }
      if (w < 1180) return [primary]
      return [
        primary,
        {
          x: gate.x - gate.rx * 2.02,
          y: gate.y - gate.ry * 0.16,
          label: '45.155.204.11',
          meta: 'scanner · 1,284 attempts',
          phase: 0.62,
        },
      ]
    }

    const onMatch = (sx: number, sy: number) => {
      matched += 1
      flash = 1
      breachBeam = 1
      hotUnit = 2 + Math.floor(rng() * 7)
      hotAge = 0
      ripples.push({ x: sx, y: sy, age: 0, life: 1.15, tone: 'amber', size: 1.5 })
      ripples.push({ x: cx, y: cy, age: 0, life: 1.5, tone: 'amber', size: 2.2 })
      for (let i = 0; i < 14; i += 1) {
        const angle = rng() * TAU
        sparks.push({
          x: sx,
          y: sy,
          vx: Math.cos(angle) * (40 + rng() * 130),
          vy: Math.sin(angle) * (40 + rng() * 130),
          age: 0,
          life: 0.6 + rng() * 0.7,
          tone: rng() > 0.35 ? 'amber' : 'red',
        })
      }
    }

    const position = (packet: Packet) => {
      const p = packet.p
      const x = (1 - p) * (1 - p) * packet.sx + 2 * (1 - p) * p * packet.cx + p * p * packet.ex
      const y = (1 - p) * (1 - p) * packet.sy + 2 * (1 - p) * p * packet.cy + p * p * packet.ey
      packet.trail.push({ x, y })
      if (packet.trail.length > 10) packet.trail.shift()
      return { x, y }
    }

    const spawnPacket = (toneOverride?: Packet['tone']) => {
      const gate = shield()
      const makeMatch = toneOverride === 'match' || (toneOverride !== 'noise' && matchCooldown <= 0)
      let node: MatchNode | null = null
      let tone: Packet['tone'] = toneOverride ?? (rng() < 0.18 ? 'crit' : 'noise')
      if (makeMatch) {
        node = matched === 0 ? matchNodes[0] : matchNodes[Math.floor(rng() * matchNodes.length)]
        tone = 'match'
        matchCooldown = 7 + rng() * 4
      }
      const angle = Math.PI * (0.58 + rng() * 0.84)
      const ex = gate.x + Math.cos(angle) * gate.rx * 0.92
      const ey = gate.y + Math.sin(angle) * gate.ry * 0.92
      const depth = 0.35 + rng() * 0.65
      const origin = hostiles()[rng() < 0.62 ? 0 : 1]
      const startY = origin
        ? origin.y - 44 + rng() * 92
        : w < 760
          ? h * 0.05 + rng() * h * 0.38
          : h * 0.08 + rng() * h * 0.4
      const sx = -40 - rng() * w * 0.07
      const sy = startY
      const mx = (sx + ex) / 2
      const my = (sy + ey) / 2 + (rng() - 0.5) * h * 0.18
      const packet: Packet = {
        sx,
        sy,
        cx: mx,
        cy: my,
        ex,
        ey,
        p: 0,
        speed: (0.34 + depth * 0.32) * (tone === 'match' ? 0.82 : 1),
        depth,
        tone,
        node,
        label: node
          ? node.cveId
          : rng() < 0.52
            ? feedIds[Math.floor(rng() * feedIds.length)]
            : null,
        age: 0,
        dead: false,
        trail: [],
      }
      packets.push(packet)
      if (packets.length > 46) packets = packets.slice(-46)
    }

    const impact = (packet: Packet, px: number, py: number) => {
      const isMatch = packet.tone === 'match' && packet.node
      if (isMatch) {
        onMatch(px, py)
      } else {
        ripples.push({ x: px, y: py, age: 0, life: 0.8, tone: 'teal', size: 0.8 })
        for (let i = 0; i < 4; i += 1) {
          const angle = rng() * TAU
          sparks.push({
            x: px,
            y: py,
            vx: Math.cos(angle) * (20 + rng() * 70),
            vy: Math.sin(angle) * (20 + rng() * 70),
            age: 0,
            life: 0.3 + rng() * 0.5,
            tone: rng() > 0.5 ? 'teal' : 'red',
          })
        }
      }
      packet.dead = true
    }

    const update = (dt: number) => {
      time += dt
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3)
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3)
      scrollShift = Math.min(140, window.scrollY * 0.1)
      flash = Math.max(0, flash - dt * 1.15)
      breachBeam = Math.max(0, breachBeam - dt * 0.9)
      hotAge += dt
      if (hotAge > 2.6) hotUnit = -1
      matchCooldown -= dt

      const narrow = w < 760
      const compact = w < 900
      const mid = w < 1280
      const xAnchor = narrow ? 0.68 : compact ? 0.74 : mid ? 0.7 : 0.66
      cx = w * xAnchor + pointer.x * (narrow ? 10 : 26)
      cy = h * (narrow ? 0.34 : 0.46) + pointer.y * (narrow ? 8 : 18) - scrollShift
      const sizeFactor = narrow ? 0.72 : compact ? 0.74 : mid ? 0.86 : 1
      scale = Math.min(1.32, Math.max(0.58, h / 900)) * sizeFactor
      yaw = -0.52 + Math.sin(time * 0.12) * 0.03 + pointer.x * 0.07
      pitch = 0.16 + pointer.y * 0.04

      spawnClock += dt
      const interval = w < 760 ? 0.42 + rng() * 0.4 : 0.24 + rng() * 0.32
      if (spawnClock > interval) {
        spawnClock = 0
        spawnPacket()
      }

      for (const packet of packets) {
        if (packet.dead) continue
        packet.age += dt
        packet.p = Math.min(1, packet.p + packet.speed * dt)
        const point = position(packet)
        if (packet.p >= 1) impact(packet, point.x, point.y)
      }
      packets = packets.filter((packet) => !packet.dead)

      for (const ripple of ripples) ripple.age += dt
      ripples = ripples.filter((ripple) => ripple.age < ripple.life)
      for (const spark of sparks) {
        spark.age += dt
        spark.x += spark.vx * dt
        spark.y += spark.vy * dt
        spark.vy += 60 * dt
      }
      sparks = sparks.filter((spark) => spark.age < spark.life)
    }

    const drawFloor = () => {
      const baseY = RACK.h / 2 + 34
      ctx.lineWidth = 0.7
      for (let z = 320; z >= -1500; z -= 170) {
        const a = project(-1500, baseY, z)
        const b = project(1500, baseY, z)
        const fade = 0.11 * Math.max(0, 1 - Math.abs(z + 300) / 1600)
        ctx.strokeStyle = `rgba(83, 227, 203, ${fade})`
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      for (let x = -1400; x <= 1400; x += 200) {
        const a = project(x, baseY, 320)
        const b = project(x, baseY, -1500)
        ctx.strokeStyle = 'rgba(83, 227, 203, 0.045)'
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      const scanZ = -1250 + ((time * 150) % 1550)
      const a = project(-1500, baseY, scanZ)
      const b = project(1500, baseY, scanZ)
      const scan = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
      scan.addColorStop(0, 'rgba(83, 227, 203, 0)')
      scan.addColorStop(0.5, `rgba(83, 227, 203, ${0.22 + flash * 0.2})`)
      scan.addColorStop(1, 'rgba(83, 227, 203, 0)')
      ctx.strokeStyle = scan
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    const drawRack = (offset: { x: number; y: number; z: number }, size: number, primary: boolean) => {
      const W = RACK.w * size
      const H = RACK.h * size
      const D = RACK.d * size
      const ox = offset.x
      const oy = offset.y
      const oz = offset.z
      const p = (x: number, y: number, z: number) => project(ox + x, oy + y, oz + z)
      const faces = [
        { key: 'front', shade: 1, pts: [[-W / 2, -H / 2, D / 2], [W / 2, -H / 2, D / 2], [W / 2, H / 2, D / 2], [-W / 2, H / 2, D / 2]] },
        { key: 'back', shade: 0.32, pts: [[-W / 2, -H / 2, -D / 2], [W / 2, -H / 2, -D / 2], [W / 2, H / 2, -D / 2], [-W / 2, H / 2, -D / 2]] },
        { key: 'left', shade: 0.5, pts: [[-W / 2, -H / 2, -D / 2], [-W / 2, -H / 2, D / 2], [-W / 2, H / 2, D / 2], [-W / 2, H / 2, -D / 2]] },
        { key: 'right', shade: 0.62, pts: [[W / 2, -H / 2, D / 2], [W / 2, -H / 2, -D / 2], [W / 2, H / 2, -D / 2], [W / 2, H / 2, D / 2]] },
        { key: 'top', shade: 0.8, pts: [[-W / 2, -H / 2, D / 2], [W / 2, -H / 2, D / 2], [W / 2, -H / 2, -D / 2], [-W / 2, -H / 2, -D / 2]] },
        { key: 'bottom', shade: 0.28, pts: [[-W / 2, H / 2, D / 2], [W / 2, H / 2, D / 2], [W / 2, H / 2, -D / 2], [-W / 2, H / 2, -D / 2]] },
      ]
        .map((face) => {
          const pts = face.pts.map(([x, y, z]) => p(x, y, z))
          const zAvg = pts.reduce((sum, point) => sum + point.z, 0) / 4
          return { ...face, pts, zAvg }
        })
        .sort((a, b) => b.zAvg - a.zAvg)

      for (const face of faces) {
        ctx.beginPath()
        ctx.moveTo(face.pts[0].x, face.pts[0].y)
        for (let i = 1; i < face.pts.length; i += 1) ctx.lineTo(face.pts[i].x, face.pts[i].y)
        ctx.closePath()
        const s = face.shade
        const gx0 = Math.min(...face.pts.map((point) => point.x))
        const gy0 = Math.min(...face.pts.map((point) => point.y))
        const gx1 = Math.max(...face.pts.map((point) => point.x))
        const gy1 = Math.max(...face.pts.map((point) => point.y))
        const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1)
        const glow = primary ? flash * 0.35 : 0
        grad.addColorStop(0, `rgba(${Math.round(17 + 34 * s + glow * 120)}, ${Math.round(23 + 34 * s + glow * 60)}, ${Math.round(25 + 28 * s + glow * 20)}, 1)`)
        grad.addColorStop(1, `rgba(${Math.round(6 + 16 * s + glow * 60)}, ${Math.round(10 + 16 * s + glow * 30)}, ${Math.round(12 + 14 * s)}, 1)`)
        ctx.fillStyle = grad
        ctx.fill()
        ctx.strokeStyle = `rgba(83, 227, 203, ${primary ? 0.2 + s * 0.12 : 0.05})`
        ctx.lineWidth = primary ? 0.9 : 0.6
        ctx.stroke()
      }

      if (!primary) {
        for (let i = 0; i < 5; i += 1) {
          const lp = p(W / 2 - 4, -H / 2 + 10 + i * (H / 6), D / 2 + 1)
          ctx.beginPath()
          ctx.fillStyle = rng() > 0.7 ? 'rgba(240, 169, 74, 0.5)' : 'rgba(83, 227, 203, 0.35)'
          ctx.arc(lp.x, lp.y, 1.3, 0, TAU)
          ctx.fill()
        }
        return
      }

      const topL = p(-W / 2, -H / 2, D / 2)
      const topR = p(W / 2, -H / 2, D / 2)
      const botL = p(-W / 2, H / 2, D / 2)
      ctx.save()
      ctx.strokeStyle = `rgba(83, 227, 203, ${0.34 + flash * 0.3})`
      ctx.lineWidth = 1.2
      ctx.shadowColor = 'rgba(83, 227, 203, 0.5)'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.moveTo(topL.x, topL.y)
      ctx.lineTo(topR.x, topR.y)
      ctx.stroke()
      ctx.restore()
      ctx.strokeStyle = 'rgba(83, 227, 203, 0.16)'
      ctx.lineWidth = 0.9
      ctx.beginPath()
      ctx.moveTo(topL.x, topL.y)
      ctx.lineTo(botL.x, botL.y)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(240, 169, 74, 0.3)'
      ctx.beginPath()
      ctx.moveTo(topR.x, topR.y)
      ctx.lineTo(p(W / 2, H / 2, D / 2).x, p(W / 2, H / 2, D / 2).y)
      ctx.stroke()

      const capA = p(-W / 2 + 10, -H / 2 + 6, D / 2 + 2)
      const capB = p(W / 2 - 10, -H / 2 + 6, D / 2 + 2)
      ctx.strokeStyle = `rgba(83, 227, 203, ${0.35 + flash * 0.3})`
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(capA.x, capA.y)
      ctx.lineTo(capB.x, capB.y)
      ctx.stroke()

      const inset = 11
      const units = 10
      const unitH = (H - inset * 2) / units
      for (let u = 0; u < units; u += 1) {
        const y0 = -H / 2 + inset + u * unitH
        const y1 = y0 + unitH - 3
        const quad = [
          p(-W / 2 + inset, y0, D / 2 + 1.5),
          p(W / 2 - inset, y0, D / 2 + 1.5),
          p(W / 2 - inset, y1, D / 2 + 1.5),
          p(-W / 2 + inset, y1, D / 2 + 1.5),
        ]
        ctx.beginPath()
        ctx.moveTo(quad[0].x, quad[0].y)
        for (let i = 1; i < 4; i += 1) ctx.lineTo(quad[i].x, quad[i].y)
        ctx.closePath()
        const hot = hotUnit === u && hotAge < 2.6
        const unitGrad = ctx.createLinearGradient(quad[0].x, quad[0].y, quad[3].x, quad[3].y)
        unitGrad.addColorStop(0, hot ? 'rgba(80, 51, 18, 0.95)' : 'rgba(16, 22, 24, 0.95)')
        unitGrad.addColorStop(1, hot ? 'rgba(34, 24, 11, 0.95)' : 'rgba(8, 12, 13, 0.95)')
        ctx.fillStyle = unitGrad
        ctx.fill()
        ctx.strokeStyle = hot ? `rgba(240, 169, 74, ${0.55 + Math.sin(hotAge * 12) * 0.2})` : 'rgba(233, 231, 222, 0.1)'
        ctx.lineWidth = hot ? 1 : 0.5
        ctx.stroke()

        for (let v = 0; v < 7; v += 1) {
          const vx = -W / 2 + inset + 12 + v * ((W - inset * 2 - 34) / 7)
          const a = p(vx, y0 + 3, D / 2 + 2)
          const b = p(vx, y1, D / 2 + 2)
          ctx.beginPath()
          ctx.strokeStyle = hot ? 'rgba(240, 169, 74, 0.2)' : 'rgba(233, 231, 222, 0.075)'
          ctx.lineWidth = 0.5
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }

        const blink = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * (1.4 + u * 0.17) + u))
        const lx = W / 2 - inset - 9
        const ly = y0 + unitH * 0.38
        const led = p(lx, ly, D / 2 + 2)
        ctx.beginPath()
        ctx.fillStyle = hot
          ? `rgba(255, 190, 92, ${0.6 + blink * 0.4})`
          : u % 4 === 1
            ? `rgba(240, 169, 74, ${0.25 + blink * 0.5})`
            : `rgba(83, 227, 203, ${0.24 + blink * 0.62})`
        ctx.arc(led.x, led.y, hot ? 2.6 : 1.7, 0, TAU)
        ctx.fill()
        if (hot) {
          const glow = ctx.createRadialGradient(led.x, led.y, 0, led.x, led.y, 22)
          glow.addColorStop(0, 'rgba(240, 169, 74, 0.45)')
          glow.addColorStop(1, 'rgba(240, 169, 74, 0)')
          ctx.fillStyle = glow
          ctx.beginPath()
          ctx.arc(led.x, led.y, 22, 0, TAU)
          ctx.fill()

          const seamTop = p(-W * 0.1 + Math.sin(hotAge * 9) * 3, y0 + 2, D / 2 + 2.5)
          const seamBottom = p(-W * 0.1, y1 - 1, D / 2 + 2.5)
          ctx.save()
          ctx.strokeStyle = `rgba(255, 190, 92, ${0.5 + Math.sin(hotAge * 14) * 0.2})`
          ctx.lineWidth = 1.4
          ctx.shadowColor = 'rgba(240, 169, 74, 0.8)'
          ctx.shadowBlur = 12
          ctx.beginPath()
          ctx.moveTo(seamTop.x, seamTop.y)
          ctx.lineTo(seamBottom.x, seamBottom.y)
          ctx.stroke()
          ctx.restore()
        }
      }

      const origin = p(-W / 2 + inset, -H / 2 + inset, D / 2 + 2)
      const ux = p(-W / 2 + inset + 1, -H / 2 + inset, D / 2 + 2)
      const vy = p(-W / 2 + inset, -H / 2 + inset + 1, D / 2 + 2)
      ctx.save()
      ctx.transform(ux.x - origin.x, ux.y - origin.y, vy.x - origin.x, vy.y - origin.y, origin.x, origin.y)
      ctx.font = '600 8px "JetBrains Mono Variable", ui-monospace, monospace'
      ctx.fillStyle = 'rgba(233, 231, 222, 0.42)'
      ctx.fillText('AEGIS // RACK-01', 8, 18)
      ctx.fillStyle = 'rgba(83, 227, 203, 0.5)'
      ctx.fillText(hotUnit >= 0 ? 'MATCH CONFIRMED' : 'SHIELD ACTIVE', 8, 29)
      ctx.restore()
    }

    const drawShield = () => {
      const gate = shield()
      const pulse = 1 + Math.sin(time * 1.6) * 0.01
      const rx = gate.rx * pulse
      const ry = gate.ry * pulse

      const fill = ctx.createRadialGradient(gate.x, gate.y, 4, gate.x, gate.y, ry)
      fill.addColorStop(0, `rgba(83, 227, 203, ${0.085 + flash * 0.05})`)
      fill.addColorStop(0.72, 'rgba(83, 227, 203, 0.03)')
      fill.addColorStop(1, 'rgba(83, 227, 203, 0)')
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.ellipse(gate.x, gate.y, rx, ry, 0, 0, TAU)
      ctx.fill()

      ctx.save()
      ctx.beginPath()
      ctx.ellipse(gate.x, gate.y, rx, ry, 0, 0, TAU)
      ctx.clip()
      ctx.strokeStyle = 'rgba(83, 227, 203, 0.08)'
      ctx.lineWidth = 0.6
      for (let i = -18; i <= 18; i += 1) {
        ctx.beginPath()
        ctx.moveTo(gate.x - rx + i * 20, gate.y - ry)
        ctx.lineTo(gate.x - rx + i * 20 + ry, gate.y + ry)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(gate.x + rx - i * 20, gate.y - ry)
        ctx.lineTo(gate.x + rx - i * 20 - ry, gate.y + ry)
        ctx.stroke()
      }
      const scanY = gate.y - ry + ((time * 0.22) % 1) * ry * 2
      const scan = ctx.createLinearGradient(0, scanY - 16, 0, scanY + 16)
      scan.addColorStop(0, 'rgba(83, 227, 203, 0)')
      scan.addColorStop(0.5, `rgba(83, 227, 203, ${0.09 + flash * 0.06})`)
      scan.addColorStop(1, 'rgba(83, 227, 203, 0)')
      ctx.fillStyle = scan
      ctx.fillRect(gate.x - rx, scanY - 9, rx * 2, 18)
      ctx.restore()

      ctx.save()
      ctx.beginPath()
      ctx.setLineDash([3, 7])
      ctx.strokeStyle = `rgba(83, 227, 203, ${0.46 + flash * 0.3})`
      ctx.lineWidth = 1
      ctx.shadowColor = 'rgba(83, 227, 203, 0.55)'
      ctx.shadowBlur = 14
      ctx.ellipse(gate.x, gate.y, rx, ry, -0.05, 0, TAU)
      ctx.stroke()
      ctx.restore()
      ctx.setLineDash([])

      ctx.beginPath()
      ctx.strokeStyle = `rgba(83, 227, 203, ${0.2 + flash * 0.2})`
      ctx.lineWidth = 0.7
      ctx.ellipse(gate.x, gate.y, rx * 0.9, ry * 0.9, -0.05, 0, TAU)
      ctx.stroke()

      const arc = time * 0.28
      ctx.beginPath()
      ctx.strokeStyle = `rgba(240, 169, 74, ${0.55 + flash * 0.35})`
      ctx.lineWidth = 1.4
      ctx.ellipse(gate.x, gate.y, rx * 1.06, ry * 1.03, -0.05, arc, arc + 0.5)
      ctx.stroke()
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(83, 227, 203, 0.28)'
      ctx.lineWidth = 1
      ctx.ellipse(gate.x, gate.y, rx * 1.13, ry * 1.08, -0.05, -arc * 0.7, -arc * 0.7 + 0.9)
      ctx.stroke()

      for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * TAU
        const x = gate.x + Math.cos(angle) * rx * 1.18
        const y = gate.y + Math.sin(angle) * ry * 1.12
        ctx.strokeStyle = 'rgba(83, 227, 203, 0.45)'
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(x - Math.cos(angle) * 5, y - Math.sin(angle) * 5)
        ctx.lineTo(x + Math.cos(angle) * 5, y + Math.sin(angle) * 5)
        ctx.stroke()
      }

      if (flash > 0.02) {
        const glow = ctx.createRadialGradient(gate.x, gate.y, 0, gate.x, gate.y, ry * 1.2)
        glow.addColorStop(0, `rgba(240, 169, 74, ${flash * 0.16})`)
        glow.addColorStop(1, 'rgba(240, 169, 74, 0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.ellipse(gate.x, gate.y, rx * 1.2, ry * 1.15, 0, 0, TAU)
        ctx.fill()
      }
    }

    const drawPacket = (packet: Packet, px: number, py: number) => {
      const fade = Math.max(0, Math.min(1, (px + 30) / 140))
      if (fade <= 0.02) return
      const isMatch = packet.tone === 'match'
      const color = isMatch ? '240, 169, 74' : packet.tone === 'crit' ? '255, 91, 77' : '155, 166, 168'
      if (packet.trail.length > 2) {
        ctx.beginPath()
        ctx.moveTo(packet.trail[0].x, packet.trail[0].y)
        for (let i = 1; i < packet.trail.length; i += 1) ctx.lineTo(packet.trail[i].x, packet.trail[i].y)
        ctx.strokeStyle = `rgba(${color}, ${(isMatch ? 0.32 : 0.13) * fade})`
        ctx.lineWidth = isMatch ? 1.6 : 0.9
        ctx.lineCap = 'round'
        ctx.stroke()
      }
      for (let i = 0; i < packet.trail.length; i += 1) {
        const point = packet.trail[i]
        const f = i / packet.trail.length
        ctx.beginPath()
        ctx.fillStyle = `rgba(${color}, ${f * (isMatch ? 0.55 : 0.3) * fade})`
        ctx.arc(point.x, point.y, (isMatch ? 1.9 : 1.05) * f + 0.3, 0, TAU)
        ctx.fill()
      }
      if (isMatch) {
        const glow = ctx.createRadialGradient(px, py, 0, px, py, 26)
        glow.addColorStop(0, `rgba(240, 169, 74, ${0.55 * fade})`)
        glow.addColorStop(1, 'rgba(240, 169, 74, 0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(px, py, 26, 0, TAU)
        ctx.fill()
      }
      ctx.beginPath()
      ctx.fillStyle = `rgba(${color}, ${(0.6 + packet.depth * 0.4) * fade})`
      ctx.arc(px, py, isMatch ? 3.2 : 1.1 + packet.depth * 1.7, 0, TAU)
      ctx.fill()
      if (packet.label && isMatch && w >= 1280) {
        ctx.font = '8.5px "JetBrains Mono Variable", ui-monospace, monospace'
        ctx.textAlign = 'left'
        ctx.fillStyle = `rgba(${color}, ${(isMatch ? 0.95 : 0.55) * fade})`
        ctx.fillText(packet.label, px + 10, py - 7)
      }
    }

    const drawHostiles = () => {
      for (const node of hostiles()) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 2.1 + node.phase * 9)
        const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, 58)
        glow.addColorStop(0, `rgba(255, 91, 77, ${0.2 + pulse * 0.1})`)
        glow.addColorStop(1, 'rgba(255, 91, 77, 0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(node.x, node.y, 58, 0, TAU)
        ctx.fill()

        ctx.save()
        ctx.translate(node.x, node.y)
        ctx.setLineDash([3, 6])
        ctx.lineDashOffset = -time * 14
        ctx.strokeStyle = 'rgba(255, 91, 77, 0.42)'
        ctx.lineWidth = 0.9
        ctx.beginPath()
        ctx.arc(0, 0, 15, 0, TAU)
        ctx.stroke()
        ctx.strokeStyle = 'rgba(255, 91, 77, 0.18)'
        ctx.lineDashOffset = time * 9
        ctx.beginPath()
        ctx.arc(0, 0, 23, 0, TAU)
        ctx.stroke()
        ctx.setLineDash([])
        for (let i = 0; i < 4; i += 1) {
          const a = i * (Math.PI / 2) + Math.PI / 4
          ctx.strokeStyle = 'rgba(255, 91, 77, 0.55)'
          ctx.lineWidth = 0.8
          ctx.beginPath()
          ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8)
          ctx.lineTo(Math.cos(a) * 19, Math.sin(a) * 19)
          ctx.stroke()
        }
        ctx.beginPath()
        ctx.fillStyle = `rgba(255, 120, 100, ${0.7 + pulse * 0.3})`
        ctx.arc(0, 0, 2.4, 0, TAU)
        ctx.fill()
        ctx.restore()

        ctx.font = '600 8px "JetBrains Mono Variable", ui-monospace, monospace'
        ctx.textAlign = 'left'
        ctx.fillStyle = 'rgba(255, 112, 96, 0.82)'
        ctx.fillText(node.label, node.x - 12, node.y - 28)
        ctx.font = '8px "JetBrains Mono Variable", ui-monospace, monospace'
        ctx.fillStyle = 'rgba(233, 231, 222, 0.34)'
        ctx.fillText(node.meta, node.x - 12, node.y - 17)
      }
    }

    const drawAttackArcs = () => {
      const gate = shield()
      for (const node of hostiles()) {
        for (let a = 0; a < 3; a += 1) {
          const phase = node.phase + a * 0.29
          const angle = 2.05 + a * 0.34 + node.phase
          const ex = gate.x + Math.cos(angle) * gate.rx * 0.96
          const ey = gate.y + Math.sin(angle) * gate.ry * 0.92
          const mx = (node.x + ex) / 2
          const my = (node.y + ey) / 2 - 30 - a * 12
          ctx.beginPath()
          ctx.setLineDash([2, 9])
          ctx.lineDashOffset = -time * 26 - a * 14
          ctx.strokeStyle = `rgba(255, 91, 77, ${0.14 + a * 0.035})`
          ctx.lineWidth = 0.9
          ctx.moveTo(node.x, node.y)
          ctx.quadraticCurveTo(mx, my, ex, ey)
          ctx.stroke()
          ctx.setLineDash([])

          const t = (time * 0.17 + phase + a * 0.31) % 1
          const cxp = (1 - t) * (1 - t) * node.x + 2 * (1 - t) * t * mx + t * t * ex
          const cyp = (1 - t) * (1 - t) * node.y + 2 * (1 - t) * t * my + t * t * ey
          const comet = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, 12)
          comet.addColorStop(0, 'rgba(255, 120, 96, 0.6)')
          comet.addColorStop(1, 'rgba(255, 91, 77, 0)')
          ctx.fillStyle = comet
          ctx.beginPath()
          ctx.arc(cxp, cyp, 12, 0, TAU)
          ctx.fill()
          ctx.beginPath()
          ctx.fillStyle = 'rgba(255, 170, 150, 0.9)'
          ctx.arc(cxp, cyp, 1.5, 0, TAU)
          ctx.fill()
        }
      }
    }

    const drawFrame = () => {
      ctx.clearRect(0, 0, w, h)
      const gate = shield()

      const ambient = ctx.createRadialGradient(cx, cy, 20, cx, cy, h * 0.72)
      ambient.addColorStop(0, `rgba(32, 171, 158, ${0.2 + flash * 0.06})`)
      ambient.addColorStop(0.5, 'rgba(24, 95, 91, 0.07)')
      ambient.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = ambient
      ctx.fillRect(0, 0, w, h)

      const floorGlow = ctx.createRadialGradient(cx, cy + RACK.h * 0.65 * scale, 10, cx, cy + RACK.h * 0.65 * scale, h * 0.42)
      floorGlow.addColorStop(0, `rgba(240, 169, 74, ${0.055 + flash * 0.16})`)
      floorGlow.addColorStop(1, 'rgba(240, 169, 74, 0)')
      ctx.fillStyle = floorGlow
      ctx.fillRect(0, 0, w, h)

      const flashHot = Math.max(0, Math.min(1, flash - 0.25) / 0.75)
      for (const node of hostiles()) {
        const hostileGlow = ctx.createRadialGradient(node.x, node.y, 2, node.x, node.y, 230)
        hostileGlow.addColorStop(0, 'rgba(255, 91, 77, 0.07)')
        hostileGlow.addColorStop(1, 'rgba(255, 91, 77, 0)')
        ctx.fillStyle = hostileGlow
        ctx.fillRect(0, 0, w, h)
      }

      for (const mote of dust) {
        const drift = Math.sin(time * 0.32 + mote.phase) * 9
        const x = (mote.x + drift + pointer.x * 16 * mote.z + w * 2) % w
        const y = (mote.y - scrollShift * mote.z + pointer.y * 12 * mote.z + h * 2) % h
        ctx.beginPath()
        ctx.fillStyle = `rgba(83, 227, 203, ${0.05 + mote.z * 0.22})`
        ctx.arc(x, y, mote.r, 0, TAU)
        ctx.fill()
      }

      drawFloor()
      drawRack({ x: -700, y: -30, z: -1000 }, 0.55, false)
      drawRack({ x: 760, y: -10, z: -1250 }, 0.42, false)
      drawRack({ x: 0, y: 0, z: 0 }, 1, true)

      if (flashHot > 0.01) {
        const top = project(0, -RACK.h / 2, RACK.d / 2)
        const bottom = project(0, RACK.h / 2, RACK.d / 2)
        for (let i = 0; i < 4; i += 1) {
          const sy = top.y + (bottom.y - top.y) * (0.16 + i * 0.21) + Math.sin(time * 24 + i * 2) * 3
          const sliceW = 140 + Math.sin(time * 6 + i) * 46
          ctx.fillStyle = `rgba(240, 169, 74, ${flashHot * 0.15})`
          ctx.fillRect(cx - sliceW / 2, sy, sliceW, 1.5 + (i % 2) * 2)
        }
      }

      const under = project(0, RACK.h / 2 + 8, RACK.d / 2)
      const underGlow = ctx.createRadialGradient(under.x, under.y, 2, under.x, under.y, RACK.w * 0.9 * scale)
      underGlow.addColorStop(0, `rgba(83, 227, 203, ${0.16 + flash * 0.16})`)
      underGlow.addColorStop(1, 'rgba(83, 227, 203, 0)')
      ctx.save()
      ctx.translate(under.x, under.y)
      ctx.scale(1, 0.26)
      ctx.fillStyle = underGlow
      ctx.beginPath()
      ctx.arc(0, 0, RACK.w * 0.9 * scale, 0, TAU)
      ctx.fill()
      ctx.restore()

      drawShield()

      drawAttackArcs()

      if (breachBeam > 0.02) {
        const a = project(0, 0, RACK.d / 2 + 46)
        const b = project(0, -RACK.h * 0.1, RACK.d / 2 + 2)
        const beam = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
        beam.addColorStop(0, `rgba(240, 169, 74, ${breachBeam * 0.65})`)
        beam.addColorStop(1, `rgba(240, 169, 74, ${breachBeam * 0.1})`)
        ctx.strokeStyle = beam
        ctx.lineWidth = 2 + breachBeam * 3
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }

      for (const packet of packets) {
        const p = packet.p
        const px = (1 - p) * (1 - p) * packet.sx + 2 * (1 - p) * p * packet.cx + p * p * packet.ex
        const py = (1 - p) * (1 - p) * packet.sy + 2 * (1 - p) * p * packet.cy + p * p * packet.ey
        drawPacket(packet, px, py)
      }

      for (const ripple of ripples) {
        const t = ripple.age / ripple.life
        const radius = 6 + t * 90 * ripple.size
        ctx.beginPath()
        ctx.strokeStyle =
          ripple.tone === 'amber'
            ? `rgba(240, 169, 74, ${(1 - t) * 0.55})`
            : `rgba(83, 227, 203, ${(1 - t) * 0.32})`
        ctx.lineWidth = ripple.tone === 'amber' ? 1.4 : 0.9
        ctx.ellipse(ripple.x, ripple.y, radius * 0.72, radius, 0, 0, TAU)
        ctx.stroke()
      }

      for (const spark of sparks) {
        const t = spark.age / spark.life
        const color = spark.tone === 'amber' ? '240, 169, 74' : spark.tone === 'red' ? '255, 91, 77' : '83, 227, 203'
        ctx.beginPath()
        ctx.fillStyle = `rgba(${color}, ${(1 - t) * 0.7})`
        ctx.arc(spark.x, spark.y, 1.2, 0, TAU)
        ctx.fill()
      }

      drawHostiles()

      const tagPoint = project(RACK.w / 2 + 24, -RACK.h * 0.16, RACK.d / 2)
      ctx.strokeStyle = 'rgba(83, 227, 203, 0.3)'
      ctx.lineWidth = 0.7
      ctx.beginPath()
      ctx.moveTo(tagPoint.x, tagPoint.y)
      ctx.lineTo(tagPoint.x + 34, tagPoint.y - 18)
      ctx.lineTo(tagPoint.x + 120, tagPoint.y - 18)
      ctx.stroke()
      ctx.font = '8px "JetBrains Mono Variable", ui-monospace, monospace'
      ctx.fillStyle = 'rgba(233, 231, 222, 0.55)'
      ctx.textAlign = 'left'
      ctx.fillText(hotUnit >= 0 ? 'EXPOSED SERVICE' : 'VERSION GATE', tagPoint.x + 38, tagPoint.y - 23)

      if (flash > 0.02) {
        const hit = ctx.createRadialGradient(gate.x, gate.y, 0, gate.x, gate.y, h * 0.5)
        hit.addColorStop(0, `rgba(240, 169, 74, ${flash * 0.1})`)
        hit.addColorStop(1, 'rgba(240, 169, 74, 0)')
        ctx.fillStyle = hit
        ctx.fillRect(0, 0, w, h)
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
      const narrow = w < 760
      const compact = w < 900
      const mid = w < 1280
      cx = w * (narrow ? 0.68 : compact ? 0.74 : mid ? 0.7 : 0.66)
      cy = h * (narrow ? 0.34 : 0.46)
      scale = Math.min(1.32, Math.max(0.58, h / 900)) * (narrow ? 0.72 : compact ? 0.74 : mid ? 0.86 : 1)
      yaw = -0.52
      pitch = 0.16
      dust.length = 0
      const count = Math.round(Math.min(120, Math.max(50, (w * h) / 16000)))
      for (let i = 0; i < count; i += 1) {
        dust.push({ x: rng() * w, y: rng() * h, z: rng(), r: 0.3 + rng() * 1.1, phase: rng() * TAU })
      }
      if (reduce) drawFrame()
    }

    const pointerMove = (event: PointerEvent) => {
      pointer.tx = event.clientX / window.innerWidth - 0.5
      pointer.ty = event.clientY / window.innerHeight - 0.5
    }
    window.addEventListener('pointermove', pointerMove, { passive: true })

    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
      },
      { threshold: 0.01 },
    )
    intersection.observe(wrap)

    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()

    if (reduce) {
      flash = 0.6
      breachBeam = 0.45
      hotUnit = 4
      hotAge = 0.6
      for (let i = 0; i < 7; i += 1) spawnPacket(i === 3 ? 'match' : 'noise')
      packets.forEach((packet, index) => {
        packet.p = 0.18 + index * 0.11
        packet.trail = []
        for (let k = 0; k < 6; k += 1) {
          const pk = packet.p - k * 0.018
          if (pk <= 0) continue
          const x = (1 - pk) * (1 - pk) * packet.sx + 2 * (1 - pk) * pk * packet.cx + pk * pk * packet.ex
          const y = (1 - pk) * (1 - pk) * packet.sy + 2 * (1 - pk) * pk * packet.cy + pk * pk * packet.ey
          packet.trail.unshift({ x, y })
        }
      })
      ripples.push({ x: shield().x, y: shield().y, age: 0.2, life: 1.2, tone: 'amber', size: 1.4 })
      drawFrame()
    } else {
      for (let i = 0; i < 8; i += 1) {
        spawnPacket(i === 2 ? 'match' : undefined)
        packets[packets.length - 1].p = 0.12 + i * 0.1
      }
      last = performance.now()
      raf = requestAnimationFrame(loop)
    }

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      intersection.disconnect()
      window.removeEventListener('pointermove', pointerMove)
    }
  }, [reduce])

  return (
    <div ref={wrapRef} className={cx('sa-scene', reduce && 'sa-still')}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  )
}
