import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { LogoMark } from '../components/Logo'
import { ServerAttackScene } from '../scenes/ServerAttackScene'
import { alerts, componentCatalog, counts, posture } from '../data/seed'
import { demoAccounts, useAuth } from '../lib/store'
import './Landing.css'

const heroAlert = alerts[0]

const gateState = {
  MATCHED: 'in range',
  VERSION_UNKNOWN: 'version unreadable',
  NOT_AFFECTED: 'outside range',
  PRODUCT_ABSENT: 'not installed',
} as const

const gateRows = ['CVE-2021-44228', 'CVE-2024-3400', 'CVE-2021-34527', 'CVE-2023-23397'].flatMap((id) =>
  alerts.filter((alert) => alert.cve.id === id),
)

const factors = [
  {
    key: 'Severity',
    note: `CVSS ${(heroAlert.cve.cvss ?? 0).toFixed(1)}`,
    value: heroAlert.breakdown.severity_points,
  },
  {
    key: 'Exploitation probability',
    note: `EPSS ${((heroAlert.cve.epss ?? 0) * 100).toFixed(1)}%`,
    value: heroAlert.breakdown.exploit_points,
  },
  { key: 'Known exploitation', note: 'CISA KEV listed', value: heroAlert.breakdown.kev_points },
  {
    key: 'Asset criticality',
    note: `${heroAlert.asset.criticality.toLowerCase()} criticality`,
    value: heroAlert.breakdown.criticality_points,
  },
  {
    key: 'Exposure',
    note: heroAlert.asset.internetFacing ? 'internet-facing' : 'internal only',
    value: heroAlert.breakdown.exposure_points,
  },
  { key: 'Version relevance', note: 'installed range matched', value: heroAlert.breakdown.relevance_points },
]

const pipeline = [
  { t: 'Ingest', d: 'NVD, KEV, EPSS and ATT&CK arrive through cached adapters.' },
  { t: 'Extract', d: 'Product, vendor and version read from the asset record.' },
  { t: 'Correlate', d: 'Installed versions checked against published ranges.' },
  { t: 'Score', d: 'Six weighted inputs, deterministic, capped at 100.' },
  { t: 'Alert', d: 'Impact, evidence and next action in plain language.' },
]

const componentPaths: Record<number, string> = {
  1: '/app',
  2: '/app/alerts',
  3: '/app/scoring',
  4: '/app/graph',
  5: '/app/attacks',
  6: '/app/assets',
  7: '/app/cves',
  8: '/app/intel',
  9: '/app/anomalies',
  10: '/app/simulator',
  11: '/app/mitre',
  12: '/app/map',
  13: '/app/provenance',
  14: '/app/radar',
  15: '/app/traffic',
  16: '/app/uploads',
  17: '/app/ai',
}

const roleCopy = [
  {
    title: 'Operate',
    em: 'the whole room.',
    description:
      'Full workspace control: ingest inventory and logs, change the inputs in the simulator, and export what the queue decided.',
    surfaces: ['Ingestion', 'Simulator', 'Scoring model', 'Exports'],
  },
  {
    title: 'Triage',
    em: 'with the why.',
    description:
      'A prioritised queue where every alert carries its version check, score breakdown and evidence trail — plus an analyst that stays inside the record.',
    surfaces: ['Alert center', 'Asset exposure', 'Provenance', 'AI analyst'],
  },
]

const postureSegments = [
  { n: counts.critical, label: `${counts.critical} critical`, tone: 'critical' },
  { n: counts.high, label: `${counts.high} high`, tone: 'high' },
  { n: counts.medium, label: `${counts.medium} medium`, tone: 'medium' },
  { n: counts.low, label: `${counts.low} low`, tone: 'low' },
]

const ledger = [
  { label: 'CVEs in corpus', value: String(counts.cves) },
  { label: 'Live alerts', value: String(counts.active) },
  { label: 'Suppressed by version', value: String(counts.suppressed) },
  { label: 'Organisation posture', value: String(posture), suffix: '/100' },
]

