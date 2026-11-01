import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, ChevronDown, Database, FileSearch, Layers } from './Icons'
import { useEstate } from '../lib/estate'
import { ALL_DATASETS, useUploads, type UploadedDataset } from '../lib/uploads'
import { useToast } from '../lib/store'
import { fmtInt, cx, timeAgo } from '../lib/format'

const scopeIcon = (dataset?: UploadedDataset) =>
  dataset?.type === 'Logs' ? FileSearch : dataset?.type === 'Assets' ? Database : Layers

const datasetCount = (d: UploadedDataset) =>
  d.type === 'Logs' ? `${fmtInt(d.events?.length ?? d.logs?.total ?? 0)} events` : `${fmtInt(d.assets.length)} assets`

export function DatasetSwitcher() {
  const estate = useEstate()
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)
  const setActive = useUploads((s) => s.setActive)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const { datasets, scope } = estate
  const Icon = scope.all ? Layers : scopeIcon(scope.datasets[0])
  const label = scope.all && datasets.length === 0 ? 'Demo seed' : scope.label

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (id: string, name: string) => {
    setActive(id)
    setOpen(false)
    toast(`Every page now analyses ${name}`)
  }

  const options: { id: string; name: string; sub: string; count: string }[] = [
    {
      id: ALL_DATASETS,
      name: 'All datasets',
      sub: datasets.length ? `${datasets.length} accepted file(s) + demo seed` : 'demo seed inventory and telemetry',
      count: `${fmtInt(estate.assets.length)} assets`,
    },
    ...datasets.map((d) => ({
      id: d.id,
      name: d.name,
      sub: `${d.id} · ${timeAgo(d.uploadedAt)}`,
      count: datasetCount(d),
    })),
  ]

  return (
    <div className={cx('ds-switch', open && 'open')} ref={wrapRef}>
      <button
        type="button"
        className="ds-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Dataset scope: ${label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={12} />
        <span className="ds-trigger-label">{label}</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="ds-menu" role="menu">
          <div className="ds-menu-head">Analyse dataset</div>
          {options.map((o) => {
            const on = o.id === scope.id
            const RowIcon = o.id === ALL_DATASETS ? Layers : scopeIcon(datasets.find((d) => d.id === o.id))
            return (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                className={cx('ds-opt', on && 'on')}
                onClick={() => choose(o.id, o.id === ALL_DATASETS ? 'every accepted dataset' : o.name)}
              >
                <RowIcon size={13} />
                <span className="ds-opt-main">
                  <span className="ds-opt-name">{o.name}</span>
                  <span className="ds-opt-sub">{o.sub}</span>
                </span>
                <span className="ds-opt-count">{o.count}</span>
                {on && <Check size={12} />}
              </button>
            )
          })}
          <button type="button" className="ds-menu-foot" onClick={() => { setOpen(false); navigate('/app/uploads') }}>
            Data Input Hub <ArrowRight size={11} />
          </button>
        </div>
      )}
    </div>
  )
}
