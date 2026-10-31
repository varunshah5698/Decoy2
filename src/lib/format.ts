export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

export const round = (n: number, digits = 1) => {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

export const fmtInt = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n))

export const fmtPct = (n: number, digits = 1) => `${round(n * 100, digits)}%`

export const fmtScore = (n: number) => round(n, 1).toFixed(1)

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export const fmtDateShort = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

export const timeAgo = (iso: string, now = new Date()) => {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime())
  const mins = Math.round(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

export const todayLabel = (d = new Date()) =>
  d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
