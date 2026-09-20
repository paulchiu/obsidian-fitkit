import { beforeEach, describe, expect, it } from 'vitest'

import type { ChartSeries } from '../../src/domain/exercise-chart'
import { renderExerciseChartSvg, type RenderChartOptions } from '../../src/ui/exercise-chart-svg'
import { createTestRoot, installObsidianDomExtensions } from './obsidian-dom'
import { measureSvgOverflow, serializeSvg, type SvgOverflow } from './svg-layout'

function strengthSeries(): ChartSeries {
  return {
    exerciseName: 'Bench Press',
    kind: 'strength',
    metric: 'weight',
    unit: 'kg',
    points: [80, 82.5, 85, 87.5, 90].map((value, index) => ({
      date: `2026-04-${15 + index}`,
      value,
      workoutPath: `w/2026-04-${15 + index}.md`,
    })),
    windowRequested: 5,
    totalDates: 5,
  }
}

function bodyweightSeries(): ChartSeries {
  return {
    exerciseName: 'Push-Up',
    kind: 'bodyweight',
    metric: 'level',
    unit: 'level',
    points: [1, 2, 2, 3, 3].map((value, index) => ({
      date: `2026-04-${15 + index}`,
      value,
      workoutPath: `w/2026-04-${15 + index}.md`,
    })),
    windowRequested: 5,
    totalDates: 5,
  }
}

/** Render a series through the real chart renderer and measure its SVG against its viewBox. */
function renderedOverflow(series: ChartSeries, options: RenderChartOptions = {}): SvgOverflow {
  const root = createTestRoot()
  renderExerciseChartSvg(root, series, options)
  const svg = root.querySelector('svg')
  expect(svg).not.toBeNull()
  return measureSvgOverflow(serializeSvg(svg as Element))
}

describe('exercise chart overflow', () => {
  beforeEach(() => {
    installObsidianDomExtensions()
  })

  it('fits a strength chart inside its own viewBox', () => {
    expect(renderedOverflow(strengthSeries())).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })

  it('fits a bodyweight chart inside its own viewBox', () => {
    expect(renderedOverflow(bodyweightSeries())).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })

  it('fits a level chart with long rung names inside its own viewBox', () => {
    const ladder = [
      'Wall push-up against the hallway door frame',
      'Incline push-up on the kitchen bench edge',
      'Knee push-up with a slow three second lower',
      'Full push-up with hands under the shoulders',
      'Diamond push-up with elbows tracking backwards',
    ]
    const series: ChartSeries = {
      ...bodyweightSeries(),
      points: [1, 2, 3, 4, 5].map((value, index) => ({
        date: `2026-04-${15 + index}`,
        value,
        workoutPath: `w/2026-04-${15 + index}.md`,
      })),
    }

    expect(renderedOverflow(series, { ladder })).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })
})
