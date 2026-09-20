import { describe, expect, it } from 'vitest'

import type { ChartSeries } from '../../src/domain/exercise-chart'
import { renderExerciseChartSvg, type RenderChartOptions } from '../../src/ui/exercise-chart-svg'
import { createTestRoot } from './obsidian-dom'
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

/** Render a series through the real chart renderer, failing when no SVG is drawn. */
function renderedChart(series: ChartSeries, options: RenderChartOptions = {}): Element {
  const root = createTestRoot()
  renderExerciseChartSvg(root, series, options)
  const svg = root.querySelector('svg')
  expect(svg).not.toBeNull()
  return svg as Element
}

/** Date texts drawn on the x axis. Empty when no date label is drawn at all. */
function xLabelTexts(svg: Element): Array<string | null> {
  return [...svg.querySelectorAll('text.fitkit-chart-axis-label[data-axis="x"]')].map(
    (node) => node.textContent,
  )
}

/** Value texts drawn on the y axis. Empty when no value label is drawn at all. */
function yLabelTexts(svg: Element): Array<string | null> {
  return [...svg.querySelectorAll('text.fitkit-chart-axis-label[data-axis="y"]')].map(
    (node) => node.textContent,
  )
}

/** Measure a rendered chart against its own viewBox. */
function chartOverflow(svg: Element): SvgOverflow {
  return measureSvgOverflow(serializeSvg(svg))
}

describe('exercise chart overflow', () => {
  it('draws and fits a strength chart inside its own viewBox', () => {
    const svg = renderedChart(strengthSeries())

    expect(xLabelTexts(svg)).toEqual([
      '2026-04-15',
      '2026-04-16',
      '2026-04-17',
      '2026-04-18',
      '2026-04-19',
    ])
    expect(yLabelTexts(svg)).toEqual(['80kg', '82.5kg', '85kg', '87.5kg', '90kg'])
    expect(svg.querySelectorAll('circle.fitkit-chart-dot')).toHaveLength(5)
    expect(svg.querySelector('polyline.fitkit-chart-line')).not.toBeNull()
    expect(chartOverflow(svg)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })

  it('draws and fits a bodyweight chart inside its own viewBox', () => {
    const svg = renderedChart(bodyweightSeries())

    expect(xLabelTexts(svg)).toEqual([
      '2026-04-15',
      '2026-04-16',
      '2026-04-17',
      '2026-04-18',
      '2026-04-19',
    ])
    expect(yLabelTexts(svg)).toEqual(['Level 1', 'Level 2', 'Level 3'])
    expect(svg.querySelectorAll('circle.fitkit-chart-dot')).toHaveLength(5)
    expect(svg.querySelector('polyline.fitkit-chart-line')).not.toBeNull()
    expect(chartOverflow(svg)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })

  it('draws and fits a level chart with long rung names inside its own viewBox', () => {
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
    const svg = renderedChart(series, { ladder })

    expect(xLabelTexts(svg)).toEqual([
      '2026-04-15',
      '2026-04-16',
      '2026-04-17',
      '2026-04-18',
      '2026-04-19',
    ])
    expect(yLabelTexts(svg)).toHaveLength(5)
    expect(
      [...svg.querySelectorAll('text.fitkit-chart-axis-label[data-axis="y"] > title')].map(
        (node) => node.textContent,
      ),
    ).toEqual(ladder)
    expect(svg.querySelectorAll('circle.fitkit-chart-dot')).toHaveLength(5)
    expect(svg.querySelector('polyline.fitkit-chart-line')).not.toBeNull()
    expect(chartOverflow(svg)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })
})
