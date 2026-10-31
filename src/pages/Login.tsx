import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Ambient } from '../components/Ambient'
import { Logo, LogoMark } from '../components/Logo'
import { ShieldScene } from '../scenes/ShieldScene'
import { AlertTriangle, ArrowRight, Eye, EyeOff, Lock, ShieldCheck, User } from '../components/Icons'
import { demoAccounts, useAuth, useTheme } from '../lib/store'
import { cx } from '../lib/format'

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
    <div className="login-page">
      <Ambient />

      <section className="login-scene">
        <ShieldScene status={status} />
        <div className="login-scene-top">
          <Link to="/" aria-label="Back to Aegis Sentinel home">
            <Logo sub="Threat early warning" />
          </Link>
        </div>

        <div className="scene-readout" aria-hidden="true">
          <div><i /> Session · httpOnly cookie</div>
          <div><i /> Deploy · offline seed</div>
          <div><i /> Formula v1.1</div>
        </div>

        <div className="login-scene-copy">
          <div className="eyebrow">
            <span className="dot" />
            Identity check
          </div>
          <h2>
            One shield.
            <em>Every asset.</em>
          </h2>
          <p>
            Sign in to the command centre. The version-aware matcher is already running against 16
            simulated assets and {demoAccounts.length} demo roles.
          </p>
          <div className="source-cell" style={{ marginTop: 24 }}>
            <span className="badge simulated">Simulated environment</span>
            <span className="badge real">Deterministic scores</span>
          </div>
        </div>
      </section>

      <section className="login-form-side">
        <div className="login-form-wrap">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 44 }}>
            <span className="brand" style={{ fontSize: 11 }}>
              <LogoMark />
              <span>
                Aegis Sentinel
                <small>Secure sign in</small>
              </span>
            </span>
            <button
              className="theme-toggle"
              onClick={toggle}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>

          <h1>Enter the command centre.</h1>
          <p>Two roles are available in this deployment: admin and analyst.</p>

          <form className="login-form" onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="email">Email</label>
              <div className="field-wrap">
                <User size={15} />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
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
                <div className="field-error" id="email-error" role="alert">
                  {fieldErrors.email}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="field-wrap">
                <Lock size={15} />
                <input
                  id="password"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="At least 12 characters"
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
                  className="reveal"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Hide password' : 'Show password'}
                  aria-pressed={show}
                >
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {fieldErrors.password && (
                <div className="field-error" id="password-error" role="alert">
                  {fieldErrors.password}
                </div>
              )}
            </div>

            <div className="form-row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember this device
              </label>
              <span className="mono" style={{ fontSize: 8.5 }}>
                {remember ? '24h session' : '8h session'}
              </span>
            </div>

            <div aria-live="polite">
              {error && (
                <div className="form-alert" role="alert">
                  <AlertTriangle size={14} />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <button className={cx('btn', 'btn-primary', 'full')} type="submit" disabled={busy || status === 'success'}>
              {status === 'success' ? 'Shield aligned — entering' : busy ? 'Verifying…' : 'Sign in'}
              {status !== 'success' && <ArrowRight size={15} />}
            </button>
          </form>

          <div className="demo-block">
            <div className="demo-title">
              <span className="mono" style={{ fontSize: 8.5 }}>
                Demo accounts
              </span>
              <span className="line" />
              <span className="mono" style={{ fontSize: 8 }}>
                DEMO_MODE
              </span>
            </div>
            <div className="demo-grid">
              {demoAccounts.map((a, i) => (
                <button key={a.role} className="demo-btn" onClick={() => useDemo(i)} type="button">
                  <strong>{a.label}</strong>
                  <span>{a.role}</span>
                  <em>{a.access}</em>
                </button>
              ))}
            </div>
            <p className="mono" style={{ fontSize: 8, marginTop: 10, lineHeight: 1.7, letterSpacing: '0.04em' }}>
              Password: {DEMO_PASSWORD} · one-click demo only
            </p>
          </div>

          <div className="login-security">
            <ShieldCheck size={13} />
            <span>
              Sessions use httpOnly, SameSite cookies. Analyst accounts cannot ingest data, run simulations
              or export the alert queue. Accounts lock after five failed attempts.
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
