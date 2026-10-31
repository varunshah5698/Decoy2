export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN)
export const median = (xs: number[]) => quantile(xs, 0.5)
export const p95 = (xs: number[]) => quantile(xs, 0.95)
export const p99 = (xs: number[]) => quantile(xs, 0.99)

export function quantile(xs: number[], q: number) {
  if (!xs.length) return NaN
  const sorted = [...xs].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base]
}

export function stdev(xs: number[]) {
  if (xs.length < 2) return NaN
  const m = mean(xs)
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1))
}

export function rank(xs: number[]) {
  const sorted = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x)
  const ranks = new Array(xs.length).fill(0)
  sorted.forEach((item, index) => {
    ranks[item.i] = index + 1
  })
  return ranks
}

export function spearman(xs: number[], ys: number[]) {
  if (xs.length < 3) return NaN
  const rx = rank(xs)
  const ry = rank(ys)
  const mx = mean(rx)
  const my = mean(ry)
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < xs.length; i += 1) {
    num += (rx[i] - mx) * (ry[i] - my)
    dx += (rx[i] - mx) ** 2
    dy += (ry[i] - my) ** 2
  }
  return num / Math.sqrt(dx * dy)
}

export function entropy(values: string[]) {
  if (!values.length) return 0
  const counts = new Map<string, number>()
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1))
  return [...counts.values()].reduce((acc, c) => {
    const p = c / values.length
    return acc - p * Math.log2(p)
  }, 0)
}

export function trendSlope(ys: number[]) {
  if (ys.length < 2) return { slope: NaN, r2: NaN, n: ys.length }
  const xs = ys.map((_, i) => i)
  const mx = mean(xs)
  const my = mean(ys)
  const num = sum(xs.map((x, i) => (x - mx) * (ys[i] - my)))
  const den = sum(xs.map((x) => (x - mx) ** 2))
  const slope = num / den
  const intercept = my - slope * mx
  const ssTot = sum(ys.map((y) => (y - my) ** 2))
  const ssRes = sum(ys.map((y, i) => (y - (intercept + slope * xs[i])) ** 2))
  return { slope, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot, n: ys.length }
}

export function groupBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item)
    ;(acc[k] ??= []).push(item)
    return acc
  }, {})
}

export function countBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const k = key(item)
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})
}

export function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
