import { useId, type CSSProperties, type ReactNode } from 'react'

/**
 * Engraved still-life plates in place of photography — the reference deck uses
 * studio portraits on a warm greige ground; these carry the same slots.
 */

function Plate({
  children,
  ratio = '3 / 4',
  viewBox = '0 0 300 400',
  tone = 'warm',
  className,
}: {
  children: ReactNode
  ratio?: string
  viewBox?: string
  tone?: 'warm' | 'cool'
  className?: string
}) {
  const uid = useId().replace(/:/g, '')
  const bg = `bg-${uid}`
  const grain = `grain-${uid}`
  const vig = `vig-${uid}`
  const stops =
    tone === 'warm'
      ? ['#e3dbd0', '#cfc5b8', '#a89e93']
      : ['#dfe4e6', '#c2ccd1', '#93a0a7']

  return (
    <svg
      className={className}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid slice"
      style={{ aspectRatio: ratio, width: '100%', display: 'block' }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={stops[0]} />
          <stop offset="0.55" stopColor={stops[1]} />
          <stop offset="1" stopColor={stops[2]} />
        </linearGradient>
        <radialGradient id={vig} cx="0.42" cy="0.34" r="0.86">
          <stop offset="0.5" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#241d16" stopOpacity="0.42" />
        </radialGradient>
        <filter id={grain}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${bg})`} />
      {children}
      <rect width="100%" height="100%" fill={`url(#${vig})`} />
      <rect width="100%" height="100%" filter={`url(#${grain})`} opacity="0.13" />
    </svg>
  )
}

const INK = '#2a2520'
const SHADOW = 'rgba(38,31,24,0.22)'

export function BellPlate({ className, ratio }: { className?: string; ratio?: string }) {
  return (
    <Plate className={className} ratio={ratio}>
      <>
        <g>
          <ellipse cx="150" cy="300" rx="96" ry="14" fill={SHADOW} />
          <line x1="52" y1="300" x2="248" y2="300" stroke={INK} strokeWidth="1" opacity="0.5" />
          <path
            d="M150 138c-40 0-64 30-64 74v40h128v-40c0-44-24-74-64-74z"
            fill="#efe7db"
            stroke={INK}
            strokeWidth="1.6"
          />
          <path d="M150 138c-40 0-64 30-64 74v10h128v-10c0-44-24-74-64-74z" fill="#d8cdbc" opacity="0.75" />
          <rect x="80" y="250" width="140" height="14" rx="4" fill="#cbbfa9" stroke={INK} strokeWidth="1.4" />
          <path d="M150 138v-22" stroke={INK} strokeWidth="2" />
          <path d="M138 104a12 12 0 1 1 24 0v12h-24z" fill="none" stroke={INK} strokeWidth="1.8" />
          <circle cx="150" cy="276" r="8" fill="#b9a888" stroke={INK} strokeWidth="1.3" />
          <path d="M104 178c8-18 24-30 40-34" stroke="#fff" strokeWidth="3" opacity="0.5" strokeLinecap="round" />
        </g>
      </>
    </Plate>
  )
}

export function RackPlate({ className, ratio }: { className?: string; ratio?: string }) {
  return (
    <Plate className={className} ratio={ratio}>
      <>
        <g>
          <ellipse cx="150" cy="306" rx="112" ry="13" fill={SHADOW} />
          <line x1="40" y1="306" x2="260" y2="306" stroke={INK} strokeWidth="1" opacity="0.5" />
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const x = 54 + i * 34
            const h = 150 + [0, 8, 4, 12, 6, 0][i]
            const lit = i === 5
            return (
              <g key={x}>
                <rect x={x} y={306 - h} width="24" height={h} rx="3" fill={lit ? '#3a332c' : '#eae2d6'} stroke={INK} strokeWidth="1.2" />
                <rect x={x + 4} y={306 - h + 10} width="16" height="3" rx="1.5" fill={lit ? '#f0a94a' : 'rgba(42,37,32,0.35)'} />
                <rect x={x + 4} y={306 - h + 20} width="16" height="3" rx="1.5" fill={lit ? '#f0a94a' : 'rgba(42,37,32,0.2)'} />
                <rect x={x + 4} y={306 - h + 30} width="10" height="3" rx="1.5" fill="rgba(42,37,32,0.18)" />
              </g>
            )
          })}
        </g>
      </>
    </Plate>
  )
}



