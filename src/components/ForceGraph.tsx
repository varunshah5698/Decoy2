import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Alert, Asset, Cve, RiskLevel } from '../lib/types'
import { hexA } from '../lib/colors'
import { cx, fmtScore } from '../lib/format'
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

/* Canvas size in scene units. The world the mesh settles inside is larger than this — see
   worldFor() — and the view transform maps world onto canvas. */
const W = 1200
const H = 780
const K = 108
/* First-paint centre of the ambient halo; the real one follows the world box. */
const MID0 = { x: W / 2, y: H / 2 - 6 }

/* Light-canvas severity ramp — same family as LEVEL_COLORS but contrast-tuned for white. */
const INK = '#1b2437'
const TONE: Record<RiskLevel, string> = {
  CRITICAL: '#dd4550',
  HIGH: '#ee7c39',
  MEDIUM: '#c99a12',
  LOW: '#2f9e6b',
}
const GATE = '#a3aec0'
const LEVELS: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

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

interface World {
  w: number
  h: number
  cx: number
  cy: number
}

interface EdgeRef {
  from: string
  to: string
  suppressed: boolean
  level: RiskLevel
}

/* One spec per plate: everything about it that does not move while the layout runs. Positions,
   dimming and edge geometry are painted onto the DOM directly, so a settled mesh never
   reconciles 1,600 plates again. */
interface NodeSpec {
  id: string
  kind: Kind
  r: number
  tone: string
  label: string
  sub?: string
  mono?: boolean
  badge: number | null
  linked: boolean
  glyph: string
  aria: string
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/* Shared-stack links are drawn for the picture, not for completeness: pairing every host that
   runs the same package turns the layout quadratic once an estate has hundreds of assets. */
const STACK_PEERS = 12

/* A 1,000-host estate cannot settle inside a 1200×780 plate box — the spacing solver would
   fight forever — so the world grows with the mesh and the view frames it. */
const WORLD_PAD = 112
/* Nodes past this fraction of the world radius feel inward pressure, so the outer shell curves
   in instead of stacking on the box edge. */
const SOFT_RIM = 0.82
const MIN_K = 0.08
const MAX_K = 2.4

/* Below this node count the layout stays animated; above it the solver runs in frame-budgeted
   chunks and paints once, because re-rasterising a 1,600-plate SVG every tick is not a thing
   a browser does at 60fps. */
const ANIMATE_NODES = 420
const SOLVE_BUDGET_MS = 14

/* Edges are merged into one stroked path and one filled arrow path per severity, so a full
   estate costs 10 DOM nodes instead of 11,695. The focused node's own edges still get the
   per-edge treatment — that list is short and it is the one the reader is tracing. */
const TRACE_LIMIT = 140

/* Zoomed past the point where a glyph is legible, the plate colour does the talking. A fitted
   1,000-host estate lands near a quarter scale, so this sits just under the fit zoom. */
const GLYPH_ZOOM = 0.32

/* Labels hold a constant screen size (the layer scales inversely with zoom), so this gate is
   about plate size on screen, not text size. Anything smaller is a dot, and dots crowd out
   their own names — the collision pass then keeps only the labels that fit. */
const LABEL_PLATE_PX = 4

const halfSide = (kind: Kind, criticality: Asset['criticality'] | null) => {
  if (kind === 'core') return 26
  if (kind === 'cve') return 15
  return criticality === 'HIGH' ? 26 : criticality === 'MEDIUM' ? 22 : 18
}

/* A record earns plate size from how much inventory it reaches, so the widely deployed
   packages read as hubs and single-host records read as leaves. */
const cveRadius = (hits: number) => (hits > 0 ? Math.min(21, 13 + hits * 1.6) : 11)

const worldFor = (count: number): World => {
  const w = Math.max(W, Math.round(Math.sqrt(Math.max(1, count)) * WORLD_PAD))
  const h = (w * H) / W
  return { w, h, cx: w / 2, cy: h / 2 }
}

const bucketOf = (suppressed: boolean, level: RiskLevel) => (suppressed ? 'gate' : level)

const r1 = (v: number) => Math.round(v * 10) / 10

/* Curved link trimmed to both plates so arrowheads and labels sit outside the node. */
function curve(from: Sim, to: Sim, endPad: number) {
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
  return { sx, sy, ex, ey, mx, my }
}

function linkPath(from: Sim, to: Sim, endPad: number) {
  const { sx, sy, ex, ey, mx, my } = curve(from, to, endPad)
  return {
    d: `M ${r1(sx)} ${r1(sy)} Q ${r1(mx)} ${r1(my)} ${r1(ex)} ${r1(ey)}`,
    mx,
    my,
  }
}

/* ---------- force layout ---------- */

/* Pairwise repulsion is quadratic: a full 1,000-asset estate would ask for over a million
   pushes per animation tick. Distant groups are summarised by their centre of mass, and the
   plate-spacing term stays exact by resolving only the handful of nodes sharing a grid cell. */
const BH_THETA = 0.9
const BH_LEAF = 4
const BH_MAX_DEPTH = 16
const COLLIDE_CELL = 96
const CELL_OFFSET = 4096
const CELL_SPAN = 8192

interface QCell {
  x: number
  y: number
  size: number
  depth: number
  mass: number
  cx: number
  cy: number
  items: number[]
  kids: (QCell | null)[] | null
}

const makeCell = (x: number, y: number, size: number, depth: number): QCell => ({
  x,
  y,
  size,
  depth,
  mass: 0,
  cx: 0,
  cy: 0,
  items: [],
  kids: null,
})

function insertPoint(cell: QCell, pts: { x: number; y: number }[], idx: number): void {
  if (cell.kids) {
    const half = cell.size / 2
    const col = pts[idx].x >= cell.x + half ? 1 : 0
    const row = pts[idx].y >= cell.y + half ? 1 : 0
    const slot = row * 2 + col
    let child = cell.kids[slot]
    if (!child) {
      child = makeCell(cell.x + col * half, cell.y + row * half, half, cell.depth + 1)
      cell.kids[slot] = child
    }
    insertPoint(child, pts, idx)
    return
  }
  cell.items.push(idx)
  if (cell.items.length > BH_LEAF && cell.depth < BH_MAX_DEPTH) {
    const own = cell.items
    cell.items = []
    cell.kids = [null, null, null, null]
    for (const j of own) insertPoint(cell, pts, j)
  }
}

function summarise(cell: QCell, pts: { x: number; y: number }[]): void {
  let mass = cell.items.length
  let cx = 0
  let cy = 0
  for (const j of cell.items) {
    cx += pts[j].x
    cy += pts[j].y
  }
  if (cell.kids) {
    for (const kid of cell.kids) {
      if (!kid) continue
      summarise(kid, pts)
      mass += kid.mass
      cx += kid.cx * kid.mass
      cy += kid.cy * kid.mass
    }
  }
  cell.mass = mass
  cell.cx = mass ? cx / mass : 0
  cell.cy = mass ? cy / mass : 0
}

function repel(nodes: Sim[], disp: { x: number; y: number }[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    if (node.x < minX) minX = node.x
    if (node.y < minY) minY = node.y
    if (node.x > maxX) maxX = node.x
    if (node.y > maxY) maxY = node.y
  }
  const span = Math.max(1, maxX - minX, maxY - minY)
  const root = makeCell(minX, minY, span, 0)
  for (let i = 0; i < nodes.length; i += 1) insertPoint(root, nodes, i)
  summarise(root, nodes)

  const stack: QCell[] = []
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i]
    const da = disp[i]
    stack.length = 0
    stack.push(root)
    while (stack.length) {
      const cell = stack.pop()!
      if (!cell.mass) continue
      if (!cell.kids) {
        for (const j of cell.items) {
          if (j === i) continue
          const b = nodes[j]
          let dx = a.x - b.x
          let dy = a.y - b.y
          let dist = Math.hypot(dx, dy)
          if (dist < 0.6) {
            dx = (i % 5) - 2
            dy = (j % 5) - 2
            dist = 2.5
          }
          const push = (K * K) / dist
          da.x += (dx / dist) * push
          da.y += (dy / dist) * push
        }
        continue
      }
      const dx = a.x - cell.cx
      const dy = a.y - cell.cy
      const dist = Math.hypot(dx, dy)
      if (dist > 1e-4 && cell.size / dist < BH_THETA) {
        const push = (cell.mass * K * K) / dist
        da.x += (dx / dist) * push
        da.y += (dy / dist) * push
      } else {
        for (const kid of cell.kids) if (kid) stack.push(kid)
      }
    }
  }
}

