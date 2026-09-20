import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestRoot, installObsidianDomExtensions } from '../harness/obsidian-dom'

const chartSvgMock = vi.hoisted(() => ({
  renderExerciseChartSvg: vi.fn(),
}))

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

vi.mock('../../src/ui/exercise-chart-svg', () => ({
  renderExerciseChartSvg: chartSvgMock.renderExerciseChartSvg,
}))

import type { MarkdownPostProcessorContext } from 'obsidian'
import { TFile } from 'obsidian'

import type { ChartSeries } from '../../src/domain/exercise-chart'
import type { FitKitIndex } from '../../src/domain/types'
import type { FitKitSettings } from '../../src/settings'
import { renderExerciseChartBlock } from '../../src/ui/exercise-chart-block'
import { buildMockVaultFolderTree } from '../fixtures/mock-vault-folder-tree'

type ChartBlockPlugin = Parameters<typeof renderExerciseChartBlock>[0]
type Frontmatter = Record<string, unknown>

const emptyIndex: FitKitIndex = {
  schemaVersion: 1,
  builtAt: 0,
  entries: [],
  diagnostics: [],
}

function createSettings(overrides: Partial<FitKitSettings> = {}): FitKitSettings {
  return {
    fitnessRoot: 'Fitness',
    autoOpenWorkoutEditor: true,
    strengthRestTimerEnabled: true,
    autosaveDebounceMs: 600,
    chartSessionsWindow: 30,
    exerciseRegistry: [],
    hiddenDashboardSectionsByPath: {},
    schemaVersion: 1,
    ...overrides,
  }
}

function createPlugin(
  files: TFile[],
  frontmatterByPath: ReadonlyMap<string, Frontmatter>,
  settings: FitKitSettings = createSettings(),
): ChartBlockPlugin {
  return {
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
        ...buildMockVaultFolderTree(files),
      },
      metadataCache: {
        getFileCache: (file: TFile) => ({ frontmatter: frontmatterByPath.get(file.path) }),
      },
    },
    settings,
    cachedIndex: emptyIndex,
    lastDiagnostics: [],
  } as unknown as ChartBlockPlugin
}

function createContext(sourcePath: string): MarkdownPostProcessorContext {
  return { sourcePath } as MarkdownPostProcessorContext
}

function renderedNotes(): string[] {
  const call = chartSvgMock.renderExerciseChartSvg.mock.calls[0]
  if (!call) {
    throw new Error('Expected chart renderer to be called.')
  }
  const options = call[2] as { notes?: string[] } | undefined
  return options?.notes ?? []
}

function renderedSeries(): ChartSeries {
  const call = chartSvgMock.renderExerciseChartSvg.mock.calls[0]
  if (!call) {
    throw new Error('Expected chart renderer to be called.')
  }
  return call[1] as ChartSeries
}