export function ShieldPlate({ className, ratio }: { className?: string; ratio?: string }) {
  return (
    <Plate className={className} ratio={ratio} tone="cool">
      <>
        <g>
          <ellipse cx="150" cy="306" rx="90" ry="12" fill="rgba(20,30,34,0.26)" />
          <path
            d="M150 112l74 28v66c0 46-32 82-74 100-42-18-74-54-74-100v-66z"
            fill="rgba(240,246,247,0.5)"
            stroke={INK}
            strokeWidth="1.6"
          />
          <path
            d="M150 150l44 16v40c0 27-19 49-44 60-25-11-44-33-44-60v-40z"
            fill="none"
            stroke={INK}
            strokeWidth="1.3"
            opacity="0.7"
          />
          <line x1="150" y1="196" x2="150" y2="240" stroke={INK} strokeWidth="1.6" />
          <circle cx="150" cy="186" r="6" fill="#53e3cb" opacity="0.85" />
        </g>
      </>
    </Plate>
  )
}


/** A dial, not a scale — the scoring surface is a metric, not a judgement call. */
export function GaugePlate({ className, ratio }: { className?: string; ratio?: string }) {
  return (
    <Plate className={className} ratio={ratio}>
      <ellipse cx="150" cy="300" rx="98" ry="13" fill={SHADOW} />
      <line x1="48" y1="300" x2="252" y2="300" stroke={INK} strokeWidth="1" opacity="0.5" />
      <path d="M62 250a88 88 0 0 1 176 0z" fill="#efe7db" stroke={INK} strokeWidth="1.6" />
      <path d="M78 250a72 72 0 0 1 144 0" fill="none" stroke="rgba(42,37,32,0.35)" strokeWidth="1.2" strokeDasharray="3 9" />
      <path d="M150 250l46-52" stroke="#c0492f" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="150" cy="250" r="9" fill="#3a332c" stroke={INK} strokeWidth="1.4" />
      <path d="M96 236a58 58 0 0 1 34-30" stroke="#53e3cb" strokeWidth="3" strokeLinecap="round" opacity="0.85" fill="none" />
      <path d="M186 206a58 58 0 0 1 18 30" stroke="#f0a94a" strokeWidth="3" strokeLinecap="round" opacity="0.9" fill="none" />
      <rect x="96" y="266" width="108" height="22" rx="4" fill="#dcd2c2" stroke={INK} strokeWidth="1.2" />
      <path d="M112 277h30M152 277h14M172 277h20" stroke="rgba(42,37,32,0.45)" strokeWidth="2" strokeLinecap="round" />
    </Plate>
  )
}

/** Copilot surface: a terminal with a caret and a cited line. */
export function TerminalPlate({ className, ratio }: { className?: string; ratio?: string }) {
  return (
    <Plate className={className} ratio={ratio}>
      <ellipse cx="150" cy="298" rx="104" ry="13" fill={SHADOW} />
      <line x1="42" y1="298" x2="258" y2="298" stroke={INK} strokeWidth="1" opacity="0.5" />
      <rect x="52" y="116" width="196" height="140" rx="7" fill="#141a1d" stroke={INK} strokeWidth="1.6" />
      <rect x="62" y="126" width="176" height="120" rx="4" fill="#0b1114" />
      <path d="M74 148h96M74 164h72M74 180h110" stroke="rgba(83,227,203,0.62)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M74 198h44" stroke="rgba(240,169,74,0.8)" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="124" y="193" width="9" height="12" fill="#f0a94a" opacity="0.9" />
      <path d="M150 256v18M120 274h60" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M196 92c14 0 24 9 24 20s-10 20-24 20c-3 0-6 4-9 8-2-5-4-8-9-9-11-3-18-11-18-19 0-11 11-20 24-20z" fill="#efe7db" stroke={INK} strokeWidth="1.3" />
    </Plate>
  )
}

