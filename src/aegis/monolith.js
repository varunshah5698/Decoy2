import * as THREE from './vendor/three.module.js'
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js'
import { RoomEnvironment } from './vendor/RoomEnvironment.js'

/** Camera + pose keyframes, one per landing section. lookX parks the shield clear of the text column. */
const POSES = [
  { camZ: 10.6, camY: 1.15, lookY: 0.5, lookX: 0, yaw: -0.42, pitch: 0.05, roll: 0.05 },
  { camZ: 6.6, camY: 1.7, lookY: 1.2, lookX: -1.55, yaw: -0.16, pitch: 0.02, roll: 0 },
  { camZ: 5.4, camY: 1.3, lookY: 0.95, lookX: -1.02, yaw: 0.05, pitch: 0, roll: 0 },
]

const TEAL = 0x53e3cb
const AMBER = 0xf0a94a
const CRITICAL = 0xe5545a

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const mix = (a, b, t) => a + (b - a) * t
const clamp01 = (v) => Math.max(0, Math.min(1, v))

function poseAt(progress) {
  const p = clamp01(progress / 2) * 2
  const i = Math.min(1, Math.floor(p))
  return { a: POSES[i], b: POSES[i + 1], t: easeInOut(p - i) }
}

const FALLBACK = [{ code: 'CVE-2021-44228', detail: 'Log4j 2.14.1', score: 96.4, suppressed: false, bands: [1, 0.8, 0.6, 0.9, 0.7, 1] }]

/**
 * The panel the shield carries: a live version-gate readout. Suppressed alerts count their
 * score down to 0.0 and take a strike-through, which is the product's whole argument.
 */
function createReadout(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  let lastKey = ''

  function frame() {
    const g = ctx.createRadialGradient(size / 2, size * 0.42, size * 0.06, size / 2, size * 0.5, size * 0.78)
    g.addColorStop(0, '#0a0d11')
    g.addColorStop(1, '#040507')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)

    ctx.strokeStyle = 'rgba(236,233,225,.14)'
    ctx.lineWidth = 2
    ctx.strokeRect(26, 26, size - 52, size - 52)
    ctx.strokeStyle = 'rgba(83,227,203,.55)'
    ctx.lineWidth = 3
    for (const [x, y, dx, dy] of [
      [26, 26, 1, 1],
      [size - 26, 26, -1, 1],
      [26, size - 26, 1, -1],
      [size - 26, size - 26, -1, -1],
    ]) {
      ctx.beginPath()
      ctx.moveTo(x + dx * 34, y)
      ctx.lineTo(x, y)
      ctx.lineTo(x, y + dy * 34)
      ctx.stroke()
    }
  }

  function text(value, x, y, font, color, align = 'left', alpha = 1) {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(value, x, y)
    ctx.restore()
  }

  function draw({ code, detail, score, suppressed, reveal, tint }) {
    const key = [code, detail, score.toFixed(1), suppressed, reveal.toFixed(2), tint].join('|')
    if (key === lastKey) return
    lastKey = key

    frame()
    text('AEGIS · VERSION GATE', 52, 84, '500 22px ui-monospace, monospace', 'rgba(236,233,225,.5)')
    text(code, 52, 152, '600 44px ui-monospace, monospace', '#ece9e1')
    text(detail, 52, 198, '400 28px ui-monospace, monospace', 'rgba(236,233,225,.55)')

    const shown = suppressed ? mix(100, 0, clamp01(reveal * 1.6)) : mix(0, score, clamp01(reveal * 2.2))
    const accent = suppressed ? '#53e3cb' : tint === 'amber' ? '#f0a94a' : '#53e3cb'
    ctx.save()
    ctx.shadowColor = accent
    ctx.shadowBlur = 40
    text(shown.toFixed(1), 52, 356, '600 132px ui-monospace, monospace', accent)
    ctx.restore()

    if (suppressed && reveal > 0.45) {
      ctx.save()
      ctx.globalAlpha = clamp01((reveal - 0.45) * 3)
      ctx.strokeStyle = '#e5545a'
      ctx.lineWidth = 7
      ctx.beginPath()
      ctx.moveTo(44, 320)
      ctx.lineTo(392, 300)
      ctx.stroke()
      ctx.restore()
    }

    const status = suppressed ? 'GATE CLOSED · NOT INSTALLED' : reveal < 0.9 ? 'CORRELATING…' : 'REACHABLE · ACT ON IT'
    text(status, 52, 424, '500 24px ui-monospace, monospace', suppressed ? '#53e3cb' : '#f0a94a')
    texture.needsUpdate = true
  }

  return { texture, draw }
}

