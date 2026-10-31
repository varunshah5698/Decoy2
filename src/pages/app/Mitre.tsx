import { useMemo, useState } from 'react'
import { Chart, axisStyle } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { StatsPanel } from '../../components/StatsPanel'
import { SourceBadge } from '../../components/Badges'
import { ExternalLink, Grid3X3, Info, Search } from '../../components/Icons'
import { attackProfiles, mitreTactics, techniques } from '../../data/seed'
import { useFilters, useTheme } from '../../lib/store'
import { groupBy } from '../../lib/stats'
import { AMBER, TEAL, hexA } from '../../lib/colors'
import type { Technique } from '../../lib/types'

export default function Mitre() {
  const theme = useTheme((s) => s.theme)
  const query = useFilters((s) => s.query)
  const setQuery = useFilters((s) => s.setQuery)
  const [selected, setSelected] = useState<Technique | null>(null)

  const byTactic = groupBy(techniques, (t) => t.tacticId)
  const observedTotal = techniques.reduce((a, b) => a + b.observed, 0)
  const topTechnique = [...techniques].sort((a, b) => b.observed - a.observed)[0]

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return techniques.filter((t) => (q ? `${t.id} ${t.name} ${t.tactic} ${t.description}`.toLowerCase().includes(q) : true))
  }, [query])

  const topOption = useMemo(() => {
    const ax = axisStyle(theme)
    const top = [...techniques].sort((a, b) => b.observed - a.observed).slice(0, 9)
    return {
      grid: { left: 150, right: 30, top: 10, bottom: 20 },
      xAxis: { type: 'value', ...ax, axisLabel: { ...ax.axisLabel, fontSize: 8 } },
      yAxis: {
        type: 'category',
        data: top.map((t) => t.name),
        ...ax,
        splitLine: { show: false },
        axisLabel: { ...ax.axisLabel, fontSize: 8, width: 140, overflow: 'truncate' },
      },
      tooltip: { formatter: (p: any) => `${p.name}<br/>${p.value} observed mappings` },
      series: [
        {
          type: 'bar',
          barWidth: '56%',
          data: top.map((t) => ({
            value: t.observed,
            itemStyle: { color: hexA(AMBER, 0.35 + (t.observed / topTechnique.observed) * 0.5), borderRadius: [0, 3, 3, 0] },
          })),
          label: { show: true, position: 'right', color: '#98a5b8', fontSize: 8, fontFamily: 'monospace' },
        },
      ],
    }
  }, [theme, topTechnique.observed])

  const tacticOption = useMemo(() => {
    const ax = axisStyle(theme)
    return {
      grid: { left: 32, right: 12, top: 20, bottom: 62 },
      xAxis: {
        type: 'category',
        data: mitreTactics.map((t) => t.name),
        ...ax,
        axisLabel: { ...ax.axisLabel, rotate: 38, fontSize: 7, interval: 0 },
      },
      yAxis: { type: 'value', ...ax, minInterval: 1 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      series: [
        {
          name: 'Techniques',
          type: 'bar',
          stack: 't',
          barWidth: '56%',
          data: mitreTactics.map((t) => (byTactic[t.id] ?? []).length),
          itemStyle: { color: hexA(TEAL, 0.6) },
        },
        {
          name: 'Observed events',
          type: 'bar',
          stack: 't',
          data: mitreTactics.map((t) => (byTactic[t.id] ?? []).reduce((a, b) => a + b.observed, 0)),
          itemStyle: { color: hexA(AMBER, 0.66), borderRadius: [2, 2, 0, 0] },
        },
      ],
    }
  }, [theme, byTactic])

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 11 · ATT&CK MATRIX"
        title="Behaviour, mapped to a common language"
        description="Observed technique counts sit inside a trimmed ATT&CK Enterprise subset. The subset ships offline and is labelled as simulated reference content."
        actions={
          <a className="btn btn-ghost btn-sm" href="https://attack.mitre.org/matrices/enterprise/" target="_blank" rel="noreferrer">
            ATT&CK matrix <ExternalLink size={12} />
          </a>
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
        <div className="kpi">
          <div className="kpi-label">Techniques</div>
          <div className="kpi-value">{techniques.length}</div>
          <div className="kpi-delta">trimmed subset</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Tactics</div>
          <div className="kpi-value">{mitreTactics.length}</div>
          <div className="kpi-delta">enterprise columns</div>
        </div>
        <div className="kpi amber-tone">
          <div className="kpi-label">Observed mappings</div>
          <div className="kpi-value">{observedTotal}</div>
          <div className="kpi-delta">sum of technique counts</div>
        </div>
        <div className="kpi teal-tone">
          <div className="kpi-label">Top technique</div>
          <div className="kpi-value" style={{ fontSize: 19, lineHeight: 1.2 }}>
            {topTechnique.id}
          </div>
          <div className="kpi-delta">{topTechnique.observed} observations</div>
        </div>
        <div className="kpi high-tone">
          <div className="kpi-label">Profiles covered</div>
          <div className="kpi-value">{attackProfiles.length}</div>
          <div className="kpi-delta">attack patterns linked</div>
        </div>
      </div>

      <Panel
        title="Enterprise matrix"
        sub="Cell intensity = observed count · click a technique to inspect it"
        action={
          <div className="inline-flex">
            <SourceBadge source="MITRE ATT&CK" simulated />
            <span className="badge simulated">offline subset</span>
          </div>
        }
        bodyClass="panel-body"
      >
        <div className="mitre-grid">
          {mitreTactics.map((t) => {
            const list = byTactic[t.id] ?? []
            return (
              <div className="mitre-col" key={t.id}>
                <h4>
                  {t.name}
                  <br />
                  <span style={{ opacity: 0.6 }}>{t.id}</span>
                </h4>
                {list.map((tech) => (
                  <button
                    key={tech.id}
                    className="mitre-cell"
                    onClick={() => setSelected(tech)}
                    style={{
                      background: hexA(AMBER, 0.04 + Math.min(0.32, tech.observed * 0.035)),
                      borderColor: tech.observed > 6 ? hexA(AMBER, 0.4) : undefined,
                      textAlign: 'left',
                    }}
                  >
                    <span>{tech.name}</span>
                    <span className="tech-id">{tech.id}</span>
                    <span className="tech-count" style={{ color: tech.observed > 6 ? '#e3a455' : undefined }}>
                      {tech.observed}
                    </span>
                  </button>
                ))}
                {list.length === 0 && <div className="mitre-cell" style={{ opacity: 0.35 }}>—</div>}
              </div>
            )
          })}
        </div>
        <div className="table-note">
          <span className="inline-flex">
            <Info size={11} /> Ten of fourteen enterprise tactics, 27 techniques, 196 reference records in the real
            bundle. Only the trimmed set is used here.
          </span>
          <span className="mono">label: simulated reference</span>
        </div>
      </Panel>

      <div className="dash-grid mt-16">
        <Panel className="col-6" title="Most observed techniques" sub="Counts from the demo mapping layer" noPad>
          <Chart option={topOption} height={300} />
        </Panel>
        <Panel className="col-6" title="Tactic density" sub="Technique rows and observed events per tactic" noPad>
          <Chart option={tacticOption} height={300} />
          <div className="chart-legend" style={{ justifyContent: 'center' }}>
            <span className="legend-item">
              <i style={{ background: TEAL }} /> techniques
            </span>
            <span className="legend-item">
              <i style={{ background: AMBER }} /> observations
            </span>
          </div>
        </Panel>

        <Panel
          className="col-12"
          title="Technique register"
          sub={`${filtered.length} of ${techniques.length} techniques`}
          action={
            <div className="topbar-search" style={{ maxWidth: 230, height: 30 }}>
              <Search size={12} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search technique…" aria-label="Search techniques" />
            </div>
          }
          noPad
        >
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Technique</th>
                  <th>Tactic</th>
                  <th>Description</th>
                  <th className="right">Observed</th>
                  <th>Profiles</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="clickable" onClick={() => setSelected(t)}>
                    <td>
                      <div className="cell-title mono">{t.id}</div>
                      <div className="cell-sub">{t.name}</div>
                    </td>
                    <td className="cell-sub">{t.tactic}</td>
                    <td className="cell-sub">{t.description}</td>
                    <td className="right mono">{t.observed}</td>
                    <td>
                      <div className="inline-flex" style={{ flexWrap: 'wrap', gap: 4 }}>
                        {attackProfiles
                          .filter((p) => p.techniques.includes(t.id))
                          .map((p) => (
                            <span className="badge" key={p.key} style={{ fontSize: 7.5 }}>
                              {p.name}
                            </span>
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'Techniques per tactic', value: (techniques.length / mitreTactics.length).toFixed(2), formula: 'techniques ÷ tactics', n: techniques.length },
            { name: 'Mean observations', value: (observedTotal / techniques.length).toFixed(2), formula: 'Σ observed ÷ techniques', n: techniques.length },
            { name: 'Techniques observed', value: `${techniques.filter((t) => t.observed > 0).length}/${techniques.length}`, formula: 'count > 0', n: techniques.length },
            { name: 'Coverage by profiles', value: `${new Set(attackProfiles.flatMap((p) => p.techniques)).size} IDs`, formula: 'distinct technique IDs referenced by attack profiles', n: attackProfiles.length },
            { name: 'Largest tactic', value: `${mitreTactics.map((t) => ({ name: t.name, n: (byTactic[t.id] ?? []).length })).sort((a, b) => b.n - a.n)[0].name}`, formula: 'max technique count', n: mitreTactics.length },
          ]}
        />
      </div>

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} label="Technique">
        {selected && (
          <>
            <DrawerHead
              overline={`${selected.id} · ${selected.tactic.toUpperCase()}`}
              title={selected.name}
              onClose={() => setSelected(null)}
              meta={
                <span className="inline-flex" style={{ gap: 8 }}>
                  <SourceBadge source="MITRE ATT&CK" simulated />
                  <span className="badge simulated">trimmed subset</span>
                </span>
              }
            />
            <div className="drawer-body">
              <div className="drawer-section">
                <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text)' }}>{selected.description}</p>
                <div className="drawer-meta">
                  <span>{selected.tactic}</span>
                  <span>{selected.observed} observations</span>
                  <span>{selected.tacticId}</span>
                </div>
              </div>
              <div className="drawer-section">
                <h3>Profiles using this technique</h3>
                <div style={{ display: 'grid', gap: 8 }}>
                  {attackProfiles.filter((p) => p.techniques.includes(selected.id)).map((p) => (
                    <div className="action-box" key={p.key}>
                      <div className="inline-flex" style={{ justifyContent: 'space-between' }}>
                        <strong style={{ fontSize: 12 }}>{p.name}</strong>
                        <span className="mono" style={{ fontSize: 8.5 }}>{p.category}</span>
                      </div>
                      <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 5 }}>{p.description}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="drawer-section">
                <h3>Matrix position</h3>
                <div className="provenance-list">
                  <div className="provenance-row">
                    <Grid3X3 size={12} className="check" />
                    <span>Tactic</span>
                    <span className="time">{selected.tactic}</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Tactic ID</span>
                    <span className="time">{selected.tacticId}</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Observed count</span>
                    <span className="time">{selected.observed}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </Drawer>
    </div>
  )
}
