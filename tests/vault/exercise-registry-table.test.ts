import type { App, TFile } from 'obsidian'
import { describe, expect, it, vi } from 'vitest'

import type { FitKitSettings } from '../../src/settings'
import type { RegistryTableRow } from '../../src/vault/exercise-registry-table'
import {
  buildRegistryTableRows,
  filterRegistryTableRows,
} from '../../src/vault/exercise-registry-table'

vi.mock('obsidian', () => ({
  normalizePath: (path: string) => path.replace(/\/+/g, '/'),
}))

type MockMarkdownFile = {
  path: string
  basename: string
  body?: string
  frontmatter?: Record<string, unknown>
}

function settings(overrides: Partial<FitKitSettings> = {}): FitKitSettings {
  return {
    fitnessRoot: 'Fitness',
    autoOpenWorkoutEditor: true,
    strengthRestTimerEnabled: true,
    autosaveDebounceMs: 600,
    chartSessionsWindow: 30,
    exerciseRegistry: [],
    deletedExercises: [],
    hiddenDashboardSectionsByPath: {},
    schemaVersion: 1,
    ...overrides,
  }
}

function workoutNote(exercises: string): string {
  return `---\ntype: workout\ndate: 2026-05-08\nname: Test\n---\n\n${exercises}`
}

function mockApp(markdownFiles: MockMarkdownFile[]): App {
  const frontmatterByPath = new Map(
    markdownFiles.map((file) => [file.path, file.frontmatter] as const),
  )
  const bodyByPath = new Map(markdownFiles.map((file) => [file.path, file.body ?? ''] as const))
  return {
    vault: {
      getMarkdownFiles: () => markdownFiles as unknown as TFile[],
      cachedRead: (file: TFile) => Promise.resolve(bodyByPath.get(file.path) ?? ''),
      read: () => Promise.reject(new Error('table rows should use cachedRead, not read')),
    },
    metadataCache: {
      getFileCache: (file: TFile) => ({
        frontmatter: frontmatterByPath.get(file.path),
      }),
    },
  } as unknown as App
}

describe('buildRegistryTableRows', () => {
  it('tags note-backed, overlay-only, and history-only rows with honest provenance', async () => {
    const app = mockApp([
      {
        path: 'Fitness/Exercises/Squat.md',
        basename: 'Squat',
        frontmatter: { type: 'exercise', kind: 'strength', unit: 'lbs' },
      },
      {
        path: 'Fitness/Workouts/2026-05-08.md',
        basename: '2026-05-08',
        frontmatter: { type: 'workout' },
        body: workoutNote(`## [[Squat]]

- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]

## [[New Plank]]

- [exercise:: [[New Plank]]] [duration:: 60]`),
      },
    ])
    const config = settings({
      exerciseRegistry: [{ name: 'Air bike', kind: 'duration', unit: 'kg', aliases: ['bike'] }],
    })

    const rows = await buildRegistryTableRows(app, config)

    expect(rows).toEqual([
      {
        name: 'Air bike',
        kind: 'duration',
        unit: 'kg',
        aliases: ['bike'],
        provenance: 'overlay',
        notePath: null,
        sourcePaths: [],
      },
      {
        name: 'New Plank',
        kind: 'duration',
        unit: undefined,
        aliases: [],
        provenance: 'history',
        notePath: null,
        sourcePaths: ['Fitness/Workouts/2026-05-08.md'],
      },
      {
        name: 'Squat',
        kind: 'strength',
        unit: 'lbs',
        aliases: [],
        provenance: 'note',
        notePath: 'Fitness/Exercises/Squat.md',
        sourcePaths: [],
      },
    ])
  })

  it('excludes tombstoned names from the history-only rows', async () => {
    const app = mockApp([
      {
        path: 'Fitness/Workouts/2026-05-08.md',
        basename: '2026-05-08',
        frontmatter: { type: 'workout' },
        body: workoutNote(`## [[Deleted lift]]

- [exercise:: [[Deleted lift]]] [set:: 1] [weight:: 20] [reps:: 10]`),
      },
    ])
    const config = settings({ deletedExercises: ['Deleted lift'] })

    const rows = await buildRegistryTableRows(app, config)

    expect(rows).toEqual([])
  })

  it('does not add a phantom history-only row for a name already covered by an overlay alias', async () => {
    const app = mockApp([
      {
        path: 'Fitness/Workouts/2026-05-08.md',
        basename: '2026-05-08',
        frontmatter: { type: 'workout' },
        body: workoutNote(`## [[push-up]]

- [exercise:: [[push-up]]] [set:: 1] [weight:: 20] [reps:: 10]`),
      },
    ])
    const config = settings({
      exerciseRegistry: [{ name: 'Push Up', kind: 'strength', aliases: ['push-up'] }],
    })

    const rows = await buildRegistryTableRows(app, config)

    expect(rows).toEqual([
      {
        name: 'Push Up',
        kind: 'strength',
        unit: undefined,
        aliases: ['push-up'],
        provenance: 'overlay',
        notePath: null,
        sourcePaths: [],
      },
    ])
  })

  it('keeps an overlay entry layered on a note as note-backed, carrying its saved aliases', async () => {
    const app = mockApp([
      {
        path: 'Fitness/Exercises/Plank.md',
        basename: 'Plank',
        frontmatter: { type: 'exercise', kind: 'duration' },
      },
    ])
    const config = settings({
      exerciseRegistry: [{ name: 'Plank', kind: 'duration', aliases: ['front plank'] }],
    })

    const rows = await buildRegistryTableRows(app, config)

    expect(rows).toEqual([
      {
        name: 'Plank',
        kind: 'duration',
        unit: undefined,
        aliases: ['front plank'],
        provenance: 'note',
        notePath: 'Fitness/Exercises/Plank.md',
        sourcePaths: [],
      },
    ])
  })
})

describe('filterRegistryTableRows', () => {
  function row(overrides: Partial<RegistryTableRow>): RegistryTableRow {
    return {
      name: 'Squat',
      kind: 'strength',
      unit: undefined,
      aliases: [],
      provenance: 'overlay',
      notePath: null,
      sourcePaths: [],
      ...overrides,
    }
  }

  it('returns every row unchanged for an empty query', () => {
    const rows = [row({ name: 'Squat' }), row({ name: 'Plank' })]

    expect(filterRegistryTableRows(rows, '')).toEqual(rows)
  })

  it('matches on a substring of the name, case and whitespace insensitively', () => {
    const rows = [row({ name: 'Back Squat' }), row({ name: 'Plank' })]

    expect(filterRegistryTableRows(rows, 'squat')).toEqual([rows[0]])
  })

  it('matches on a substring of an alias even when the name does not match', () => {
    const rows = [
      row({ name: 'Push Up', aliases: ['push-up', 'press up'] }),
      row({ name: 'Plank' }),
    ]

    expect(filterRegistryTableRows(rows, 'press')).toEqual([rows[0]])
  })

  it('returns an empty list when nothing matches', () => {
    const rows = [row({ name: 'Squat' })]

    expect(filterRegistryTableRows(rows, 'nonexistent')).toEqual([])
  })
})
