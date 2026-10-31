import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { activeAlerts, assets, counts, suppressedAlerts } from '../data/seed'
import type { Alert } from '../lib/types'
import './AegisLanding.css'

const QUERIES = [
  'Which CVEs can actually reach our estate?',
  'Show Log4j 2.14.1 on the payroll gateway and rank the exposure.',
  'Why did CVE-2023-44487 score 0.0 on the edge host?',
  'List every CISA KEV entry whose fix we have not shipped.',
]

const FEATURES = ['NVD · KEV · EPSS INGEST', 'VERSION RELEVANCE GATE', 'DETERMINISTIC 0–100 SCORE', 'AND MUCH MORE']

const NAV_LINKS = [
  { label: 'Mechanism', href: '#ag-gate' },
  { label: 'Console', href: '#ag-console' },
  { label: 'Signals', href: '#ag-signals' },
  { label: 'Estate', href: '#ag-console' },
]

const RAIL_DOTS = 14
const SECTIONS = ['GATE', 'CONSOLE', 'SIGNALS']
/** Dot pitch is 13px; each label parks beside the middle dot of its section. */
const RAIL_LABEL_Y = [22, 87, 145]

const LEVEL_COLOR: Record<string, string> = {
  CRITICAL: '#e5545a',
  HIGH: '#e08a2f',
  MEDIUM: '#e6c229',
  LOW: '#3fae74',
}

/** The six weighted inputs behind every score, in the order the shield's bands draw them. */
const BAND_KEYS = [
  'severity_points',
  'exploit_points',
  'kev_points',
  'criticality_points',
  'exposure_points',
  'relevance_points',
] as const

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The four highest-scoring live alerts, then the two the version gate zeroes out. */
function pickSignals(): Alert[] {
  const live = [...activeAlerts].sort((a, b) => b.score - a.score).slice(0, 4)
  return [...live, ...suppressedAlerts.slice(0, 2)]
}