export function mountAegisMonolith(canvas, options = {}) {
  const reduced = !!options.reducedMotion
  const readouts = options.readouts?.length ? options.readouts : FALLBACK
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  } catch (error) {
    return { ok: false, dispose() {} }
  }

  const mobile = () => window.innerWidth < 900
  let disposed = false
  let frame = 0

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile() ? 1.6 : 2))
  renderer.setSize(window.innerWidth, window.innerHeight, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.02
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment(renderer)
  const envMap = pmrem.fromScene(room, 0.04).texture
  scene.environment = envMap

  // --- materials -----------------------------------------------------------
  const ceramic = new THREE.MeshPhysicalMaterial({
    color: 0xeceae4,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.95,
  })
  const metal = new THREE.MeshPhysicalMaterial({
    color: 0x7d868f,
    roughness: 0.3,
    metalness: 0.92,
    envMapIntensity: 1.1,
  })
  const dark = new THREE.MeshPhysicalMaterial({ color: 0x12151a, roughness: 0.5, metalness: 0.35, envMapIntensity: 0.7 })
  const charcoal = new THREE.MeshStandardMaterial({ color: 0x191c22, roughness: 0.85, metalness: 0.12 })

  const panel = createReadout()
  const screenMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.14,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
    emissive: 0xffffff,
    emissiveMap: panel.texture,
    emissiveIntensity: 1.35,
  })

  const rbox = (w, h, d, r = 0.08, seg = 4) =>
    new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2))

  const parts = []
  function add(parent, geometry, material, position, cast = true) {
    const m = new THREE.Mesh(geometry, material)
    m.position.copy(position)
    m.castShadow = cast
    m.receiveShadow = true
    parent.add(m)
    parts.push(m)
    return m
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z)

  // --- the shield ----------------------------------------------------------
  const stack = new THREE.Group()
  stack.position.set(0.3, 0, 0)
  scene.add(stack)

  add(stack, rbox(2.3, 0.44, 2.3, 0.07, 3), charcoal, V(0, -1.98, 0), false)
  add(stack, rbox(1.8, 0.34, 1.8, 0.06, 3), dark, V(0, -1.59, 0), false)
  const inlay = new THREE.Mesh(
    new THREE.TorusGeometry(0.78, 0.018, 8, 64),
    new THREE.MeshStandardMaterial({ color: TEAL, emissive: TEAL, emissiveIntensity: 2.6, roughness: 0.4 }),
  )
  inlay.rotation.x = Math.PI / 2
  inlay.position.set(0, -1.4, 0)
  stack.add(inlay)
  parts.push(inlay)

  const shield = new THREE.Group()
  shield.position.set(0, 0.12, 0)
  stack.add(shield)

  const outline = new THREE.Shape()
  outline.moveTo(-0.86, 1.06)
  outline.lineTo(0.86, 1.06)
  outline.quadraticCurveTo(0.98, 1.06, 0.98, 0.94)
  outline.lineTo(0.98, 0.12)
  outline.bezierCurveTo(0.98, -0.72, 0.52, -1.24, 0, -1.54)
  outline.bezierCurveTo(-0.52, -1.24, -0.98, -0.72, -0.98, 0.12)
  outline.lineTo(-0.98, 0.94)
  outline.quadraticCurveTo(-0.98, 1.06, -0.86, 1.06)

  const shieldGeometry = new THREE.ExtrudeGeometry(outline, {
    depth: 0.34,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: 0.055,
    bevelSize: 0.05,
    bevelSegments: 3,
    curveSegments: 24,
  })
  shieldGeometry.translate(0, 0, -0.17)
  const body = new THREE.Mesh(shieldGeometry, [ceramic, metal])
  body.castShadow = true
  body.receiveShadow = true
  shield.add(body)
  parts.push(body)

  // Dark bezel hugging the upper face, then the readout screen inside it.
  const bezel = add(shield, rbox(1.44, 1.3, 0.07, 0.14), dark, V(0, 0.24, 0.2), false)
  bezel.rotation.x = -0.02
  add(shield, new THREE.PlaneGeometry(1.24, 1.08), screenMaterial, V(0, 0.24, 0.245), false)

  // Six weighted inputs, one band each.
  const bands = []
  for (let i = 0; i < 6; i += 1) {
    const material = new THREE.MeshStandardMaterial({
      color: 0x0d1114,
      emissive: TEAL,
      emissiveIntensity: 0.2,
      roughness: 0.5,
      metalness: 0.2,
    })
    const band = new THREE.Mesh(rbox(0.92, 0.045, 0.03, 0.018, 2), material)
    band.position.set(0, -0.62 - i * 0.085, 0.235)
    shield.add(band)
    parts.push(band)
    bands.push(band)
  }

  // Chevron under the bands, lit by the current verdict.
  const chevronMaterial = new THREE.MeshStandardMaterial({
    color: AMBER,
    emissive: AMBER,
    emissiveIntensity: 2.2,
    roughness: 0.35,
  })
  for (const side of [-1, 1]) {
    const limb = new THREE.Mesh(rbox(0.34, 0.05, 0.03, 0.02, 2), chevronMaterial)
    limb.position.set(side * 0.13, -1.19, 0.235)
    limb.rotation.z = side * 0.62
    shield.add(limb)
    parts.push(limb)
  }

  // Bolts on the plinth corners and a loom running behind the stack.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const bolt = add(stack, new THREE.CylinderGeometry(0.055, 0.055, 0.06, 18), metal, V(sx * 0.92, -1.73, sz * 0.92), false)
      bolt.receiveShadow = false
    }
  }
  add(
    stack,
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        V(0.5, -1.5, -0.5),
        V(0.92, -1.62, -0.86),
        V(0.86, -1.86, -0.5),
        V(0.5, -1.92, -0.18),
      ]),
      24,
      0.035,
      10,
      false,
    ),
    dark,
    V(0, 0, 0),
  )

  // --- lights --------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xdfe8ee, 0x0a0d12, 0.55)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(0xeaf2f6, 2.3)
  key.position.set(4.2, 7, 6)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.camera.near = 1
  key.shadow.camera.far = 26
  key.shadow.camera.left = -6
  key.shadow.camera.right = 6
  key.shadow.camera.top = 8
  key.shadow.camera.bottom = -4
  key.shadow.bias = -0.0008
  key.shadow.radius = 3
  scene.add(key)
  const rim = new THREE.DirectionalLight(TEAL, 1.7)
  rim.position.set(-5, 3, -4.5)
  scene.add(rim)
  const warm = new THREE.PointLight(AMBER, 12, 12, 2)
  warm.position.set(2.2, 1.2, 3.1)
  scene.add(warm)

  // --- scroll, pointer, idle ------------------------------------------------
  const state = {
    progress: 0,
    target: 0,
    px: 0,
    py: 0,
    tx: 0,
    ty: 0,
    readout: 0,
    reveal: 0,
    nextSwap: 4.6,
  }
  const look = new THREE.Vector3(0, POSES[0].lookY, 0)
  const clock = new THREE.Clock()

  function readScroll() {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    state.target = Math.min(2, Math.max(0, window.scrollY / (max / 2)))
  }

  const onScroll = readScroll
  const onPointer = (event) => {
    state.tx = (event.clientX / window.innerWidth) * 2 - 1
    state.ty = (event.clientY / window.innerHeight) * 2 - 1
  }
  const onResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile() ? 1.6 : 2))
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    readScroll()
  }
  const onWake = () => clock.getDelta()

  readScroll()
  state.progress = state.target
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('pointermove', onPointer, { passive: true })
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onWake)

  function applyReadout(entry) {
    panel.draw({
      code: entry.code,
      detail: entry.detail,
      score: entry.score,
      suppressed: entry.suppressed,
      reveal: state.reveal,
      tint: entry.score >= 80 ? 'amber' : 'teal',
    })
    const values = entry.bands?.length ? entry.bands : [0.4, 0.4, 0.4, 0.4, 0.4, 0.4]
    for (let i = 0; i < bands.length; i += 1) {
      const weight = clamp01((values[i] ?? 0) * (entry.suppressed ? 0.12 : 1))
      bands[i].material.emissiveIntensity = 0.25 + weight * 2.4
      bands[i].material.color.setHex(weight > 0.66 ? 0x1a0f06 : 0x0d1114)
    }
    chevronMaterial.emissive = new THREE.Color(entry.suppressed ? TEAL : entry.score >= 80 ? CRITICAL : AMBER)
    chevronMaterial.emissiveIntensity = 1.6 + (entry.score / 100) * 1.6
  }

  function tick() {
    if (disposed) return
    frame = requestAnimationFrame(tick)
    if (document.hidden) return

    const dt = Math.min(0.05, clock.getDelta())
    const elapsed = clock.elapsedTime
    const blend = reduced ? 1 : 1 - Math.pow(0.92, dt * 60)

    state.progress += (state.target - state.progress) * blend
    state.px += (state.tx - state.px) * (reduced ? 1 : blend * 0.6)
    state.py += (state.ty - state.py) * (reduced ? 1 : blend * 0.6)

    const { a, b, t } = poseAt(state.progress)
    const zoom = mobile() ? 1.62 : 1
    // On phones the hero query box owns the upper screen, so the whole shield
    // rides down in frame until the user reaches the console section, and the
    // text-clearing sideways park only applies to wide viewports.
    const drop = mobile() ? 1.9 * (1 - clamp01(state.progress)) : 0
    const camY = mix(a.camY, b.camY, t) + drop
    const lookY = mix(a.lookY, b.lookY, t) + drop
    const lookX = mobile() ? 0 : mix(a.lookX, b.lookX, t)
    camera.position.set(state.px * 0.55, camY + state.py * -0.35, mix(a.camZ, b.camZ, t) * zoom)
    look.set(state.px * 0.12 + lookX, lookY, 0)
    camera.lookAt(look)

    const bob = reduced ? 0 : Math.sin(elapsed * 1.1) * 0.03
    const sway = reduced ? 0 : Math.sin(elapsed * 0.7) * 0.035

    stack.position.y = bob
    shield.rotation.y = mix(a.yaw, b.yaw, t) + (reduced ? 0 : state.px * 0.16)
    shield.rotation.x = mix(a.pitch, b.pitch, t) + state.py * 0.08
    shield.rotation.z = mix(a.roll, b.roll, t) + sway * 0.35

    if (!reduced) {
      state.reveal = Math.min(1, state.reveal + dt * 0.85)
      if (elapsed > state.nextSwap) {
        state.nextSwap = elapsed + 4.6
        state.readout = (state.readout + 1) % readouts.length
        state.reveal = 0
      }
    } else if (state.reveal === 0) {
      state.reveal = 1
    }
    applyReadout(readouts[state.readout])

    renderer.render(scene, camera)
  }

  tick()

  return {
    ok: true,
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onWake)
      for (const part of parts) {
        part.geometry?.dispose()
        const material = part.material
        for (const m of Array.isArray(material) ? material : [material]) {
          if (!m) continue
          for (const value of Object.values(m)) if (value && value.isTexture) value.dispose()
          m.dispose()
        }
      }
      inlay.geometry.dispose()
      envMap.dispose()
      pmrem.dispose()
      renderer.dispose()
    },
  }
}
