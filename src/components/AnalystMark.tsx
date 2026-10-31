import { Sparkles } from './Icons'
import { cx } from '../lib/format'

export function AnalystMark({
  size = 32,
  live = false,
  className,
}: {
  size?: number
  live?: boolean
  className?: string
}) {
  return (
    <span
      className={cx('ai-mark', live && 'is-live', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="ai-mark-halo" />
      <span className="ai-mark-core">
        <Sparkles size={Math.max(11, Math.round(size * 0.42))} strokeWidth={1.7} />
      </span>
    </span>
  )
}
