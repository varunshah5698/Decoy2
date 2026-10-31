import type { Role } from './store'

export const ADMIN_ONLY_IDS = new Set([10, 16])

export const restrictedRoutes = [
  {
    id: 16,
    path: '/app/uploads',
    name: 'Data Uploads',
    reason: 'Source ingestion changes the evidence every score depends on.',
  },
  {
    id: 10,
    path: '/app/simulator',
    name: 'What-If Simulator',
    reason: 'Scenario runs can model asset changes that look like production state.',
  },
] as const

export const isAdmin = (role?: Role | null) => role === 'ADMIN'

export const canAccess = (role: Role | undefined, id: number) => isAdmin(role) || !ADMIN_ONLY_IDS.has(id)
