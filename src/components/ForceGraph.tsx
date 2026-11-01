import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type { Alert, Asset, Cve, RiskLevel } from '../lib/types'
import { hexA } from '../lib/colors'
import { cx, fmtScore, plural } from '../lib/format'
import { mulberry32 } from '../lib/stats'
import { worstLevel } from '../lib/correlation'
import {
  AlertTriangle,
  Boxes,
  Bug,
  Database,
  Globe2,
  LayoutGrid,
  Maximize2,
  Minus,
  Network,
  Plus,
  Server,
  Shield,
} from './Icons'

const W = 1200
const H = 780
const MID = { x: W / 2, y: H / 2 - 6 }
const K = 108

/* Light-canvas severity ramp — same family as LEVEL_COLORS but contrast-tuned for white. */
const INK = '#1b2437'
const MUTE = '#8894a8'
const TONE: Record<RiskLevel, string> = {
  CRITICAL: '#dd4550',
  HIGH: '#ee7c39',
  MEDIUM: '#c99a12',
  LOW: '#2f9e6b',
}
const GATE = '#a3aec0'

const ASSET_ICONS = {
  app: Boxes,
  server: Server,
  network: Shield,
  database: Database,
  cloud: Globe2,
  endpoint: LayoutGrid,
} as const

type Kind = 'core' | 'asset' | 'cve'

interface Sim {
  id: string
  kind: Kind
  x: number
  y: number
  r: number
  pin: boolean
}

interface SharedBuild {
  product: string
  a: string
  b: string
}

interface StackLink {
  key: string
  from: string
  to: string
  shared: SharedBuild[]
}

