import { beforeEach, describe, expect, it, vi } from 'vitest'

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

type ChartBlockPlugin = Parameters<typeof renderExerciseChartBlock>[0]
type Frontmatter = Record<string, unknown>

interface TestElementOptions {
  cls?: string
  text?: string
}

class TestElement {
  readonly children: TestElement[] = []
  readonly classes = new Set<string>()
  textContent = ''

  constructor(readonly tagName: string) {}

  empty(): void {
    this.children.length = 0
    this.textContent = ''
  }

  addClass(className: string): void {
    this.classes.add(className)
  }

  createDiv(options: TestElementOptions = {}): TestElement {
    const child = new TestElement('div')
    if (options.cls) {
      child.addClass(options.cls)
    }
    if (options.text !== undefined) {
      child.textContent = options.text
    }
    this.children.push(child)
    return child
  }
}

const emptyIndex: FitKitIndex = {
  schemaVersion: 1,
  builtAt: 0,
  entries: [],
  diagnostics: [],
}

function createSettings(overrides: Partial<FitKitSettings> = {}): FitKitSettings {
  return {
    fitnessRoot: 'Fitness',
    journalFolder: '',
    autoCreateMissingExercises: false,
    autoOpenWorkoutEditor: true,
    strengthRestTimerEnabled: true,
    autoUpdateDashboard: true,
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
        getMarkdownFiles: () => files,
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
    chartSvgMock.renderExerciseChartSvg.mockReset()
  })

  it('shows a missing kind frontmatter note for exercise notes that fall back to strength', async () => {
    const file = new TFile('Fitness/Exercises/Bench Press.md')
    const plugin = createPlugin([file], new Map([[file.path, { type: 'exercise' }]]))

    await renderExerciseChartBlock(
      plugin,
      '',
      new TestElement('div') as unknown as HTMLElement,
      createContext(file.path),
    )

    expect(renderedNotes()).toEqual([
      "Exercise note frontmatter is missing 'kind:'; defaulting to strength. Add 'kind: strength' or 'kind: duration' to be explicit.",
    ])
  })

  it('shows an invalid kind frontmatter note for exercise notes that fall back to strength', async () => {
    const file = new TFile('Fitness/Exercises/Bench Press.md')
    const plugin = createPlugin(
      [file],
      new Map([[file.path, { type: 'exercise', kind: 'cardio' }]]),
    )

    await renderExerciseChartBlock(
      plugin,
      '',
      new TestElement('div') as unknown as HTMLElement,
      createContext(file.path),
    )

    expect(renderedNotes()).toEqual([
      "Exercise note frontmatter has unrecognised 'kind: cardio'; defaulting to strength. Use 'kind: strength' or 'kind: duration'.",
    ])
  })

  it('suppresses the missing kind note when the registry resolves the exercise to duration', async () => {
    const file = new TFile('Fitness/Exercises/Plank.md')
    const plugin = createPlugin(
      [file],
      new Map([[file.path, { type: 'exercise' }]]),
      createSettings({
        exerciseRegistry: [{ name: 'Plank', kind: 'duration', aliases: [] }],
      }),
    )

    await renderExerciseChartBlock(
      plugin,
      '',
      new TestElement('div') as unknown as HTMLElement,
      createContext(file.path),
    )

    expect(renderedNotes()).toEqual([])
  })

  it('shows an invalid kind note when the registry resolves the exercise to duration', async () => {
    const file = new TFile('Fitness/Exercises/Plank.md')
    const plugin = createPlugin(
      [file],
      new Map([[file.path, { type: 'exercise', kind: 'cardio' }]]),
      createSettings({
        exerciseRegistry: [{ name: 'Plank', kind: 'duration', aliases: [] }],
      }),
    )

    await renderExerciseChartBlock(
      plugin,
      '',
      new TestElement('div') as unknown as HTMLElement,
      createContext(file.path),
    )

    expect(renderedSeries().kind).toBe('duration')
    expect(renderedNotes()).toEqual([
      "Exercise note frontmatter has unrecognised 'kind: cardio'; using duration from the exercise registry. Use 'kind: strength' or 'kind: duration'.",
    ])
  })
})
