import { useEffect } from 'react'

export function Ambient() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    let frame = 0
    const onMove = (e: PointerEvent) => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        const el = document.documentElement
        const dx = (e.clientX / window.innerWidth - 0.5) * 60
        const dy = (e.clientY / window.innerHeight - 0.5) * 60
        el.style.setProperty('--mx', `${dx.toFixed(1)}px`)
        el.style.setProperty('--my', `${dy.toFixed(1)}px`)
        frame = 0
      })
    }
    const onScroll = () => {
      const el = document.documentElement
      el.style.setProperty('--sy', `${(window.scrollY % 1400) * 0.08}px`)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <>
      <div className="ambient" aria-hidden="true">
        <div className="ambient-band" />
      </div>
      <div className="grain" aria-hidden="true" />
    </>
  )
}
