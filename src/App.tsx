import { useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './app/AppShell'
import { ToastHost } from './components/Toast'
import { useAuth, useTheme } from './lib/store'
import Landing from './pages/Landing'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import Alerts from './pages/app/Alerts'
import Anomalies from './pages/app/Anomalies'
import Assets from './pages/app/Assets'
import Attacks from './pages/app/Attacks'
import Cves from './pages/app/Cves'
import Dashboard from './pages/app/Dashboard'
import Graph from './pages/app/Graph'
import Intel from './pages/app/Intel'
import Mitre from './pages/app/Mitre'
import Provenance from './pages/app/Provenance'
import RadarPage from './pages/app/Radar'
import Restricted from './pages/app/Restricted'
import Scoring from './pages/app/Scoring'
import Simulator from './pages/app/Simulator'
import ThreatMap from './pages/app/ThreatMap'
import Traffic from './pages/app/Traffic'
import Uploads from './pages/app/Uploads'

function ThemeSync() {
  const theme = useTheme((s) => s.theme)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#05080e' : '#f1eee7')
  }, [theme])
  return null
}

function ScrollTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])
  return null
}

function Protected({ children }: { children: ReactNode }) {
  const session = useAuth((s) => s.session)
  const location = useLocation()
  if (!session) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  return <>{children}</>
}

function AdminOnly({ moduleName, children }: { moduleName: string; children: ReactNode }) {
  const role = useAuth((s) => s.session?.role)
  if (role !== 'ADMIN') return <Restricted moduleName={moduleName} />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeSync />
      <ScrollTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/app"
          element={
            <Protected>
              <AppShell />
            </Protected>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="scoring" element={<Scoring />} />
          <Route path="assets" element={<Assets />} />
          <Route path="cves" element={<Cves />} />
          <Route path="intel" element={<Intel />} />
          <Route path="graph" element={<Graph />} />
          <Route path="attacks" element={<Attacks />} />
          <Route path="anomalies" element={<Anomalies />} />
          <Route
            path="simulator"
            element={
              <AdminOnly moduleName="What-if Simulator">
                <Simulator />
              </AdminOnly>
            }
          />
          <Route path="mitre" element={<Mitre />} />
          <Route path="map" element={<ThreatMap />} />
          <Route path="provenance" element={<Provenance />} />
          <Route path="radar" element={<RadarPage />} />
          <Route path="traffic" element={<Traffic />} />
          <Route
            path="uploads"
            element={
              <AdminOnly moduleName="Data Uploads">
                <Uploads />
              </AdminOnly>
            }
          />
          <Route path="*" element={<NotFound inApp />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <ToastHost />
    </BrowserRouter>
  )
}
