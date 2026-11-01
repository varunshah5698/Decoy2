import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, ChevronDown, Database, Upload } from './Icons'
import {
  ALL_UPLOADS_SCOPE,
  LIVE_SCOPE,
  scopedInventory,
  useDataScope,
  useScopeInfo,
} from '../lib/dataScope'
import { useUploads } from '../lib/uploads'
import { useToast } from '../lib/store'
import { cx, plural } from '../lib/format'

export function DataScopeSwitch() {
  const navigate = useNavigate()
  const showToast = useToast((s) => s.show)
  const scopeId = useDataScope((s) => s.scopeId)
  const setScopeId = useDataScope((s) => s.setScopeId)
  const datasets = useUploads((s) => s.datasets)
  const info = useScopeInfo()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const usable = useMemo(() => datasets.filter((dataset) => dataset.assets.length > 0), [datasets])
  const uploadAssetCount = useMemo(
    () => scopedInventory(ALL_UPLOADS_SCOPE, datasets).length,
    [datasets],
  )

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (id: string, label: string) => {
    setScopeId(id)
    setOpen(false)
    showToast(`Workspace dataset switched to ${label}`)
  }

  const chooseUploads = () => {
    if (!usable.length) {
      setOpen(false)
      navigate('/app/uploads')
      return
    }
    choose(ALL_UPLOADS_SCOPE, 'All uploads')
  }

  return (
    <div className="scope-switch" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={cx('scope-btn', info.kind !== 'live' && 'upload')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={`Workspace dataset · ${info.detail}`}
      >
        <span className="scope-btn-icon">
          {info.kind === 'live' ? <Database size={13} /> : <Upload size={13} />}
        </span>
        <span className="scope-btn-copy">
          <em>Dataset</em>
          <strong>{info.label}</strong>
        </span>
        <ChevronDown size={12} className={cx('scope-btn-chev', open && 'open')} />
      </button>

      {open && (
        <div className="scope-menu" role="listbox" aria-label="Workspace dataset">
          <div className="scope-menu-head">
            <span>Workspace dataset</span>
            <em>Threat feeds stay live</em>
          </div>

          <button
            type="button"
            role="option"
            aria-selected={info.kind === 'live'}
            className={cx('scope-option', info.kind === 'live' && 'on')}
            onClick={() => choose(LIVE_SCOPE, 'Live feeds')}
          >
            <span className="scope-option-body">
              <span className="scope-option-title">
                <i className="scope-pip live" />
                <strong>Live feeds</strong>
              </span>
              <span className="scope-option-sub">Seeded demo estate plus your uploads · NVD / KEV / EPSS</span>
            </span>
            {info.kind === 'live' && <Check size={13} className="scope-option-check" />}
          </button>

          <div className="scope-menu-rule">
            <span>Uploaded datasets</span>
            <em>{usable.length || 'none'}</em>
          </div>

          <button
            type="button"
            role="option"
            aria-selected={info.kind === 'uploads'}
            className={cx('scope-option', info.kind === 'uploads' && 'on')}
            onClick={chooseUploads}
            disabled={!usable.length}
          >
            <span className="scope-option-body">
              <span className="scope-option-title">
                <i className="scope-pip upload" />
                <strong>All uploads</strong>
              </span>
              <span className="scope-option-sub">
                {usable.length
                  ? `${usable.length} ${plural(usable.length, 'dataset')} · ${uploadAssetCount} ${plural(uploadAssetCount, 'asset')}`
                  : 'No accepted asset datasets yet'}
              </span>
            </span>
            {info.kind === 'uploads' && <Check size={13} className="scope-option-check" />}
          </button>

          {usable.map((dataset) => (
            <button
              type="button"
              role="option"
              aria-selected={info.id === dataset.id}
              key={dataset.id}
              className={cx('scope-option', 'dataset', info.id === dataset.id && 'on')}
              onClick={() => choose(dataset.id, dataset.name)}
            >
              <span className="scope-option-body">
                <span className="scope-option-title">
                  <i className="scope-pip dataset" />
                  <strong>{dataset.name}</strong>
                </span>
                <span className="scope-option-sub">
                  {dataset.id} · {dataset.assets.length} {plural(dataset.assets.length, 'asset')} · {dataset.status.toLowerCase()}
                </span>
              </span>
              {info.id === dataset.id && <Check size={13} className="scope-option-check" />}
            </button>
          ))}

          {!usable.length && (
            <p className="scope-menu-empty">
              Accept an inventory file in the Data Input Hub and it appears here as a switchable dataset.
            </p>
          )}

          <button
            type="button"
            className="scope-menu-foot"
            onClick={() => {
              setOpen(false)
              navigate('/app/uploads')
            }}
          >
            Manage uploads <ArrowRight size={11} />
          </button>
        </div>
      )}
    </div>
  )
}
