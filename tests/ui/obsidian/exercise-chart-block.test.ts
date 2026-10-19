import { describe, expect, it, vi } from 'vitest'

import { createTestRoot } from '../../harness/obsidian-dom'

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

import { TFile } from 'obsidian'

import { renderExerciseChartBlock } from '../../../src/ui/obsidian/exercise-chart-block'
import {
  createContext,
  createPlugin,
  createSettings,
  indexOf,
  type ChartBlockPlugin,
  type Frontmatter,
} from '../../fixtures/chart-block'

/** Renders one block and returns what it drew. */
async function draw(
  plugin: ChartBlockPlugin,
  source: string,
  sourcePath: string,
): Promise<HTMLElement> {
  const el = createTestRoot()
  await renderExerciseChartBlock(plugin, source, el, createContext(sourcePath))
  return el
}

function notesOf(el: HTMLElement): string[] {
  return [...el.querySelectorAll('.fitkit-chart-note')].map((note) => note.textContent ?? '')
}

/** The kind the empty state names, as in "No duration sessions found". */
function emptyKindOf(el: HTMLElement): string | undefined {
  return /^No (\w+) sessions/.exec(el.querySelector('.fitkit-chart-empty')?.textContent ?? '')?.[1]
}

const KIND_ADVICE = "'kind: strength' or 'kind: duration' or 'kind: bodyweight'"

describe('exercise chart block rendering', () => {
  it('names every known kind in the missing kind note for non-exercise notes', async () => {
    const el = await draw(
      createPlugin([], new Map()),
      'exercise: Bench Press',
      'Fitness/Dashboard.md',
    )

    expect(notesOf(el)).toEqual([
      `No 'kind:' supplied; defaulting to strength. Add ${KIND_ADVICE} to be explicit.`,
    ])
  })

  it('shows a missing kind frontmatter note for exercise notes that fall back to strength', async () => {
    const file = new TFile('Fitness/Exercises/Bench Press.md')
    const plugin = createPlugin([file], new Map([[file.path, { type: 'exercise' }]]))

    const el = await draw(plugin, '', file.path)

    expect(notesOf(el)).toEqual([
      `Exercise note frontmatter is missing 'kind:'; defaulting to strength. Add ${KIND_ADVICE} to be explicit.`,
    ])
  })

  it('shows an invalid kind frontmatter note for exercise notes that fall back to strength', async () => {
    const file = new TFile('Fitness/Exercises/Bench Press.md')
    const plugin = createPlugin(
      [file],
      new Map([[file.path, { type: 'exercise', kind: 'cardio' }]]),
    )

    const el = await draw(plugin, '', file.path)

    expect(notesOf(el)).toEqual([
      `Exercise note frontmatter has unrecognised 'kind: cardio'; defaulting to strength. Use ${KIND_ADVICE}.`,
    ])
  })

  it('suppresses the missing kind note when the registry resolves the exercise to duration', async () => {
    const file = new TFile('Fitness/Exercises/Plank.md')
    const plugin = createPlugin(
      [file],
      new Map([[file.path, { type: 'exercise' }]]),
      createSettings({
        exerciseRegistry: [{ name: 'Plank', kind: 'duration', unit: 'kg', aliases: [] }],
      }),
    )

    const el = await draw(plugin, '', file.path)

    expect(notesOf(el)).toEqual([])
  })

  it('charts an interval exercise note as duration without a kind note', async () => {
    const file = new TFile('Fitness/Exercises/Bike.md')
    const plugin = createPlugin(
      [file],
      new Map([[file.path, { type: 'exercise', kind: 'duration', interval: true }]]),
    )

    const el = await draw(plugin, '', file.path)

    expect([emptyKindOf(el), notesOf(el)]).toEqual(['duration', []])
  })

  it('uses exercise note unit frontmatter for strength charts', async () => {
    const file = new TFile('Fitness/Exercises/Bench Press.md')
    const plugin = createPlugin(
      [file],
      new Map([[file.path, { type: 'exercise', kind: 'strength', unit: 'lbs' }]]),
    )
    plugin.cachedIndex = indexOf('Bench Press', [100], (value) => ({
      exerciseName: '',
      kind: 'strength',
      bestSet: { weight: value, reps: 5, e1rm: value },
    }))

    const el = await draw(plugin, '', file.path)

    expect(el.textContent).toContain('e1rm (lbs)')
  })

  it('shows an invalid kind note when the registry resolves the exercise to duration', async () => {
    const file = new TFile('Fitness/Exercises/Plank.md')
    const plugin = createPlugin(
      [file],
      new Map([[file.path, { type: 'exercise', kind: 'cardio' }]]),
      createSettings({
        exerciseRegistry: [{ name: 'Plank', kind: 'duration', unit: 'kg', aliases: [] }],
      }),
    )

    const el = await draw(plugin, '', file.path)

    expect(emptyKindOf(el)).toBe('duration')
    expect(notesOf(el)).toEqual([
      `Exercise note frontmatter has unrecognised 'kind: cardio'; using duration from the exercise registry. Use ${KIND_ADVICE}.`,
    ])
  })

  it('accepts and rejects the same kinds as the other frontmatter read paths', async () => {
    const drawWith = async (frontmatter: Frontmatter): Promise<string[]> => {
      const file = new TFile('Fitness/Exercises/Bench Press.md')
      const plugin = createPlugin([file], new Map([[file.path, frontmatter]]))
      return notesOf(await draw(plugin, '', file.path))
    }

    const accepted: unknown[] = ['strength', 'duration', 'bodyweight', ' Strength ', 'DURATION']
    for (const kind of accepted) {
      expect(await drawWith({ type: 'exercise', kind })).toEqual([])
    }

    expect(await drawWith({ type: 'exercise', kind: 'cardio' })).toEqual([
      `Exercise note frontmatter has unrecognised 'kind: cardio'; defaulting to strength. Use ${KIND_ADVICE}.`,
    ])

    const missing: Frontmatter[] = [
      { type: 'exercise' },
      { type: 'exercise', kind: '' },
      { type: 'exercise', kind: '   ' },
      { type: 'exercise', kind: 42 },
    ]
    for (const frontmatter of missing) {
      expect(await drawWith(frontmatter)).toEqual([
        `Exercise note frontmatter is missing 'kind:'; defaulting to strength. Add ${KIND_ADVICE} to be explicit.`,
      ])
    }
  })

  it('renders the registry rung names on a bodyweight chart', async () => {
    const plugin = createPlugin(
      [],
      new Map(),
      createSettings({
        exerciseRegistry: [
          {
            name: 'Push-Up',
            kind: 'bodyweight',
            aliases: [],
            levels: ['Wall push-up', 'Knee push-up'],
          },
        ],
      }),
    )
    plugin.cachedIndex = indexOf('Push-Up', [2], (level) => ({
      exerciseName: '',
      kind: 'bodyweight',
      maxBodyweightSet: { level, reps: 8, load: 0 },
      totalSets: 1,
    }))

    const el = await draw(plugin, 'exercise: Push-Up\nkind: bodyweight', 'Fitness/Dashboard.md')

    expect(el.textContent).toContain('Knee push-up')
  })
})
