import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnalystMark } from './AnalystMark'
import { AiMarkdown } from './AiMarkdown'
import { Activity, ArrowRight, Database, Info, RefreshCw, ShieldAlert, Zap } from './Icons'
import { useAiPanel } from '../lib/aiStore'
import { useLiveActiveAlerts, useLiveCounts, useLiveMl, useLiveSourceHealth } from '../lib/liveData'
import { useScopedInventory, useScopeInfo } from '../lib/dataScope'
import { MODEL_CARD } from '../lib/ml'
import { fmtScore, cx, plural } from '../lib/format'

export default function AiBriefing() {
  const activeAlerts = useLiveActiveAlerts()
  const counts = useLiveCounts()
  const sourceHealth = useLiveSourceHealth()
  const liveMl = useLiveMl()
  const ranked = [...activeAlerts].sort((a, b) => b.score - a.score)
  const topAlert = ranked[0]
  const internetFacing = activeAlerts.filter((a) => a.asset.internetFacing).length
  const versionUnknown = activeAlerts.filter((a) => a.relevance === 'VERSION_UNKNOWN').length
  const degraded = sourceHealth.filter((s) => s.status === 'DEGRADED')
  const navigate = useNavigate()
  const generate = useAiPanel((s) => s.generateBriefing)
  const briefing = useAiPanel((s) => s.briefing)
  const inventory = useScopedInventory()
  const scopeInfo = useScopeInfo()
  const inventoryCount = inventory.length

  useEffect(() => {
    generate('/app')
  }, [generate, scopeInfo.id])

  const ask = (prompt?: string) =>
    navigate('/app/ai', { state: prompt ? { prompt, nonce: Date.now() } : undefined })

  const status = briefing?.status ?? 'streaming'
  const text = briefing?.text ?? ''
  const streaming = status === 'streaming'
  const reasoning = streaming && !text.trim()

  const statusLabel = streaming ? (text ? 'Writing briefing' : 'Analysing context') : status === 'fallback' ? 'Local fallback' : 'Updated just now'

  return (
    <section className="ai-brief" aria-label="AI analyst briefing">
      <div className="ai-brief-aura" aria-hidden="true" />

      <header className="ai-brief-head">
        <AnalystMark size={42} live={streaming} />
        <div className="ai-brief-id">
          <span className="ai-kicker">AI ANALYST · SITUATION BRIEFING</span>
          <h2>What changed, what matters, what to do</h2>
        </div>
        <div className="ai-brief-tools">
          <span className={cx('ai-brief-status', streaming && 'busy')}>
            <i className="ai-status-dot" />
            {statusLabel}
          </span>
          <button
            type="button"
            className="ai-icon-btn"
            onClick={() => generate('/app', true)}
            disabled={streaming}
            title="Regenerate briefing"
            aria-label="Regenerate briefing"
          >
            <RefreshCw size={14} className={cx(streaming && 'spin')} />
          </button>
        </div>
      </header>

      <div className="ai-brief-body">
        <div className="ai-brief-text">
          {reasoning ? (
            <div className="ai-brief-loading">
              <div className="ai-brief-lines" aria-hidden="true">
                <span style={{ width: '94%' }} />
                <span style={{ width: '88%' }} />
                <span style={{ width: '62%' }} />
                <span style={{ width: '91%' }} />
                <span style={{ width: '46%' }} />
              </div>
              <p>
                Reading {counts.active} {plural(counts.active, 'alert')}, {inventoryCount} {plural(inventoryCount, 'asset')} and {sourceHealth.length} {plural(sourceHealth.length, 'source')}…
              </p>
            </div>
          ) : (
            <>
              <AiMarkdown text={text} />
              {streaming && <span className="ai-caret" aria-hidden="true" />}
            </>
          )}
          {status === 'fallback' && briefing?.note && (
            <div className="ai-brief-note">
              <Info size={12} />
              {briefing.note}
            </div>
          )}
        </div>

        <aside className="ai-brief-rail" aria-label="Key signals">
          <div className="ai-signal critical">
            <span className="ai-signal-label">
              <ShieldAlert size={11} /> Top risk
            </span>
            <strong>{topAlert ? fmtScore(topAlert.score) : '—'}</strong>
            <p>
              {topAlert ? topAlert.cve.id : 'No active alerts'}
              {topAlert && <span> · {topAlert.asset.name}</span>}
            </p>
          </div>
          <div className="ai-signal amber">
            <span className="ai-signal-label">
              <Zap size={11} /> Exposure
            </span>
            <strong>{internetFacing}</strong>
            <p>
              internet-facing alerts
              <span> · {counts.critical} critical</span>
            </p>
          </div>
          <div className="ai-signal model">
            <span className="ai-signal-label">
              <Activity size={11} /> XGBoost prior
            </span>
            <strong>{(liveMl.portfolio.max * 100).toFixed(0)}%</strong>
            <p>
              top KEV-membership prior
              <span> · {liveMl.portfolio.elevated}/{liveMl.portfolio.coverage} elevated · AUC {MODEL_CARD.test.auc.toFixed(3)}</span>
            </p>
          </div>
          <div className="ai-signal muted">
            <span className="ai-signal-label">
              <Database size={11} /> Data gap
            </span>
            <strong>{versionUnknown}</strong>
            <p>
              unverified version{versionUnknown === 1 ? '' : 's'}
              <span>{degraded.length ? ` · ${degraded.map((d) => d.source).join(', ')} degraded` : ' · sources healthy'}</span>
            </p>
          </div>
        </aside>
      </div>

      <footer className="ai-brief-foot">
        <span className="ai-brief-provenance">
          Generated from {counts.active} {plural(counts.active, 'alert')} · {inventoryCount} {plural(inventoryCount, 'asset')} in {scopeInfo.label} · {sourceHealth.length} {plural(sourceHealth.length, 'source')} · deterministic scores · XGBoost v{MODEL_CARD.version} second opinion
        </span>
        <div className="ai-brief-prompts">
          <button type="button" onClick={() => ask('What changed in the last 24 hours that I should act on?')}>
            What changed?
          </button>
          <button type="button" onClick={() => ask('Draft the patch order for this week, with owners and checks.')}>
            Draft patch order
          </button>
          <button type="button" className="ai-brief-open" onClick={() => ask()}>
            Open copilot <ArrowRight size={12} />
          </button>
        </div>
      </footer>
    </section>
  )
}
