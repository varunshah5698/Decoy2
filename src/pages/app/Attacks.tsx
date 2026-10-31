import { useMemo, useState } from 'react'
import { Chart } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge, SourceBadge } from '../../components/Badges'
import { ArrowRight, Crosshair, ShieldCheck, Sparkles, Swords } from '../../components/Icons'
import { attackProfiles, mitreTactics, techniques } from '../../data/seed'
import { useTheme } from '../../lib/store'
import { hexA } from '../../lib/colors'

export default function Attacks() {
  const theme = useTheme((s) => s.theme)
  const [selectedKey, setSelectedKey] = useState(attackProfiles[2].key)
  const profile = attackProfiles.find((p) => p.key === selectedKey) ?? attackProfiles[0]
  const linked = profile.techniques.map((id) => techniques.find((t) => t.id === id)).filter(Boolean)

  const radarOption = useMemo(() => {
    const values = mitreTactics.map((t) => {
      const stage = profile.stages.some((s) => s.tactic === t.name)
      const techs = linked.filter((x) => x && x.tacticId === t.id).length
      return (stage ? 1 : 0) + techs * 0.6
    })
    return {
      radar: {
        indicator: mitreTactics.map((t) => ({ name: t.name, max: 2.2 })),
        radius: '62%',
        splitNumber: 3,
        axisName: {
          color: theme === 'dark' ? '#98a5b8' : '#596474',
          fontSize: 8,
          fontFamily: 'monospace',
        },
        splitLine: { lineStyle: { color: theme === 'dark' ? 'rgba(150,168,192,.12)' : 'rgba(23,30,40,.1)' } },
        splitArea: { areaStyle: { color: ['transparent', theme === 'dark' ? 'rgba(255,255,255,.012)' : 'rgba(0,0,0,.012)'] } },
        axisLine: { lineStyle: { color: theme === 'dark' ? 'rgba(150,168,192,.14)' : 'rgba(23,30,40,.12)' } },
      },
      tooltip: {},
      series: [
        {
          type: 'radar',
          data: [
            {
              value: values,
              name: profile.name,
              symbolSize: 4,
              lineStyle: { color: '#e3a455', width: 1.6 },
              itemStyle: { color: '#e3a455' },
              areaStyle: { color: hexA('#e3a455', 0.16) },
            },
          ],
        },
      ],
    }
  }, [profile, linked, theme])

  const exposureOption = useMemo(() => {
    const names = attackProfiles.map((p) => p.name)
    const values = attackProfiles.map((p) => p.techniques.length + p.stages.length * 0.5)
    return {
      grid: { left: 90, right: 26, top: 10, bottom: 18 },
      xAxis: { type: 'value', min: 0, axisLabel: { color: '#647184', fontSize: 8, fontFamily: 'monospace' }, splitLine: { show: false } },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { lineStyle: { color: 'rgba(150,168,192,.14)' } },
        axisTick: { show: false },
        axisLabel: { color: theme === 'dark' ? '#98a5b8' : '#596474', fontSize: 8.5, fontFamily: 'monospace' },
      },
      tooltip: { formatter: (p: any) => `${p.name}<br/>techniques + half-weight stages` },
      series: [
        {
          type: 'bar',
          barWidth: '58%',
          data: values.map((v, i) => ({
            value: v,
            itemStyle: {
              color: attackProfiles[i].key === selectedKey ? hexA('#e3a455', 0.9) : hexA('#3ed2c1', 0.35),
              borderRadius: [0, 3, 3, 0],
            },
          })),
        },
      ],
    }
  }, [selectedKey, theme])

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 05 · ATTACK PROFILES"
        title="From technique to mitigation"
        description="Ten attack patterns, each mapped to MITRE ATT&CK stages and to controls that a named team can actually own."
        actions={
          <a
            className="btn btn-ghost btn-sm"
            href="https://attack.mitre.org/"
            target="_blank"
            rel="noreferrer"
          >
            ATT&CK <ArrowRight size={13} />
          </a>
        }
      />

      <div className="attack-strip">
        {attackProfiles.map((p) => (
          <button
            key={p.key}
            className={`attack-chip${p.key === selectedKey ? ' on' : ''}`}
            onClick={() => setSelectedKey(p.key)}
            aria-pressed={p.key === selectedKey}
          >
            <strong>{p.name}</strong>
            <span>
              {p.category} · {p.techniques.length} techniques
            </span>
          </button>
        ))}
      </div>

      <div className="dash-grid">
        <Panel
          className="col-8"
          title={profile.name}
          sub={profile.description}
          action={<SeverityBadge level={profile.defaultSeverity} />}
          bodyClass="panel-body"
        >
          <div className="inline-flex" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            <SourceBadge source="MITRE ATT&CK" simulated />
            <span className="badge simulated">trimmed offline subset</span>
            <span className="mono" style={{ fontSize: 9 }}>
              {linked.length} linked techniques · {profile.stages.length} stages
            </span>
          </div>

          <div className="lifecycle">
            {profile.stages.map((s, i) => (
              <div className="lifecycle-stage" key={`${s.tactic}-${i}`}>
                <span className="mono">STAGE {String(i + 1).padStart(2, '0')} · {s.tactic.toUpperCase()}</span>
                <strong>{s.note}</strong>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: 12, marginTop: 18, marginBottom: 8, fontWeight: 600 }}>Techniques in this profile</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {profile.techniques.map((id) => {
              const t = techniques.find((x) => x.id === id)
              return (
                <span
                  key={id}
                  className="entity-tag"
                  style={t ? undefined : { opacity: 0.55, textDecoration: 'line-through' }}
                  title={t?.description ?? 'Not in the trimmed demo subset'}
                >
                  {id} {t ? `· ${t.name}` : '· not in subset'}
                </span>
              )
            })}
          </div>

          <h3 style={{ fontSize: 12, marginTop: 20, marginBottom: 8, fontWeight: 600 }}>Indicators to hunt</h3>
          <div className="entity-tags">
            {profile.indicators.map((i) => (
              <span className="entity-tag" key={i}>
                {i}
              </span>
            ))}
          </div>
        </Panel>

        <Panel className="col-4" title="Tactic coverage" sub="Presence of the stage, plus mapped technique weight" noPad>
          <Chart option={radarOption} height={284} />
          <div className="chart-legend" style={{ justifyContent: 'center' }}>
            <span className="legend-item">
              <i style={{ background: '#e3a455' }} /> {profile.name}
            </span>
            <span className="legend-item dim">0–2.2 scale</span>
          </div>
        </Panel>

        <Panel className="col-5" title="Mitigations" sub="Each control carries an owning team" bodyClass="panel-body">
          <ul className="mitigations">
            {profile.mitigations.map((m, i) => (
              <li key={m.control}>
                <span className="num">{String(i + 1).padStart(2, '0')}</span>
                <span style={{ flex: 1 }}>{m.control}</span>
                <span className="badge low">{m.team}</span>
              </li>
            ))}
          </ul>
          <div className="action-box mt-16">
            <div className="inline-flex">
              <ShieldCheck size={13} className="check" />
              <strong style={{ fontSize: 12 }}>Why this matters</strong>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 6 }}>
              The profile is a planning artefact. It does not claim this organisation observed the attack; it links
              observed techniques to the controls that would interrupt the chain.
            </p>
          </div>
        </Panel>

        <Panel className="col-7" title="Profile weight" sub="Techniques plus half-weighted stages · select a chip to change" noPad>
          <Chart option={exposureOption} height={300} />
          <div className="chart-legend">
            <span className="legend-item">
              <i style={{ background: '#e3a455' }} /> selected
            </span>
            <span className="legend-item">
              <i style={{ background: 'rgba(62,210,193,.4)' }} /> other profiles
            </span>
          </div>
        </Panel>

        <Panel className="col-12" title="Techniques linked to this profile" sub="Observed counts come from the demo technique map" noPad>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Technique</th>
                  <th>Tactic</th>
                  <th>Description</th>
                  <th className="right">Observed</th>
                  <th>Profile link</th>
                </tr>
              </thead>
              <tbody>
                {linked.map((t) => (
                  <tr key={t!.id}>
                    <td>
                      <div className="cell-title mono">{t!.id}</div>
                      <div className="cell-sub">{t!.name}</div>
                    </td>
                    <td className="cell-sub">{t!.tactic}</td>
                    <td className="cell-sub">{t!.description}</td>
                    <td className="right mono">{t!.observed}</td>
                    <td>
                      <span className="badge" style={{ color: 'var(--amber)', borderColor: 'rgba(227,164,85,.35)' }}>
                        <Swords size={10} /> {profile.name}
                      </span>
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
            { name: 'Profiles', value: String(attackProfiles.length), formula: 'attack_profiles rows', n: attackProfiles.length },
            { name: 'Mean stages', value: (attackProfiles.reduce((a, b) => a + b.stages.length, 0) / attackProfiles.length).toFixed(1), formula: 'stages ÷ profiles', n: attackProfiles.length },
            { name: 'Linked techniques', value: `${linked.length}/${profile.techniques.length}`, formula: 'present in trimmed ATT&CK subset', n: profile.techniques.length },
            { name: 'Total techniques in subset', value: String(techniques.length), formula: 'technique rows', n: techniques.length },
            { name: 'Observed events', value: String(techniques.reduce((a, b) => a + b.observed, 0)), formula: 'sum of technique observed counts', n: techniques.length },
          ]}
        />
      </div>

      <div className="page-foot">
        <span className="inline-flex">
          <Crosshair size={11} /> ATT&CK content is a trimmed, clearly labelled offline subset.
        </span>
        <span className="inline-flex">
          <Sparkles size={11} /> Default severity is a profile attribute, not a computed alert score.
        </span>
      </div>
    </div>
  )
}
