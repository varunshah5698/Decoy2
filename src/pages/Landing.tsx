import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { LogoMark } from '../components/Logo'
import { GateScene } from '../scenes/GateScene'
import { BellPlate, ConsolePlate, GaugePlate, RackPlate, ShieldPlate, TerminalPlate, Glyph, Scribble } from './LandingArt'
import type { GlyphKind } from './LandingArt'
import { alerts, assets, counts, cves, posture, suppressedAlerts } from '../data/seed'
import { demoAccounts, useAuth } from '../lib/store'
import './Landing.css'

const gate = suppressedAlerts.find((a) => (a.cve.cvss ?? 0) >= 9) ?? suppressedAlerts[0]
const heroAlert = alerts.find((a) => a.cve.id === 'CVE-2021-44228') ?? alerts[0]

const navLinks = [
  { href: '#gate', label: 'The Gate' },
  { href: '#about', label: 'Threat Model' },
  { href: '#capabilities', label: 'Detection' },
  { href: '#numbers', label: 'Numbers' },
  { href: '#console', label: 'Console' },
]

const capabilities: { n: string; glyph: GlyphKind; title: [string, string]; body: string; path: string }[] = [
  {
    n: '01',
    glyph: 'shield',
    title: ['Version', 'Gate'],
    body: 'An advisory only matters if the build on your host falls inside the affected range. Aegis checks the installed version against the published CPE range before anything reaches the queue — and scores the miss at 0.0.',
    path: '/app/alerts',
  },
  {
    n: '02',
    glyph: 'radar',
    title: ['Risk', 'Scoring'],
    body: 'CVSS, EPSS exploitation probability, CISA KEV listing, asset criticality, internet exposure and version relevance. Six weighted inputs, one deterministic formula, capped at 100 — printed beside the alert, not hidden in a model.',
    path: '/app/scoring',
  },
  {
    n: '03',
    glyph: 'bug',
    title: ['Alert', 'Center'],
    body: 'A triage queue ordered by what can actually be exploited against you. Every alert carries its version check, its score breakdown, its evidence trail and the patch that closes it.',
    path: '/app/alerts',
  },
  {
    n: '04',
    glyph: 'packet',
    title: ['Asset', 'Exposure'],
    body: "Which hosts are internet-facing, what they run, how much the business function behind them matters, and how many of today's advisories land inside their installed versions.",
    path: '/app/assets',
  },
  {
    n: '05',
    glyph: 'key',
    title: ['Analyst', 'Copilot'],
    body: 'A copilot scoped to the record in front of you. It cites the alert it read, quotes the version it matched, and refuses to invent a number the scoring engine did not produce.',
    path: '/app/ai',
  },
]

const statSteps = [
  { value: String(counts.suppressed), label: 'cleared by the gate', note: 'suppressed, would-have score kept' },
  { value: '6', label: 'weighted inputs', note: `formula v${heroAlert.breakdown.formula_version}, one pass` },
  { value: String(counts.active), label: 'live exploit alerts', note: `across ${assets.length} seeded hosts` },
  { value: String(counts.cves), label: 'real CVE identifiers', note: 'NVD · CISA KEV · FIRST EPSS' },
]

const surfaces = [
  {
    name: 'Alert Center',
    role: 'Triage surface',
    stat: String(counts.active),
    unit: 'live exploit alerts',
    note: 'each one carrying its version check',
    plate: BellPlate,
    path: '/app/alerts',
  },
  {
    name: 'Asset Exposure',
    role: 'Inventory surface',
    stat: String(assets.length),
    unit: 'hosts mapped',
    note: 'down to the installed build',
    plate: RackPlate,
    path: '/app/assets',
  },
  {
    name: 'Risk Scoring',
    role: 'Model surface',
    stat: '6',
    unit: 'weighted inputs',
    note: 'same record, same number',
    plate: GaugePlate,
    path: '/app/scoring',
  },
  {
    name: 'AI Analyst',
    role: 'Copilot surface',
    stat: '0',
    unit: 'invented numbers',
    note: 'every answer cites the record',
    plate: TerminalPlate,
    path: '/app/ai',
  },
]

