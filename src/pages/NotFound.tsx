import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { ArrowRight, Compass } from '../components/Icons'

export default function NotFound({ inApp }: { inApp?: boolean }) {
  return (
    <div
      className={inApp ? undefined : 'notfound'}
      style={
        inApp
          ? { minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 40 }
          : undefined
      }
    >
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        {!inApp && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
            <Logo />
          </div>
        )}
        <span className="eyebrow" style={{ justifyContent: 'center' }}>
          <span className="dot" /> 404 · off the map
        </span>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 40,
            fontWeight: 500,
            letterSpacing: '-0.04em',
            marginTop: 14,
          }}
        >
          This route is not in the <span className="serif-accent">inventory</span>.
        </h1>
        <p style={{ color: 'var(--text-dim)', marginTop: 12, fontSize: 14 }}>
          The page you asked for does not exist. Everything the demo does live under the sixteen
          components inside the command centre.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
          <Link className="btn btn-primary" to={inApp ? '/app' : '/'}>
            {inApp ? 'Back to dashboard' : 'Return home'} <ArrowRight size={14} />
          </Link>
          {!inApp && (
            <Link className="btn btn-ghost" to="/login">
              <Compass size={14} /> Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