/** The reference draws a single thin blue line scribbled across the About spread. */
export function Scribble({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 900 520" fill="none" aria-hidden="true">
      <path
        d="M188 34C214 96 262 168 320 226c58 58 128 96 196 104 62 7 118-16 150-58 30-40 34-92 8-128-28-38-82-50-128-30-46 20-70 68-58 112 12 42 52 70 96 68 40-2 72-28 78-62"
        stroke="#4c8fd6"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.72"
      />
      <path d="M188 34l-16-22M188 34l26-12" stroke="#4c8fd6" strokeWidth="1.4" strokeLinecap="round" opacity="0.72" />
    </svg>
  )
}

/** Thin line-art marks used beside a capability card. */
export type GlyphKind = 'shield' | 'radar' | 'key' | 'packet' | 'bug'

export function Glyph({
  kind,
  className,
  style,
}: {
  kind: GlyphKind
  className?: string
  style?: CSSProperties
}) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const }
  return (
    <svg className={className} style={style} viewBox="0 0 100 100" aria-hidden="true">
      {kind === 'shield' && (
        <>
          <path d="M50 12l30 11v26c0 19-13 33-30 40-17-7-30-21-30-40V23z" {...common} />
          <path d="M50 30l14 5v13c0 9-6 15-14 19-8-4-14-10-14-19V35z" {...common} opacity="0.6" />
        </>
      )}
      {kind === 'radar' && (
        <>
          <circle cx="50" cy="50" r="34" {...common} />
          <circle cx="50" cy="50" r="18" {...common} opacity="0.55" />
          <path d="M50 50 78 26" {...common} />
          <circle cx="64" cy="40" r="3" fill="currentColor" stroke="none" opacity="0.8" />
        </>
      )}
      {kind === 'key' && (
        <>
          <circle cx="34" cy="34" r="16" {...common} />
          <path d="M45 45l34 34M66 66l10-10M74 74l8-8" {...common} />
        </>
      )}
      {kind === 'packet' && (
        <>
          <path d="M50 16l30 16v36L50 84 20 68V32z" {...common} />
          <path d="M20 32l30 16 30-16M50 48v36" {...common} opacity="0.6" />
        </>
      )}
      {kind === 'bug' && (
        <>
          <ellipse cx="50" cy="56" rx="20" ry="26" {...common} />
          <path d="M50 32v48M30 44l-14-8M70 44l14-8M30 62l-16 6M70 62l16 6M34 30l-8-12M66 30l8-12" {...common} />
          <circle cx="50" cy="26" r="8" {...common} />
        </>
      )}
    </svg>
  )
}

/** The small landscape plate set inside the About headline. */
export function ConsolePlate({ className }: { className?: string }) {
  return (
    <Plate className={className} ratio="16 / 9" viewBox="0 0 480 270">
      <ellipse cx="240" cy="214" rx="150" ry="10" fill={SHADOW} />
      <line x1="70" y1="214" x2="410" y2="214" stroke={INK} strokeWidth="1" opacity="0.5" />
      <rect x="150" y="62" width="180" height="118" rx="5" fill="#1b1e24" stroke={INK} strokeWidth="1.6" />
      <rect x="158" y="70" width="164" height="102" rx="3" fill="#0d1216" />
      <path d="M164 96h152M164 118h120M164 140h134" stroke="rgba(83,227,203,0.5)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="298" cy="146" r="7" fill="none" stroke="#f0a94a" strokeWidth="2" />
      <path d="M240 180v16M214 196h52" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <rect x="60" y="150" width="66" height="60" rx="3" fill="#efe7db" stroke={INK} strokeWidth="1.3" transform="rotate(-7 93 180)" />
      <rect x="360" y="158" width="58" height="52" rx="3" fill="#e6dccd" stroke={INK} strokeWidth="1.3" transform="rotate(6 389 184)" />
    </Plate>
  )
}