const roleCopy = [
  {
    title: 'Operate',
    em: 'the whole room.',
    body: 'Full workspace control: ingest asset inventories and raw logs, rewrite the inputs in the what-if simulator, export exactly what the queue decided.',
  },
  {
    title: 'Triage',
    em: 'with the why.',
    body: 'A prioritised exploit queue where every alert carries its version check, score breakdown, ATT&CK technique and evidence trail.',
  },
]

/** The reference's converging-bar band, used to hand one world off to the next. */
function Funnel({ tone }: { tone: 'light' | 'dark' }) {
  const rows = useMemo(() => Array.from({ length: 15 }, (_, i) => 100 - i * 5.4 - Math.pow(i / 14, 2) * 12), [])
  return (
    <div className={`lp-funnel lp-rv is-${tone}`} aria-hidden="true">
      <div className="lp-funnel-band">
        {Array.from({ length: 96 }, (_, i) => (
          <i key={i} style={{ height: `${18 + Math.abs(Math.sin(i * 0.37)) * 74}%` }} />
        ))}
      </div>
      <div className="lp-funnel-rows">
        {rows.map((width, i) => (
          <span key={i} style={{ width: `${width}%`, transitionDelay: `${i * 34}ms` }} />
        ))}
      </div>
    </div>
  )
}

/** Bar charts drawn as hairlines, the way the reference sets its figures. */
function LineBars({ seed, bars = 44, tone }: { seed: number; bars?: number; tone: 'light' | 'dark' }) {
  const heights = useMemo(
    () =>
      Array.from({ length: bars }, (_, i) => {
        const x = i / (bars - 1)
        const swell = Math.sin(x * Math.PI) ** 0.6
        const jitter = ((Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453) % 1 + 1) % 1
        return 26 + swell * 62 + jitter * 12
      }),
    [bars, seed],
  )
  return (
    <div className={`lp-bars is-${tone}`} aria-hidden="true">
      {heights.map((h, i) => (
        <i key={i} style={{ height: `${h}%`, transitionDelay: `${i * 9}ms` }} />
      ))}
    </div>
  )
}

