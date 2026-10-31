import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Clock, Moon, Sun } from 'lucide-react'
import { Ambient } from '../components/Ambient'
import { LogoMark } from '../components/Logo'
import { ShieldScene } from '../scenes/ShieldScene'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  User,
} from '../components/Icons'
import { demoAccounts, useAuth, useTheme } from '../lib/store'
import { assets, counts } from '../data/seed'
import './Login.css'

const DEMO_PASSWORD = 'aegis-demo-2026'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/app'
  const { theme, toggle } = useTheme()
  const signIn = useAuth((s) => s.signIn)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [busy, setBusy] = useState(false)
  const attempts = useRef<number[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const locked = () => {
    const now = Date.now()
    attempts.current = attempts.current.filter((t) => now - t < 10 * 60 * 1000)
    return attempts.current.length >= 5
  }

  const fail = (message: string) => {
    attempts.current.push(Date.now())
    setError(message)
    setStatus('error')
    setTimeout(() => setStatus('idle'), 900)
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (busy) return
    if (locked()) {
      setError('Too many attempts. Try again later.')
      return
    }
    const errors: { email?: string; password?: string } = {}
    if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.'
    if (password.length < 12) errors.password = 'Passwords are at least 12 characters.'
    setFieldErrors(errors)
    if (Object.keys(errors).length) return

    setBusy(true)
    setError(null)
    const account = demoAccounts.find((a) => a.email.toLowerCase() === email.toLowerCase())
    const ok = account && password === DEMO_PASSWORD
    if (!ok) {
      setBusy(false)
      fail('Email or password is incorrect.')
      return
    }
    setStatus('success')
    setTimeout(() => {
      signIn(account.email, account.role, account.name)
      navigate(next, { replace: true })
    }, 900)
  }

  const useDemo = (roleIndex: number) => {
    const account = demoAccounts[roleIndex]
    setEmail(account.email)
    setPassword(DEMO_PASSWORD)
    setFieldErrors({})
    setError(null)
    setStatus('success')
    setBusy(true)
    setTimeout(() => {
      signIn(account.email, account.role, account.name)
      navigate(next, { replace: true })
    }, 700)
  }

  return (
    <div className="auth">
      <Ambient />

      <header className="auth-top">
        <Link to="/" className="auth-brand" aria-label="Back to Aegis Sentinel home">
          <LogoMark />
          <span className="auth-brand-text">
            Aegis Sentinel
            <small>Threat early warning</small>
          </span>
        </Link>

        <div className="auth-top-actions">
          <span className="auth-system">
            <i />
            Matcher online
          </span>
          <Link to="/" className="auth-back">
            Back to overview
            <ArrowRight size={13} />
          </Link>
          <button
            type="button"
            className="theme-toggle auth-theme"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <main className="auth-main">
        <section className="auth-visual" aria-label="Aegis Sentinel perimeter status">
          <ShieldScene status={status} />
          <div className="auth-visual-scrim" aria-hidden="true" />
          <div className="auth-rings" aria-hidden="true" />

          <div className="auth-scene-top" aria-hidden="true">
            <span>Perimeter feed</span>
            <span className="auth-scene-state">
              <i />
              Live
            </span>
          </div>

          <div className="auth-visual-copy">
            <h2>
              One shield.
              <em>Every asset.</em>
            </h2>
            <p>
              Sign in to the command centre. The version-aware matcher is already running against{' '}
              {assets.length} simulated assets and {demoAccounts.length} demo roles.
            </p>
            <div className="auth-visual-tags">
              <span className="badge simulated">Simulated environment</span>
              <span className="badge real">Deterministic scores</span>
            </div>
          </div>

          <div className="auth-rail" aria-hidden="true">
            <span>Session · cookie</span>
            <span>Matcher · v1.1</span>
            <span>Data · seeded</span>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-panel-inner">
            <h1>
              <span>Enter the</span>
              <span>command centre.</span>
            </h1>
            <p className="auth-sub">
              Two roles are provisioned for this deployment — admin and analyst.
            </p>

            <form className="auth-form" onSubmit={submit} noValidate>
              <div className="auth-field">
                <div className="auth-label-row">
                  <label htmlFor="email">Email</label>
                </div>
                <div className="auth-input">
                  <User size={16} />
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="analyst@aegis.demo"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      setFieldErrors((f) => ({ ...f, email: undefined }))
                    }}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                  />
                </div>
                {fieldErrors.email && (
                  <div className="auth-field-error" id="email-error" role="alert">
                    {fieldErrors.email}
                  </div>
                )}
              </div>

              <div className="auth-field">
                <div className="auth-label-row">
                  <label htmlFor="password">Password</label>
                  <span className="auth-hint">12 characters minimum</span>
                </div>
                <div className="auth-input">
                  <Lock size={16} />
                  <input
                    id="password"
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      setFieldErrors((f) => ({ ...f, password: undefined }))
                    }}
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                  />
                  <button
                    type="button"
                    className="auth-reveal"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    aria-pressed={show}
                  >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <div className="auth-field-error" id="password-error" role="alert">
                    {fieldErrors.password}
                  </div>
                )}
              </div>

              <div className="auth-options">
                <label className="auth-check">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  <span className="auth-check-box" aria-hidden="true">
                    <Check size={11} />
                  </span>
                  <span>Remember this device</span>
                </label>
                <span className="auth-session">
                  <Clock size={12} />
                  {remember ? '24 h session' : '8 h session'}
                </span>
              </div>

              <div aria-live="polite">
                {error && (
                  <div className="auth-alert" role="alert">
                    <AlertTriangle size={15} />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <button
                className="btn btn-primary auth-submit"
                type="submit"
                disabled={busy || status === 'success'}
              >
                {status === 'success' ? (
                  <>
                    Access granted
                    <Check size={16} />
                  </>
                ) : busy ? (
                  <>
                    Verifying…
                    <i className="auth-spinner" aria-hidden="true" />
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>

            <section className="auth-demo" aria-labelledby="demo-title">
              <div className="auth-demo-head">
                <h2 id="demo-title">Demo access</h2>
                <span className="auth-demo-mode">Demo mode</span>
              </div>
              <div className="auth-demo-list">
                {demoAccounts.map((a, i) => (
                  <button
                    key={a.role}
                    className="auth-demo-row"
                    onClick={() => useDemo(i)}
                    disabled={busy || status === 'success'}
                    type="button"
                  >
                    <span className="auth-demo-icon" aria-hidden="true">
                      {a.role === 'ADMIN' ? <ShieldCheck size={16} /> : <User size={16} />}
                    </span>
                    <span className="auth-demo-body">
                      <span className="auth-demo-title">
                        <strong>{a.label}</strong>
                        <span className="auth-demo-email">{a.email}</span>
                      </span>
                      <span className="auth-demo-scope">{a.access}</span>
                    </span>
                    <ArrowRight className="auth-demo-go" size={16} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <p className="auth-demo-note">
                Shared password <code>{DEMO_PASSWORD}</code> is filled in for you.
              </p>
            </section>

            <p className="auth-security">
              <ShieldCheck size={14} />
              <span>httpOnly, SameSite sessions · accounts lock after five failed attempts.</span>
            </p>
          </div>
        </section>
      </main>

      <footer className="auth-foot" aria-hidden="true">
        <span className="auth-foot-id">Aegis Sentinel · Secure access</span>
        <span className="auth-foot-mid">
          <i />
          {assets.length} assets · {counts.cves} CVEs · matcher v1.1
        </span>
        <span className="auth-foot-end">Simulated environment</span>
      </footer>
    </div>
  )
}