export default function Landing() {
  const navigate = useNavigate()
  const { session, signIn } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const ambientRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.lp-rv'))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((node) => node.classList.add('in'))
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
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    )
    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = ambientRef.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    let x = 0.68
    let y = 0.22
    const target = { x, y }
    const onMove = (event: PointerEvent) => {
      target.x = event.clientX / window.innerWidth
      target.y = event.clientY / window.innerHeight
    }
    const tick = () => {
      x += (target.x - x) * 0.045
      y += (target.y - y) * 0.045
      el.style.setProperty('--ax', `${(x * 100).toFixed(2)}%`)
      el.style.setProperty('--ay', `${(y * 100).toFixed(2)}%`)
      el.style.setProperty('--sy', `${Math.min(160, window.scrollY * 0.05).toFixed(1)}px`)
      raf = requestAnimationFrame(tick)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    raf = requestAnimationFrame(tick)
    return () => {
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

  const openComponent = (id: number) => {
    const path = componentPaths[id]
    if (session) navigate(path)
    else navigate(`/login?next=${encodeURIComponent(path)}`)
  }

  return (
    <div className="lp">
      <div className="lp-ambient" ref={ambientRef} aria-hidden="true" />
      <div className="lp-grain" aria-hidden="true" />

      <nav className={`lp-nav${scrolled ? ' is-scrolled' : ''}`} aria-label="Primary">
        <div className="lp-wrap lp-nav-inner">
          <a className="lp-brand" href="#top" aria-label="Aegis Sentinel home">
            <LogoMark />
            <span className="lp-brand-text">
              <b>Aegis Sentinel</b>
              <small>Threat early warning</small>
            </span>
          </a>
          <div className="lp-nav-links">
            <a href="#problem">The problem</a>
            <a href="#matcher">The matcher</a>
            <a href="#scoring">Scoring</a>
            <a href="#console">Console</a>
          </div>
          <div className="lp-nav-actions">
            <button type="button" className="lp-nav-signin" onClick={() => navigate('/login')}>
              Sign in
            </button>
            <button type="button" className="lp-btn lp-btn-solid lp-btn-sm" onClick={startDemo}>
              Open demo
            </button>
          </div>
        </div>
      </nav>

      <header className="lp-hero" id="top">
        <ServerAttackScene />
        <div className="lp-hero-shell">
          <div className="lp-hero-copy">
            <h1 className="lp-hero-title">
              The internet is loud.
              <br />
              <em>Your breach is specific.</em>
            </h1>
            <p className="lp-hero-sub">
              Aegis Sentinel reads the global vulnerability firehose, checks every affected range
              against the software you <strong>actually run</strong>, and escalates only what reaches
              your systems — with the version, the score and the fix in plain sight.
            </p>
            <div className="lp-hero-actions">
              <button type="button" className="lp-btn lp-btn-solid" onClick={startDemo}>
                Enter the command centre
                <ArrowRight size={16} strokeWidth={1.8} />
              </button>
              <a className="lp-btn lp-btn-ghost" href="#matcher">
                See how the gate works
                <ArrowRight size={16} strokeWidth={1.8} />
              </a>
            </div>
          </div>
        </div>
        <div className="lp-hero-ledger">
          <div className="lp-wrap lp-ledger-inner">
            {ledger.map((item) => (
              <div className="lp-ledger-item" key={item.label}>
                <span>{item.label}</span>
                <b>
                  {item.value}
                  {item.suffix && <em>{item.suffix}</em>}
                </b>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="lp-main">
        <section className="lp-section" id="problem">
          <div className="lp-wrap lp-problem">
            <div className="lp-sec-copy lp-rv">
              <h2>
                Most alerts are <em>not yours.</em>
              </h2>
              <p>
                The feed is endless and genuinely alarming. A 9.8 on software you do not run is still
                a 9.8 — and it still pages someone. Aegis starts by removing what cannot touch you.
              </p>
              <div className="lp-facts">
                <div>
                  <b>
                    {counts.active}
                    <i> / {counts.total}</i>
                  </b>
                  <span>alerts clear the gate</span>
                </div>
                <div>
                  <b>{counts.suppressed}</b>
                  <span>suppressed with their would-have score kept</span>
                </div>
              </div>
              <a className="lp-link" href="#scoring">
                Then the survivors are scored <ArrowRight size={14} strokeWidth={1.8} />
              </a>
            </div>

            <div className="lp-gate lp-rv" style={{ transitionDelay: '90ms' }} role="table" aria-label="Version gate decisions">
              <div className="lp-gate-head" role="row">
                <span role="columnheader">cve</span>
                <span role="columnheader">installed software</span>
                <span role="columnheader">gate</span>
                <span role="columnheader">score</span>
              </div>
              {gateRows.map((alert) => {
                const tone = alert.suppressed
                  ? 'is-suppressed'
                  : alert.relevance === 'MATCHED'
                    ? 'is-matched'
                    : 'is-unknown'
                return (
                  <div className={`lp-gate-row ${tone}`} key={alert.id} role="row">
                    <span className="lp-gate-cve" role="cell">
                      {alert.cve.id}
                    </span>
                    <span className="lp-gate-asset" role="cell">
                      {alert.asset.name}
                      <em>
                        {alert.cve.product} · {alert.version}
                      </em>
                    </span>
                    <span className="lp-gate-state" role="cell">
                      <i />
                      {gateState[alert.relevance]}
                    </span>
                    <span className="lp-gate-score" role="cell">
                      {alert.suppressed ? '0.0' : alert.score.toFixed(1)}
                      {alert.suppressed && alert.wouldHaveScored != null && (
                        <em>would be {alert.wouldHaveScored.toFixed(1)}</em>
                      )}
                    </span>
                  </div>
                )
              })}
              <div className="lp-gate-foot">
                <span>CPE range check · normalised versions</span>
                <span>simulated inventory</span>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-section" id="matcher">
          <div className="lp-wrap lp-split">
            <div className="lp-sec-copy lp-rv">
              <h2>
                One version string <em>changes everything.</em>
              </h2>
              <p>
                Correlation is not a keyword search. Aegis pulls the product and installed version
                out of the inventory record, then checks them against the CVE's published affected
                range.
              </p>
              <ul className="lp-principles">
                <li>
                  <span>Extract</span>
                  Product, vendor and version come from the asset record — never guessed from the
                  CVE title.
                </li>
                <li>
                  <span>Compare</span>
                  Ranges are evaluated on normalised versions, including pre-release and partial
                  strings.
                </li>
                <li>
                  <span>Verify</span>
                  An unreadable version is never treated as safe. It stays visible at reduced
                  relevance.
                </li>
              </ul>
            </div>

            <figure className="lp-ruler lp-rv" style={{ transitionDelay: '90ms' }}>
              <div className="lp-ruler-top">
                <span>CPE range check</span>
                <span>{heroAlert.cve.id}</span>
              </div>
              <figcaption className="lp-ruler-title">
                <b>{heroAlert.cve.vendor} {heroAlert.cve.product}</b>
                <span>{heroAlert.asset.name} · installed {heroAlert.version}</span>
              </figcaption>
              <div className="lp-ruler-track" aria-hidden="true">
                <span className="lp-ruler-band" />
                <span className="lp-ruler-safe" />
                <span className="lp-ruler-mark">
                  <i />
                  <b>{heroAlert.version}</b>
                </span>
                <span className="lp-ruler-fix" />
              </div>
              <div className="lp-ruler-scale" aria-hidden="true">
                <span className="is-start">{heroAlert.cve.range.startIncluding}</span>
                <span className="is-end">{heroAlert.cve.range.endExcluding}</span>
                <span className="is-fix">{heroAlert.cve.fixVersion.replace(' or later', '+')}</span>
              </div>
              <div className="lp-ruler-verdict">
                <span className="lp-verdict-match">
                  <i /> in range → matched
                </span>
                <span className="lp-verdict-fix">fix ≥ {heroAlert.cve.fixVersion.replace(' or later', '')}</span>
              </div>
              <div className="lp-ruler-foot">
                <span>CVSS {(heroAlert.cve.cvss ?? 0).toFixed(1)}</span>
                <span>EPSS {((heroAlert.cve.epss ?? 0) * 100).toFixed(1)}%</span>
                <span>{heroAlert.cve.kev ? 'CISA KEV' : 'not in KEV'}</span>
                <span>{heroAlert.asset.criticality} criticality</span>
              </div>
            </figure>
          </div>

          <div className="lp-wrap">
            <ol className="lp-path lp-rv">
              {pipeline.map((step, index) => (
                <li key={step.t}>
                  <span className="lp-path-n">{String(index + 1).padStart(2, '0')}</span>
                  <b>{step.t}</b>
                  <span className="lp-path-d">{step.d}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-section" id="scoring">
          <div className="lp-wrap lp-split lp-split-scoring">
            <div className="lp-sec-copy lp-rv">
              <h2>
                The score keeps <em>no secrets.</em>
              </h2>
              <p>
                Six weighted inputs, one deterministic formula, capped at 100. The same record always
                produces the same number — and the arithmetic is on screen, not behind a model.
              </p>
              <Link className="lp-link" to="/login?next=%2Fapp%2Fscoring">
                Open the scoring model <ArrowRight size={14} strokeWidth={1.8} />
              </Link>
              <div className="lp-sources">
                <span>NVD</span>
                <span>CISA KEV</span>
                <span>FIRST EPSS</span>
                <span>MITRE ATT&amp;CK</span>
              </div>
              <p className="lp-small">
                Language explains the alert. It never invents the number.
              </p>
            </div>

            <div className="lp-calc lp-rv" style={{ transitionDelay: '90ms' }}>
              <header>
                <div>
                  <b>{heroAlert.asset.name}</b>
                  <span>
                    {heroAlert.cve.id} · {heroAlert.cve.product} {heroAlert.version}
                  </span>
                </div>
                <span className={`lp-level is-${heroAlert.level.toLowerCase()}`}>{heroAlert.level}</span>
              </header>
              <div className="lp-factors">
                {factors.map((factor) => (
                  <div className="lp-factor" key={factor.key}>
                    <div className="lp-factor-head">
                      <span>{factor.key}</span>
                      <em>{factor.note}</em>
                      <b>{factor.value.toFixed(1)}</b>
                    </div>
                    <div className="lp-factor-bar">
                      <i
                        className={factor.key === 'Version relevance' ? 'is-amber' : undefined}
                        style={{ width: `${(factor.value / 25) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="lp-calc-total">
                <span>total · capped</span>
                <b>
                  {heroAlert.score.toFixed(1)}
                  <em>/100</em>
                </b>
              </div>
              <div className="lp-calc-foot">
                <span>formula v{heroAlert.breakdown.formula_version}</span>
                <span>six inputs</span>
                <span>reproducible</span>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-section" id="console">
          <div className="lp-wrap">
            <div className="lp-console-head">
              <div className="lp-rv">
                <h2>
                  The alert is <em>the beginning.</em>
                </h2>
                <p>
                  Every surface opens from the same evidence — the asset, the version, the score, and
                  the record trail behind it.
                </p>
              </div>
              <aside className="lp-posture lp-rv" style={{ transitionDelay: '90ms' }}>
                <span>organisation posture</span>
                <b>
                  {posture}
                  <em>/100</em>
                </b>
                <div
                  className="lp-posture-bar"
                  role="img"
                  aria-label={`${counts.critical} critical, ${counts.high} high, ${counts.medium} medium and ${counts.low} low alerts`}
                >
                  {postureSegments.map((segment) => (
                    <i
                      key={segment.tone}
                      className={`is-${segment.tone}`}
                      style={{ width: `${(segment.n / counts.active) * 100}%` }}
                    />
                  ))}
                </div>
                <div className="lp-posture-legend">
                  {postureSegments.map((segment) => (
                    <span key={segment.tone}>{segment.label}</span>
                  ))}
                </div>
                <p>−15 points per critical · −6 per high, computed from the live queue.</p>
              </aside>
            </div>

            <div className="lp-index lp-rv">
              {componentCatalog.map((item) => (
                <button
                  type="button"
                  className="lp-index-row"
                  key={item.id}
                  onClick={() => openComponent(item.id)}
                >
                  <span className="lp-index-n">{String(item.id).padStart(2, '0')}</span>
                  <span className="lp-index-name">{item.name}</span>
                  <span className="lp-index-group">{item.group}</span>
                  <ArrowUpRight size={14} strokeWidth={1.7} />
                </button>
              ))}
            </div>

            <div className="lp-console-cta">
              <span>Seeded demo · no signup · two roles</span>
              <button type="button" className="lp-btn lp-btn-solid" onClick={startDemo}>
                Enter the command centre
                <ArrowRight size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        </section>

        <section className="lp-section" id="roles">
          <div className="lp-wrap">
            <div className="lp-roles-head lp-rv">
              <h2>
                Two clearances. <em>One source of truth.</em>
              </h2>
            </div>
            <div className="lp-role-list">
              {demoAccounts.map((account, index) => {
                const copy = roleCopy[index]
                return (
                  <article className="lp-role lp-rv" key={account.role} style={{ transitionDelay: `${index * 80}ms` }}>
                    <span className="lp-role-k">{account.label}</span>
                    <h3>
                      {copy.title} <em>{copy.em}</em>
                    </h3>
                    <p>{copy.description}</p>
                    <ul>
                      {copy.surfaces.map((surface) => (
                        <li key={surface}>{surface}</li>
                      ))}
                    </ul>
                    <div className="lp-role-foot">
                      <span>{account.email}</span>
                      <button type="button" className="lp-link" onClick={() => enterAs(index)}>
                        Enter as {account.label.toLowerCase()} <ArrowRight size={14} strokeWidth={1.8} />
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section className="lp-section lp-final">
          <div className="lp-wrap">
            <div className="lp-final-inner lp-rv">
              <div className="lp-final-copy">
                <h2>
                  Start with the alert that <em>actually reaches you.</em>
                </h2>
                <p>
                  Open the seeded organisation, walk the {heroAlert.score.toFixed(1)} Log4Shell match
                  down to its fix, then patch it and watch the queue change.
                </p>
                <div className="lp-hero-actions">
                  <button type="button" className="lp-btn lp-btn-solid" onClick={startDemo}>
                    Enter the command centre
                    <ArrowRight size={16} strokeWidth={1.8} />
                  </button>
                  <button type="button" className="lp-btn lp-btn-ghost" onClick={() => navigate('/login')}>
                    Sign in
                  </button>
                </div>
                <div className="lp-final-meta">
                  <span>Demo data simulated and labelled</span>
                  <span>Real CVE identifiers</span>
                  <span>Formula v{heroAlert.breakdown.formula_version}</span>
                </div>
              </div>
              <span className="lp-final-mark" aria-hidden="true">
                <LogoMark />
              </span>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-grid">
            <div className="lp-footer-brand">
              <span className="lp-brand">
                <LogoMark />
                <span className="lp-brand-text">
                  <b>Aegis Sentinel</b>
                  <small>Threat early warning</small>
                </span>
              </span>
              <p>
                Asset-specific, version-aware, explainable early warning. Customer data stays inside
                this deployment.
              </p>
            </div>
            <div>
              <h4>Data sources</h4>
              <ul>
                <li>NVD CVE API 2.0</li>
                <li>CISA KEV catalog</li>
                <li>FIRST EPSS</li>
                <li>MITRE ATT&amp;CK</li>
                <li>CERT-In sample feed</li>
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
                <li className="lp-footer-note">Demo password shown on the sign-in screen.</li>
              </ul>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>© 2026 Aegis Sentinel</span>
            <span>formula v{heroAlert.breakdown.formula_version} · demo build</span>
            <span>simulated data labelled</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
