import { describe, expect, it } from 'vitest'

import type { ChartSeries } from '../../../src/domain/exercise-chart'
import {
  buildChartLayout,
  chartYAxisTitle,
  formatChartTooltip,
  formatChartValue,
} from '../../../src/ui/model/exercise-chart-layout'

function seriesOf(
  overrides: Pick<ChartSeries, 'metric' | 'unit'> & Partial<ChartSeries>,
): ChartSeries {
  return {
    exerciseName: 'Bench Press',
    kind: 'strength',
    points: [],
    windowRequested: 30,
    totalDates: 0,
    ...overrides,
  }
}

describe('chart value text', () => {
  it('formats weight and e1rm values with kg and lbs suffixes', () => {
    expect(formatChartValue(80, seriesOf({ metric: 'weight', unit: 'kg' }))).toBe('80kg')
    expect(formatChartValue(200, seriesOf({ metric: 'weight', unit: 'lbs' }))).toBe('200lbs')
    expect(formatChartValue(114.5, seriesOf({ metric: 'e1rm', unit: 'kg' }))).toBe('114.5kg')
    expect(formatChartValue(233.3, seriesOf({ metric: 'e1rm', unit: 'lbs' }))).toBe('233.3lbs')
  })

  it('reads reps as a count and durations as minutes and seconds', () => {
    const reps = seriesOf({ metric: 'reps', unit: 'reps' })
    const duration = seriesOf({ metric: 'duration', unit: 's' })

    expect(formatChartValue(12, reps)).toBe('12 reps')
    expect(formatChartValue(1, reps)).toBe('1 rep')
    expect(formatChartValue(45, duration)).toBe('45s')
    expect(formatChartValue(125, duration)).toBe('2m 5s')
  })

  it('names the rung in a level value and tooltip instead of a duration', () => {
    const level = seriesOf({ metric: 'level', unit: 'level', kind: 'bodyweight' })

    expect(formatChartTooltip('2026-04-01', 2, level, ['Wall push-up', 'Knee push-up'])).toBe(
      '2026-04-01: Knee push-up',
    )
  })

  it('prefixes an e1rm tooltip and reads a reps tooltip as a rep count', () => {
    expect(formatChartTooltip('2026-04-01', 114, seriesOf({ metric: 'e1rm', unit: 'kg' }))).toBe(
      '2026-04-01: e1rm 114.0kg',
    )
    expect(formatChartTooltip('2026-04-03', 12, seriesOf({ metric: 'reps', unit: 'reps' }))).toBe(
      '2026-04-03: 12 reps',
    )
  })
})

describe('chart y axis title', () => {
  it('names the metric and its unit', () => {
    expect(chartYAxisTitle(seriesOf({ metric: 'e1rm', unit: 'kg' }))).toBe('e1rm (kg)')
    expect(chartYAxisTitle(seriesOf({ metric: 'weight', unit: 'lbs' }))).toBe('weight (lbs)')
    expect(chartYAxisTitle(seriesOf({ metric: 'reps', unit: 'reps' }))).toBe('reps')
    expect(chartYAxisTitle(seriesOf({ metric: 'level', unit: 'level' }))).toBe('level')
  })

  it('has none for a duration series', () => {
    expect(chartYAxisTitle(seriesOf({ metric: 'duration', unit: 's' }))).toBeNull()
  })
})

describe('chart layout', () => {
  it('shortens an overlong rung label and keeps the full name for its tooltip', () => {
    const long = `Diamond push-up ${'x'.repeat(40)}`
    const series = seriesOf({
      metric: 'level',
      unit: 'level',
      kind: 'bodyweight',
      points: [{ date: '2026-04-01', value: 2, workoutPath: 'w.md' }],
      totalDates: 1,
    })

    const labels = buildChartLayout(series, ['Wall push-up', long]).yLabels

    expect(labels.find((label) => label.fullName === long)?.text).toHaveLength(20)
    expect(labels.find((label) => label.text === 'Wall push-up')?.fullName).toBeUndefined()
  })
})