function ShieldMark({ level }: { level: string }) {
  const tint = level === 'SUPPRESSED' ? '#53e3cb' : (LEVEL_COLOR[level] ?? '#53e3cb')
  const id = `ag-shield-${level}`
  return (
    <svg className="ag-mark" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={tint} />
          <stop offset="100%" stopColor="#53e3cb" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="55" height="55" rx="10" fill="#0e1014" />
      <path
        d="M28 10.5 41 15.4v11.2c0 7.6-5.1 14.2-13 17.9-7.9-3.7-13-10.3-13-17.9V15.4z"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="1.6"
      />
      <path d="M22.4 27.6l4.1 4.2 8.1-9.4" fill="none" stroke={`url(#${id})`} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function DialIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M12 12V5.5M12 12l4.6 4.6" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

export default function AegisLanding() {
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [reduced] = useState(prefersReducedMotion)
  const [announceOpen, setAnnounceOpen] = useState(true)
  const [tucked, setTucked] = useState(false)
  const [section, setSection] = useState(0)
  const [rail, setRail] = useState(0)
  const [typed, setTyped] = useState(reduced ? QUERIES[0] : '')
  const [queryIndex, setQueryIndex] = useState(0)
  const [step, setStep] = useState(0)
  const [signal, setSignal] = useState(0)
  const [webgl, setWebgl] = useState<'pending' | 'ok' | 'failed'>('pending')

  const signals = useMemo(pickSignals, [])
  const modules = useMemo(
    () => [
      { name: 'Risk Dashboard', note: 'estate posture in one number' },
      { name: 'AI Analyst', note: 'plain-language verdicts' },
      { name: 'Alert Triage', note: `${counts.active} live, ${counts.suppressed} suppressed` },
      { name: 'Scoring Engine', note: 'six weighted inputs' },
      { name: 'Asset Inventory', note: `${assets.length} hosts, versions attached` },
      { name: 'CVE Explorer', note: `${counts.cves} real identifiers` },
      { name: 'Threat Intel', note: 'KEV deadlines, EPSS drift' },
      { name: 'Exposure Graph', note: 'correlation in 3D' },
      { name: 'Attack Paths', note: 'lateral reach per host' },
      { name: 'Anomaly Radar', note: 'behaviour off baseline' },
      { name: 'MITRE Mapping', note: 'techniques, not buzzwords' },
      { name: 'What-if Simulator', note: 'patch it, watch the score move' },
    ],
    [],
  )
  const readouts = useMemo(
    () =>
      signals.map((a) => {
        const weights = BAND_KEYS.map((key) => a.breakdown[key])
        const peak = Math.max(1, ...weights)
        return {
          code: a.cve.id,
          detail: `${a.cve.product} ${a.version}`,
          score: a.score,
          suppressed: a.suppressed,
          bands: weights.map((w) => w / peak),
        }
      }),
    [signals],
  )

  // Lazy so the ~1MB Three.js chunk only loads for visitors who reach the landing page.
  useEffect(() => {
    let handle: { dispose: () => void } | null = null
    let cancelled = false
    const previousBody = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#08090c'

    import('../aegis/monolith')
      .then((mod) => {
        if (cancelled || !canvasRef.current) return
        const mounted = mod.mountAegisMonolith(canvasRef.current, {
          reducedMotion: prefersReducedMotion(),
          readouts,
        })
        if (!mounted || mounted.ok === false) {
          setWebgl('failed')
          return
        }
        handle = mounted
        setWebgl('ok')
      })
      .catch(() => !cancelled && setWebgl('failed'))

    return () => {
      cancelled = true
      handle?.dispose()
      document.body.style.backgroundColor = previousBody
    }
  }, [readouts])

  useEffect(() => {
    const nodes = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('.ag-rv') ?? [])
    if (reduced) {
      nodes.forEach((node) => node.classList.add('is-in'))
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add('is-in')
          observer.unobserve(entry.target)
        })
      },
      { threshold: 0.12 },
    )
    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [reduced])

  useEffect(() => {
    let queued = 0
    const measure = () => {
      queued = 0
      const viewport = window.innerHeight
      const y = window.scrollY
      const max = Math.max(1, document.documentElement.scrollHeight - viewport)
      setTucked(y > 40)
      setSection(Math.min(2, Math.max(0, Math.round(y / viewport))))
      setRail(Math.round((Math.min(max, Math.max(0, y)) / max) * (RAIL_DOTS - 1)))
    }
    const onScroll = () => {
      if (!queued) queued = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (queued) cancelAnimationFrame(queued)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  useEffect(() => {
    if (reduced) return
    const full = QUERIES[queryIndex]
    let length = 0
    let timer = 0
    const type = () => {
      length += 1
      setTyped(full.slice(0, length))
      if (length < full.length) timer = window.setTimeout(type, 38)
      else timer = window.setTimeout(startDelete, 2600)
    }
    const startDelete = () => {
      if (length > 0) {
        length = Math.max(0, length - 2)
        setTyped(full.slice(0, length))
        timer = window.setTimeout(startDelete, 14)
        return
      }
      timer = window.setTimeout(() => setQueryIndex((i) => (i + 1) % QUERIES.length), 250)
    }
    timer = window.setTimeout(type, 38)
    return () => window.clearTimeout(timer)
  }, [queryIndex, reduced])

  useEffect(() => {
    if (reduced || section !== 1) return
    const id = window.setInterval(() => setStep((s) => (s + 1) % modules.length), 2400)
    return () => window.clearInterval(id)
  }, [reduced, section, modules.length])

  const nextQuery = QUERIES[(queryIndex + 1) % QUERIES.length]
  const current = signals[signal]
  const next = signals[(signal + 1) % signals.length]
  const go = (href: string) => (event: MouseEvent) => {
    event.preventDefault()
    document.querySelector(href)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }
  const openConsole = (event: MouseEvent) => {
    event.preventDefault()
    navigate('/login')
  }
  const delay = (d: string) => ({ '--d': d } as CSSProperties)

  return (
    <div className="ag" id="aegis-landing" ref={rootRef}>
      <canvas className="ag-canvas" ref={canvasRef} aria-hidden="true" data-state={webgl} />
      {webgl === 'failed' ? <div className="ag-pool" aria-hidden="true" /> : null}

      <div className="ag-grid" aria-hidden="true">
        <span className="ag-guide is-left" />
        <span className="ag-guide is-right" />
      </div>

      <div className={`ag-top${tucked && announceOpen ? ' is-tucked' : ''}`}>
        {announceOpen ? (
          <div className="ag-announce">
            <p>
              Live demo: {counts.cves} CVEs, {counts.total} correlated alerts, {counts.suppressed} zeroed by the version
              gate{' '}
              <a href="#ag-signals" onClick={go('#ag-signals')}>
                ↗
              </a>
            </p>
            <button type="button" aria-label="Dismiss announcement" onClick={() => setAnnounceOpen(false)}>
              ×
            </button>
          </div>
        ) : null}

        <nav className="ag-nav" aria-label="Aegis Sentinel">
          <a className="ag-brand" href="#ag-gate" onClick={go('#ag-gate')}>
            <svg className="ag-logo" viewBox="0 0 22 26" aria-hidden="true">
              <path
                d="M11 1.6 20.2 5v7.4c0 5.4-3.7 10.2-9.2 12.8C5.5 22.6 1.8 17.8 1.8 12.4V5z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path d="M6.8 12.6l3 3.1 6-6.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            AEGIS SENTINEL
          </a>
          <ul className="ag-menu">
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <a href={link.href} onClick={go(link.href)}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="ag-actions">
            <a className="ag-gate" href="#ag-gate" onClick={go('#ag-gate')}>
              Version gate <i>↗</i>
            </a>
            <a className="ag-console" href="/login" onClick={openConsole}>
              Console <i>↗</i>
            </a>
            <a className="ag-launch" href="/login" onClick={openConsole}>
              OPEN THE CONSOLE
            </a>
          </div>
        </nav>
      </div>

      <aside className="ag-rail" aria-hidden="true">
        <div className="ag-rail-dots">
          {Array.from({ length: RAIL_DOTS }, (_, i) => (
            <i key={i} className={i === rail ? 'is-on' : ''} />
          ))}
        </div>
        <span className="ag-rail-label" style={{ transform: `translateY(${RAIL_LABEL_Y[section]}px)` }}>
          {SECTIONS[section]}
        </span>
        <div className="ag-rail-foot">
          <DialIcon />
          <span>MENU</span>
        </div>
      </aside>

      <main>
        <section className="ag-sec ag-gate-sec" id="ag-gate">
          <div className="ag-prompt ag-rv">
            <span className="ag-quote-tab" aria-hidden="true">
              &gt;
            </span>
            <span className="ag-brackets" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <p className="ag-prompt-text">
              {typed}
              <span className="ag-caret" aria-hidden="true" />
            </p>
            <p className="ag-prompt-next">
              NEXT<span aria-hidden="true"> · </span>
              {nextQuery}
            </p>
          </div>

          <span className="ag-rule" aria-hidden="true" />

          <ul className="ag-features ag-rv" style={delay('0.2s')}>
            {FEATURES.map((feature) => (
              <li key={feature}>
                <i aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          <div className="ag-hero-foot">
            <p className="ag-kicker ag-rv">VERSION-AWARE THREAT EARLY WARNING</p>
            <h1 className="ag-headline ag-rv" style={delay('0.1s')}>
              <span className="ag-word is-reach">Threats that</span>
              <span className="ag-word is-you">can reach you</span>
            </h1>
            <p className="ag-sub ag-rv" style={delay('0.2s')}>
              Aegis Sentinel reads the CVE firehose against the versions installed on your own estate. A{' '}
              <b>CVSS 9.8</b> on software you don&apos;t run scores <b>0.0</b>; a quiet 7.5 on a matched build outranks
              it.
            </p>
          </div>

          <div className="ag-scroll">
            <span className="ag-brackets is-sm" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            SCROLL <i aria-hidden="true">↓</i>
          </div>
        </section>

        <section className="ag-sec ag-console-sec" id="ag-console">
          <div className="ag-strip" aria-hidden="true">
            <div className="ag-track" style={{ transform: `translate3d(calc(6vw - ${step} * var(--tabw)),0,0)` }}>
              {modules.map((mod, i) => (
                <div
                  key={`${mod.name}-${i}`}
                  className={`ag-tab${i === step ? ' is-active' : ''}${i < step ? ' is-past' : ''}`}
                >
                  <span className="ag-tab-n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="ag-tab-t">{mod.name}</span>
                  <small>{mod.note}</small>
                  <span className="ag-brackets is-sm" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="ag-console-foot">
            <p className="ag-kicker ag-rv">INSIDE THE CONSOLE</p>
            <h2 className="ag-headline ag-rv" style={delay('0.1s')}>
              <span className="ag-box">Seventeen modules,</span>
              <span>one verdict per host.</span>
            </h2>
          </div>
        </section>

        <section className="ag-sec ag-signals-sec" id="ag-signals">
          <div className="ag-sig-head ag-rv">
            <span>SIGNAL</span>
            <span className="ag-sig-n">{String(signal + 1).padStart(2, '0')}</span>
            <span className="ag-sig-level" style={{ color: current.suppressed ? '#53e3cb' : LEVEL_COLOR[current.level] }}>
              {current.suppressed ? 'SUPPRESSED' : current.level}
            </span>
            <span className="ag-sig-id">
              <ShieldMark level={current.suppressed ? 'SUPPRESSED' : current.level} />
              <span>
                <b>{current.asset.id}</b>
                <small>
                  {current.asset.name} · {current.cve.id}
                </small>
              </span>
            </span>
          </div>

          <div className="ag-sig-body">
            <blockquote className="ag-quote" key={signal}>
              <p>{current.summary}</p>
              <p className="ag-score-line">
                SCORE <b>{current.score.toFixed(1)}</b>
                {current.suppressed && current.wouldHaveScored ? (
                  <>
                    <span>CVSS-ONLY</span>
                    <s>{current.wouldHaveScored.toFixed(1)}</s>
                  </>
                ) : (
                  <span>CVSS {current.cve.cvss?.toFixed(1) ?? 'n/a'}</span>
                )}
              </p>
              <div className="ag-sig-nav">
                <button
                  type="button"
                  aria-label="Previous signal"
                  onClick={() => setSignal((s) => (s - 1 + signals.length) % signals.length)}
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label="Next signal"
                  onClick={() => setSignal((s) => (s + 1) % signals.length)}
                >
                  →
                </button>
              </div>
            </blockquote>

            <p className="ag-quote-ghost" aria-hidden="true">
              {next.summary}
            </p>

            <a className="ag-try ag-rv" href="/login" onClick={openConsole} style={delay('0.3s')}>
              Run these checks yourself <i>(Open the console)</i>
            </a>
          </div>

          <footer className="ag-footer">
            AEGIS SENTINEL · 2026 · {counts.cves} REAL CVE IDS · SIMULATED ESTATE
          </footer>
        </section>
      </main>
    </div>
  )
}
