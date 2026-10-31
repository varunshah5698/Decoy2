import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Logo, LogoMark } from '../components/Logo'
import { Ambient } from '../components/Ambient'
import {
  Bell,
  CatalogIcon,
  Lock,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  ShieldCheck,
} from '../components/Icons'
import { componentCatalog, counts, DEMO_NOW } from '../data/seed'
import { useAuth, useFilters, useTheme, useToast } from '../lib/store'
import { useAiPanel } from '../lib/aiStore'
import { allUploadedAssets, useUploads } from '../lib/uploads'
import { AnalystMark } from '../components/AnalystMark'
import { navGroups, pageTitle, routeById } from './catalog'
import { canAccess } from '../lib/access'
import { cx, initials } from '../lib/format'

export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useAuth((s) => s.session)
  const signOut = useAuth((s) => s.signOut)
  const theme = useTheme((s) => s.theme)
  const toggle = useTheme((s) => s.toggle)
  const query = useFilters((s) => s.query)
  const setQuery = useFilters((s) => s.setQuery)
  const showToast = useToast((s) => s.show)
  const aiStreaming = useAiPanel((s) => s.streaming)
  const uploadDatasets = useUploads((s) => s.datasets)
  const inventoryCount = 16 + allUploadedAssets(uploadDatasets).length
  const [mobileOpen, setMobileOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const title = pageTitle(location.pathname)

  useEffect(() => setMobileOpen(false), [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        if (location.pathname === '/app/ai') window.dispatchEvent(new Event('aegis-ai-focus'))
        else navigate('/app/ai')
        return
      }
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [location.pathname, navigate])

  const logout = () => {
    signOut()
    navigate('/')
  }

  return (
    <div className="app">
      <Ambient />
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={cx('sidebar', mobileOpen && 'open')}>
        <div className="sidebar-head">
          <NavLink to="/" aria-label="Aegis Sentinel home">
            <Logo sub="Threat early warning" />
          </NavLink>
        </div>

        <div className="org-card">
          <span className="org-avatar">AS</span>
          <div style={{ minWidth: 0 }}>
            <strong>Aegis Demo Org</strong>
            <span>{counts.active} active · {inventoryCount} assets</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Components">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.ids.map((id) => {
                const c = componentCatalog.find((x) => x.id === id)!
                const locked = !canAccess(session?.role, id)
                return (
                  <NavLink
                    key={id}
                    to={routeById[id]}
                    end={routeById[id] === '/app'}
                    title={locked ? 'Admin access required' : undefined}
                    className={({ isActive }) => cx('nav-item', isActive && 'active', locked && 'locked')}
                  >
                    <CatalogIcon name={c.icon} size={15} />
                    <span>{c.name}</span>
                    <span className="nav-num">
                      {locked ? <Lock size={10} aria-label="Admin only" /> : String(id).padStart(2, '0')}
                    </span>
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="status-line">
            <i className="status-dot" />
            Demo seed · offline
            <span style={{ marginLeft: 'auto', opacity: 0.7 }}>v1.1</span>
          </div>
          <div className="user-pill" style={{ cursor: 'default' }}>
            <span className="user-avatar">{initials(session?.name ?? 'Demo User')}</span>
            <div style={{ minWidth: 0 }}>
              <strong>{session?.name ?? 'Demo User'}</strong>
              <span>{session?.role ?? 'ANALYST'}</span>
            </div>
            <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button className="icon-btn mobile-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu size={18} />
          </button>
          <div className="topbar-title">
            <strong>{title.title}</strong>
            <span>{title.sub}</span>
          </div>

          <div className="topbar-search">
            <Search size={14} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search CVE, asset, IP, technique…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  navigate('/app/alerts')
                  searchRef.current?.blur()
                }
              }}
              aria-label="Global search"
            />
            <kbd>/</kbd>
          </div>

          <div className="topbar-actions">
            <NavLink
              to="/app/ai"
              className={({ isActive }) => cx('ai-trigger', isActive && 'active')}
              aria-label="Open Aegis Copilot"
              title="Aegis Copilot (Ctrl/⌘ + I)"
            >
              <AnalystMark size={19} live={aiStreaming} />
              <span className="ai-trigger-label">Ask Aegis</span>
              <kbd className="ai-trigger-kbd">⌘I</kbd>
            </NavLink>
            <span className="topbar-chip live">
              <i className="dot" style={{ background: 'var(--amber)', boxShadow: '0 0 8px var(--amber)' }} />
              DEMO
            </span>
            <span className="topbar-chip hide-sm">
              <RefreshCw size={11} />
              Updated {DEMO_NOW.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
            </span>
            <button
              className="icon-btn hide-sm"
              aria-label="Source health"
              onClick={() => showToast('All demo sources healthy · CERT-In marked degraded')}
            >
              <ShieldCheck size={15} />
            </button>
            <button
              className="icon-btn"
              aria-label="Notifications"
              onClick={() => showToast(`${counts.active} active alerts · ${counts.critical} critical`)}
            >
              <Bell size={15} />
            </button>
            <button
              className="icon-btn hide-sm"
              onClick={toggle}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
                </svg>
              )}
            </button>
          </div>
        </header>

        <main>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
