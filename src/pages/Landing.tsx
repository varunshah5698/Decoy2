import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useScroll, useSpring, useTransform } from 'framer-motion'
import { Ambient } from '../components/Ambient'
import { Logo, LogoMark } from '../components/Logo'
import { HeroScene } from '../scenes/HeroScene'
import { Counter } from '../components/Counter'
import { Reveal } from '../components/Reveal'
import { Sparkline } from '../components/Sparkline'
import { Waterfall } from '../components/Waterfall'
import { SourceBadge, SeverityBadge } from '../components/Badges'
import { TiltCard } from '../components/TiltCard'
import { CatalogIcon, ArrowRight, ExternalLink, Sparkles, ShieldCheck, SlidersHorizontal, FileSearch, Zap } from '../components/Icons'
import { alerts, componentCatalog, counts, posture, suppressedAlerts } from '../data/seed'
import { demoAccounts, useAuth, useTheme } from '../lib/store'
import { cx } from '../lib/format'

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
}

const heroAlert = alerts[0]

const tickerAlerts = [...alerts]
  .filter((a) => !a.suppressed)
  .sort((a, b) => b.score - a.score)
  .slice(0, 8)

export default function Landing() {
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const { session, signIn } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [correlated, setCorrelated] = useState(counts.cves)
  const threadRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: threadRef,
    offset: ['start 0.82', 'end 0.45'],
  })
  const progress = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: 0.4 })
  const lineWidth = useTransform(progress, [0, 1], ['0%', '100%'])
  const sparkLeft = useTransform(progress, [0, 1], ['0%', '100%'])
  const onCorrelate = useCallback(() => setCorrelated((c) => c + 1), [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const startDemo = () => {
    if (!session) {
      const analyst = demoAccounts[1]
      signIn(analyst.email, analyst.role, analyst.name)
    }
    navigate('/app')
  }

  const openComponent = (id: number) => {
    const path = componentPaths[id]
    if (session) navigate(path)
    else navigate(`/login?next=${encodeURIComponent(path)}`)
  }

  return (
    <div>
      <Ambient />

      <nav className={cx('site-nav', scrolled && 'scrolled')}>
        <div className="container nav-inner">
          <a href="#top" aria-label="Aegis Sentinel home">
            <Logo sub="Threat early warning" />
          </a>
          <div className="nav-links" aria-label="Sections">
            <a href="#problem">Problem</a>
            <a href="#thread">How it works</a>
            <a href="#scoring">Scoring</a>
            <a href="#components">Components</a>
          </div>
          <div className="nav-actions">
            <button
              className="theme-toggle"
              onClick={toggle}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
                </svg>
              )}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/login')}>
              Sign in
            </button>
            <button className="btn btn-primary btn-sm" onClick={startDemo}>
              Explore demo
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </nav>

      <header className="hero" id="top">
        <HeroScene onCorrelate={onCorrelate} />
        <div className="hero-scrim" />
        <div className="hero-vignette" />

        <div className="hero-inner">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="dot" />
              Early warning · version-aware · explainable
            </div>
            <h1>
              Know which threats <span className="serif-accent">reach</span> your systems.
              <br />
              Before they do.
            </h1>
            <p className="hero-sub">
              Aegis Sentinel correlates global vulnerability intelligence with{' '}
              <strong>your own asset inventory</strong> — down to the installed version — and tells you
              what to fix first, and why.
            </p>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={startDemo}>
                Explore the demo
                <ArrowRight size={16} />
              </button>
              <button className="btn btn-ghost" onClick={() => navigate('/login')}>
                Sign in
              </button>
            </div>
            <div className="hero-meta">
              <div className="hero-meta-item">
                <strong>{counts.cves} CVEs</strong>
                <span>NVD-seeded corpus</span>
              </div>
              <div className="hero-meta-item">
                <strong>{counts.active} alerts</strong>
                <span>scored &amp; explained</span>
              </div>
              <div className="hero-meta-item">
                <strong>{counts.suppressed} suppressed</strong>
                <span>by the version gate</span>
              </div>
              <div className="hero-meta-item">
                <strong>{posture}/100</strong>
                <span>org posture</span>
              </div>
            </div>
          </div>

          <div className="hero-counter" aria-live="off">
            <span className="count">{correlated.toString().padStart(2, '0')}</span>
            <small>
              CVEs correlated
              <br />
              this session · animated illustration
            </small>
          </div>
        </div>

        <div className="scroll-cue" aria-hidden="true">
          <span>Scroll</span>
          <span className="rail" />
        </div>

        <div className="hero-ticker" aria-label="Latest prioritised alerts">
          <div className="ticker-track">
            {[...tickerAlerts, ...tickerAlerts].map((a, i) => (
              <span className="ticker-item" key={`${a.id}-${i}`}>
                <SeverityBadge level={a.level} />
                <strong style={{ color: 'var(--text)' }}>{a.cve.id}</strong>
                <span>{a.asset.name}</span>
                <span style={{ color: 'var(--amber)' }}>{a.score.toFixed(1)}</span>
                <i className="ticker-sep" />
              </span>
            ))}
          </div>
        </div>
      </header>

      <main>
        <section className="section" id="problem">
          <div className="container">
            <Reveal>
              <div className="section-head">
                <span className="mono">01 — The problem</span>
                <h2>
                  Severity is not the same as <span className="serif-accent">danger.</span>
                </h2>
                <p>
                  Every day NVD publishes new CVEs. Very few of them touch your systems. A 9.8 on a
                  product you do not run is noise — and noise is how real emergencies get missed.
                </p>
              </div>
            </Reveal>

            <div className="problem-grid">
              <Reveal delay={0.05}>
                <article className="panel problem-card">
                  <span className="mono">Seeded corpus</span>
                  <div className="problem-num">
                    <Counter to={counts.cves} />
                  </div>
                  <div className="problem-label">CVEs in the demo window</div>
                  <p className="problem-copy">
                    Real NVD identifiers, flattened and normalised, each with CVSS, EPSS, KEV status and
                    readable version ranges.
                  </p>
                  <div className="problem-formula">
                    computed: counts of cves seeded from NVD records · source NVD
                  </div>
                  <div className="problem-foot">
                    <div className="source-cell">
                      <SourceBadge source="NVD" />
                      <span className="badge simulated">Simulated slice</span>
                    </div>
                    <span className="mono" style={{ fontSize: 8.5 }}>
                      n={counts.cves}
                    </span>
                  </div>
                </article>
              </Reveal>

              <Reveal delay={0.12}>
                <article className="panel problem-card">
                  <span className="mono">Already exploited</span>
                  <div className="problem-num">
                    <Counter to={counts.kev} />
                  </div>
                  <div className="problem-label">In the CISA KEV catalog</div>
                  <p className="problem-copy">
                    These are not theoretical. Each KEV entry carries a remediation due date that the
                    scoring engine treats as an escalation floor.
                  </p>
                  <div className="problem-formula">
                    computed: count where kev = true · join on cve_id · CISA KEV
                  </div>
                  <div className="problem-foot">
                    <div className="source-cell">
                      <SourceBadge source="CISA KEV" />
                      <SourceBadge source="FIRST EPSS" />
                    </div>
                    <span className="mono" style={{ fontSize: 8.5 }}>
                      KEV floor
                    </span>
                  </div>
                </article>
              </Reveal>

              <Reveal delay={0.19}>
                <article className="panel problem-card">
                  <span className="mono">Relevance gate</span>
                  <div className="problem-num">
                    <Counter to={counts.suppressed} />
                  </div>
                  <div className="problem-label">High-severity alerts suppressed</div>
                  <p className="problem-copy">
                    {suppressedAlerts.map((a) => a.cve.id).join(' and ')} would top a CVSS-only queue.
                    Version-aware correlation says they do not apply here.
                  </p>
                  <div className="problem-formula">
                    NOT_AFFECTED or PRODUCT_ABSENT → score 0.0 · would-have value retained
                  </div>
                  <div className="problem-foot">
                    <div className="source-cell">
                      <span className="badge suppressed">Suppressed</span>
                      <span className="badge simulated">Simulated inventory</span>
                    </div>
                    <span className="mono" style={{ fontSize: 8.5 }}>
                      n={counts.suppressed}
                    </span>
                  </div>
                </article>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="section" id="thread" style={{ paddingTop: 40 }}>
          <div className="container">
            <Reveal>
              <div className="section-head">
                <span className="mono">02 — The golden thread</span>
                <h2>
                  Five steps. One <span className="serif-accent">explainable</span> path.
                </h2>
                <p>
                  Nothing in the pipeline is a black box. Every step is deterministic, versioned, and
                  traceable back to the exact record that produced it.
                </p>
              </div>
            </Reveal>

            <div className="thread" ref={threadRef}>
              <div className="thread-track">
                <div className="thread-line" />
                <motion.div className="thread-progress" style={{ width: lineWidth }} />
                <motion.div className="thread-spark" style={{ left: sparkLeft }} aria-hidden="true" />
                {[
                  {
                    n: '01',
                    k: 'Ingest',
                    t: 'Ingest',
                    d: 'NVD, KEV, EPSS and ATT&CK arrive through cached, rate-limited adapters.',
                    icon: <RssIcon />,
                  },
                  {
                    n: '02',
                    k: 'Extract',
                    t: 'Extract',
                    d: 'Gazetteer and regex pull products, versions, CVE IDs and IPs from text.',
                    icon: <FileSearch size={16} />,
                  },
                  {
                    n: '03',
                    k: 'Correlate',
                    t: 'Correlate',
                    d: 'Vendor, product and installed version are checked against CPE ranges.',
                    icon: <ShieldCheck size={16} />,
                  },
                  {
                    n: '04',
                    k: 'Score',
                    t: 'Score',
                    d: 'Six weighted inputs produce a reproducible 0–100 risk score.',
                    icon: <SlidersHorizontal size={16} />,
                  },
                  {
                    n: '05',
                    k: 'Alert',
                    t: 'Alert',
                    d: 'A plain-language summary, impact and next action — validated, never invented.',
                    icon: <Zap size={16} />,
                  },
                ].map((s, i) => (
                  <Reveal key={s.n} delay={0.04 * i} className="thread-step">
                    <span className="thread-node">{s.n}</span>
                    <span className="mono">Step {s.n}</span>
                    <h3>{s.t}</h3>
                    <p>{s.d}</p>
                    <div className="thread-icon">{s.icon}</div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="scoring" style={{ paddingTop: 40 }}>
          <div className="container split">
            <Reveal>
              <div className="section-head" style={{ marginBottom: 0 }}>
                <span className="mono">03 — Explainability</span>
                <h2>
                  Every alert can be rebuilt, <span className="serif-accent">line by line.</span>
                </h2>
                <p>
                  No opaque model decides your risk. The score is arithmetic over six inputs, shown as
                  a waterfall. The language layer only explains it — and is validated against the same
                  facts.
                </p>
                <div className="hero-meta" style={{ marginTop: 30, maxWidth: 480 }}>
                  <div className="hero-meta-item">
                    <strong>25 + 25</strong>
                    <span>severity + EPSS</span>
                  </div>
                  <div className="hero-meta-item">
                    <strong>+10 + 25</strong>
                    <span>KEV + criticality</span>
                  </div>
                  <div className="hero-meta-item">
                    <strong>+5 + 10</strong>
                    <span>exposure + relevance</span>
                  </div>
                </div>
                <button
                  className="link-arrow"
                  style={{ marginTop: 28 }}
                  onClick={() => navigate('/login?next=%2Fapp%2Falerts')}
                >
                  Open the alert center <ArrowRight size={14} />
                </button>
                <div className="source-cell" style={{ marginTop: 26 }}>
                  <SourceBadge source="NVD" />
                  <SourceBadge source="CISA KEV" />
                  <SourceBadge source="FIRST EPSS" />
                  <span className="badge simulated">Simulated asset</span>
                </div>
              </div>
            </Reveal>

            <Reveal delay={0.1}>
              <div className="panel wf-panel">
                <div className="panel-head" style={{ padding: 0, paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
                  <div>
                    <div className="panel-title">
                      HR Portal
                      <span className="badge suppressed" style={{ marginLeft: 4 }}>
                        2.14.1
                      </span>
                    </div>
                    <div className="panel-sub">Version-aware correlation · matched</div>
                  </div>
                  <SeverityBadge level={heroAlert.level} />
                </div>
                <Waterfall alert={heroAlert} />
                <div className="wf-foot" style={{ borderTop: '1px solid var(--line)', marginTop: 12 }}>
                  <span className="mono">HR Portal · HIGH · internet-facing</span>
                  <span className="badge simulated">Simulated asset</span>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="section" style={{ paddingTop: 40 }}>
          <div className="container">
            <Reveal>
              <div className="section-head">
                <span className="mono">04 — Two roles, one signal</span>
                <h2>
                  The same signal, at two <span className="serif-accent">altitudes.</span>
                </h2>
              </div>
            </Reveal>
            <div className="roles-grid">
              {[
                {
                  index: 'Analyst',
                  title: 'Triage',
                  em: 'with the why.',
                  copy: 'A prioritised queue where every card explains its inputs, its version check, and what to do next.',
                  tags: ['Alert center', 'Provenance', 'Network graph'],
                  link: '/login?next=%2Fapp%2Falerts',
                },
                {
                  index: 'Admin',
                  title: 'Operate',
                  em: 'with full control.',
                  copy: 'Everything analysts see, plus the patch simulator, data intake and exports that change the queue.',
                  tags: ['Scoring', 'Simulator', 'Data input', 'Exports'],
                  link: '/login?next=%2Fapp%2Fscoring',
                },
              ].map((role, i) => (
                <Reveal key={role.index} delay={0.06 * i}>
                  <TiltCard className="role-card">
                    <span className="role-glow" />
                    <span className="role-index">{String(i + 1).padStart(2, '0')} / {role.index}</span>
                    <h3>
                      {role.title}
                      <em>{role.em}</em>
                    </h3>
                    <p>{role.copy}</p>
                    <div className="role-list">
                      {role.tags.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                    <div className="role-foot">
                      <button className="link-arrow" onClick={() => navigate(role.link)}>
                        Enter as {role.index.toLowerCase()} <ArrowRight size={14} />
                      </button>
                      <Sparkles size={14} style={{ color: 'var(--text-mute)' }} />
                    </div>
                  </TiltCard>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="components" style={{ paddingTop: 40 }}>
          <div className="container">
            <Reveal>
              <div className="section-head">
                <span className="mono">05 — The surface</span>
                <h2>
                  Sixteen components. One <span className="serif-accent">decision.</span>
                </h2>
                <p>
                  Each surface carries graphics and a statistics layer, with formulas, sample sizes and
                  windows attached. Click a tile to open its demo.
                </p>
              </div>
            </Reveal>
            <div className="showcase-grid">
              {componentCatalog.map((c, i) => (
                <Reveal key={c.id} delay={(i % 4) * 0.04} y={14}>
                  <button className="tile" onClick={() => openComponent(c.id)} style={{ width: '100%', textAlign: 'left' }}>
                    <span className="tile-top">
                      <span className="tile-icon">
                        <CatalogIcon name={c.icon} size={16} />
                      </span>
                      <span className="tile-num">{String(c.id).padStart(2, '0')}</span>
                    </span>
                    <h4>{c.name}</h4>
                    <p>{c.tagline}</p>
                    <span className="tile-spark">
                      <Sparkline
                        values={Array.from({ length: 11 }, (_, k) =>
                          Math.max(4, 10 + Math.sin(k * 0.9 + c.id) * 6 + (k % 3) * 2),
                        )}
                        width={72}
                        height={22}
                        color={i % 3 === 0 ? '#e3a455' : i % 3 === 1 ? '#3ed2c1' : '#9b7bd4'}
                      />
                    </span>
                    <span
                      className="mono"
                      style={{ position: 'absolute', left: 20, bottom: 16, fontSize: 8, opacity: 0.8 }}
                    >
                      {c.group}
                    </span>
                  </button>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="section" style={{ paddingTop: 20 }}>
          <div className="container">
            <Reveal>
              <div className="cta-panel">
                <div className="cta-grid-mark" aria-hidden="true" />
                <div style={{ position: 'relative' }}>
                  <span className="eyebrow">
                    <span className="dot" />
                    Demo mode · offline seed
                  </span>
                  <h2 style={{ marginTop: 20 }}>
                    See your own exposure
                    <br />
                    in <span className="serif-accent">five minutes.</span>
                  </h2>
                  <p className="dim" style={{ marginTop: 18, maxWidth: 480, fontSize: 14 }}>
                    Explore the seeded organisation, open a 99.4 Log4Shell alert, then patch it in the
                    simulator and watch the queue change.
                  </p>
                </div>
                <div className="cta-actions">
                  <button className="btn btn-primary" onClick={startDemo}>
                    Enter the demo
                    <ArrowRight size={16} />
                  </button>
                  <button className="btn btn-ghost" onClick={() => navigate('/login')}>
                    Sign in
                  </button>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container">
          <div className="footer-grid">
            <div>
              <span className="brand">
                <LogoMark />
                <span>
                  Aegis Sentinel
                  <small>Threat early warning</small>
                </span>
              </span>
              <p className="footer-note">
                Turns raw threat intelligence into asset-specific, risk-ranked, explainable early
                warning. Customer data stays in this deployment.
              </p>
            </div>
            <div>
              <h5>Data sources</h5>
              <ul>
                <li>NVD CVE API 2.0</li>
                <li>CISA KEV catalog</li>
                <li>FIRST EPSS</li>
                <li>MITRE ATT&CK</li>
                <li>CERT-In (sample feed)</li>
              </ul>
            </div>
            <div>
              <h5>Platform</h5>
              <ul>
                <li><a href="#problem">Problem</a></li>
                <li><a href="#thread">How it works</a></li>
                <li><a href="#scoring">Scoring</a></li>
                <li><a href="#components">Components</a></li>
              </ul>
            </div>
            <div>
              <h5>Demo</h5>
              <ul>
                <li>admin@aegis.demo</li>
                <li>analyst@aegis.demo</li>
                <li style={{ paddingTop: 10, color: 'var(--text-mute)', fontSize: 11.5 }}>
                  Demo data is simulated and labelled. CVEs are real identifiers.
                </li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <span className="mono">© 2026 Aegis Sentinel · formula v1.1 · demo build</span>
            <div className="footer-badges">
              <span className="badge simulated">Simulated data labelled</span>
              <span className="badge upload">User uploads quarantined</span>
              <span className="badge real">Deterministic core</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

function RssIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" fill="currentColor" />
    </svg>
  )
}