interface View {
  x: number
  y: number
  k: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const halfSide = (kind: Kind, criticality: Asset['criticality'] | null) => {
  if (kind === 'core') return 26
  if (kind === 'cve') return 15
  return criticality === 'HIGH' ? 26 : criticality === 'MEDIUM' ? 22 : 18
}

/* A record earns plate size from how much inventory it reaches, so the widely deployed
   packages read as hubs and single-host records read as leaves. */
const cveRadius = (hits: number) => (hits > 0 ? Math.min(21, 13 + hits * 1.6) : 11)

export function ForceGraph({
  alerts,
  allAlerts,
  assets,
  cves,
  query,
  hover,
  selected,
  liveLabel,
  onHover,
  onSelect,
}: {
  alerts: Alert[]
  allAlerts: Alert[]
  assets: Asset[]
  cves: Cve[]
  query: string
  hover: string | null
  selected: string | null
  liveLabel?: string
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const [, bump] = useState(0)
  const simRef = useRef<Sim[]>([])
  const alphaRef = useRef(0)

  /* ---------- scene ---------- */

  const alertsByAsset = useMemo(() => {
    const map = new Map<string, Alert[]>()
    for (const alert of alerts) {
      const list = map.get(alert.asset.id) ?? []
      list.push(alert)
      map.set(alert.asset.id, list)
    }
    return map
  }, [alerts])

  const linkedCves = useMemo(() => new Set(alerts.map((alert) => alert.cve.id)), [alerts])

  const assetsByCve = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const alert of alerts) {
      const list = map.get(alert.cve.id) ?? []
      if (!list.includes(alert.asset.id)) list.push(alert.asset.id)
      map.set(alert.cve.id, list)
    }
    return map
  }, [alerts])

  /* The second relationship type: two platforms that carry the same package. These are not
     alerts — they are why an alert spreads — so they surface as lateral stack links while a
     node is in focus, and they pull their endpoints together in the layout. */
  const stackLinks = useMemo(() => {
    const owners = new Map<string, { asset: Asset; version: string }[]>()
    for (const asset of assets) {
      for (const entry of asset.software) {
        const key = entry.product.toLowerCase()
        const list = owners.get(key) ?? []
        list.push({ asset, version: entry.version })
        owners.set(key, list)
      }
    }
    const pairs = new Map<string, StackLink>()
    owners.forEach((list, key) => {
      if (list.length < 2) return
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i]
          const b = list[j]
          const id = `${a.asset.id}|${b.asset.id}`
          const existing = pairs.get(id)
          const shared: SharedBuild = {
            product: a.asset.software.find((s) => s.product.toLowerCase() === key)?.product ?? key,
            a: a.version,
            b: b.version,
          }
          if (existing) existing.shared.push(shared)
          else pairs.set(id, { key: id, from: a.asset.id, to: b.asset.id, shared: [shared] })
        }
      }
    })
    return [...pairs.values()]
  }, [assets])

  const peersByAsset = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const link of stackLinks) {
      map.set(link.from, [...(map.get(link.from) ?? []), link.to])
      map.set(link.to, [...(map.get(link.to) ?? []), link.from])
    }
    return map
  }, [stackLinks])

  const scene = useMemo(() => {
    const edges = alerts.map((alert) => ({
      key: alert.id,
      from: alert.asset.id,
      to: alert.cve.id,
      level: alert.level,
      suppressed: alert.suppressed,
      score: alert.score,
    }))
    return { edges }
  }, [alerts])

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    const touch = (a: string, b: string) => {
      const set = map.get(a) ?? new Set<string>()
      set.add(b)
      map.set(a, set)
    }
    for (const edge of scene.edges) {
      touch(edge.from, edge.to)
      touch(edge.to, edge.from)
      touch(edge.from, 'hub')
      touch('hub', edge.from)
    }
    return map
  }, [scene.edges])

  const nodeKey = useMemo(
    () => ['hub', ...assets.map((a) => a.id), ...cves.map((c) => c.id)].join('|'),
    [assets, cves],
  )

  /* The live feeds re-issue alert objects on every pull, but the mesh only cares about who is
     wired to whom. Keying the physics to this identity keeps a settled graph settled. */
  const edgeKey = useMemo(
    () =>
      alerts
        .map((alert) => `${alert.asset.id}>${alert.cve.id}`)
        .sort()
        .join('|'),
    [alerts],
  )

  /* ---------- force layout ---------- */

  const forcesRef = useRef({ alerts, stackLinks })
  forcesRef.current = { alerts, stackLinks }
  const rafRef = useRef(0)

  /* One rAF owner for every re-heat — first mount or a scope change — so the springs keep
     answering while alpha decays, and the canvas re-centres once the mesh settles. */
  const run = () => {
    cancelAnimationFrame(rafRef.current)
    const tick = () => {
      if (alphaRef.current > 0.012) {
        step(simRef.current, forcesRef.current.alerts, forcesRef.current.stackLinks)
        alphaRef.current *= 0.955
        bump((v) => v + 1)
        rafRef.current = requestAnimationFrame(tick)
      } else {
        settle()
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    const rand = mulberry32(20261031)
    const seed: Sim[] = [
      { id: 'hub', kind: 'core', x: MID.x, y: MID.y, r: halfSide('core', null), pin: true },
      ...assets.map((asset, index) => {
        const angle = (index / Math.max(1, assets.length)) * Math.PI * 2
        const radius = 150 + rand() * 130
        return {
          id: asset.id,
          kind: 'asset' as Kind,
          x: MID.x + Math.cos(angle) * radius,
          y: MID.y + Math.sin(angle) * radius * 0.72,
          r: halfSide('asset', asset.criticality),
          pin: false,
        }
      }),
      ...cves.map((cve, index) => {
        const angle = (index / Math.max(1, cves.length)) * Math.PI * 2 + 0.4
        const radius = 250 + rand() * 120
        return {
          id: cve.id,
          kind: 'cve' as Kind,
          x: MID.x + Math.cos(angle) * radius * 1.35,
          y: MID.y + Math.sin(angle) * radius * 0.8,
          r: cveRadius(assetsByCve.get(cve.id)?.length ?? 0),
          pin: false,
        }
      }),
    ]
    simRef.current = seed
    alphaRef.current = 1
    run()
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey])

  /* A scope change re-shapes who a record reaches, so plate size follows the wiring and the
     springs re-heat once. Live-feed score updates never reach this. */
  useEffect(() => {
    simRef.current.forEach((node) => {
      if (node.kind === 'cve') node.r = cveRadius(assetsByCve.get(node.id)?.length ?? 0)
    })
    if (!simRef.current.length) return
    fitArmedRef.current = true
    alphaRef.current = Math.max(alphaRef.current, 0.55)
    bump((v) => v + 1)
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeKey])

  const positions = useMemo(() => {
    const map = new Map<string, Sim>()
    simRef.current.forEach((node) => map.set(node.id, node))
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simRef.current.length, hover, selected, view, scene.edges, alphaRef.current])

  /* ---------- interaction ---------- */

  /* Zoom is anchored to the middle of the canvas, so the mesh stays where the reader put it
     instead of sliding away as the scale grows. Panning and node dragging are deliberately
     absent: the layout owns the positions, and the only gesture is zoom. */
  const zoomTo = (next: number) =>
    setView((prev) => {
      const k = clamp(next, 0.72, 2.4)
      const ratio = k / prev.k
      return { k, x: W / 2 - (W / 2 - prev.x) * ratio, y: H / 2 - (H / 2 - prev.y) * ratio }
    })

  const viewRef = useRef(view)
  viewRef.current = view

  const activate = (id: string) => (event: ReactKeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(id)
    }
  }

  /* React attaches wheel handlers passively, so zooming over the canvas would also scroll
     the page. A non-passive listener can preventDefault and keep the gesture inside the graph. */
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheelEvent = (event: WheelEvent) => {
      event.preventDefault()
      zoomTo(event.deltaY < 0 ? viewRef.current.k * 1.14 : viewRef.current.k * 0.88)
    }
    el.addEventListener('wheel', onWheelEvent, { passive: false })
    return () => el.removeEventListener('wheel', onWheelEvent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* The mesh grows with the estate, so the canvas follows the content instead of clipping it.
     Armed on mount and on every scope change; a manual zoom wins until the layout runs again. */
  const fitArmedRef = useRef(true)

  const fitToContent = () => {
    const nodes = simRef.current
    if (!nodes.length) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let sumX = 0
    let sumY = 0
    for (const node of nodes) {
      minX = Math.min(minX, node.x - node.r)
      maxX = Math.max(maxX, node.x + node.r)
      minY = Math.min(minY, node.y - node.r)
      maxY = Math.max(maxY, node.y + node.r + 20)
      sumX += node.x
      sumY += node.y
    }
    const k = clamp(
      Math.min((W - 104) / Math.max(1, maxX - minX), (H - 150) / Math.max(1, maxY - minY)),
      0.62,
      1.35,
    )
    /* A reader centres on the mass of the mesh, not its rim, so the frame slides toward the
       middle of the cluster — as far as the extremes still fitting inside the canvas allows. */
    const roomX = W / 2 - 8 / k
    const roomY = H / 2 - 8 / k
    const cx = clamp(sumX / nodes.length, maxX - roomX, minX + roomX)
    const cy = clamp(sumY / nodes.length, maxY - roomY, minY + roomY)
    setView({ k, x: W / 2 - k * cx, y: H / 2 - k * cy })
  }

  const settle = () => {
    if (!fitArmedRef.current) return
    fitArmedRef.current = false
    fitToContent()
  }

  /* ---------- focus model ---------- */

  const focusId = hover ?? selected

  /* Lateral links are revealed for the node in focus: an asset shows the platforms that run
     its packages, a record shows why its blast radius reaches those platforms in the first place. */
  const lateral = useMemo(() => {
    const empty = { links: [] as StackLink[], peers: new Set<string>() }
    if (!focusId || focusId === 'hub') return empty
    const candidates = focusId.startsWith('AST-')
      ? stackLinks.filter((link) => link.from === focusId || link.to === focusId)
      : (() => {
          const inBlast = new Set(assetsByCve.get(focusId) ?? [])
          return stackLinks.filter((link) => inBlast.has(link.from) && inBlast.has(link.to))
        })()
    const links = candidates
      .slice()
      .sort((a, b) => b.shared.length - a.shared.length || a.key.localeCompare(b.key))
      .slice(0, 7)
    const peers = new Set<string>()
    links.forEach((link) => {
      peers.add(link.from)
      peers.add(link.to)
    })
    return { links, peers }
  }, [focusId, stackLinks, assetsByCve])

  const neighbours = useMemo(() => {
    if (!focusId || focusId === 'hub') return null
    const set = new Set(adjacency.get(focusId) ?? [])
    lateral.peers.forEach((peer) => set.add(peer))
    return set
  }, [focusId, adjacency, lateral])

  const q = query.trim().toLowerCase()

  const matches = (text: string) => !!q && text.toLowerCase().includes(q)
  const assetLit = (asset: Asset) => !q || matches(asset.name) || matches(asset.id) || matches(asset.department)
  const cveLit = (cve: Cve) => !q || matches(cve.id) || matches(cve.product) || matches(cve.vendor)

  const nodeState = (id: string, lit: boolean) => {
    if (focusId && focusId !== 'hub') {
      if (id === focusId) return 'active' as const
      if (neighbours?.has(id)) return 'linked' as const
      return 'dim' as const
    }
    if (focusId === 'hub') return id === 'hub' ? 'active' : lit ? 'linked' : 'dim'
    return lit ? ('base' as const) : ('dim' as const)
  }

  /* Two labels sharing ground is the flaw every reader notices, so each frame claims slots in
     priority order — the node in focus, its neighbours, the core, assets, then records — and a
     text that would collide or run off the canvas is dropped. Boxes live in scene coordinates,
     so zooming never changes who fits. */
  const labelPlan = useMemo(() => {
    const rows: LabelRow[] = []
    const occupied: Box[] = []
    const tracing = !!focusId && focusId !== 'hub'
    const rank = (id: string, base: number) => (id === focusId ? 0 : neighbours?.has(id) ? 1 : base)
    /* While a node is in focus, everything outside its ring is background: it gives up its name
       rather than compete for a slot. */
    const speakable = (id: string) => !tracing || id === focusId || !!neighbours?.has(id)

    for (const link of lateral.links) {
      const from = positions.get(link.from)
      const to = positions.get(link.to)
      if (!from || !to) continue
      const { mx, my } = linkPath(from, to, 4)
      const text = `${link.shared[0]?.product ?? ''}${link.shared.length > 1 ? ` +${link.shared.length - 1}` : ''}`
      occupied.push({ x: mx - (text.length * 5.2) / 2, y: my - 17, w: text.length * 5.2, h: 13 })
    }

    const hub = positions.get('hub')
    if (hub) rows.push({ id: 'hub', node: hub, text: 'AEGIS core', order: tracing ? 4 : 0, state: nodeState('hub', true) })

    for (const asset of assets) {
      const node = positions.get(asset.id)
      if (!node || !speakable(asset.id)) continue
      rows.push({
        id: asset.id,
        node,
        text: asset.name,
        sub: asset.department,
        order: rank(asset.id, 2),
        state: nodeState(asset.id, assetLit(asset)),
      })
    }
    for (const cve of cves) {
      const node = positions.get(cve.id)
      if (!node || !speakable(cve.id)) continue
      rows.push({
        id: cve.id,
        node,
        text: cve.id.replace('CVE-', ''),
        mono: true,
        order: rank(cve.id, 3),
        state: nodeState(cve.id, cveLit(cve)),
      })
    }
    return claimLabels(rows, occupied)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, focusId, neighbours, assets, cves, lateral, query])

  const tip = useMemo(() => {
    const id = hover
    if (!id) return null
    const node = simRef.current.find((entry) => entry.id === id)
    if (!node) return null
    if (id === 'hub') {
      return {
        node,
        tone: TONE.CRITICAL,
        kicker: 'Correlation core',
        title: 'AEGIS exposure mesh',
        rows: [
          ['assets', String(assets.length)],
          ['records', String(cves.length)],
          ['paths', String(alerts.length)],
          ['stacks', String(stackLinks.length)],
        ] as [string, string][],
      }
    }
    const asset = assets.find((entry) => entry.id === id)
    if (asset) {
      const mine = alertsByAsset.get(asset.id) ?? []
      const level = worstLevel(mine.filter((alert) => !alert.suppressed)) ?? 'LOW'
      const top = [...mine].sort((a, b) => b.score - a.score)[0]
      return {
        node,
        tone: TONE[level],
        kicker: `${asset.department} · ${asset.type}`,
        title: asset.name,
        rows: [
          ['paths', String(mine.length)],
          ['worst', top ? fmtScore(top.score) : '—'],
          ['peers', String(peersByAsset.get(asset.id)?.length ?? 0)],
          ['posture', level.toLowerCase()],
        ] as [string, string][],
      }
    }
    const cve = cves.find((entry) => entry.id === id)
    if (cve) {
      const hits = alerts.filter((alert) => alert.cve.id === cve.id)
      const reach = assetsByCve.get(cve.id)?.length ?? 0
      const top = [...hits].sort((a, b) => b.score - a.score)[0]
      return {
        node,
        tone: cve.kev ? TONE.CRITICAL : TONE[cve.severity],
        kicker: `${cve.vendor} ${cve.product}`,
        title: cve.kev ? 'Actively exploited · CISA KEV' : `CVSS ${cve.cvss?.toFixed(1) ?? '—'} vulnerability`,
        rows: [
          ['assets', String(reach)],
          ['worst', top ? fmtScore(top.score) : '—'],
          ['gated', String(hits.filter((alert) => alert.suppressed).length)],
          ['epss', cve.epss == null ? '—' : `${(cve.epss * 100).toFixed(1)}%`],
        ] as [string, string][],
      }
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, alerts, alertsByAsset, assetsByCve, assets, cves, scene.edges, stackLinks, peersByAsset])

  const counts = useMemo(() => {
    const byLevel = (level: RiskLevel) => allAlerts.filter((a) => !a.suppressed && a.level === level).length
    return {
      critical: byLevel('CRITICAL'),
      high: byLevel('HIGH'),
      medium: byLevel('MEDIUM'),
      low: byLevel('LOW'),
      suppressed: allAlerts.filter((a) => a.suppressed).length,
    }
  }, [allAlerts])

  /* ---------- render ---------- */

  return (
    <div className="fg" style={{ '--view-k': view.k } as CSSProperties}>
      <svg
        ref={svgRef}
        className="fg-stage"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="Exposure correlation graph"
        onPointerLeave={() => onHover(null)}
        onDoubleClick={fitToContent}
      >
        <defs>
          <pattern id="fg-dots" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="rgba(27,36,55,0.07)" />
          </pattern>
          <radialGradient id="fg-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(242,104,60,0.075)" />
            <stop offset="100%" stopColor="rgba(242,104,60,0)" />
          </radialGradient>
          {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskLevel[]).map((level) => (
            <marker
              key={level}
              id={`fg-arrow-${level}`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0.5 1 L7 4 L0.5 7 Z" fill={TONE[level]} />
            </marker>
          ))}
          <marker id="fg-arrow-gate" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0.5 1 L7 4 L0.5 7 Z" fill={GATE} />
          </marker>
        </defs>

        <rect x="0" y="0" width={W} height={H} fill="url(#fg-dots)" />

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <ellipse cx={MID.x} cy={MID.y} rx="330" ry="230" fill="url(#fg-halo)" />

          {/* Shared-stack links between platforms, for the node in focus */}
          <g className="fg-stacks">
            {lateral.links.map((link) => {
              const from = positions.get(link.from)
              const to = positions.get(link.to)
              if (!from || !to) return null
              const { d, mx, my } = linkPath(from, to, 4)
              return (
                <g key={link.key}>
                  <path className="fg-stack" d={d} />
                  <text className="fg-stack-label" x={mx} y={my - 6}>
                    {link.shared[0]?.product}
                    {link.shared.length > 1 ? ` +${link.shared.length - 1}` : ''}
                  </text>
                </g>
              )
            })}
          </g>

          <g className="fg-edges">
            {scene.edges.map((edge) => {
              const from = positions.get(edge.from)
              const to = positions.get(edge.to)
              if (!from || !to) return null
              const state = nodeState(edge.to, true)
              const active = focusId ? (edge.from === focusId || edge.to === focusId ? 'on' : 'off') : 'on'
              const { d } = linkPath(from, to, 7)
              const tone = edge.suppressed ? GATE : TONE[edge.level]
              return (
                <path
                  key={edge.key}
                  className={cx('fg-edge', active === 'off' && 'is-off')}
                  d={d}
                  stroke={tone}
                  strokeDasharray={edge.suppressed ? '4 5' : undefined}
                  markerEnd={`url(#${edge.suppressed ? 'fg-arrow-gate' : `fg-arrow-${edge.level}`})`}
                  style={{ '--edge-tone': tone } as CSSProperties}
                  data-state={state}
                />
              )
            })}
          </g>

          {/* CVE nodes */}
          {cves.map((cve) => {
            const node = positions.get(cve.id)
            if (!node) return null
            const linked = linkedCves.has(cve.id)
            const tone = cve.kev ? TONE.CRITICAL : TONE[cve.severity]
            const state = nodeState(cve.id, cveLit(cve))
            const size = node.r * 2
            return (
              <g
                key={cve.id}
                className={cx('fg-node', `is-${state}`, selected === cve.id && 'is-selected')}
                transform={`translate(${node.x} ${node.y})`}
                onMouseEnter={() => onHover(cve.id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(cve.id)}
                onBlur={() => onHover(null)}
                onClick={() => onSelect(cve.id)}
                onKeyDown={activate(cve.id)}
                tabIndex={0}
                role="button"
                aria-label={`${cve.id} ${cve.product}, ${cve.severity.toLowerCase()}, ${linked ? 'linked to inventory' : 'no inventory hit'}`}
              >
                <rect
                  className="fg-plate"
                  x={-size / 2}
                  y={-size / 2}
                  width={size}
                  height={size}
                  rx={size * 0.32}
                  fill={linked ? hexA(tone, 0.1) : '#f4f6f9'}
                  stroke={linked ? tone : GATE}
                  strokeDasharray={linked ? undefined : '3 3'}
                />
                <g transform={`translate(${-size / 2} ${-size / 2}) scale(${(size * 0.52) / 24})`} style={{ color: tone }}>
                  <Bug size={24} strokeWidth={1.7} color={linked ? tone : GATE} />
                </g>
              </g>
            )
          })}

          {/* Asset nodes */}
          {assets.map((asset) => {
            const node = positions.get(asset.id)
            if (!node) return null
            const mine = alertsByAsset.get(asset.id) ?? []
            const level = worstLevel(mine.filter((alert) => !alert.suppressed))
            const tone = level ? TONE[level] : GATE
            const state = nodeState(asset.id, assetLit(asset))
            const size = node.r * 2
            const Glyph = ASSET_ICONS[asset.type] ?? Server
            const activeCount = mine.filter((alert) => !alert.suppressed).length
            return (
              <g
                key={asset.id}
                className={cx('fg-node', `is-${state}`, selected === asset.id && 'is-selected')}
                transform={`translate(${node.x} ${node.y})`}
                onMouseEnter={() => onHover(asset.id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(asset.id)}
                onBlur={() => onHover(null)}
                onClick={() => onSelect(asset.id)}
                onKeyDown={activate(asset.id)}
                tabIndex={0}
                role="button"
                aria-label={`${asset.name}, ${asset.department}, ${activeCount} active paths`}
              >
                <rect
                  className="fg-plate"
                  x={-size / 2}
                  y={-size / 2}
                  width={size}
                  height={size}
                  rx={size * 0.28}
                  fill="#ffffff"
                  stroke={tone}
                />
                <g transform={`translate(${-size * 0.28} ${-size * 0.28}) scale(${(size * 0.56) / 24})`}>
                  <Glyph size={24} strokeWidth={1.6} color={tone} />
                </g>
                {activeCount > 0 && (
                  <g className="fg-badge" transform={`translate(${node.r - 4} ${-node.r + 4})`}>
                    <circle r="9" fill={tone} />
                    <text className="fg-badge-num" y="3.4">
                      {activeCount}
                    </text>
                  </g>
                )}
              </g>
            )
          })}

          {/* Correlation core */}
          {(() => {
            const node = positions.get('hub')
            if (!node) return null
            const state = nodeState('hub', true)
            return (
              <g
                className={cx('fg-node', 'fg-core', `is-${state}`, selected === 'hub' && 'is-selected')}
                transform={`translate(${node.x} ${node.y})`}
                onMouseEnter={() => onHover('hub')}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover('hub')}
                onBlur={() => onHover(null)}
                onClick={() => onSelect('hub')}
                onKeyDown={activate('hub')}
                tabIndex={0}
                role="button"
                aria-label="AEGIS correlation core"
              >
                <rect x={-26} y={-26} width={52} height={52} rx={15} fill={INK} />
                <g transform="translate(-11 -11)">
                  <Network size={22} strokeWidth={1.7} color="#ffffff" />
                </g>
              </g>
            )
          })()}

          {/* One text layer above every plate, so a name is never clipped by a node drawn later. */}
          <g className="fg-labels">
            {labelPlan.map((row) => (
              <g key={row.id} className={`is-${row.state}`} transform={`translate(${row.node.x} ${row.node.y})`}>
                <text className={cx('fg-label', row.mono && 'mono')} y={row.node.r + (row.mono ? 13 : 14)}>
                  {row.text}
                </text>
                {row.sub && (
                  <text className="fg-sub" y={row.node.r + 25}>
                    {row.sub}
                  </text>
                )}
              </g>
            ))}
          </g>

          {tip &&
            (() => {
              const tipW = 12 + tip.rows.length * 64 + 8
              return (
                <g
                  className="fg-tip"
                  transform={`translate(${clamp(tip.node.x - tipW / 2, 12, W - tipW - 12)} ${clamp(
                    tip.node.y - tip.node.r - 96,
                    8,
                    H - 110,
                  )})`}
                >
                  <rect className="fg-tip-card" width={tipW} height="86" rx="14" />
                  <rect x="12" y="13" width="20" height="20" rx="7" fill={hexA(tip.tone, 0.14)} />
                  <g transform="translate(15 16)">
                    <AlertTriangle size={14} strokeWidth={1.9} color={tip.tone} />
                  </g>
                  <text className="fg-tip-kicker" x="40" y="24">
                    {tip.kicker.length > 26 ? `${tip.kicker.slice(0, 25)}…` : tip.kicker}
                  </text>
                  <text className="fg-tip-title" x="12" y="50">
                    {tip.title.length > 32 ? `${tip.title.slice(0, 31)}…` : tip.title}
                  </text>
                  {tip.rows.map(([label, value], index) => (
                    <text key={label} className="fg-tip-row" x={12 + index * 64} y="70">
                      <tspan className="fg-tip-v">{value}</tspan>
                      <tspan className="fg-tip-k" dx="4">
                        {label}
                      </tspan>
                    </text>
                  ))}
                </g>
              )
            })()}
        </g>
      </svg>

      <div className="fg-legend" aria-hidden="true">
        <span>
          <i style={{ background: TONE.CRITICAL }} /> critical {counts.critical}
        </span>
        <span>
          <i style={{ background: TONE.HIGH }} /> high {counts.high}
        </span>
        <span>
          <i style={{ background: TONE.MEDIUM }} /> medium {counts.medium}
        </span>
        <span>
          <i style={{ background: TONE.LOW }} /> low {counts.low}
        </span>
        <span>
          <i className="fg-legend-gate" /> gated {counts.suppressed}
        </span>
        <span>
          <i className="fg-legend-stack" /> shared stack
        </span>
      </div>

      <div className="fg-meta mono">
        <span className="fg-live">
          <i /> {liveLabel ?? 'live'}
        </span>
        <span>
          {assets.length} {plural(assets.length, 'asset')} · {cves.length} records · {alerts.length} paths · {stackLinks.length} stack links
        </span>
      </div>

      <div className="fg-tools">
        <button className="fg-tool" onClick={() => zoomTo(view.k * 1.18)} aria-label="Zoom in">
          <Plus size={14} />
        </button>
        <button className="fg-tool" onClick={() => zoomTo(view.k * 0.85)} aria-label="Zoom out">
          <Minus size={14} />
        </button>
        <button
          className="fg-tool"
          onClick={() => {
            fitArmedRef.current = true
            alphaRef.current = Math.max(alphaRef.current, 0.5)
            run()
          }}
          aria-label="Recentre the mesh"
        >
          <Maximize2 size={13} />
        </button>
      </div>

      <p className="fg-hint mono">click a node · hover to trace the stack · scroll to zoom</p>
    </div>
  )
}

/* ---------- simulation ---------- */

/* Curved link trimmed to both plates so arrowheads and labels sit outside the node. */
function linkPath(from: Sim, to: Sim, endPad: number) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy) || 1
  const ux = dx / dist
  const uy = dy / dist
  const sx = from.x + ux * (from.r + 3)
  const sy = from.y + uy * (from.r + 3)
  const ex = to.x - ux * (to.r + endPad)
  const ey = to.y - uy * (to.r + endPad)
  const mx = (sx + ex) / 2 - uy * 16
  const my = (sy + ey) / 2 + ux * 16
  return {
    d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`,
    mx,
    my,
  }
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface LabelRow {
  id: string
  node: Sim
  text: string
  sub?: string
  mono?: boolean
  order: number
  state: 'active' | 'linked' | 'dim' | 'base'
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/* Char widths of .fg-label / .fg-sub / .fg-label.mono at their rendered point sizes. */
function labelBox(row: LabelRow): Box {
  const width = Math.max(row.text.length * (row.mono ? 5.4 : 6.2), row.sub ? row.sub.length * 5.8 : 0)
  return {
    x: row.node.x - width / 2 - 3,
    y: row.node.y + row.node.r + 1,
    w: width + 6,
    h: row.sub ? 27 : 14,
  }
}

function claimLabels(rows: LabelRow[], occupied: Box[]): LabelRow[] {
  /* Plates are not obstacles — the labels carry a white halo and sit above every plate — but
     text must never sit on text, and a name that runs off the canvas is no name at all. */
  const taken: Box[] = [...occupied]
  const shown: LabelRow[] = []
  const ordered = [...rows].sort((a, b) => a.order - b.order || b.node.r - a.node.r || a.node.x - b.node.x)
  for (const row of ordered) {
    const box = labelBox(row)
    if (box.x < 4 || box.x + box.w > W - 4 || box.y + box.h > H - 4) continue
    if (taken.some((t) => overlaps(t, box))) continue
    taken.push(box)
    shown.push(row)
  }
  return shown
}

function step(nodes: Sim[], alerts: Alert[], stackLinks: StackLink[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const links: [Sim, Sim][] = []
  for (const alert of alerts) {
    const a = byId.get(alert.asset.id)
    const b = byId.get(alert.cve.id)
    if (a && b) links.push([a, b])
  }
  /* Shared-stack pairs are a weaker spring than a correlation edge: they gather the assets
     that run the same package without dragging them on top of each other. */
  const softLinks: [Sim, Sim][] = []
  for (const link of stackLinks) {
    const a = byId.get(link.from)
    const b = byId.get(link.to)
    if (a && b) softLinks.push([a, b])
  }
  const disp = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]))

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]
      const b = nodes[j]
      let dx = a.x - b.x
      let dy = a.y - b.y
      let dist = Math.hypot(dx, dy)
      if (dist < 0.6) {
        dx = (i % 5) - 2
        dy = (j % 5) - 2
        dist = 2.5
      }
      /* Room for a label under each plate, not just room for the plate itself. */
      const min = a.r + b.r + 40
      const push = (K * K) / dist + (dist < min ? 900 * (1 - dist / min) : 0)
      const da = disp.get(a.id)!
      const db = disp.get(b.id)!
      da.x += (dx / dist) * push
      da.y += (dy / dist) * push
      db.x -= (dx / dist) * push
      db.y -= (dy / dist) * push
    }
  }

  for (const [a, b] of links) {
    const dx = a.x - b.x
    const dy = a.y - b.y
    const dist = Math.hypot(dx, dy) || 1
    const pull = (dist * dist) / K
    const da = disp.get(a.id)!
    const db = disp.get(b.id)!
    da.x -= (dx / dist) * pull
    da.y -= (dy / dist) * pull
    db.x += (dx / dist) * pull
    db.y += (dy / dist) * pull
  }

  for (const [a, b] of softLinks) {
    const dx = a.x - b.x
    const dy = a.y - b.y
    const dist = Math.hypot(dx, dy) || 1
    const pull = (dist * dist) / (K * 6)
    const da = disp.get(a.id)!
    const db = disp.get(b.id)!
    da.x -= (dx / dist) * pull
    da.y -= (dy / dist) * pull
    db.x += (dx / dist) * pull
    db.y += (dy / dist) * pull
  }

  for (const node of nodes) {
    const d = disp.get(node.id)!
    if (node.pin) {
      node.x = MID.x
      node.y = MID.y
      continue
    }
    const gravity = node.kind === 'asset' ? 1.15 : 0.5
    d.x += (MID.x - node.x) * gravity
    d.y += (MID.y - node.y) * gravity
    const len = Math.hypot(d.x, d.y) || 1
    const cap = Math.min(len, 70)
    node.x = clamp(node.x + (d.x / len) * cap, 62, W - 62)
    node.y = clamp(node.y + (d.y / len) * cap, 56, H - 62)
  }
}
