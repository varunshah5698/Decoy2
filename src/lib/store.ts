import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light'
export type Role = 'ADMIN' | 'ANALYST'
export type SeverityFilter = 'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type SourceFilter = 'ALL' | 'REAL' | 'USER UPLOAD' | 'SIMULATED'
export type TimeRange = '7d' | '30d' | '90d' | 'ALL'

interface ThemeState {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      toggle: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'aegis.theme' },
  ),
)

interface Session {
  email: string
  name: string
  role: Role
  signedInAt: string
}

interface AuthState {
  session: Session | null
  signIn: (email: string, role: Role, name: string) => void
  signOut: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      session: null,
      signIn: (email, role, name) =>
        set({ session: { email, role, name, signedInAt: new Date().toISOString() } }),
      signOut: () => set({ session: null }),
    }),
    {
      name: 'aegis.session',
      version: 2,
      migrate: (persisted: any) => {
        const session = persisted?.session
        if (session && session.role !== 'ADMIN' && session.role !== 'ANALYST') {
          return { ...persisted, session: { ...session, role: 'ANALYST' } }
        }
        return persisted
      },
    },
  ),
)

export const demoAccounts: { role: Role; email: string; name: string; label: string; access: string }[] = [
  {
    role: 'ADMIN',
    email: 'admin@aegis.demo',
    name: 'Meera Iyer',
    label: 'Admin',
    access: 'Full workspace · ingestion and simulation',
  },
  {
    role: 'ANALYST',
    email: 'analyst@aegis.demo',
    name: 'Dev Sharma',
    label: 'Analyst',
    access: 'Triage and investigation · no ingestion',
  },
]

interface FilterState {
  query: string
  severity: SeverityFilter
  source: SourceFilter
  range: TimeRange
  setQuery: (q: string) => void
  setSeverity: (s: SeverityFilter) => void
  setSource: (s: SourceFilter) => void
  setRange: (r: TimeRange) => void
}

export const useFilters = create<FilterState>((set) => ({
  query: '',
  severity: 'ALL',
  source: 'ALL',
  range: '30d',
  setQuery: (query) => set({ query }),
  setSeverity: (severity) => set({ severity }),
  setSource: (source) => set({ source }),
  setRange: (range) => set({ range }),
}))

interface AckEntry {
  by: string
  at: string
  note?: string
}

interface AckState {
  acks: Record<string, AckEntry>
  ack: (alertId: string, by: string, note?: string) => void
  reset: () => void
}

const seedAcks: Record<string, AckEntry> = {
  'ALR-1011': {
    by: 'Dev Sharma',
    at: new Date('2026-10-30T15:20:00Z').toISOString(),
    note: 'Browser fleet update scheduled for tonight.',
  },
  'ALR-1009': {
    by: 'Meera Iyer',
    at: new Date('2026-10-29T11:05:00Z').toISOString(),
    note: 'Accepted risk until the HR release window.',
  },
}

export const useAcks = create<AckState>()(
  persist(
    (set) => ({
      acks: seedAcks,
      ack: (alertId, by, note) =>
        set((s) => ({ acks: { ...s.acks, [alertId]: { by, at: new Date().toISOString(), note } } })),
      reset: () => set({ acks: seedAcks }),
    }),
    { name: 'aegis.acks' },
  ),
)

interface ToastState {
  message: string | null
  show: (message: string) => void
  clear: () => void
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  show: (message) => set({ message }),
  clear: () => set({ message: null }),
}))
