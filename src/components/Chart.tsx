import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { useTheme } from '../lib/store'
import { cx } from '../lib/format'

export const chartFont = "'JetBrains Mono Variable', 'Inter Variable', monospace"

export function chartTokens(theme: string) {
  const dark = theme === 'dark'
  return {
    dark,
    text: dark ? '#98a5b8' : '#596474',
    muted: dark ? '#7b8899' : '#6c7787',
    line: dark ? 'rgba(150,168,192,0.14)' : 'rgba(23,30,40,0.12)',
    grid: dark ? 'rgba(150,168,192,0.08)' : 'rgba(23,30,40,0.07)',
    tooltipBg: dark ? 'rgba(11,17,26,0.97)' : 'rgba(255,253,248,0.98)',
    tooltipText: dark ? '#e9eef5' : '#131a23',
    tooltipBorder: dark ? 'rgba(150,168,192,0.25)' : 'rgba(23,30,40,0.16)',
    accent: '#3ed2c1',
    amber: '#e3a455',
  }
}

export function axisStyle(theme: string, opts: { split?: boolean } = {}) {
  const t = chartTokens(theme)
  return {
    axisLine: { lineStyle: { color: t.line } },
    axisTick: { show: false },
    axisLabel: {
      color: t.muted,
      fontSize: 9.5,
      fontWeight: 500,
      fontFamily: chartFont,
      margin: 10,
    },
    splitLine: opts.split === false ? { show: false } : { lineStyle: { color: t.grid, type: 'dashed' as const } },
    nameTextStyle: { color: t.muted, fontSize: 9, fontFamily: chartFont, padding: [0, 0, 4, 0] },
  }
}

export function Chart({
  option,
  height = 260,
  className,
  onEvents,
}: {
  option: Record<string, unknown>
  height?: number | string
  className?: string
  onEvents?: Record<string, (params: unknown) => void>
}) {
  const theme = useTheme((s) => s.theme)
  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const merged = useMemo(() => {
    const t = chartTokens(theme)
    const incomingTooltip = (option.tooltip ?? {}) as Record<string, unknown>
    const incomingText = (incomingTooltip.textStyle ?? {}) as Record<string, unknown>
    const incomingPointer = (incomingTooltip.axisPointer ?? {}) as Record<string, unknown>
    return {
      backgroundColor: 'transparent',
      animation: !reduceMotion,
      animationDuration: 900,
      animationDurationUpdate: 480,
      animationDelay: (idx: number) => Math.min(idx * 32, 420),
      animationDelayUpdate: (idx: number) => Math.min(idx * 14, 160),
      animationEasing: 'quarticOut',
      animationEasingUpdate: 'cubicOut',
      stateAnimation: { duration: 220, easing: 'cubicOut' },
      textStyle: {
        fontFamily: chartFont,
        color: t.text,
      },
      ...option,
      tooltip: {
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        borderWidth: 1,
        padding: [10, 12],
        confine: true,
        transitionDuration: 0.18,
        extraCssText:
          'box-shadow: 0 18px 44px -16px rgba(0,0,0,.65); border-radius: 8px; backdrop-filter: blur(10px);',
        ...incomingTooltip,
        axisPointer: {
          lineStyle: { color: t.line, width: 1 },
          crossStyle: { color: t.line, width: 1 },
          shadowStyle: { color: t.dark ? 'rgba(150,168,192,0.07)' : 'rgba(23,30,40,0.05)' },
          ...incomingPointer,
        },
        textStyle: {
          color: t.tooltipText,
          fontSize: 10.5,
          fontFamily: chartFont,
          lineHeight: 18,
          ...incomingText,
        },
      },
    }
  }, [option, theme, reduceMotion])

  return (
    <div className={cx('chart-wrap', className)} style={{ height }}>
      <ReactECharts
        option={merged}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge
        lazyUpdate
        onEvents={onEvents}
      />
    </div>
  )
}
