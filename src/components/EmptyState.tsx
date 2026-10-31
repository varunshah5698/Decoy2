import { FileSearch } from './Icons'

export function EmptyState({ title = 'Nothing to show', hint }: { title?: string; hint?: string }) {
  return (
    <div className="empty-state">
      <FileSearch size={26} />
      <div style={{ color: 'var(--text-dim)', fontWeight: 500 }}>{title}</div>
      {hint && <div style={{ marginTop: 4, fontSize: 11.5 }}>{hint}</div>}
    </div>
  )
}
