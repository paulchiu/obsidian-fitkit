import { describe, expect, it } from 'vitest'

import type { ChartSeries } from '../../src/domain/exercise-chart'
import { renderExerciseChartSvg } from '../../src/ui/exercise-chart-svg'

interface FakeElementOptions {
  cls?: string
  text?: string
  attr?: Record<string, string | number>
}

class FakeNode {
  readonly children: FakeNode[] = []
  readonly classes = new Set<string>()
  attrs: Record<string, string | number> = {}
  textContent = ''

  constructor(readonly tag: string) {}

  empty(): void {
    this.children.length = 0
    this.textContent = ''
  }

  addClass(className: string): void {
    this.classes.add(className)
  }

  createDiv(options: FakeElementOptions = {}): FakeNode {
    return this.append('div', options)
  }

  createSvg(tag: string, options: FakeElementOptions = {}): FakeNode {
    return this.append(tag, options)
  }

  private append(tag: string, options: FakeElementOptions): FakeNode {
    const child = new FakeNode(tag)
    if (options.cls) {
      child.addClass(options.cls)
    }
    if (options.text !== undefined) {
      child.textContent = options.text
    }
    if (options.attr) {
      child.attrs = { ...options.attr }
    }
    this.children.push(child)
    return child
  }
}

function render(series: ChartSeries, options: { ladder?: readonly string[] } = {}): FakeNode {
  const root = new FakeNode('div')
  renderExerciseChartSvg(root as unknown as HTMLElement, series, options)
  return root
}

function levelSeries(values: number[]): ChartSeries {
  return {
    exerciseName: 'Push-Up',
    kind: 'bodyweight',
    metric: 'level',
    unit: 'level',
    points: values.map((value, index) => ({
      date: `2026-04-0${index + 1}`,
      value,
      workoutPath: `w/2026-04-0${index + 1}.md`,
    })),
    windowRequested: values.length,
    totalDates: values.length,
  }
}

function strengthSeries(values: number[]): ChartSeries {
  return {
    exerciseName: 'Bench Press',
    kind: 'strength',
    metric: 'weight',
    unit: 'kg',
    points: values.map((value, index) => ({
      date: `2026-04-0${index + 1}`,
      value,
      workoutPath: `w/2026-04-0${index + 1}.md`,
    })),
    windowRequested: values.length,
    totalDates: values.length,
  }
}

function descendants(root: FakeNode): FakeNode[] {
  return root.children.flatMap((child) => [child, ...descendants(child)])
}

function yLabelTexts(root: FakeNode): string[] {
  return descendants(root)
    .filter((node) => node.tag === 'text' && node.attrs['text-anchor'] === 'end')
    .map((node) => node.textContent)
}

function polylinePairs(root: FakeNode): Array<{ x: number; y: number }> {
  const line = descendants(root).find((node) => node.tag === 'polyline')
  if (!line) {
    return []
  }
  const raw = String(line.attrs['points'] ?? '')
  if (raw.trim().length === 0) {
    return []
  }
  return raw.split(' ').map((pair) => {
    const [x, y] = pair.split(',').map(Number)
    return { x: x as number, y: y as number }
  })
}

describe('exercise chart svg', () => {
  it('draws a level series as a step line that holds each rung until the next session', () => {
    const pairs = polylinePairs(render(levelSeries([2, 3])))

    expect(pairs).toHaveLength(3)
    expect(pairs[1]?.x).toBe(pairs[2]?.x)
    expect(pairs[0]?.y).toBe(pairs[1]?.y)
  })

  it('draws a strength series straight from point to point', () => {
    const pairs = polylinePairs(render(strengthSeries([80, 85])))

    expect(pairs).toHaveLength(2)
  })

  it('draws a single level point with no line, exactly as other kinds do', () => {
    const root = render(levelSeries([2]))
    const nodes = descendants(root)

    expect(nodes.some((node) => node.tag === 'polyline')).toBe(false)
    expect(nodes.filter((node) => node.tag === 'circle')).toHaveLength(1)
  })

  it('renders the existing empty state for a level series with no sessions', () => {
    const root = render(levelSeries([]))
    const nodes = descendants(root)

    expect(nodes.some((node) => node.tag === 'svg')).toBe(false)
    expect(nodes.some((node) => node.classes.has('fitkit-chart-empty'))).toBe(true)
  })

  it('labels a level axis with rung names from the ladder', () => {
    const root = render(levelSeries([1, 3]), {
      ladder: ['Wall push-up', 'Knee push-up', 'Push-up'],
    })

    expect(yLabelTexts(root)).toEqual(['Wall push-up', 'Knee push-up', 'Push-up'])
  })

  it('falls back to the level number for rungs the ladder no longer names', () => {
    const root = render(levelSeries([2, 4]), { ladder: ['Wall push-up', 'Knee push-up'] })

    expect(yLabelTexts(root)).toEqual(['Knee push-up', 'Level 3', 'Level 4'])
  })

  it('still renders a level chart with numeric fallback labels when no ladder reaches it', () => {
    const root = render(levelSeries([2, 3]))

    expect(yLabelTexts(root)).toEqual(['Level 2', 'Level 3'])
    expect(descendants(root).some((node) => node.tag === 'svg')).toBe(true)
  })

  it('thins a long ladder to the visited rungs and the span ends', () => {
    const ladder = Array.from({ length: 12 }, (_unused, index) => `Rung ${index + 1}`)
    const root = render(levelSeries([2, 9]), { ladder })

    expect(yLabelTexts(root)).toEqual(['Rung 2', 'Rung 9', 'Rung 10'])
  })
})
