import type { RiskLevel } from '../lib/types'
import { hexA } from '../lib/colors'

export type Glyph =
  | 'crystal'
  | 'server'
  | 'shield'
  | 'cylinders'
  | 'globe'
  | 'glass'
  | 'cloud'
  | 'lock'
  | 'monitor'
  | 'beacon'

export type Tone = 'teal' | 'gold' | 'blue' | 'violet' | 'indigo' | 'dim'

interface ToneSpec {
  line: string
  bright: string
  base: string
  deep: string
}

export const TONES: Record<Tone, ToneSpec> = {
  teal: { line: '#5ef5e2', bright: '#c8fff7', base: '#3ed2c1', deep: '#0a3b3a' },
  gold: { line: '#ffd479', bright: '#fff2c8', base: '#e3a455', deep: '#49310f' },
  blue: { line: '#6fc9ff', bright: '#d8f3ff', base: '#5aa8e8', deep: '#0d2c46' },
  violet: { line: '#b9a2ff', bright: '#efe8ff', base: '#8d77d8', deep: '#241c45' },
  indigo: { line: '#97aaff', bright: '#e2e9ff', base: '#6c82e6', deep: '#161f44' },
  dim: { line: '#8290a8', bright: '#c8d1e0', base: '#5b6880', deep: '#1a2230' },
}

export const TONE_KEYS = Object.keys(TONES) as Tone[]

