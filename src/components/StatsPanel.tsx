import { AlertTriangle } from './Icons'
import { Panel } from './Panel'

export interface Stat {
  name: string
  value: string
  formula: string
  n: number
  note?: string
  small?: boolean
}

export function StatsPanel({
  stats,
  title = 'Statistics',
  sub = 'Computed from the seeded demo window · not a production claim',
  className,
}: {
  stats: Stat[]
  title?: string
  sub?: string
  className?: string
}) {
  return (
    <Panel
      title={title}
      sub={sub}
      className={className}
      bodyClass="panel-body"
      action={<span className="mono" style={{ fontSize: 8.5 }}>Layer B</span>}
    >
      <div className="stats-grid">
        {stats.map((s) => (
          <div className="stat-row" key={s.name}>
            <span className="stat-name">
              {s.name}
              {s.note && (
                <span className="cell-sub" style={{ display: 'block', fontSize: 9.5 }}>
                  {s.note}
                </span>
              )}
            </span>
            <span className="stat-value">
              {s.value}
              {(s.small || s.n < 30) && (
                <span className="stat-warning" title="Small sample: interpret with caution">
                  <AlertTriangle size={9} /> small n
                </span>
              )}
            </span>
            <span className="stat-formula">{s.formula}</span>
            <span className="stat-n">n={s.n}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}