describe('exercise chart block rendering', () => {
  beforeEach(() => {
    installObsidianDomExtensions()
    chartSvgMock.renderExerciseChartSvg.mockReset()
  })

  it('names every known kind in the missing kind note for non-exercise notes', async () => {
    const plugin = createPlugin([], new Map())

    await renderExerciseChartBlock(
      plugin,
      'exercise: Bench Press',
      createTestRoot(),
      createContext('Fitness/Dashboard.md'),
    )

    expect(renderedNotes()).toEqual([
      "No 'kind:' supplied; defaulting to strength. Add 'kind: strength' or 'kind: duration' or 'kind: bodyweight' to be explicit.",
    ])
  })

  it('shows a missing kind frontmatter note for exercise notes that fall back to strength', async () => {
    const file = new TFile('Fitness/Exercises/Bench Press.md')
    const plugin = createPlugin([file], new Map([[file.path, { type: 'exercise' }]]))

    await renderExerciseChartBlock(plugin, '', createTestRoot(), createContext(file.path))

    expect(renderedNotes()).toEqual([
      "Exercise note frontmatter is missing 'kind:'; defaulting to strength. Add 'kind: strength' or 'kind: duration' or 'kind: bodyweight' to be explicit.",
    ])
  })

  it('shows an invalid kind frontmatter note for exercise notes that fall back to strength', async () => {
    const file = new TFile('Fitness/Exercises/Bench Press.md')
    const plugin = createPlugin(
      [file],
      new Map([[file.path, { type: 'exercise', kind: 'cardio' }]]),
    )

    await renderExerciseChartBlock(plugin, '', createTestRoot(), createContext(file.path))

    expect(renderedNotes()).toEqual([
      "Exercise note frontmatter has unrecognised 'kind: cardio'; defaulting to strength. Use 'kind: strength' or 'kind: duration' or 'kind: bodyweight'.",
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

    await renderExerciseChartBlock(plugin, '', createTestRoot(), createContext(file.path))

    expect(renderedNotes()).toEqual([])
  })

  it('uses exercise note unit frontmatter for strength charts', async () => {
    const file = new TFile('Fitness/Exercises/Bench Press.md')
    const plugin = createPlugin(
      [file],
      new Map([[file.path, { type: 'exercise', kind: 'strength', unit: 'lbs' }]]),
    )

    await renderExerciseChartBlock(plugin, '', createTestRoot(), createContext(file.path))

    expect(renderedSeries().unit).toBe('lbs')
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

    await renderExerciseChartBlock(plugin, '', createTestRoot(), createContext(file.path))

    expect(renderedSeries().kind).toBe('duration')
    expect(renderedNotes()).toEqual([
      "Exercise note frontmatter has unrecognised 'kind: cardio'; using duration from the exercise registry. Use 'kind: strength' or 'kind: duration' or 'kind: bodyweight'.",
    ])
  })

  it('accepts and rejects the same kinds as the other frontmatter read paths', async () => {
    const accepted: unknown[] = ['strength', 'duration', 'bodyweight', ' Strength ', 'DURATION']
    for (const kind of accepted) {
      chartSvgMock.renderExerciseChartSvg.mockReset()
      const file = new TFile('Fitness/Exercises/Bench Press.md')
      const plugin = createPlugin([file], new Map([[file.path, { type: 'exercise', kind }]]))

      await renderExerciseChartBlock(plugin, '', createTestRoot(), createContext(file.path))

      expect(renderedNotes()).toEqual([])
    }

    const invalid: unknown[] = ['cardio']
    for (const kind of invalid) {
      chartSvgMock.renderExerciseChartSvg.mockReset()
      const file = new TFile('Fitness/Exercises/Bench Press.md')
      const plugin = createPlugin([file], new Map([[file.path, { type: 'exercise', kind }]]))

      await renderExerciseChartBlock(plugin, '', createTestRoot(), createContext(file.path))

      expect(renderedNotes()).toEqual([
        `Exercise note frontmatter has unrecognised 'kind: ${String(kind).trim()}'; defaulting to strength. Use 'kind: strength' or 'kind: duration' or 'kind: bodyweight'.`,
      ])
    }

    const missing: Frontmatter[] = [
      { type: 'exercise' },
      { type: 'exercise', kind: '' },
      { type: 'exercise', kind: '   ' },
      { type: 'exercise', kind: 42 },
    ]
    for (const frontmatter of missing) {
      chartSvgMock.renderExerciseChartSvg.mockReset()
      const file = new TFile('Fitness/Exercises/Bench Press.md')
      const plugin = createPlugin([file], new Map([[file.path, frontmatter]]))

      await renderExerciseChartBlock(plugin, '', createTestRoot(), createContext(file.path))

      expect(renderedNotes()).toEqual([
        "Exercise note frontmatter is missing 'kind:'; defaulting to strength. Add 'kind: strength' or 'kind: duration' or 'kind: bodyweight' to be explicit.",
      ])
    }
  })

  it('renders the registry rung names on a bodyweight chart', async () => {
    const actual = await vi.importActual<typeof import('../../src/ui/exercise-chart-svg')>(
      '../../src/ui/exercise-chart-svg',
    )
    chartSvgMock.renderExerciseChartSvg.mockImplementationOnce(
      (container: unknown, series: unknown, options: unknown) =>
        actual.renderExerciseChartSvg(
          container as HTMLElement,
          series as ChartSeries,
          options as { notes?: string[] },
        ),
    )
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
    plugin.cachedIndex = {
      schemaVersion: 1,
      builtAt: 0,
      diagnostics: [],
      entries: [
        {
          path: 'Fitness/Workouts/2026-04-01.md',
          mtime: 1,
          date: '2026-04-01',
          name: 'Workout',
          exercises: [
            {
              exerciseName: 'Push-Up',
              kind: 'bodyweight',
              maxBodyweightSet: { level: 2, reps: 8, load: 0 },
              totalSets: 1,
            },
          ],
        },
      ],
    }
    const el = createTestRoot()

    await renderExerciseChartBlock(
      plugin,
      'exercise: Push-Up\nkind: bodyweight',
      el,
      createContext('Fitness/Dashboard.md'),
    )

    expect(el.textContent).toContain('Knee push-up')
  })
})
