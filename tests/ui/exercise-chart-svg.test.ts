import { describe, expect, it } from 'vitest'

import type { ChartSeries } from '../../src/domain/exercise-chart'
import { renderExerciseChartSvg } from '../../src/ui/exercise-chart-svg'

interface TestElementOptions {
  cls?: string
  text?: string
  attr?: Record<string, string | number>
}

class TestElement {
  readonly children: TestElement[] = []
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

  createDiv(options: TestElementOptions = {}): TestElement {
    return this.append('div', options)
  }

  createSvg(tag: string, options: TestElementOptions = {}): TestElement {
    return this.append(tag, options)
  }

  private append(tag: string, options: TestElementOptions): TestElement {
    const child = new TestElement(tag)
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

function render(series: ChartSeries, options: { ladder?: readonly string[] } = {}): TestElement {
  const root = new TestElement('div')
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

function descendants(root: TestElement): TestElement[] {
  return root.children.flatMap((child) => [child, ...descendants(child)])
}

function yLabelTexts(root: TestElement): string[] {
  return descendants(root)
    .filter((node) => node.tag === 'text' && node.attrs['text-anchor'] === 'end')
    .map((node) => node.textContent)
}

function polylinePairs(root: TestElement): Array<{ x: number; y: number }> {
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
  it('gives a level axis a wider left margin than a numeric one', () => {
    const levelRoot = render(levelSeries([1, 2]), { ladder: ['Wall push-up', 'Knee push-up'] })
    const strengthRoot = render(strengthSeries([80, 85]))
    const levelLabelX = descendants(levelRoot)
      .filter((node) => node.tag === 'text' && node.attrs['text-anchor'] === 'end')
      .map((node) => Number(node.attrs['x']))
    const strengthLabelX = descendants(strengthRoot)
      .filter((node) => node.tag === 'text' && node.attrs['text-anchor'] === 'end')
      .map((node) => Number(node.attrs['x']))

    expect(levelLabelX[0]).toBe(132)
    expect(strengthLabelX[0]).toBe(48)
  })

  it('draws a level series as a step line that holds each rung until the next session', () => {
    const pairs = polylinePairs(render(levelSeries([2, 3])))

    /**
     * Known plot area pins the corner and the rise: rung 2 sits at the
     * bottom edge and rung 3 at the top, so a held line must rise there.
     */
    expect(pairs).toEqual([
      { x: 140, y: 276 },
      { x: 784, y: 276 },
      { x: 784, y: 16 },
    ])
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

  it('names the rung in each level dot tooltip from the ladder', () => {
    const root = render(levelSeries([2]), { ladder: ['Wall push-up', 'Knee push-up'] })
    const titles = descendants(root)
      .filter((node) => node.tag === 'title')
      .map((node) => node.textContent)

    expect(titles).toEqual(['2026-04-01: Knee push-up'])
  })

  it('labels a level axis with rung names from the ladder', () => {
    const root = render(levelSeries([1, 3]), {
      ladder: ['Wall push-up', 'Knee push-up', 'Push-up'],
    })

    expect(yLabelTexts(root)).toEqual(['Wall push-up', 'Knee push-up', 'Push-up'])
  })

  it('shortens an overlong rung name while keeping its distinguishing start', () => {
    const longName = `Diamond push-up ${'x'.repeat(200)}`
    const root = render(levelSeries([1, 2]), { ladder: ['Wall push-up', longName] })
    const labels = yLabelTexts(root)

    expect(labels[0]).toBe('Wall push-up')
    expect(labels[1]).not.toBe(longName)
    expect(labels[1]?.startsWith('Diamond')).toBe(true)
    expect(labels[1]?.endsWith('\u2026')).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('keeps the full rung name where the axis label shortens it', () => {
    const longName = `Diamond push-up ${'x'.repeat(200)}`
    const root = render(levelSeries([1, 2]), { ladder: ['Wall push-up', longName] })
    const labels = descendants(root).filter(
      (node) => node.tag === 'text' && node.attrs['text-anchor'] === 'end',
    )
    const shortened = labels.filter((node) => node.textContent.endsWith('\u2026'))
    const shortenedTitles = shortened.flatMap((node) =>
      node.children.filter((child) => child.tag === 'title').map((child) => child.textContent),
    )

    expect(labels.map((node) => node.textContent)).toContain('Wall push-up')
    expect(shortened).toHaveLength(1)
    expect(shortenedTitles).toEqual([longName])
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

  it('never labels a rung zero for a single level-1 session', () => {
    const root = render(levelSeries([1]), { ladder: ['Wall push-up', 'Knee push-up'] })

    expect(yLabelTexts(root)).toEqual(['Wall push-up', 'Knee push-up'])
  })

  it('draws level gridlines where the rung labels sit', () => {
    const root = render(levelSeries([2, 5]))
    const nodes = descendants(root)
    const gridYs = nodes
      .filter((node) => node.tag === 'line' && node.classes.has('fitkit-chart-grid'))
      .map((node) => Number(node.attrs['y1']))
    const labelYs = nodes
      .filter((node) => node.tag === 'text' && node.attrs['text-anchor'] === 'end')
      .map((node) => Number(node.attrs['y']) - 4)

    expect(gridYs).toEqual(labelYs)
  })
})
