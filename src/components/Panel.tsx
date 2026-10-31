import type { ReactNode } from 'react'
import { cx } from '../lib/format'

export function Panel({
  title,
  sub,
  action,
  children,
  className,
  bodyClass,
  noPad,
  id,
  spotlight,
}: {
  title?: ReactNode
  sub?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
  noPad?: boolean
  id?: string
  spotlight?: boolean
}) {
  return (
    <section
      className={cx('panel', spotlight && 'spotlight', className)}
      id={id}
      onPointerMove={
        spotlight
          ? (e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`)
              e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`)
            }
          : undefined
      }
    >
      <span className="panel-tick" aria-hidden="true" />
      {(title || action) && (
        <header className="panel-head">
          <div>
            {title && <h2 className="panel-title">{title}</h2>}
            {sub && <div className="panel-sub">{sub}</div>}
          </div>
          {action && <div>{action}</div>}
        </header>
      )}
      <div className={cx(noPad ? undefined : 'panel-body', bodyClass)}>{children}</div>
    </section>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        <span className="mono">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  )
}