export default function Landing() {
  const navigate = useNavigate()
  const { session, signIn } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const ambientRef = useRef<HTMLDivElement>(null)
  const gateRef = useRef<HTMLElement>(null)
  const gateValueRef = useRef<HTMLSpanElement>(null)
  const progressRef = useRef(0)

  const stars = useMemo(
    () =>
      Array.from({ length: 110 }, (_, i) => {
        const r = (n: number) => {
          const v = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453
          return v - Math.floor(v)
        }
        const size = 1 + r(3) * 1.9
        return {
          left: `${(r(1) * 100).toFixed(2)}%`,
          top: `${(r(2) * 100).toFixed(2)}%`,
          width: `${size.toFixed(2)}px`,
          height: `${size.toFixed(2)}px`,
          animationDelay: `${(r(4) * 5.5).toFixed(2)}s`,
          opacity: 0.16 + r(5) * 0.5,
        }
      }),
    [],
  )

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.lp-rv'))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((node) => node.classList.add('in'))
      if (gateValueRef.current) gateValueRef.current.textContent = '0.0'
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in')
            observer.unobserve(entry.target)
          }
        })
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
    )
    nodes.forEach((node) => observer.observe(node))

    let raf = 0
    let lastScrolled = false
    const pointer = { x: 0.62, y: 0.3 }
    const eased = { ...pointer }

    const onMove = (event: PointerEvent) => {
      pointer.x = event.clientX / window.innerWidth
      pointer.y = event.clientY / window.innerHeight
    }

    const tick = () => {
      eased.x += (pointer.x - eased.x) * 0.05
      eased.y += (pointer.y - eased.y) * 0.05

      const el = ambientRef.current
      if (el) {
        el.style.setProperty('--ax', `${(eased.x * 100).toFixed(2)}%`)
        el.style.setProperty('--ay', `${(eased.y * 100).toFixed(2)}%`)
        el.style.setProperty('--sy', `${Math.min(120, window.scrollY * 0.04).toFixed(1)}px`)
      }

      const section = gateRef.current
      if (section) {
        const rect = section.getBoundingClientRect()
        const span = rect.height + window.innerHeight * 0.4
        const raw = (window.innerHeight - rect.top) / span
        const p = Math.min(1, Math.max(0, raw))
        progressRef.current = p
        section.style.setProperty('--gp', p.toFixed(4))
        const node = gateValueRef.current
        if (node) node.textContent = ((gate.cve.cvss ?? 9.8) * (1 - p)).toFixed(1)
      }

      const past = window.scrollY > 24
      if (past !== lastScrolled) {
        lastScrolled = past
        setScrolled(past)
      }
      raf = requestAnimationFrame(tick)    }

    window.addEventListener('pointermove', onMove, { passive: true })
    raf = requestAnimationFrame(tick)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])

  const startDemo = () => {
    if (!session) {
      const analyst = demoAccounts.find((account) => account.role === 'ANALYST') ?? demoAccounts[1]
      signIn(analyst.email, analyst.role, analyst.name)
    }
    navigate('/app')
  }

  const enterAs = (index: number) => {
    const account = demoAccounts[index]
    if (!session) signIn(account.email, account.role, account.name)
    navigate('/app')
  }

  const openPath = (path: string) => {
    if (session) navigate(path)
    else navigate(`/login?next=${encodeURIComponent(path)}`)
  }

  return (
    <div className="lp" ref={ambientRef}>
      <nav className={`lp-nav${scrolled ? ' is-scrolled' : ''}`} aria-label="Primary">
        <a className="lp-chip lp-brand-chip" href="#top" aria-label="Aegis Sentinel home">
          <LogoMark />
          <b>Aegis</b>
        </a>
        <div className="lp-chip lp-nav-links">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
        <button type="button" className="lp-pill lp-pill-nav" onClick={startDemo}>
          Open demo
          <ArrowUpRight size={15} strokeWidth={1.9} />
        </button>
      </nav>

      <header className="lp-hero" id="top">
        <div className="lp-hero-field" aria-hidden="true" />
        <div className="lp-hero-glow" aria-hidden="true" />
        <div className="lp-hero-stripes" aria-hidden="true" />

        <div className="lp-hero-body">
          <h1 className="lp-hero-title lp-rv">
            Filtering <em>Noise</em>
            <br />
            <em>Threat</em> Early Warning
          </h1>
          <p className="lp-hero-sub lp-rv" style={{ transitionDelay: '120ms' }}>
            The CVE firehose never stops. Aegis Sentinel reads NVD, CISA KEV and FIRST EPSS, checks
            every affected version range against the software actually installed on your estate, and
            escalates only the exploits that can reach you — with the version, the score and the patch
            in plain sight.
          </p>
          <button
            type="button"
            className="lp-pill lp-pill-ink lp-rv"
            style={{ transitionDelay: '220ms' }}
            onClick={startDemo}
          >
            Open the console
            <ArrowUpRight size={15} strokeWidth={1.9} />
          </button>
        </div>
      </header>

      <main className="lp-main">
        <section className="lp-gate" id="gate" ref={gateRef}>
          <GateScene progressRef={progressRef} />
          <div className="lp-gate-label">
            <span>The version gate</span>
            <i />
            <span>01</span>
          </div>
          <div className="lp-gate-readout">
            <span className="lp-gate-value" ref={gateValueRef}>
              {(gate.cve.cvss ?? 9.8).toFixed(1)}
            </span>
            <p className="lp-gate-caption">
              {gate.cve.id} · CVSS {(gate.cve.cvss ?? 0).toFixed(1)} · CISA KEV listed ·{' '}
              {gate.cve.title.split(':')[0]}
              <br />
              {gate.cve.product} is not installed on {gate.asset.name} — the version gate zeroes the
              score and the queue never files it.
            </p>
          </div>
        </section>

        <Funnel tone="dark" />

        <section className="lp-about" id="about">
          <div className="lp-smoke" aria-hidden="true" />
          <Scribble className="lp-about-scribble" />

          <h2 className="lp-about-title lp-rv">
            A Clear
            <br />
            Patch <span className="lp-about-plate"><ConsolePlate /></span> Path
            <br />
            <em>Out of Noise</em>
          </h2>

          <div className="lp-about-grid">
            <div className="lp-about-tag lp-rv">
              <span>Threat model</span>
            </div>

            <div className="lp-about-who lp-rv" style={{ transitionDelay: '80ms' }}>
              <span className="lp-about-tag">
                <span>Real CVE IDs</span>
              </span>
              <span className="lp-about-avatar">
                <ShieldPlate />
              </span>
              <b>Aegis Sentinel</b>
              <small>Version-aware early warning</small>
            </div>

            <div className="lp-about-copy lp-rv" style={{ transitionDelay: '160ms' }}>
              <p>
                Aegis Sentinel is built for the analyst on night shift. NVD publishes hundreds of
                advisories a day and every one arrives sounding like an emergency — but a CVSS 9.8 on
                software you do not run is still a 9.8, and it still pages someone. We start by
                deleting the threats that cannot reach your estate, then rank what survives by the
                build installed on the host, not the headline the advisory shipped with.
              </p>
              <p>
                Correlation is arithmetic, not judgement: six weighted inputs — severity, EPSS
                exploitation probability, CISA KEV listing, asset criticality, internet exposure and
                version relevance — one deterministic formula, capped at 100, printed in full beside
                the alert. This build runs a seeded organisation: the inventory and scores are
                simulated and labelled, the CVE identifiers are real.
              </p>
            </div>
          </div>
        </section>

        <section className="lp-services" id="capabilities">
          <div className="lp-stars" aria-hidden="true">
            {stars.map((s, i) => (
              <i key={i} style={s} />
            ))}
          </div>
          <div className="lp-services-field" aria-hidden="true">
            <Glyph kind="radar" className="lp-glyph" style={{ right: '9%', top: '11%', width: 118, height: 118 }} />
            <Glyph kind="packet" className="lp-glyph" style={{ left: '5%', bottom: '9%', width: 88, height: 88 }} />
          </div>

          <h2 className="lp-sec-title lp-rv">
            Our <em>Vulnerability</em>
            <br />
            Detection Services
          </h2>

          <div className="lp-cards">
            {capabilities.map((card, index) => (
              <button
                type="button"
                key={card.n}
                className="lp-card lp-rv"
                style={{ transitionDelay: `${index * 90}ms` }}
                onClick={() => openPath(card.path)}
              >
                <span className="lp-card-n">
                  <i />
                  {card.n}
                </span>
                <Glyph kind={card.glyph} className="lp-card-glyph" />
                <h3>
                  {card.title[0]} <em>{card.title[1]}</em>
                </h3>
                <p>{card.body}</p>
                <span className="lp-card-go">
                  Open <ArrowUpRight size={13} strokeWidth={1.9} />
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="lp-numbers" id="numbers">
          <div className="lp-wrap lp-numbers-head">
            <h2 className="lp-bignum lp-rv">
              0<em>.0</em>
            </h2>
            <div className="lp-numbers-note lp-rv" style={{ transitionDelay: '100ms' }}>
              <p>
                is what a CVSS 9.8, CISA-listed, actively-exploited advisory scores on a host that
                does not run the product. Quietly, deterministically, by arithmetic — the queue never
                files it as an emergency, and nobody gets paged at 03:00 for a threat with no path in.
              </p>
              <button type="button" className="lp-pill lp-pill-bone" onClick={startDemo}>
                Open the console
                <ArrowUpRight size={15} strokeWidth={1.9} />
              </button>
            </div>
          </div>

          <div className="lp-wrap lp-steps">
            {statSteps.map((step, index) => (
              <div className="lp-step lp-rv" key={step.label} style={{ transitionDelay: `${index * 110}ms` }}>
                <b>{step.value}</b>
                <span className="lp-step-label">{step.label}</span>
                <span className="lp-step-note">{step.note}</span>
                <LineBars seed={index + 3} tone="light" />
              </div>
            ))}
          </div>
        </section>

        <Funnel tone="light" />

        <section className="lp-console" id="console">
          <div className="lp-wrap">
            <div className="lp-console-head">
              <h2 className="lp-sec-title is-ink lp-rv">
                Inside the <em>Console</em>
              </h2>
              <p className="lp-console-sub lp-rv" style={{ transitionDelay: '90ms' }}>
                Behind every alert is a surface built to show the exploit, the installed version, the
                score and the patch that closes it — open any of them on the seeded estate.
              </p>
            </div>

            <div className="lp-tiles">
              {surfaces.map((surface, index) => {
                const Plate = surface.plate
                return (
                  <button
                    type="button"
                    className="lp-tile lp-rv"
                    key={surface.name}
                    onClick={() => openPath(surface.path)}
                    style={{ transitionDelay: `${index * 100}ms` }}
                  >
                    <span className="lp-tile-plate">
                      <Plate />
                    </span>
                    <b>{surface.name}</b>
                    <span className="lp-tile-role">{surface.role}</span>
                    <span className="lp-tile-stat">
                      {surface.stat}
                      <i>+</i>
                    </span>
                    <span className="lp-tile-unit">{surface.unit}</span>
                    <span className="lp-tile-note">{surface.note}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        <section className="lp-access" id="access">
          <div className="lp-hero-stripes" aria-hidden="true" />
          <div className="lp-access-body">
            <h2 className="lp-hero-title is-sm lp-rv">
              Two <em>Clearances.</em>
              <br />
              One <em>Threat</em> Record
            </h2>
            <p className="lp-hero-sub lp-rv" style={{ transitionDelay: '100ms' }}>
              Open the seeded organisation, walk the {heroAlert.score.toFixed(1)} Log4Shell match down
              to its fix, patch it in the what-if simulator and watch the exploit queue re-rank behind
              you.
            </p>
            <div className="lp-access-actions lp-rv" style={{ transitionDelay: '180ms' }}>
              <button type="button" className="lp-pill lp-pill-ink" onClick={startDemo}>
                Open the demo
                <ArrowUpRight size={15} strokeWidth={1.9} />
              </button>
              <Link className="lp-pill lp-pill-ghost" to="/login">
                Sign in
              </Link>
            </div>

            <div className="lp-registers lp-rv" style={{ transitionDelay: '240ms' }}>
              {demoAccounts.map((account, index) => {
                const copy = roleCopy[index]
                return (
                  <div className="lp-register" key={account.role}>
                    <span className="lp-register-tag">
                      {account.label} · {account.email}
                    </span>
                    <h4>
                      {copy.title} <em>{copy.em}</em>
                    </h4>
                    <p>{copy.body}</p>
                    <button type="button" className="lp-register-go" onClick={() => enterAs(index)}>
                      Enter as {account.label.toLowerCase()}
                      <ArrowUpRight size={14} strokeWidth={1.9} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-grid">
            <div className="lp-footer-brand">
              <span className="lp-chip lp-brand-chip is-static">
                <LogoMark />
                <b>Aegis</b>
              </span>
              <p>
                Version-aware, explainable threat early warning. Your asset inventory and telemetry
                stay inside this deployment.
              </p>
            </div>
            <div>
              <h4>Data sources</h4>
              <ul>
                <li>NVD CVE API 2.0</li>
                <li>CISA KEV catalog</li>
                <li>FIRST EPSS</li>
                <li>MITRE ATT&amp;CK</li>
                <li>{cves.length} seeded advisories</li>
              </ul>
            </div>
            <div>
              <h4>Surfaces</h4>
              <ul>
                <li>
                  <Link to="/login?next=%2Fapp%2Falerts">Alert center</Link>
                </li>
                <li>
                  <Link to="/login?next=%2Fapp%2Fassets">Asset exposure</Link>
                </li>
                <li>
                  <Link to="/login?next=%2Fapp%2Fscoring">Risk scoring</Link>
                </li>
                <li>
                  <Link to="/login?next=%2Fapp%2Fai">AI analyst</Link>
                </li>
              </ul>
            </div>
            <div>
              <h4>Access</h4>
              <ul>
                <li>admin@aegis.demo</li>
                <li>analyst@aegis.demo</li>
                <li>Posture {posture}/100 · formula v{heroAlert.breakdown.formula_version}</li>
              </ul>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>© 2026 Aegis Sentinel</span>
            <span>Simulated inventory and scores, labelled everywhere</span>
            <span>Real CVE identifiers</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
