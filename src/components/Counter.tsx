import { useEffect, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

export function Counter({
  to,
  duration = 1600,
  decimals = 0,
  suffix = '',
  prefix = '',
  start = 0,
}: {
  to: number
  duration?: number
  decimals?: number
  suffix?: string
  prefix?: string
  start?: number
}) {
  const reduce = useReducedMotion()
  const [value, setValue] = useState(reduce ? to : start)

  useEffect(() => {
    if (reduce) {
      setValue(to)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(start + (to - start) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, start, duration, reduce])

  return (
    <span>
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  )
}