/* Plate spacing and label room are short-range, so they are resolved exactly against the
   nine grid buckets around each plate instead of the whole field. */
function collide(nodes: Sim[], disp: { x: number; y: number }[]) {
  /* The world box grows with the square root of the node count, so a fixed breathing room is
     what fills it: at 40px a thousand-plate estate has no slack left and the field piles onto
     the walls. Large meshes pack tight and lean on colour and the label layer for legibility. */
  const pad = nodes.length > 400 ? 10 : 40
  const grid = new Map<number, number[]>()
  for (let i = 0; i < nodes.length; i += 1) {
    const key =
      Math.floor(nodes[i].x / COLLIDE_CELL) + CELL_OFFSET + (Math.floor(nodes[i].y / COLLIDE_CELL) + CELL_OFFSET) * CELL_SPAN
    const bucket = grid.get(key)
    if (bucket) bucket.push(i)
    else grid.set(key, [i])
  }
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i]
    const gx = Math.floor(a.x / COLLIDE_CELL) + CELL_OFFSET
    const gy = Math.floor(a.y / COLLIDE_CELL) + CELL_OFFSET
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const bucket = grid.get((gy + oy) * CELL_SPAN + gx + ox)
        if (!bucket) continue
        for (const j of bucket) {
          if (j <= i) continue
          const b = nodes[j]
          const min = a.r + b.r + pad
          let dx = a.x - b.x
          let dy = a.y - b.y
          let dist = Math.hypot(dx, dy)
          if (dist >= min) continue
          if (dist < 0.6) {
            dx = (i % 5) - 2
            dy = (j % 5) - 2
            dist = 2.5
          }
          const push = 900 * (1 - dist / min)
          const px = (dx / dist) * push
          const py = (dy / dist) * push
          disp[i].x += px
          disp[i].y += py
          disp[j].x -= px
          disp[j].y -= py
        }
      }
    }
  }
}

function step(nodes: Sim[], edges: EdgeRef[], soft: [string, string][], world: World) {
  const index = new Map(nodes.map((node, i) => [node.id, i]))
  const links: [number, number][] = []
  for (const edge of edges) {
    const a = index.get(edge.from)
    const b = index.get(edge.to)
    if (a !== undefined && b !== undefined) links.push([a, b])
  }
  const softLinks: [number, number][] = []
  for (const [from, to] of soft) {
    const a = index.get(from)
    const b = index.get(to)
    if (a !== undefined && b !== undefined) softLinks.push([a, b])
  }
  const disp: { x: number; y: number }[] = nodes.map(() => ({ x: 0, y: 0 }))

  repel(nodes, disp)
  collide(nodes, disp)

  /* Correlation edges pull hard; shared-stack pairs are a weaker spring, so the assets that
     run the same package gather without being dragged on top of each other. */
  for (const [ia, ib] of links) {
    const a = nodes[ia]
    const b = nodes[ib]
    const dx = a.x - b.x
    const dy = a.y - b.y
    const dist = Math.hypot(dx, dy) || 1
    const pull = (dist * dist) / K
    const da = disp[ia]
    const db = disp[ib]
    da.x -= (dx / dist) * pull
    da.y -= (dy / dist) * pull
    db.x += (dx / dist) * pull
    db.y += (dy / dist) * pull
  }

  for (const [ia, ib] of softLinks) {
    const a = nodes[ia]
    const b = nodes[ib]
    const dx = a.x - b.x
    const dy = a.y - b.y
    const dist = Math.hypot(dx, dy) || 1
    const pull = (dist * dist) / (K * 6)
    const da = disp[ia]
    const db = disp[ib]
    da.x -= (dx / dist) * pull
    da.y -= (dy / dist) * pull
    db.x += (dx / dist) * pull
    db.y += (dy / dist) * pull
  }

  const halfX = world.w / 2 - 62
  const halfY = world.h / 2 - 62
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    const d = disp[i]
    if (node.pin) {
      node.x = world.cx
      node.y = world.cy
      continue
    }
    const gravity = node.kind === 'asset' ? 1.15 : 0.5
    d.x += (world.cx - node.x) * gravity
    d.y += (world.cy - node.y) * gravity
    /* Containment is elliptical with a soft rim: a rectangular clamp leaves the nodes with no
       spring pull sitting in straight rows along the walls, which reads as a frame, not a mesh. */
    const ex = (node.x - world.cx) / halfX
    const ey = (node.y - world.cy) / halfY
    const er = Math.hypot(ex, ey)
    if (er > SOFT_RIM) {
      const bite = ((er - SOFT_RIM) / (1 - SOFT_RIM)) ** 2
      d.x -= ex * halfX * bite
      d.y -= ey * halfY * bite
    }
    const len = Math.hypot(d.x, d.y) || 1
    const cap = Math.min(len, 70)
    let nx = node.x + (d.x / len) * cap
    let ny = node.y + (d.y / len) * cap
    const rx = (nx - world.cx) / halfX
    const ry = (ny - world.cy) / halfY
    const rr = Math.hypot(rx, ry)
    if (rr > 1) {
      nx = world.cx + (rx / rr) * halfX
      ny = world.cy + (ry / rr) * halfY
    }
    node.x = nx
    node.y = ny
  }
}

