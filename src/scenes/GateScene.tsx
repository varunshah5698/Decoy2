import { useEffect, useRef, type RefObject } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  match: boolean
  life: number
}

/**
 * The gate staged as a physical event: a single lamp over a rack in the dark,
 * hostile packets drifting in and most of them never reaching the light.
 * `progressRef` is written by the page's scroll loop and read here per frame.
 */
export function GateScene({ progressRef }: { progressRef: RefObject<number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0
    let t = 0
    const pointer = { x: 0.5, y: 0.5 }
    const eased = { x: 0.5, y: 0.5 }
    const particles: Particle[] = []

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(2, window.devicePixelRatio || 1)
      w = Math.max(1, rect.width)
      h = Math.max(1, rect.height)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const seed = () => {
      particles.length = 0
      for (let i = 0; i < 90; i++) {
        const match = i % 9 === 0
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.9,
          vx: -(0.18 + Math.random() * 0.5),
          vy: (Math.random() - 0.5) * 0.14,
          r: match ? 1.5 : 0.8 + Math.random() * 0.9,
          match,
          life: Math.random(),
        })
      }
    }

    const draw = () => {
      const p = progressRef.current ?? 0
      t += reduce ? 0 : 1

      eased.x += (pointer.x - eased.x) * 0.05
      eased.y += (pointer.y - eased.y) * 0.05

      const camX = (eased.x - 0.5) * 26
      const camY = (eased.y - 0.5) * 16 + p * 14

      ctx.clearRect(0, 0, w, h)

      // Room: near-black with a slow amber bloom behind the lamp.
      ctx.fillStyle = '#07070a'
      ctx.fillRect(0, 0, w, h)

      const lampX = w * (0.78 + (eased.x - 0.5) * 0.02)
      const lampY = h * 0.2
      const bloom = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, Math.max(w, h) * 0.72)
      bloom.addColorStop(0, 'rgba(150, 74, 32, 0.5)')
      bloom.addColorStop(0.32, 'rgba(86, 40, 22, 0.24)')
      bloom.addColorStop(1, 'rgba(8, 8, 12, 0)')
      ctx.fillStyle = bloom
      ctx.fillRect(0, 0, w, h)

      // Light cone: a soft volumetric wedge falling toward the rack.
      const rackX = w * 0.44 + camX
      const rackY = h * 0.74 + camY * 0.2
      const spread = 0.26 + p * 0.05
      const dx = rackX - lampX
      const dy = rackY - lampY
      const base = Math.atan2(dy, dx)

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.beginPath()
      ctx.moveTo(lampX, lampY)
      ctx.lineTo(lampX + Math.cos(base - spread) * w * 1.1, lampY + Math.sin(base - spread) * w * 1.1)
      ctx.lineTo(lampX + Math.cos(base + spread) * w * 1.1, lampY + Math.sin(base + spread) * w * 1.1)
      ctx.closePath()
      const cone = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, Math.hypot(dx, dy) * 1.25)
      cone.addColorStop(0, 'rgba(255, 226, 190, 0.34)')
      cone.addColorStop(0.45, 'rgba(228, 150, 92, 0.14)')
      cone.addColorStop(1, 'rgba(120, 60, 30, 0)')
      ctx.fillStyle = cone
      ctx.fill()
      ctx.restore()

      // Lamp fixture
      ctx.save()
      ctx.fillStyle = '#0d0e12'
      ctx.strokeStyle = 'rgba(240, 169, 74, 0.42)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.ellipse(lampX, lampY, 26, 15, base + Math.PI / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      const core = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, 40)
      core.addColorStop(0, 'rgba(255, 244, 226, 0.95)')
      core.addColorStop(1, 'rgba(255, 200, 140, 0)')
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(lampX, lampY, 40, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // Floor line
      ctx.strokeStyle = 'rgba(233, 231, 222, 0.09)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, rackY + 46)
      ctx.lineTo(w, rackY + 46)
      ctx.stroke()

      // Rack silhouette, lit by the cone
      const rw = Math.min(150, w * 0.2)
      const rh = rw * 1.5
      ctx.save()
      ctx.fillStyle = '#0a0c10'
      ctx.strokeStyle = `rgba(240, 169, 74, ${0.18 + p * 0.5})`
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.roundRect(rackX - rw / 2, rackY - rh / 2, rw, rh, 6)
      ctx.fill()
      ctx.stroke()
      for (let i = 0; i < 7; i++) {
        const y = rackY - rh / 2 + 14 + i * (rh / 8)
        ctx.strokeStyle = `rgba(83, 227, 203, ${0.06 + p * 0.1})`
        ctx.beginPath()
        ctx.moveTo(rackX - rw / 2 + 12, y)
        ctx.lineTo(rackX + rw / 2 - 12, y)
        ctx.stroke()
        ctx.fillStyle = `rgba(240, 169, 74, ${0.12 + p * 0.62})`
        ctx.beginPath()
        ctx.arc(rackX + rw / 2 - 18, y - 3, 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()

      // Packets: most drift through the dark and fade before the light reaches them.
      for (const pt of particles) {
        if (!reduce) {
          pt.x += pt.vx
          pt.y += pt.vy
          pt.life += 0.004
          if (pt.x < -20 || pt.life > 1.4) {
            pt.x = w + Math.random() * 60
            pt.y = Math.random() * h * 0.9
            pt.life = 0
            pt.match = Math.random() < 0.11
          }
        }

        const inCone = (() => {
          const a = Math.atan2(pt.y - lampY, pt.x - lampX)
          let d = a - base
          while (d > Math.PI) d -= Math.PI * 2
          while (d < -Math.PI) d += Math.PI * 2
          return Math.abs(d) < spread && pt.x < lampX
        })()

        const near = 1 - Math.min(1, Math.hypot(pt.x - rackX, pt.y - rackY) / (w * 0.5))
        const alpha = pt.match ? 0.28 + near * 0.6 : 0.1 + near * 0.22
        ctx.fillStyle = pt.match ? `rgba(240, 169, 74, ${alpha})` : `rgba(120, 168, 178, ${alpha * (inCone ? 0.5 : 0.9)})`
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2)
        ctx.fill()
      }

      // Dust in the beam
      if (!reduce) {
        for (let i = 0; i < 46; i++) {
          const f = (i * 0.618 + t * 0.0006) % 1
          const along = f
          const wob = Math.sin(i * 2.3 + t * 0.008) * 0.5
          const px = lampX + dx * along + Math.cos(base + Math.PI / 2) * wob * 190 * along
          const py = lampY + dy * along + Math.sin(base + Math.PI / 2) * wob * 190 * along
          ctx.fillStyle = `rgba(255, 226, 196, ${0.05 + along * 0.11})`
          ctx.beginPath()
          ctx.arc(px, py, 0.9, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Vignette
      const vig = ctx.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.22, w / 2, h * 0.5, Math.max(w, h) * 0.78)
      vig.addColorStop(0, 'rgba(0,0,0,0)')
      vig.addColorStop(1, 'rgba(0,0,0,0.72)')
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, w, h)

      if (!reduce) raf = requestAnimationFrame(draw)
    }

    resize()
    seed()
    draw()

    const onResize = () => {
      resize()
      seed()
      if (reduce) draw()
    }
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX / window.innerWidth
      pointer.y = e.clientY / window.innerHeight
    }

    window.addEventListener('resize', onResize)
    if (!reduce) window.addEventListener('pointermove', onMove, { passive: true })

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
    }
  }, [progressRef])

  return <canvas ref={canvasRef} className="lp-gate-canvas" aria-hidden="true" />
}
