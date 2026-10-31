import { componentCatalog } from '../data/seed'

export const routeById: Record<number, string> = {
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

export const navGroups = [
  { label: 'Assistant', ids: [17] },
  { label: 'Command', ids: [1, 2, 3] },
  { label: 'Assets & vulnerabilities', ids: [6, 7] },
  { label: 'Threat intelligence', ids: [8, 14, 12] },
  { label: 'Operations & analytics', ids: [9, 15, 11] },
  { label: 'Investigation', ids: [4, 5, 13] },
  { label: 'Scenarios', ids: [10] },
  { label: 'Data', ids: [16] },
]

export const componentByPath = (pathname: string) => {
  const entry = Object.entries(routeById).find(([, path]) =>
    path === '/app' ? pathname === '/app' : pathname === path || pathname.startsWith(`${path}/`),
  )
  const id = entry ? Number(entry[0]) : 1
  return componentCatalog.find((c) => c.id === id) ?? componentCatalog[0]
}

export const pageTitle = (pathname: string) => {
  const c = componentByPath(pathname)
  return { title: c.name, sub: `Component ${String(c.id).padStart(2, '0')} · ${c.group}` }
}
