import { describe, expect, it, vi } from 'vitest'

import { createTestRoot, harnessWindow } from '../../harness/obsidian-dom'

vi.mock('obsidian', () => {
  class Notice {
    constructor(readonly message: string) {}
  }

  class TFile {
    basename: string
    extension: string

    constructor(readonly path: string) {
      this.basename = path.split('/').pop()?.replace(/\.md$/, '') ?? ''
      this.extension = path.split('.').pop() ?? ''
    }
  }

  return {
    Notice,
    TFile,
    normalizePath: (path: string) => path.replace(/\/+/g, '/'),
  }
})

import type { FitKitIndex } from '../../../src/domain/types'
import { renderExerciseChartBlock } from '../../../src/ui/obsidian/exercise-chart-block'
import {
  createContext,
  createPlugin,
  createSettings,
  indexOf,
  type ChartBlockPlugin,
} from '../../fixtures/chart-block'
import { outline } from '../../harness/outline'

/** The container's outline, then the svg's serialised markup one element per line. */
function drawn(el: HTMLElement): string {
  const svg = el.querySelector('svg')
  const markup = svg
    ? new harnessWindow.XMLSerializer().serializeToString(svg).replaceAll('><', '>\n<')
    : '(no svg)'
  return `${outline(el)}\n\n${markup}`
}

async function draw(plugin: ChartBlockPlugin, source: string): Promise<string> {
  const el = createTestRoot()
  await renderExerciseChartBlock(plugin, source, el, createContext('Fitness/Dashboard.md'))
  return drawn(el)
}

const strengthIndex = (values: number[]): FitKitIndex =>
  indexOf('Bench Press', values, (value) => ({
    exerciseName: '',
    kind: 'strength',
    bestSet: { weight: value, reps: 5, e1rm: value * 1.2 },
    maxWeightSet: { weight: value, reps: 5 },
  }))

const durationIndex = (values: number[]): FitKkitIndexAlias =>
  indexOf('Plank', values, (value) => ({
    exerciseName: '',
    kind: 'duration',
    totalDurationSeconds: value,
  }))

type FitKkitIndexAlias = FitKitIndex

const bodyweightIndex = (values: number[]): FitKitIndex =>
  indexOf('Push-Up', values, (level) => ({
    exerciseName: '',
    kind: 'bodyweight',
    maxBodyweightSet: { level, reps: level * 3, load: 0 },
  }))

const withIndex = (index: FitKitIndex, settings = createSettings()): ChartBlockPlugin => {
  const plugin = createPlugin([], new Map(), settings)
  plugin.cachedIndex = index
  return plugin
}

const longRung = `Diamond push-up ${'x'.repeat(40)}`
const laddered = createSettings({
  exerciseRegistry: [
    {
      name: 'Push-Up',
      kind: 'bodyweight',
      aliases: [],
      levels: ['Wall push-up', 'Knee push-up', 'Push-up', longRung],
    },
  ],
})

describe('exercise chart block structure', () => {
  it('draws a strength e1rm chart with its kind note', async () => {
    expect(
      await draw(withIndex(strengthIndex([80, 82.5, 85, 87.5, 90])), 'exercise: Bench Press'),
    ).toMatchSnapshot()
  })

  it('draws a strength weight chart', async () => {
    expect(
      await draw(
        withIndex(strengthIndex([80, 82.5, 85])),
        'exercise: Bench Press\nkind: strength\nmetric: weight',
      ),
    ).toMatchSnapshot()
  })

  it('draws a strength reps chart in pounds', async () => {
    const settings = createSettings({
      exerciseRegistry: [{ name: 'Bench Press', kind: 'strength', unit: 'lbs', aliases: [] }],
    })
    expect(
      await draw(
        withIndex(strengthIndex([80, 85]), settings),
        'exercise: Bench Press\nkind: strength\nmetric: reps',
      ),
    ).toMatchSnapshot()
  })

  it('draws a duration chart with the condensed date labels of a long series', async () => {
    expect(
      await draw(
        withIndex(durationIndex([30, 45, 60, 75, 90, 120, 150, 3600, 3660])),
        'exercise: Plank\nkind: duration',
      ),
    ).toMatchSnapshot()
  })

  it('draws a bodyweight level chart as a step line with ladder rung labels', async () => {
    expect(
      await draw(
        withIndex(bodyweightIndex([1, 2, 2, 4]), laddered),
        'exercise: Push-Up\nkind: bodyweight',
      ),
    ).toMatchSnapshot()
  })

  it('draws a bodyweight reps chart', async () => {
    expect(
      await draw(
        withIndex(bodyweightIndex([1, 2, 3]), laddered),
        'exercise: Push-Up\nkind: bodyweight\nmetric: reps',
      ),
    ).toMatchSnapshot()
  })

  it('draws a single session as a lone dot', async () => {
    expect(
      await draw(withIndex(strengthIndex([80])), 'exercise: Bench Press\nkind: strength'),
    ).toMatchSnapshot()
  })

  it('names the window when sessions were trimmed', async () => {
    expect(
      await draw(
        withIndex(strengthIndex([80, 82.5, 85, 87.5, 90])),
        'exercise: Bench Press\nkind: strength\nwindow: 3',
      ),
    ).toMatchSnapshot()
  })

  it('draws the empty state for an exercise with no sessions', async () => {
    expect(
      await draw(withIndex(strengthIndex([])), 'exercise: Bench Press\nkind: strength'),
    ).toMatchSnapshot()
  })

  it('asks for an exercise when the block names none', async () => {
    expect(await draw(withIndex(strengthIndex([])), '')).toMatchSnapshot()
  })

  it('draws the failure state when the chart cannot be built', async () => {
    const plugin = withIndex(strengthIndex([]))
    plugin.getIndex = (): Promise<FitKitIndex> => Promise.reject(new Error('index unavailable'))

    expect(await draw(plugin, 'exercise: Bench Press')).toMatchSnapshot()
  })
})