/* ---------- static layers ---------- */

const NodePlate = memo(function NodePlate({
  spec,
  bind,
  onEnter,
  onLeave,
  onActivate,
  onKey,
}: {
  spec: NodeSpec
  bind: (id: string, el: SVGGElement | null) => void
  onEnter: (id: string) => void
  onLeave: () => void
  onActivate: (id: string) => void
  onKey: (id: string) => (event: ReactKeyboardEvent) => void
}) {
  const size = spec.r * 2
  const shared = {
    ref: (el: SVGGElement | null) => bind(spec.id, el),
    className: cx('fg-node', spec.kind === 'core' && 'fg-core'),
    onMouseEnter: () => onEnter(spec.id),
    onMouseLeave: onLeave,
    onFocus: () => onEnter(spec.id),
    onBlur: onLeave,
    onClick: () => onActivate(spec.id),
    onKeyDown: onKey(spec.id),
    tabIndex: 0,
    role: 'button' as const,
    'aria-label': spec.aria,
  }

  if (spec.kind === 'core') {
    return (
      <g {...shared}>
        <rect x={-26} y={-26} width={52} height={52} rx={15} fill={INK} />
        <g transform="translate(-11 -11)" className="fg-glyph">
          <Network size={22} strokeWidth={1.7} color="#ffffff" />
        </g>
      </g>
    )
  }

  if (spec.kind === 'cve') {
    return (
      <g {...shared}>
        <rect
          className="fg-plate"
          x={-size / 2}
          y={-size / 2}
          width={size}
          height={size}
          rx={size * 0.32}
          fill={spec.linked ? hexA(spec.tone, 0.1) : '#f4f6f9'}
          stroke={spec.linked ? spec.tone : GATE}
          strokeDasharray={spec.linked ? undefined : '3 3'}
        />
        <g className="fg-glyph" transform={`translate(${-size / 2} ${-size / 2}) scale(${(size * 0.52) / 24})`} style={{ color: spec.tone }}>
          <Bug size={24} strokeWidth={1.7} color={spec.linked ? spec.tone : GATE} />
        </g>
      </g>
    )
  }

  const Glyph = ASSET_ICONS[spec.glyph as keyof typeof ASSET_ICONS] ?? Server
  return (
    <g {...shared}>
      <rect className="fg-plate" x={-size / 2} y={-size / 2} width={size} height={size} rx={size * 0.28} fill="#ffffff" stroke={spec.tone} />
      <g className="fg-glyph" transform={`translate(${-size * 0.28} ${-size * 0.28}) scale(${(size * 0.56) / 24})`}>
        <Glyph size={24} strokeWidth={1.6} color={spec.tone} />
      </g>
      {spec.badge !== null && spec.badge > 0 && (
        <g className="fg-badge" transform={`translate(${spec.r - 4} ${-spec.r + 4})`}>
          <circle r="9" fill={spec.tone} />
          <text className="fg-badge-num" y="3.4">
            {spec.badge > 99 ? '99+' : spec.badge}
          </text>
        </g>
      )}
    </g>
  )
})

const BucketLayer = memo(function BucketLayer({
  buckets,
  bind,
}: {
  buckets: { key: string; tone: string; dash?: string }[]
  bind: (key: string, el: SVGPathElement | null, kind: 'line' | 'arrow') => void
}) {
  return (
    <>
      {buckets.map((bucket) => (
        <g key={bucket.key}>
          <path
            ref={(el) => bind(bucket.key, el, 'line')}
            className={cx('fg-bucket', bucket.key === 'gate' && 'is-gate')}
            stroke={bucket.tone}
            strokeDasharray={bucket.dash}
          />
          <path ref={(el) => bind(bucket.key, el, 'arrow')} className="fg-arrow" fill={bucket.tone} />
        </g>
      ))}
    </>
  )
})

const TipCard = memo(function TipCard({
  rows,
  kicker,
  title,
  tone,
}: {
  rows: [string, string][]
  kicker: string
  title: string
  tone: string
}) {
  const tipW = 20 + rows.length * 64
  return (
    <>
      <rect className="fg-tip-card" width={tipW} height="86" rx="14" />
      <rect x="12" y="13" width="20" height="20" rx="7" fill={hexA(tone, 0.14)} />
      <g transform="translate(15 16)">
        <AlertTriangle size={14} strokeWidth={1.9} color={tone} />
      </g>
      <text className="fg-tip-kicker" x="40" y="24">
        {kicker.length > 26 ? `${kicker.slice(0, 25)}…` : kicker}
      </text>
      <text className="fg-tip-title" x="12" y="50">
        {title.length > 32 ? `${title.slice(0, 31)}…` : title}
      </text>
      {rows.map(([label, value], index) => (
        <text key={label} className="fg-tip-row" x={12 + index * 64} y="70">
          <tspan className="fg-tip-v">{value}</tspan>
          <tspan className="fg-tip-k" dx="4">
            {label}
          </tspan>
        </text>
      ))}
    </>
  )
})

/* ---------- labels ---------- */

interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface LabelRow {
  id: string
  text: string
  sub?: string
  mono?: boolean
  dy: number
  order: number
  state: 'active' | 'linked' | 'dim' | 'base'
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/* Char widths of .fg-label / .fg-sub / .fg-label.mono at their rendered point sizes; labels are
   scaled to a constant screen size, so these are screen pixels. */
function labelBox(x: number, y: number, row: LabelRow): Box {
  const width = Math.max(row.text.length * (row.mono ? 5.4 : 6.2), row.sub ? row.sub.length * 5.8 : 0)
  return { x: x - width / 2 - 3, y, w: width + 6, h: row.sub ? 27 : 14 }
}

const LABEL_CELL = 110

/* Sorting needs the screen x of a row; carried on the row so the comparator stays cheap. */
type SortableRow = LabelRow & { x0: number }

/* Plates are not obstacles — the labels carry a white halo and sit above every plate — but text
   must never sit on text, and a name outside the canvas is no name at all. Accepted boxes go
   into a spatial grid, so a 1,600-plate claim pass stays a few milliseconds. */
function claimLabels(rows: SortableRow[], screen: (id: string) => { x: number; y: number } | null, occupied: Box[]): SortableRow[] {
  const ordered = [...rows].sort((a, b) => a.order - b.order || b.dy - a.dy || a.x0 - b.x0)
  const taken = new Map<number, Box[]>()
  const shown: SortableRow[] = []

  const keyOf = (gx: number, gy: number) => gx + CELL_OFFSET + (gy + CELL_OFFSET) * CELL_SPAN
  const put = (box: Box) => {
    const k = keyOf(Math.floor((box.x + box.w / 2) / LABEL_CELL), Math.floor((box.y + box.h / 2) / LABEL_CELL))
    const list = taken.get(k)
    if (list) list.push(box)
    else taken.set(k, [box])
  }
  for (const box of occupied) put(box)

  for (const row of ordered) {
    const at = screen(row.id)
    if (!at) continue
    const box = labelBox(at.x, at.y + row.dy, row)
    if (box.x < 4 || box.x + box.w > W - 4 || box.y + box.h > H - 4 || box.y > H) continue
    const gx = Math.floor((box.x + box.w / 2) / LABEL_CELL)
    const gy = Math.floor((box.y + box.h / 2) / LABEL_CELL)
    let clash = false
    for (let oy = -1; oy <= 1 && !clash; oy += 1) {
      for (let ox = -1; ox <= 1 && !clash; ox += 1) {
        const list = taken.get(keyOf(gx + ox, gy + oy))
        if (!list) continue
        clash = list.some((t) => overlaps(t, box))
      }
    }
    if (clash) continue
    put(box)
    shown.push(row)
  }
  return shown
}

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
  const stageRef = useRef<HTMLDivElement>(null)
  const worldGRef = useRef<SVGGElement>(null)
  const edgesGRef = useRef<SVGGElement | null>(null)
  const labelGRef = useRef<SVGGElement>(null)
  const tipRef = useRef<SVGGElement>(null)
  const haloRef = useRef<SVGEllipseElement>(null)

  const simRef = useRef<Sim[]>([])
  const posRef = useRef(new Map<string, Sim>())
  const worldRef = useRef<World>(worldFor(0))
  const alphaRef = useRef(0)
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 })
  const rafRef = useRef(0)
  const fitArmedRef = useRef(true)
  const [solving, setSolving] = useState(false)

  const nodeEls = useRef(new Map<string, SVGGElement>())
  const labelEls = useRef(new Map<string, SVGGElement>())
  const lineEls = useRef(new Map<string, SVGPathElement>())
  const arrowEls = useRef(new Map<string, SVGPathElement>())
  const traceEls = useRef(new Map<string, SVGPathElement>())
  const stackEls = useRef(new Map<string, SVGPathElement>())

  const onHoverRef = useRef(onHover)
  onHoverRef.current = onHover
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

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
      /* A package shared by 400 hosts is one cluster, not 80k springs: peers are capped so the
         layout stays a picture rather than turning quadratic in the estate size. */
      const peers = list.length > STACK_PEERS ? list.slice(0, STACK_PEERS) : list
      for (let i = 0; i < peers.length; i += 1) {
        for (let j = i + 1; j < peers.length; j += 1) {
          const a = peers[i]
          const b = peers[j]
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

  const edges = useMemo<EdgeRef[]>(
    () =>
      alerts.map((alert) => ({
        from: alert.asset.id,
        to: alert.cve.id,
        suppressed: alert.suppressed,
        level: alert.level,
      })),
    [alerts],
  )

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    const touch = (a: string, b: string) => {
      const set = map.get(a) ?? new Set<string>()
      set.add(b)
      map.set(a, set)
    }
    for (const edge of edges) {
      touch(edge.from, edge.to)
      touch(edge.to, edge.from)
      touch(edge.from, 'hub')
      touch('hub', edge.from)
    }
    return map
  }, [edges])

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

  /* ---------- plate specs ---------- */

  const specs = useMemo<NodeSpec[]>(() => {
    const rows: NodeSpec[] = cves.map((cve) => {
      const linked = linkedCves.has(cve.id)
      return {
        id: cve.id,
        kind: 'cve',
        r: cveRadius(assetsByCve.get(cve.id)?.length ?? 0),
        tone: cve.kev ? TONE.CRITICAL : TONE[cve.severity],
        label: cve.id.replace('CVE-', ''),
        mono: true,
        badge: null,
        linked,
        glyph: 'bug',
        aria: `${cve.id} ${cve.product}, ${cve.severity.toLowerCase()}, ${linked ? 'linked to inventory' : 'no inventory hit'}`,
      }
    })
    for (const asset of assets) {
      const mine = alertsByAsset.get(asset.id) ?? []
      const live = mine.filter((alert) => !alert.suppressed)
      const level = worstLevel(live)
      rows.push({
        id: asset.id,
        kind: 'asset',
        r: halfSide('asset', asset.criticality),
        tone: level ? TONE[level] : GATE,
        label: asset.name,
        sub: asset.department,
        badge: live.length,
        linked: true,
        glyph: asset.type,
        aria: `${asset.name}, ${asset.department}, ${live.length} active paths`,
      })
    }
    rows.push({
      id: 'hub',
      kind: 'core',
      r: halfSide('core', null),
      tone: INK,
      label: 'AEGIS core',
      badge: null,
      linked: true,
      glyph: 'core',
      aria: 'AEGIS correlation core',
    })
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, edgeKey, assetsByCve, alertsByAsset, linkedCves])

  const specById = useMemo(() => new Map(specs.map((spec) => [spec.id, spec])), [specs])

  /* Mirrors for the imperative painters, which must never read a stale render. */
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const specByIdRef = useRef(specById)
  specByIdRef.current = specById
  const softRef = useRef<[string, string][]>([])
  softRef.current = useMemo(() => stackLinks.map((link) => [link.from, link.to] as [string, string]), [stackLinks])
  const traceRef = useRef(new Map<string, EdgeRef>())
  const stackRef = useRef(new Map<string, { from: string; to: string }>())
  const tipRef2 = useRef<{ id: string; rows: [string, string][] } | null>(null)
  const stateRef = useRef(new Map<string, 'active' | 'linked' | 'dim' | 'base'>())
  const focusRef = useRef<string | null>(null)
  const selectedRef = useRef<string | null>(selected)
  selectedRef.current = selected

  /* ---------- painting ---------- */

  const paintView = useCallback(() => {
    const view = viewRef.current
    const world = worldRef.current
    worldGRef.current?.setAttribute('transform', `translate(${r1(view.x)} ${r1(view.y)}) scale(${view.k.toFixed(3)})`)
    stageRef.current?.classList.toggle('is-flat', view.k < GLYPH_ZOOM)
    const halo = haloRef.current
    if (halo) {
      halo.setAttribute('cx', String(r1(world.cx)))
      halo.setAttribute('cy', String(r1(world.cy)))
      halo.setAttribute('rx', String(r1(world.w * 0.3)))
      halo.setAttribute('ry', String(r1(world.h * 0.44)))
    }
  }, [])

  const paintLabels = useCallback(() => {
    const view = viewRef.current
    const inv = 1 / view.k
    labelEls.current.forEach((el, id) => {
      const node = posRef.current.get(id)
      if (node) el.setAttribute('transform', `translate(${r1(node.x)} ${r1(node.y)}) scale(${inv.toFixed(3)})`)
    })
  }, [])

  const paintBuckets = useCallback(() => {
    /* One merged stroke path and one merged arrow path per severity. */
    const lines = new Map<string, string[]>()
    const heads = new Map<string, string[]>()
    for (const edge of edgesRef.current) {
      const from = posRef.current.get(edge.from)
      const to = posRef.current.get(edge.to)
      if (!from || !to) continue
      const key = bucketOf(edge.suppressed, edge.level)
      const { sx, sy, ex, ey, mx, my } = curve(from, to, 7)
      const line = lines.get(key)
      const seg = `M${r1(sx)} ${r1(sy)}Q${r1(mx)} ${r1(my)} ${r1(ex)} ${r1(ey)}`
      if (line) line.push(seg)
      else lines.set(key, [seg])
      let ax = ex - mx
      let ay = ey - my
      const alen = Math.hypot(ax, ay) || 1
      ax /= alen
      ay /= alen
      const head = heads.get(key)
      const tri = `M${r1(ex)} ${r1(ey)}L${r1(ex - ax * 7 - ay * 3.4)} ${r1(ey - ay * 7 + ax * 3.4)}L${r1(ex - ax * 7 + ay * 3.4)} ${r1(ey - ay * 7 - ax * 3.4)}Z`
      if (head) head.push(tri)
      else heads.set(key, [tri])
    }
    lineEls.current.forEach((el, key) => el.setAttribute('d', lines.get(key)?.join('') ?? ''))
    arrowEls.current.forEach((el, key) => el.setAttribute('d', heads.get(key)?.join('') ?? ''))
  }, [])

  const paintTrace = useCallback(() => {
    for (const [key, el] of traceEls.current) {
      const link = traceRef.current.get(key)
      if (!link) continue
      const from = posRef.current.get(link.from)
      const to = posRef.current.get(link.to)
      if (!from || !to) continue
      el.setAttribute('d', linkPath(from, to, 7).d)
    }
  }, [])

  const paintStacks = useCallback(() => {
    for (const [key, el] of stackEls.current) {
      const link = stackRef.current.get(key)
      if (!link) continue
      const from = posRef.current.get(link.from)
      const to = posRef.current.get(link.to)
      if (!from || !to) continue
      const { d, mx, my } = linkPath(from, to, 4)
      el.setAttribute('d', d)
      const label = el.nextElementSibling
      if (label) {
        label.setAttribute('x', String(r1(mx)))
        label.setAttribute('y', String(r1(my - 6)))
      }
    }
  }, [])

  const paintTip = useCallback(() => {
    const tip = tipRef2.current
    const tipEl = tipRef.current
    if (tip && tipEl) {
      const node = posRef.current.get(tip.id)
      if (node) {
        const tipW = 20 + tip.rows.length * 64
        const world = worldRef.current
        const x = clamp(node.x - tipW / 2, world.cx - world.w / 2 + 12, world.cx + world.w / 2 - tipW - 12)
        const y = clamp(node.y - node.r - 96, world.cy - world.h / 2 + 8, world.cy + world.h / 2 - 110)
        tipEl.setAttribute('transform', `translate(${r1(x)} ${r1(y)})`)
      }
    }
  }, [])

  const paintNodes = useCallback(() => {
    const nodes = simRef.current
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]
      nodeEls.current.get(node.id)?.setAttribute('transform', `translate(${r1(node.x)} ${r1(node.y)})`)
    }
  }, [])

  const paintPositions = useCallback(() => {
    paintNodes()
    paintBuckets()
    paintTrace()
    paintStacks()
    paintLabels()
    paintTip()
  }, [paintNodes, paintBuckets, paintTrace, paintStacks, paintLabels, paintTip])

  /* Dim / highlight is a class write per plate, so it is its own pass: it runs when focus,
     selection or the query change — never on a physics tick. Only plates whose class actually
     changed are touched, so sweeping the mesh stays cheap at estate scale. */
  const lastPaintRef = useRef(new Map<string, string | boolean>())
  const paintState = useCallback(() => {
    const state = stateRef.current
    const last = lastPaintRef.current
    const selectedId = selectedRef.current
    nodeEls.current.forEach((el, id) => {
      const next = state.get(id) ?? 'base'
      const key = next + (id === selectedId ? '*' : '')
      if (last.get(id) === key) return
      last.set(id, key)
      el.classList.toggle('is-dim', next === 'dim')
      el.classList.toggle('is-active', next === 'active')
      el.classList.toggle('is-linked', next === 'linked')
      el.classList.toggle('is-selected', id === selectedId)
    })
    labelEls.current.forEach((el, id) => {
      const dim = (state.get(id) ?? 'base') === 'dim'
      const key = 'label:' + id
      if (last.get(key) === dim) return
      last.set(key, dim)
      el.classList.toggle('is-dim', dim)
    })
    edgesGRef.current?.classList.toggle('is-tracing', !!focusRef.current && focusRef.current !== 'hub')
  }, [])

  const bindNode = useCallback((id: string, el: SVGGElement | null) => {
    if (el) {
      nodeEls.current.set(id, el)
      lastPaintRef.current.delete(id)
    } else nodeEls.current.delete(id)
  }, [])

  const bindBucket = useCallback((key: string, el: SVGPathElement | null, kind: 'line' | 'arrow') => {
    const map = kind === 'line' ? lineEls : arrowEls
    if (el) map.current.set(key, el)
    else map.current.delete(key)
  }, [])

  /* Hover is a full re-trace, so a fast sweep across the estate would pay for every plate it
     crossed. Coalesce to the last plate touched in each frame instead. */
  const hoverFrame = useRef(0)
  const pendingHover = useRef<string | null>(null)
  const enter = useCallback((id: string) => {
    pendingHover.current = id
    if (hoverFrame.current) return
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0
      onHoverRef.current(pendingHover.current)
    })
  }, [])
  const leave = useCallback(() => {
    pendingHover.current = null
    if (hoverFrame.current) {
      cancelAnimationFrame(hoverFrame.current)
      hoverFrame.current = 0
    }
    onHoverRef.current(null)
  }, [])
  const activate = useCallback((id: string) => onSelectRef.current(id), [])
  const onKey = useCallback(
    (id: string) => (event: ReactKeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onSelectRef.current(id)
      }
    },
    [],
  )

  /* ---------- solver ---------- */

  const settle = useCallback(() => {
    if (fitArmedRef.current) {
      fitArmedRef.current = false
      fitToContentRef.current()
    }
    planLabelsRef.current()
  }, [])

  const run = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    const animated = simRef.current.length <= ANIMATE_NODES
    let deadline = performance.now() + SOLVE_BUDGET_MS

    const finish = () => {
      setSolving(false)
      paintPositions()
      settle()
    }

    /* Small mesh: one step per frame, painted as it goes. */
    const tick = () => {
      step(simRef.current, edgesRef.current, softRef.current, worldRef.current)
      alphaRef.current *= 0.955
      paintPositions()
      if (alphaRef.current > 0.012) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      finish()
    }

    /* Big mesh: solve inside the frame budget without painting — re-rasterising 1,600 plates
       per tick is what makes a full-estate graph unusable — then paint once, settled. */
    const chunk = () => {
      let steps = 0
      while (alphaRef.current > 0.012) {
        step(simRef.current, edgesRef.current, softRef.current, worldRef.current)
        alphaRef.current *= 0.955
        steps += 1
        if (steps % 4 === 0 && performance.now() > deadline) break
      }
      if (alphaRef.current > 0.012) {
        deadline = performance.now() + SOLVE_BUDGET_MS
        rafRef.current = requestAnimationFrame(chunk)
        return
      }
      finish()
    }

    if (animated) {
      setSolving(false)
      rafRef.current = requestAnimationFrame(tick)
    } else {
      setSolving(true)
      deadline = performance.now() + SOLVE_BUDGET_MS
      rafRef.current = requestAnimationFrame(chunk)
    }
  }, [paintPositions, settle])

  /* ---------- fit ---------- */

  const fitToContent = useCallback(() => {
    const nodes = simRef.current
    if (!nodes.length) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of nodes) {
      minX = Math.min(minX, node.x - node.r)
      maxX = Math.max(maxX, node.x + node.r)
      minY = Math.min(minY, node.y - node.r)
      maxY = Math.max(maxY, node.y + node.r + 20)
    }
    const k = clamp(
      Math.min((W - 40) / Math.max(1, maxX - minX), (H - 40) / Math.max(1, maxY - minY)),
      MIN_K,
      1.35,
    )
    /* Centre the frame on the bounding box, not on the mass of the mesh: the scale above is
       chosen so the extremes fit, and when they cannot (a floor-scale fit on a huge estate) the
       middle of the cluster is still the honest thing to show. */
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    viewRef.current = { k, x: W / 2 - k * cx, y: H / 2 - k * cy }
    paintView()
    paintPositions()
    paintState()
  }, [paintView, paintPositions, paintState])

  const fitToContentRef = useRef(fitToContent)
  fitToContentRef.current = fitToContent

  /* ---------- zoom & pan ---------- */

  const planLabelsRef = useRef<() => void>(() => {})

  /* React attaches wheel handlers passively, so zooming over the canvas would also scroll
     the page. A non-passive listener can preventDefault and keep the gesture inside the graph. */
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const apply = (k: number) => {
      const prev = viewRef.current
      const next = clamp(k, MIN_K, MAX_K)
      const ratio = next / prev.k
      viewRef.current = { k: next, x: W / 2 - (W / 2 - prev.x) * ratio, y: H / 2 - (H / 2 - prev.y) * ratio }
      paintView()
      paintLabels()
      planLabelsRef.current()
    }
    const onWheelEvent = (event: WheelEvent) => {
      event.preventDefault()
      apply(viewRef.current.k * (event.deltaY < 0 ? 1.14 : 0.88))
    }
    el.addEventListener('wheel', onWheelEvent, { passive: false })
    return () => el.removeEventListener('wheel', onWheelEvent)
  }, [paintView, paintLabels])

  /* Panning exists because the world is bigger than the canvas on a real estate; without it a
     reader can zoom into a mesh they can never walk across. */
  const dragRef = useRef<{ id: number; x: number; y: number; view: View; moved: boolean } | null>(null)

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const target = event.target as Element
    if (target.closest('.fg-node')) return
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, view: { ...viewRef.current }, moved: false }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    const rect = svgRef.current?.getBoundingClientRect()
    const scale = rect ? W / rect.width : 1
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 3) return
    drag.moved = true
    viewRef.current = { k: drag.view.k, x: drag.view.x + dx * scale, y: drag.view.y + dy * scale }
    paintView()
    paintLabels()
  }

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    dragRef.current = null
    if (drag.moved) planLabelsRef.current()
  }

  const zoomTo = (next: number) => {
    const prev = viewRef.current
    const k = clamp(next, MIN_K, MAX_K)
    const ratio = k / prev.k
    viewRef.current = { k, x: W / 2 - (W / 2 - prev.x) * ratio, y: H / 2 - (H / 2 - prev.y) * ratio }
    paintView()
    paintLabels()
    planLabelsRef.current()
  }

  /* ---------- mount / re-seed ---------- */

  useEffect(() => {
    const world = worldFor(assets.length + cves.length + 1)
    worldRef.current = world
    const rand = mulberry32(20261031)
    const seed: Sim[] = [
      { id: 'hub', kind: 'core', x: world.cx, y: world.cy, r: halfSide('core', null), pin: true },
      ...assets.map((asset, index) => {
        const angle = (index / Math.max(1, assets.length)) * Math.PI * 2
        const radius = world.w * 0.13 + rand() * world.w * 0.12
        return {
          id: asset.id,
          kind: 'asset' as Kind,
          x: world.cx + Math.cos(angle) * radius,
          y: world.cy + Math.sin(angle) * radius * 0.72,
          r: halfSide('asset', asset.criticality),
          pin: false,
        }
      }),
      ...cves.map((cve, index) => {
        const angle = (index / Math.max(1, cves.length)) * Math.PI * 2 + 0.4
        const radius = world.w * 0.22 + rand() * world.w * 0.11
        return {
          id: cve.id,
          kind: 'cve' as Kind,
          x: world.cx + Math.cos(angle) * radius * 1.35,
          y: world.cy + Math.sin(angle) * radius * 0.8,
          r: cveRadius(assetsByCve.get(cve.id)?.length ?? 0),
          pin: false,
        }
      }),
    ]
    simRef.current = seed
    posRef.current = new Map(seed.map((node) => [node.id, node]))
    alphaRef.current = 1
    fitArmedRef.current = true
    /* Frame the world before the first step, so a mesh solving off-canvas is not a blank canvas. */
    const k0 = clamp(Math.min((W - 40) / world.w, (H - 40) / world.h), MIN_K, 1.35)
    viewRef.current = { k: k0, x: W / 2 - k0 * world.cx, y: H / 2 - k0 * world.cy }
    paintView()
    run()
    return () => {
      cancelAnimationFrame(rafRef.current)
      if (hoverFrame.current) {
        cancelAnimationFrame(hoverFrame.current)
        hoverFrame.current = 0
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey])

  /* A scope change re-shapes who a record reaches, so plate size follows the wiring and the
     springs re-heat once. Live-feed score updates never reach this. */
  useEffect(() => {
    if (!simRef.current.length) return
    simRef.current.forEach((node) => {
      if (node.kind === 'cve') node.r = cveRadius(assetsByCve.get(node.id)?.length ?? 0)
    })
    fitArmedRef.current = true
    alphaRef.current = Math.max(alphaRef.current, 0.55)
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeKey])

  /* After a structural re-render the plates exist in the DOM again: put them where the solver
     left them and re-apply focus state before the browser paints. */
  useEffect(() => {
    paintPositions()
    paintState()
    paintView()
  })

  /* ---------- focus model ---------- */

  const focusId = hover ?? selected
  focusRef.current = focusId

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

  const litById = useMemo(() => {
    const set = new Set<string>()
    const matches = (text: string) => !!q && text.toLowerCase().includes(q)
    if (!q) return null
    for (const asset of assets) {
      if (matches(asset.name) || matches(asset.id) || matches(asset.department)) set.add(asset.id)
    }
    for (const cve of cves) {
      if (matches(cve.id) || matches(cve.product) || matches(cve.vendor)) set.add(cve.id)
    }
    return set
  }, [assets, cves, q])

  const nodeState = useCallback(
    (id: string): 'active' | 'linked' | 'dim' | 'base' => {
      if (focusId && focusId !== 'hub') {
        if (id === focusId) return 'active'
        if (neighbours?.has(id)) return 'linked'
        return 'dim'
      }
      if (focusId === 'hub') return id === 'hub' ? 'active' : !litById || litById.has(id) ? 'linked' : 'dim'
      return !litById || litById.has(id) ? 'base' : 'dim'
    },
    [focusId, neighbours, litById],
  )

  /* Trace edges: the focused node's own wiring, drawn one-per-path so it can carry an arrowhead
     and sit above the merged background. */
  const trace = useMemo(() => {
    if (!focusId || focusId === 'hub') return []
    return edges
      .filter((edge) => edge.from === focusId || edge.to === focusId)
      .slice(0, TRACE_LIMIT)
      .map((edge, i) => ({ ...edge, key: `${edge.from}>${edge.to}#${i}` }))
  }, [edges, focusId])

  useEffect(() => {
    const map = new Map<string, 'active' | 'linked' | 'dim' | 'base'>()
    for (const spec of specs) map.set(spec.id, nodeState(spec.id))
    stateRef.current = map
    paintState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specs, nodeState])

  useEffect(() => {
    traceRef.current = new Map(trace.map((edge) => [edge.key, edge]))
    paintTrace()
    paintTip()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace])

  useEffect(() => {
    stackRef.current = new Map(lateral.links.map((link) => [link.key, { from: link.from, to: link.to }]))
    paintStacks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lateral])

  /* ---------- label plan ---------- */

  const [labelPlan, setLabelPlan] = useState<SortableRow[]>([])
  const labelKeyRef = useRef('')

  const planLabels = useCallback(() => {
    const view = viewRef.current
    const tracing = !!focusId && focusId !== 'hub'
    const toScreen = (id: string) => {
      const node = posRef.current.get(id)
      if (!node) return null
      return { x: node.x * view.k + view.x, y: node.y * view.k + view.y, r: node.r * view.k }
    }

    const occupied: Box[] = []
    for (const link of lateral.links) {
      const from = toScreen(link.from)
      const to = toScreen(link.to)
      if (!from || !to) continue
      const text = `${link.shared[0]?.product ?? ''}${link.shared.length > 1 ? ` +${link.shared.length - 1}` : ''}`
      const w = text.length * 5.2 * view.k
      occupied.push({ x: (from.x + to.x) / 2 - w / 2, y: (from.y + to.y) / 2 - 24, w, h: 13 })
    }

    const rows: SortableRow[] = []
    for (const spec of specs) {
      if (spec.kind === 'core') continue
      const at = toScreen(spec.id)
      if (!at) continue
      if (!tracing && at.r < LABEL_PLATE_PX) continue
      if (tracing && spec.id !== focusId && !neighbours?.has(spec.id)) continue
      rows.push({
        id: spec.id,
        x0: at.x,
        text: spec.label,
        sub: spec.sub,
        mono: spec.mono,
        dy: at.r + (spec.mono ? 13 : 14),
        order: spec.id === focusId ? 0 : neighbours?.has(spec.id) ? 1 : spec.kind === 'asset' ? 2 : 3,
        state: nodeState(spec.id),
      })
    }
    const hub = specById.get('hub')
    const hubNode = posRef.current.get('hub')
    if (hub && hubNode && !tracing) {
      rows.push({
        id: 'hub',
        x0: hubNode.x * view.k + view.x,
        text: hub.label,
        dy: hubNode.r * view.k + 30,
        order: 0,
        state: nodeState('hub'),
      })
    }

    const shown = claimLabels(rows, (id) => {
      const at = toScreen(id)
      return at ? { x: at.x, y: at.y } : null
    }, occupied)
    const nextKey = `${view.k.toFixed(2)}:${shown.map((row) => row.id).join('|')}`
    if (nextKey === labelKeyRef.current) return
    labelKeyRef.current = nextKey
    setLabelPlan(shown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specs, focusId, neighbours, nodeState, lateral, specById])

  planLabelsRef.current = planLabels

  useEffect(() => {
    planLabels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planLabels, solving])

  /* ---------- tooltip ---------- */

  const tip = useMemo(() => {
    const id = hover
    if (!id) {
      tipRef2.current = null
      return null
    }
    const spec = specById.get(id)
    const node = posRef.current.get(id)
    if (!spec || !node) return null
    if (spec.kind === 'core') {
      const rows = [
        ['assets', String(assets.length)],
        ['records', String(cves.length)],
        ['paths', String(alerts.length)],
        ['stacks', String(stackLinks.length)],
      ] as [string, string][]
      tipRef2.current = { id, rows }
      return { node, tone: TONE.CRITICAL, kicker: 'Correlation core', title: 'AEGIS exposure mesh', rows }
    }
    if (spec.kind === 'asset') {
      const mine = alertsByAsset.get(spec.id) ?? []
      const level = worstLevel(mine.filter((alert) => !alert.suppressed)) ?? 'LOW'
      const top = mine.length ? mine.reduce((best, alert) => (alert.score > best.score ? alert : best)) : null
      const rows = [
        ['paths', String(mine.length)],
        ['worst', top ? fmtScore(top.score) : '—'],
        ['peers', String(peersByAsset.get(spec.id)?.length ?? 0)],
        ['posture', level.toLowerCase()],
      ] as [string, string][]
      tipRef2.current = { id, rows }
      return { node, tone: TONE[level], kicker: `${spec.sub ?? '—'} · ${spec.glyph}`, title: spec.label, rows }
    }
    const reach = assetsByCve.get(spec.id)?.length ?? 0
    let worstScore = 0
    let gated = 0
    for (const alert of alerts) {
      if (alert.cve.id !== spec.id) continue
      if (alert.suppressed) gated += 1
      else if (alert.score > worstScore) worstScore = alert.score
    }
    const rows = [
      ['assets', String(reach)],
      ['worst', worstScore ? fmtScore(worstScore) : '—'],
      ['gated', String(gated)],
    ] as [string, string][]
    tipRef2.current = { id, rows }
    return { node, tone: spec.tone, kicker: 'CVE record', title: spec.id, rows }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, specById, alertsByAsset, assetsByCve, alerts, assets, cves, stackLinks, peersByAsset])

  useEffect(() => {
    paintTip()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip])

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

  const buckets = useMemo(
    () => [...LEVELS.map((level) => ({ key: level, tone: TONE[level] })), { key: 'gate', tone: GATE, dash: '4 5' }],
    [],
  )

  /* ---------- render ---------- */

  return (
    <div ref={stageRef} className="fg">
      <svg
        ref={svgRef}
        className="fg-stage"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="Exposure correlation graph"
        onPointerLeave={() => onHover(null)}
        onDoubleClick={fitToContent}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <pattern id="fg-dots" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="rgba(27,36,55,0.07)" />
          </pattern>
          <radialGradient id="fg-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(242,104,60,0.075)" />
            <stop offset="100%" stopColor="rgba(242,104,60,0)" />
          </radialGradient>
          {LEVELS.map((level) => (
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

        <g ref={worldGRef}>
          <ellipse ref={haloRef} cx={MID0.x} cy={MID0.y} rx={W * 0.3} ry={H * 0.44} fill="url(#fg-halo)" />

          <g className="fg-stacks">
            {lateral.links.map((link) => (
              <g key={link.key}>
                <path
                  className="fg-stack"
                  ref={(el) => {
                    if (el) stackEls.current.set(link.key, el)
                    else stackEls.current.delete(link.key)
                  }}
                />
                <text className="fg-stack-label">
                  {link.shared[0]?.product}
                  {link.shared.length > 1 ? ` +${link.shared.length - 1}` : ''}
                </text>
              </g>
            ))}
          </g>

          <g
            className="fg-edges"
            ref={(el) => {
              if (el) edgesGRef.current = el
            }}
          >
            <BucketLayer buckets={buckets} bind={bindBucket} />
            {trace.map((edge) => (
              <path
                key={edge.key}
                className="fg-edge"
                ref={(el) => {
                  if (el) traceEls.current.set(edge.key, el)
                  else traceEls.current.delete(edge.key)
                }}
                stroke={edge.suppressed ? GATE : TONE[edge.level]}
                strokeDasharray={edge.suppressed ? '4 5' : undefined}
                markerEnd={`url(#${edge.suppressed ? 'fg-arrow-gate' : `fg-arrow-${edge.level}`})`}
              />
            ))}
          </g>

          <g className="fg-nodes">
            {specs.map((spec) => (
              <NodePlate
                key={spec.id}
                spec={spec}
                bind={bindNode}
                onEnter={enter}
                onLeave={leave}
                onActivate={activate}
                onKey={onKey}
              />
            ))}
          </g>

          {/* One text layer above every plate, so a name is never clipped by a node drawn later. */}
          <g className="fg-labels" ref={labelGRef}>
            {labelPlan.map((row) => (
              <g
                key={row.id}
                ref={(el) => {
                  if (el) labelEls.current.set(row.id, el)
                  else {
                    labelEls.current.delete(row.id)
                    lastPaintRef.current.delete('label:' + row.id)
                  }
                }}
              >
                <text className={cx('fg-label', row.mono && 'mono')} y={row.dy}>
                  {row.text}
                </text>
                {row.sub && (
                  <text className="fg-sub" y={row.dy + 11}>
                    {row.sub}
                  </text>
                )}
              </g>
            ))}
          </g>

          {tip && (
            <g ref={tipRef} className="fg-tip" transform={`translate(${r1(tip.node.x)} ${r1(tip.node.y - tip.node.r - 96)})`}>
              <TipCard rows={tip.rows} kicker={tip.kicker} title={tip.title} tone={tip.tone} />
            </g>
          )}
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
        <span className={cx('fg-live', solving && 'is-solving')}>
          <i /> {solving ? 'laying out mesh' : liveLabel ?? 'live'}
        </span>
        <span>
          {assets.length} assets · {cves.length} records · {alerts.length} paths · {stackLinks.length} stack links
        </span>
      </div>

      <div className="fg-tools">
        <button className="fg-tool" onClick={() => zoomTo(viewRef.current.k * 1.18)} aria-label="Zoom in">
          <Plus size={14} />
        </button>
        <button className="fg-tool" onClick={() => zoomTo(viewRef.current.k * 0.85)} aria-label="Zoom out">
          <Minus size={14} />
        </button>
        <button className="fg-tool" onClick={fitToContent} aria-label="Fit the mesh to the canvas">
          <Maximize2 size={13} />
        </button>
      </div>

      <p className="fg-hint mono">click a node · hover to trace the stack · drag to pan · scroll to zoom</p>
    </div>
  )
}