export function IsoGradientDefs() {
  return (
    <>
      {TONE_KEYS.map((tone) => {
        const t = TONES[tone]
        return (
          <g key={tone}>
            <linearGradient id={`iso-face-${tone}`} x1="0.1" y1="0" x2="0.75" y2="1">
              <stop offset="0%" stopColor={t.bright} stopOpacity="0.96" />
              <stop offset="42%" stopColor={t.base} stopOpacity="0.92" />
              <stop offset="100%" stopColor={t.deep} stopOpacity="0.98" />
            </linearGradient>
            <linearGradient id={`iso-edge-${tone}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={t.bright} stopOpacity="0.9" />
              <stop offset="55%" stopColor={t.line} stopOpacity="0.65" />
              <stop offset="100%" stopColor={t.deep} stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id={`iso-alt-${tone}`} x1="0" y1="0" x2="0.8" y2="1">
              <stop offset="0%" stopColor={t.base} stopOpacity="0.7" />
              <stop offset="100%" stopColor={t.deep} stopOpacity="0.95" />
            </linearGradient>
            <radialGradient id={`iso-rad-${tone}`}>
              <stop offset="0%" stopColor={t.line} stopOpacity="0.32" />
              <stop offset="55%" stopColor={t.base} stopOpacity="0.12" />
              <stop offset="100%" stopColor={t.base} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`iso-core-${tone}`}>
              <stop offset="0%" stopColor={t.bright} stopOpacity="0.95" />
              <stop offset="45%" stopColor={t.line} stopOpacity="0.5" />
              <stop offset="100%" stopColor={t.line} stopOpacity="0" />
            </radialGradient>
          </g>
        )
      })}
      <linearGradient id="iso-plate" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0%" stopColor="#1a2736" />
        <stop offset="52%" stopColor="#0d1621" />
        <stop offset="100%" stopColor="#070d15" />
      </linearGradient>
      <linearGradient id="iso-plate-side" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#0b141f" />
        <stop offset="100%" stopColor="#04080e" />
      </linearGradient>
      <radialGradient id="iso-shadow">
        <stop offset="0%" stopColor="#000000" stopOpacity="0.72" />
        <stop offset="62%" stopColor="#000000" stopOpacity="0.26" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="iso-hub-fill">
        <stop offset="0%" stopColor="#5ef5e2" stopOpacity="0.1" />
        <stop offset="62%" stopColor="#0d3940" stopOpacity="0.16" />
        <stop offset="100%" stopColor="#061018" stopOpacity="0.02" />
      </radialGradient>
      <radialGradient id="iso-hub-floor">
        <stop offset="0%" stopColor="#3ed2c1" stopOpacity="0.34" />
        <stop offset="38%" stopColor="#2ba99c" stopOpacity="0.12" />
        <stop offset="100%" stopColor="#3ed2c1" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="iso-beam" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#8bfff0" stopOpacity="0" />
        <stop offset="55%" stopColor="#5ef5e2" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#5ef5e2" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="iso-red-glow">
        <stop offset="0%" stopColor="#ff6b78" stopOpacity="0.4" />
        <stop offset="100%" stopColor="#ff6b78" stopOpacity="0" />
      </radialGradient>
    </>
  )
}

function platePoints(w: number, h: number) {
  return [
    [0, -h / 2],
    [w * 0.3, -h * 0.3],
    [w * 0.46, -h * 0.11],
    [w * 0.5, 0],
    [w * 0.46, h * 0.11],
    [w * 0.3, h * 0.3],
    [0, h / 2],
    [-w * 0.3, h * 0.3],
    [-w * 0.46, h * 0.11],
    [-w * 0.5, 0],
    [-w * 0.46, -h * 0.11],
    [-w * 0.3, -h * 0.3],
  ] as const
}

const toPoints = (w: number, h: number, dy = 0, scale = 1) =>
  platePoints(w * scale, h * scale)
    .map(([x, y]) => `${(x as number).toFixed(2)},${((y as number) + dy).toFixed(2)}`)
    .join(' ')

export function IsoPlatform({
  width = 112,
  tone = 'teal',
  active = false,
  bare = false,
}: {
  width?: number
  tone?: Tone
  active?: boolean
  bare?: boolean
}) {
  const t = TONES[tone]
  const h = width * 0.46
  const thickness = Math.max(7, width * 0.075)
  return (
    <g>
      <ellipse cx={0} cy={h * 0.36} rx={width * 0.82} ry={h * 0.95} fill="url(#iso-shadow)" />
      <ellipse cx={0} cy={h * 0.16} rx={width * 0.78} ry={h * 0.78} fill={`url(#iso-rad-${tone})`} opacity={active ? 0.95 : 0.6} />
      <polygon points={toPoints(width, h, thickness)} fill="url(#iso-plate-side)" stroke={hexA(t.line, 0.16)} strokeWidth={0.8} />
      <polygon points={toPoints(width, h)} fill="url(#iso-plate)" stroke={hexA(t.line, active ? 0.85 : 0.42)} strokeWidth={active ? 1.3 : 1} strokeLinejoin="round" />
      <polygon points={toPoints(width, h, 0, 0.84)} fill="none" stroke={hexA(t.line, 0.16)} strokeWidth={0.7} />
      <polygon points={toPoints(width, h, 0, 0.6)} fill={hexA(t.line, active ? 0.07 : 0.035)} stroke="none" />
      <path
        d={`M ${-width * 0.46} ${-h * 0.11} L ${-width * 0.3} ${-h * 0.3} L 0 ${-h * 0.5} L ${width * 0.3} ${-h * 0.3} L ${width * 0.46} ${-h * 0.11}`}
        fill="none"
        stroke={hexA(t.bright, active ? 0.55 : 0.22)}
        strokeWidth={1}
      />
      {!bare &&
        platePoints(width, h)
          .filter((_, i) => i % 3 === 0)
          .map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={1.5} fill={t.line} opacity={active ? 0.95 : 0.42} />
          ))}
      <path d={`M ${-width * 0.46} ${h * 0.11} L ${-width * 0.3} ${h * 0.3} L 0 ${h * 0.5}`} fill="none" stroke={hexA(t.line, 0.45)} strokeWidth={0.9} />
      <path d={`M ${width * 0.46} ${h * 0.11} L ${width * 0.3} ${h * 0.3} L 0 ${h * 0.5}`} fill="none" stroke={hexA(t.line, 0.3)} strokeWidth={0.9} />
      <ellipse className="iso-halo" cx={0} cy={0} rx={width * 0.72} ry={h * 1.02} fill="none" stroke={hexA(t.line, 0.55)} strokeWidth={0.8} strokeDasharray="2 5" />
    </g>
  )
}

interface GlyphProps {
  tone: Tone
}

function Crystal({ tone }: GlyphProps) {
  const t = TONES[tone]
  return (
    <g>
      <ellipse cx={0} cy={-44} rx={42} ry={22} fill={`url(#iso-rad-${tone})`} />
      <polygon points={toPoints(48, 22, 0)} fill="url(#iso-plate)" stroke={hexA(t.line, 0.4)} strokeWidth={0.7} />
      <path d="M 0 -104 L -29 -50 L 0 -30 Z" fill={hexA(t.deep, 0.96)} stroke={hexA(t.line, 0.6)} strokeWidth={0.8} />
      <path d="M 0 -104 L 29 -50 L 0 -30 Z" fill={`url(#iso-face-${tone})`} stroke={hexA(t.line, 0.85)} strokeWidth={0.9} />
      <path d="M -29 -50 L 0 -30 L 0 -10 L -20 -24 Z" fill={hexA(t.deep, 0.9)} stroke={hexA(t.line, 0.4)} strokeWidth={0.7} />
      <path d="M 29 -50 L 0 -30 L 0 -10 L 20 -24 Z" fill={hexA(t.base, 0.46)} stroke={hexA(t.line, 0.6)} strokeWidth={0.7} />
      <path d="M -29 -50 L 0 -70 L 29 -50" fill="none" stroke={hexA(t.bright, 0.42)} strokeWidth={0.8} />
      <path d="M 0 -104 L 0 -30" stroke={hexA(t.bright, 0.75)} strokeWidth={1.1} />
      <path d="M 0 -104 L -12 -66 M 0 -104 L 12 -66" stroke={hexA(t.bright, 0.22)} strokeWidth={0.7} />
      <path d="M 0 -66 L 9 -55 L 0 -43 L -9 -55 Z" fill={t.bright} opacity={0.92} />
      <path d="M 0 -66 L 9 -55 L 0 -43 L -9 -55 Z" fill="none" stroke={t.line} strokeWidth={0.6} opacity={0.9} />
    </g>
  )
}

function Server({ tone }: GlyphProps) {
  const t = TONES[tone]
  return (
    <g>
      <ellipse cx={0} cy={-44} rx={40} ry={20} fill={`url(#iso-rad-${tone})`} />
      <polygon points={toPoints(52, 23, 0)} fill="url(#iso-plate)" stroke={hexA(t.line, 0.4)} strokeWidth={0.7} />
      <path d="M -26 -60 L 0 -46 L 0 -18 L -26 -32 Z" fill={hexA(t.deep, 0.98)} stroke={hexA(t.line, 0.45)} strokeWidth={0.7} />
      <path d="M 26 -60 L 0 -46 L 0 -18 L 26 -32 Z" fill={`url(#iso-alt-${tone})`} stroke={hexA(t.line, 0.65)} strokeWidth={0.8} />
      <path d="M 0 -74 L -26 -60 L 0 -46 L 26 -60 Z" fill={`url(#iso-face-${tone})`} stroke={hexA(t.line, 0.85)} strokeWidth={0.8} />
      <path d="M -20 -58 L 0 -67 L 20 -58" fill="none" stroke={hexA(t.bright, 0.35)} strokeWidth={0.7} />
      <path d="M -18 -47 L 0 -38 M -18 -41 L 0 -32" stroke={hexA(t.line, 0.28)} strokeWidth={0.8} />
      <g fill={t.bright}>
        <rect x={9} y={-53} width={4} height={4} rx={0.7} opacity={0.95} transform="skewY(26)" />
        <rect x={16} y={-49} width={4} height={4} rx={0.7} opacity={0.7} transform="skewY(26)" />
        <rect x={9} y={-44} width={4} height={4} rx={0.7} opacity={0.55} transform="skewY(26)" />
        <circle cx={17} cy={-58} r={1.2} />
        <circle cx={22} cy={-55} r={1.2} />
      </g>
      <path d="M -26 -32 L 0 -18 L 26 -32" fill="none" stroke={hexA(t.line, 0.35)} strokeWidth={0.8} />
    </g>
  )
}

function Shield({ tone }: GlyphProps) {
  const t = TONES[tone]
  const right: Tone = tone === 'gold' ? 'teal' : 'gold'
  const r = TONES[right]
  const shield = 'M 0 -90 C -19 -83 -32 -74 -35 -61 L -35 -45 C -35 -23 -19 -7 0 6 C 19 -7 35 -23 35 -45 L 35 -61 C 32 -74 19 -83 0 -90 Z'
  const rightHalf = 'M 0 -90 C 19 -83 32 -74 35 -61 L 35 -45 C 35 -23 19 -7 0 6 Z'
  return (
    <g>
      <ellipse cx={0} cy={-44} rx={46} ry={25} fill={`url(#iso-rad-${tone})`} />
      <polygon points={toPoints(48, 22, 0)} fill="url(#iso-plate)" stroke={hexA(t.line, 0.4)} strokeWidth={0.7} />
      <path d={shield} transform="translate(0 4)" fill="#050b12" stroke={hexA(r.line, 0.3)} strokeWidth={1} opacity={0.95} />
      <path d={shield} fill={`url(#iso-face-${tone})`} stroke={hexA(t.line, 0.85)} strokeWidth={1.2} />
      <path d={rightHalf} fill={`url(#iso-face-${right})`} stroke={hexA(r.line, 0.55)} strokeWidth={0.8} opacity={0.92} />
      <path d={shield} fill="none" stroke={hexA(t.bright, 0.5)} strokeWidth={0.8} transform="scale(0.82) translate(0 -7)" />
      <path d="M 0 -84 L 0 2" stroke={hexA(r.bright, 0.4)} strokeWidth={0.8} />
      <path d="M -20 -34 L -8 -26 L -20 -18 M 20 -34 L 8 -26 L 20 -18" fill="none" stroke={hexA(r.bright, 0.28)} strokeWidth={0.8} />
      <ellipse cx={0} cy={-52} rx={30} ry={30} fill={`url(#iso-core-${tone})`} opacity={0.35} />
      <circle cx={0} cy={-52} r={2.4} fill={t.bright} opacity={0.9} />
    </g>
  )
}

function Cylinders({ tone }: GlyphProps) {
  const t = TONES[tone]
  const drums = [
    { y: -42, rx: 25, h: 18 },
    { y: -63, rx: 23, h: 16 },
    { y: -82, rx: 21, h: 15 },
  ]
  return (
    <g>
      <ellipse cx={0} cy={-34} rx={42} ry={20} fill={`url(#iso-rad-${tone})`} />
      <polygon points={toPoints(50, 22, 0)} fill="url(#iso-plate)" stroke={hexA(t.line, 0.4)} strokeWidth={0.7} />
      {[...drums].reverse().map((d, i) => (
        <g key={i}>
          <path
            d={`M ${-d.rx} ${d.y} L ${-d.rx} ${d.y + d.h} A ${d.rx} ${d.rx * 0.34} 0 0 0 ${d.rx} ${d.y + d.h} L ${d.rx} ${d.y} Z`}
            fill={`url(#iso-alt-${tone})`}
            stroke={hexA(t.line, 0.4)}
            strokeWidth={0.7}
          />
          <ellipse cx={0} cy={d.y} rx={d.rx} ry={d.rx * 0.34} fill={`url(#iso-face-${tone})`} stroke={hexA(t.line, 0.85)} strokeWidth={0.8} />
          <ellipse cx={0} cy={d.y} rx={d.rx * 0.72} ry={d.rx * 0.24} fill={hexA(t.deep, 0.55)} stroke={hexA(t.bright, 0.25)} strokeWidth={0.6} />
          <path d={`M ${-d.rx} ${d.y + d.h * 0.55} A ${d.rx} ${d.rx * 0.34} 0 0 0 ${d.rx} ${d.y + d.h * 0.55}`} fill="none" stroke={hexA(t.line, 0.22)} strokeWidth={0.7} />
        </g>
      ))}
      <circle cx={0} cy={-81} r={2} fill={t.bright} />
      <circle cx={-12} cy={-80} r={1.2} fill={t.line} opacity={0.7} />
    </g>
  )
}

function Globe({ tone }: GlyphProps) {
  const t = TONES[tone]
  return (
    <g>
      <ellipse cx={0} cy={-30} rx={44} ry={20} fill={`url(#iso-rad-${tone})`} />
      <polygon points={toPoints(48, 22, 0)} fill="url(#iso-plate)" stroke={hexA(t.line, 0.4)} strokeWidth={0.7} />
      <path d="M -10 -28 L 0 -33 L 10 -28 L 0 -23 Z" fill={hexA(t.deep, 0.9)} stroke={hexA(t.line, 0.4)} strokeWidth={0.6} />
      <circle cx={0} cy={-64} r={33} fill="url(#iso-hub-fill)" stroke={hexA(t.line, 0.5)} strokeWidth={0.9} />
      <g fill="none" stroke={hexA(t.line, 0.38)} strokeWidth={0.65}>
        <ellipse cx={0} cy={-64} rx={11} ry={33} />
        <ellipse cx={0} cy={-64} rx={22} ry={33} />
        <ellipse cx={0} cy={-64} rx={33} ry={9} />
        <ellipse cx={0} cy={-64} rx={31} ry={19} transform="translate(0 0)" opacity={0.6} />
        <path d="M -32 -76 Q 0 -90 32 -76" opacity={0.7} />
        <path d="M -32 -52 Q 0 -38 32 -52" opacity={0.7} />
      </g>
      <g transform="translate(0 -64) rotate(-16)">
        <ellipse rx={48} ry={12} fill="none" stroke={hexA(t.bright, 0.32)} strokeWidth={0.8} strokeDasharray="3 4" />
        <circle cx={46} cy={0} r={1.8} fill={t.bright} />
        <circle cx={-46} cy={0} r={1.2} fill={t.line} opacity={0.7} />
      </g>
      <circle cx={0} cy={-64} r={34} fill={`url(#iso-core-${tone})`} opacity={0.22} />
    </g>
  )
}

function Glass({ tone }: GlyphProps) {
  const t = TONES[tone]
  return (
    <g>
      <ellipse cx={0} cy={-36} rx={44} ry={21} fill={`url(#iso-rad-${tone})`} />
      <polygon points={toPoints(50, 22, 0)} fill="url(#iso-plate)" stroke={hexA(t.line, 0.4)} strokeWidth={0.7} />
      <g opacity={0.92}>
        <path d="M 0 -76 L -30 -59 L 0 -42 L 30 -59 Z" fill={hexA(t.line, 0.09)} stroke={hexA(t.line, 0.55)} strokeWidth={0.8} />
        <path d="M -30 -59 L 0 -42 L 0 -14 L -30 -31 Z" fill={hexA(t.line, 0.045)} stroke={hexA(t.line, 0.4)} strokeWidth={0.7} />
        <path d="M 30 -59 L 0 -42 L 0 -14 L 30 -31 Z" fill={hexA(t.line, 0.075)} stroke={hexA(t.line, 0.48)} strokeWidth={0.7} />
        <path d="M -30 -31 L 0 -14 L 30 -31" fill="none" stroke={hexA(t.line, 0.32)} strokeWidth={0.7} />
        <path d="M -30 -59 L -30 -31 M 30 -59 L 30 -31 M 0 -42 L 0 -14" stroke={hexA(t.bright, 0.22)} strokeWidth={0.6} />
      </g>
      <path d="M 0 -60 L -14 -52 L 0 -44 L 14 -52 Z" fill={t.bright} opacity={0.95} />
      <path d="M -14 -52 L 0 -44 L 0 -32 L -14 -40 Z" fill={hexA(t.deep, 0.9)} />
      <path d="M 14 -52 L 0 -44 L 0 -32 L 14 -40 Z" fill={hexA(t.base, 0.8)} />
      <path d="M 0 -60 L -14 -52 L 0 -44 L 14 -52 Z" fill="none" stroke={t.bright} strokeWidth={0.8} />
      <ellipse cx={0} cy={-48} rx={20} ry={18} fill={`url(#iso-core-${tone})`} opacity={0.65} />
      <circle cx={0} cy={-48} r={1.4} fill="#ffffff" />
    </g>
  )
}

function Cloud({ tone }: GlyphProps) {
  const t = TONES[tone]
  const body =
    'M -40 -56 C -40 -70 -26 -76 -16 -69 C -13 -84 9 -88 17 -74 C 30 -83 45 -72 42 -58 C 54 -53 52 -39 40 -38 L -32 -38 C -44 -40 -48 -51 -40 -56 Z'
  return (
    <g>
      <ellipse cx={0} cy={-30} rx={46} ry={22} fill={`url(#iso-rad-${tone})`} />
      <path d={body} transform="translate(0 5)" fill="#050b13" stroke={hexA(t.line, 0.25)} strokeWidth={0.8} />
      <path d={body} fill={`url(#iso-alt-${tone})`} stroke={hexA(t.line, 0.7)} strokeWidth={0.9} />
      <path d="M -34 -64 C -28 -73 -17 -73 -12 -66 C -8 -76 8 -79 14 -68 C 25 -74 34 -67 33 -59" fill="none" stroke={hexA(t.bright, 0.38)} strokeWidth={0.8} />
      <g stroke={hexA(t.line, 0.28)} strokeWidth={0.6}>
        <path d="M -22 -54 L -4 -62 L 16 -56 L 26 -46 M -4 -62 L 2 -46 L 16 -56" fill="none" />
      </g>
      <g fill={t.bright}>
        <circle cx={-22} cy={-54} r={1.4} />
        <circle cx={-4} cy={-62} r={1.9} />
        <circle cx={16} cy={-56} r={1.5} />
        <circle cx={2} cy={-46} r={1.3} opacity={0.8} />
        <circle cx={26} cy={-46} r={1.2} opacity={0.7} />
      </g>
      <polygon points={toPoints(44, 20, 0)} fill="url(#iso-plate)" stroke={hexA(t.line, 0.35)} strokeWidth={0.7} opacity={0.8} />
    </g>
  )
}

function Lock({ tone }: GlyphProps) {
  const t = TONES[tone]
  return (
    <g>
      <ellipse cx={0} cy={-30} rx={38} ry={18} fill={`url(#iso-rad-${tone})`} />
      <polygon points={toPoints(44, 20, 0)} fill="url(#iso-plate)" stroke={hexA(t.line, 0.4)} strokeWidth={0.7} />
      <path
        d="M -17 -64 L -17 -76 C -17 -91 17 -91 17 -76 L 17 -64"
        fill="none"
        stroke={hexA(t.deep, 1)}
        strokeWidth={8}
        strokeLinecap="round"
      />
      <path
        d="M -17 -64 L -17 -76 C -17 -89 17 -89 17 -76 L 17 -64"
        fill="none"
        stroke={`url(#iso-face-${tone})`}
        strokeWidth={4.5}
        strokeLinecap="round"
      />
      <path
        d="M -15 -72 C -15 -82 15 -82 15 -72"
        fill="none"
        stroke={hexA(t.bright, 0.7)}
        strokeWidth={1}
      />
      <path d="M -25 -66 L 0 -54 L 25 -66 L 25 -24 L 0 -12 L -25 -24 Z" fill={`url(#iso-face-${tone})`} stroke={hexA(t.line, 0.85)} strokeWidth={1} />
      <path d="M 0 -54 L 25 -66 L 25 -24 L 0 -12 Z" fill={hexA(t.deep, 0.32)} />
      <path d="M -25 -66 L 0 -54 L 0 -12" fill="none" stroke={hexA(t.bright, 0.28)} strokeWidth={0.8} />
      <circle cx={0} cy={-42} r={4.2} fill={hexA(t.deep, 0.92)} stroke={t.bright} strokeWidth={0.9} />
      <path d="M 0 -38 L 0 -28" stroke={t.bright} strokeWidth={2.4} strokeLinecap="round" />
      <path d="M -18 -24 L 0 -16 L 18 -24" fill="none" stroke={hexA(t.line, 0.35)} strokeWidth={0.7} />
    </g>
  )
}

function Monitor({ tone }: GlyphProps) {
  const t = TONES[tone]
  return (
    <g>
      <ellipse cx={0} cy={-30} rx={42} ry={20} fill={`url(#iso-rad-${tone})`} />
      <polygon points={toPoints(50, 22, 0)} fill="url(#iso-plate)" stroke={hexA(t.line, 0.4)} strokeWidth={0.7} />
      <path d="M -8 -34 L 8 -34 L 13 -20 L -13 -20 Z" fill={hexA(t.deep, 0.95)} stroke={hexA(t.line, 0.4)} strokeWidth={0.7} />
      <rect x={-34} y={-88} width={68} height={50} rx={6} fill="#071019" stroke={hexA(t.line, 0.6)} strokeWidth={1.1} />
      <rect x={-28} y={-82} width={56} height={38} rx={3} fill={hexA(t.deep, 0.55)} stroke={hexA(t.line, 0.3)} strokeWidth={0.6} />
      <rect x={-28} y={-82} width={56} height={38} rx={3} fill={`url(#iso-core-${tone})`} opacity={0.4} />
      <g stroke={hexA(t.bright, 0.6)} strokeWidth={1.1} fill="none">
        <path d="M -22 -70 L -14 -74 L -6 -68 L 2 -76 L 10 -71 L 22 -78" />
      </g>
      <g stroke={hexA(t.line, 0.25)} strokeWidth={0.6}>
        <path d="M -22 -77 L 22 -77 M -22 -70 L 22 -70 M -22 -63 L 22 -63 M -22 -56 L 22 -56" />
      </g>
      <g fill={t.line}>
        <rect x={-20} y={-51} width={12} height={2} rx={1} opacity={0.8} />
        <rect x={-5} y={-51} width={7} height={2} rx={1} opacity={0.5} />
        <circle cx={22} cy={-55} r={1.2} />
      </g>
      <rect x={-36} y={-34} width={72} height={5} rx={2} fill={hexA(t.line, 0.18)} />
    </g>
  )
}

function Beacon({ tone }: GlyphProps) {
  const t = TONES[tone]
  return (
    <g>
      <ellipse cx={0} cy={-24} rx={34} ry={16} fill={`url(#iso-rad-${tone})`} />
      <polygon points={toPoints(42, 19, 0)} fill="url(#iso-plate)" stroke={hexA(t.line, 0.4)} strokeWidth={0.7} />
      <ellipse cx={0} cy={-20} rx={22} ry={9} fill="none" stroke={hexA(t.line, 0.35)} strokeWidth={0.7} />
      <ellipse cx={0} cy={-20} rx={13} ry={5} fill={`url(#iso-core-${tone})`} />
      <path d="M 0 -22 L 0 -70" stroke={hexA(t.line, 0.5)} strokeWidth={1.2} strokeDasharray="2 3" />
      <path d="M 0 -22 L 0 -70" stroke={hexA(t.bright, 0.25)} strokeWidth={4} strokeLinecap="round" />
      <path d="M 0 -82 L 9 -71 L 0 -60 L -9 -71 Z" fill={`url(#iso-face-${tone})`} stroke={hexA(t.line, 0.9)} strokeWidth={0.9} />
      <path d="M 0 -82 L 0 -60" stroke={hexA(t.bright, 0.7)} strokeWidth={0.7} />
      <circle cx={0} cy={-71} r={12} fill={`url(#iso-core-${tone})`} opacity={0.8} />
    </g>
  )
}

export function AssetGlyph({ glyph, tone }: { glyph: Glyph; tone: Tone }) {
  switch (glyph) {
    case 'crystal':
      return <Crystal tone={tone} />
    case 'server':
      return <Server tone={tone} />
    case 'shield':
      return <Shield tone={tone} />
    case 'cylinders':
      return <Cylinders tone={tone} />
    case 'globe':
      return <Globe tone={tone} />
    case 'glass':
      return <Glass tone={tone} />
    case 'cloud':
      return <Cloud tone={tone} />
    case 'lock':
      return <Lock tone={tone} />
    case 'monitor':
      return <Monitor tone={tone} />
    case 'beacon':
      return <Beacon tone={tone} />
    default:
      return null
  }
}

export function HubCore() {
  const t = TONES.teal
  return (
    <g>
      <ellipse cx={0} cy={10} rx={290} ry={132} fill="url(#iso-hub-floor)" />
      <ellipse cx={0} cy={0} rx={214} ry={96} fill="none" stroke={hexA(t.line, 0.1)} strokeWidth={0.8} strokeDasharray="2 10" />
      <ellipse cx={0} cy={0} rx={168} ry={74} fill="none" stroke={hexA(t.line, 0.14)} strokeWidth={0.8} strokeDasharray="1 7" />
      <ellipse cx={0} cy={0} rx={126} ry={55} fill="none" stroke={hexA(t.line, 0.2)} strokeWidth={0.9} strokeDasharray="2 6" />
      <g className="iso-orbit-spin">
        <ellipse cx={0} cy={-58} rx={148} ry={50} fill="none" stroke={hexA(t.line, 0.2)} strokeWidth={0.8} strokeDasharray="4 10" />
        <circle cx={148} cy={-58} r={2.2} fill={t.bright} />
        <circle cx={-148} cy={-58} r={1.4} fill={t.line} opacity={0.7} />
      </g>
      <g className="iso-orbit-spin-rev">
        <ellipse cx={0} cy={-58} rx={118} ry={40} fill="none" stroke={hexA(t.line, 0.14)} strokeWidth={0.7} strokeDasharray="1 7" />
      </g>
      <ellipse className="iso-core-pulse" cx={0} cy={0} rx={140} ry={60} fill="none" stroke={hexA(t.line, 0.4)} strokeWidth={0.8} />
      <ellipse className="iso-core-pulse iso-core-pulse-2" cx={0} cy={0} rx={100} ry={42} fill="none" stroke={hexA(t.line, 0.5)} strokeWidth={0.9} />
      <circle cx={0} cy={-58} r={84} fill="url(#iso-hub-fill)" stroke={hexA(t.line, 0.2)} strokeWidth={0.9} />
      <g fill="none" stroke={hexA(t.line, 0.18)} strokeWidth={0.6}>
        <ellipse cx={0} cy={-58} rx={28} ry={84} />
        <ellipse cx={0} cy={-58} rx={56} ry={84} />
        <ellipse cx={0} cy={-58} rx={84} ry={84} />
        <ellipse cx={0} cy={-58} rx={83} ry={22} />
        <ellipse cx={0} cy={-58} rx={78} ry={46} />
        <ellipse cx={0} cy={-58} rx={64} ry={66} />
        <path d="M -82 -58 Q 0 -100 82 -58 Q 0 -16 -82 -58" opacity={0.6} />
      </g>
      <path d="M -84 -58 Q 0 -120 84 -58" fill="none" stroke={hexA(t.line, 0.25)} strokeWidth={0.8} strokeDasharray="3 8" />
      <rect x={-3} y={-170} width={6} height={120} fill="url(#iso-beam)" opacity={0.55} />
      <IsoPlatform width={172} tone="teal" active bare />
      <path d="M 0 -176 L -42 -114 L 0 -92 Z" fill={hexA(t.deep, 0.92)} stroke={hexA(t.line, 0.6)} strokeWidth={0.9} />
      <path d="M 0 -176 L 42 -114 L 0 -92 Z" fill={`url(#iso-face-${'teal'})`} stroke={hexA(t.bright, 0.85)} strokeWidth={1.1} />
      <path d="M -42 -114 L 0 -92 L 0 -76 L -30 -88 Z" fill={hexA(t.deep, 0.9)} stroke={hexA(t.line, 0.4)} strokeWidth={0.7} />
      <path d="M 42 -114 L 0 -92 L 0 -76 L 30 -88 Z" fill={hexA(t.base, 0.5)} stroke={hexA(t.line, 0.55)} strokeWidth={0.7} />
      <path d="M -42 -114 L 0 -136 L 42 -114" fill="none" stroke={hexA(t.bright, 0.5)} strokeWidth={0.9} />
      <path d="M 0 -176 L 0 -78" stroke={hexA(t.bright, 0.85)} strokeWidth={1.4} />
      <path d="M 0 -124 L 14 -108 L 0 -90 L -14 -108 Z" fill={t.bright} opacity={0.95} />
      <circle cx={0} cy={-108} r={22} fill={`url(#iso-core-${'teal'})`} opacity={0.75} />
      <text x={0} y={-196} textAnchor="middle" className="iso-core-label">
        AEGIS
      </text>
    </g>
  )
}

const HAZARD: Record<RiskLevel, { line: string; bright: string; base: string; dark: string }> = {
  CRITICAL: { line: '#ff6b78', bright: '#ffd6da', base: '#e5484d', dark: '#2a090d' },
  HIGH: { line: '#ffb05c', bright: '#ffe3bf', base: '#e08a2f', dark: '#2a1807' },
  MEDIUM: { line: '#ffe066', bright: '#fff6c4', base: '#e6c229', dark: '#262105' },
  LOW: { line: '#63d99a', bright: '#d3ffe5', base: '#3fae74', dark: '#0a2417' },
}

export function HazardMarker({
  level,
  suppressed,
  active = false,
}: {
  level: RiskLevel
  suppressed?: boolean
  active?: boolean
}) {
  const c = HAZARD[level]
  if (suppressed) {
    return (
      <g>
        <ellipse cx={0} cy={4} rx={20} ry={8} fill="rgba(4,10,16,.7)" />
        <polygon points="0,-2 16,6 0,14 -16,6" fill="#0a121b" stroke="rgba(124,145,168,.5)" strokeWidth={0.9} />
        <circle cx={0} cy={-20} r={9.5} fill="rgba(8,14,22,.9)" stroke="rgba(124,145,168,.75)" strokeWidth={1.1} strokeDasharray="2.5 2.5" />
        <path d="M -6 -26 L 6 -14" stroke="rgba(170,190,210,.8)" strokeWidth={1.2} />
        <path d="M 0 -2 L 0 -9" stroke="rgba(124,145,168,.35)" strokeWidth={0.8} />
      </g>
    )
  }
  if (level === 'MEDIUM' || level === 'LOW') {
    return (
      <g>
        <ellipse cx={0} cy={4} rx={22} ry={9} fill={`url(#iso-rad-${level === 'LOW' ? 'teal' : 'gold'})`} opacity={0.6} />
        <polygon points="0,-2 16,6 0,14 -16,6" fill="#071018" stroke={hexA(c.line, 0.55)} strokeWidth={0.8} />
        <path d="M 0 -30 L 9 -21 L 0 -12 L -9 -21 Z" fill={c.base} stroke={c.bright} strokeWidth={0.9} opacity={0.96} />
        <path d="M 0 -30 L 0 -12 M -9 -21 L 0 -16 L 9 -21" fill="none" stroke={c.bright} strokeWidth={0.6} opacity={0.75} />
        <circle className="iso-warn-pulse" cx={0} cy={-21} r={14} fill="none" stroke={c.line} strokeWidth={0.8} opacity={0.35} />
      </g>
    )
  }
  return (
    <g>
      <ellipse cx={0} cy={7} rx={26} ry={11} fill={`url(#iso-rad-${level === 'HIGH' ? 'gold' : 'teal'})`} opacity={0.8} />
      <ellipse className="iso-warn-pulse" cx={0} cy={-20} r={active ? 22 : 18} fill="none" stroke={c.line} strokeWidth={1} opacity={0.4} />
      <polygon points="0,-2 17,6 0,15 -17,6" fill="#0a1119" stroke={hexA(c.line, 0.65)} strokeWidth={0.9} />
      <path d="M 0 -2 L 0 -10" stroke={hexA(c.line, 0.5)} strokeWidth={0.9} />
      <path
        d="M 0 -35 L 10 -17 Q 11.5 -13 7.5 -13 L -7.5 -13 Q -11.5 -13 -10 -17 Z"
        fill={c.dark}
        stroke={c.line}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      <path d="M 0 -33 L 7.5 -18 Q 8 -16 6 -16 L -6 -16 Q -8 -16 -7.5 -18 Z" fill={c.base} opacity={0.38} />
      <text x={0} y={-19} textAnchor="middle" className="iso-warn-glyph" fill={c.bright}>
        !
      </text>
      <circle cx={0} cy={-20} r={17} fill={`url(#iso-red-glow)`} opacity={0.32} />
    </g>
  )
}
