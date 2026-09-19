import type { App, TFile } from 'obsidian'
import { describe, expect, it, vi } from 'vitest'

import type { FitKitSettings } from '../../src/settings'
import { findExerciseNotePath, readExerciseCatalog } from '../../src/vault/exercise-catalog'
import { buildMockVaultFolderTree } from '../fixtures/mock-vault-folder-tree'

vi.mock('obsidian', () => ({
  normalizePath: (path: string) => path.replace(/^\/+/, '').replace(/\/+$/, ''),
}))

type MockMarkdownFile = {
  path: string
  basename: string
  frontmatter?: Record<string, unknown>
}

function mockApp(markdownFiles: MockMarkdownFile[]): App {
  const frontmatterByPath = new Map(
    markdownFiles.map((file) => [file.path, file.frontmatter] as const),
  )
  return {
    vault: buildMockVaultFolderTree(markdownFiles),
    metadataCache: {
      getFileCache: (file: TFile) => ({
        frontmatter: frontmatterByPath.get(file.path),
      }),
    },
  } as unknown as App
}

function settings(): FitKitSettings {
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
  }
}

describe('exercise catalog', () => {
  it('includes only exercise notes from the configured exercises folder', () => {
    const snapshot = readExerciseCatalog(
      mockApp([
        {
          path: 'Fitness/Exercises/Squat.md',
          basename: 'Squat',
          frontmatter: { type: ' exercise ', kind: 'strength', unit: 'LBS' },
        },
        {
          path: 'Fitness/Exercises/Workout draft.md',
          basename: 'Workout draft',
          frontmatter: { type: 'workout', kind: 'strength' },
        },
        {
          path: 'Fitness/Exercises/No type.md',
          basename: 'No type',
          frontmatter: { kind: 'strength' },
        },
        {
          path: 'Other/Exercises/Ignored.md',
          basename: 'Ignored',
          frontmatter: { type: 'exercise', kind: 'strength' },
        },
      ]),
      settings(),
    )

    expect(snapshot.entries).toEqual([
      { name: 'Squat', path: 'Fitness/Exercises/Squat.md', kind: 'strength', unit: 'lbs' },
    ])
    expect(snapshot.diagnostics).toEqual([])
  })

  it('uses frontmatter kind for strength and duration notes', () => {
    const snapshot = readExerciseCatalog(
      mockApp([
        {
          path: 'Fitness/Exercises/Plank.md',
          basename: 'Plank',
          frontmatter: { type: 'exercise', kind: ' duration ' },
        },
        {
          path: 'Fitness/Exercises/Squat.md',
          basename: 'Squat',
          frontmatter: { type: 'exercise', kind: 'STRENGTH' },
        },
      ]),
      settings(),
    )

    expect(snapshot.entries).toEqual([
      { name: 'Plank', path: 'Fitness/Exercises/Plank.md', kind: 'duration' },
      { name: 'Squat', path: 'Fitness/Exercises/Squat.md', kind: 'strength' },
    ])
  })

  it('accepts and rejects the same kinds as the other frontmatter read paths', () => {
    const accepted: Array<{ raw: unknown; kind: string }> = [
      { raw: 'strength', kind: 'strength' },
      { raw: 'duration', kind: 'duration' },
      { raw: ' Strength ', kind: 'strength' },
      { raw: 'DURATION', kind: 'duration' },
    ]
    const rejected: unknown[] = ['cardio', '', '   ', 42]
    const snapshot = readExerciseCatalog(
      mockApp([
        ...accepted.map((entry, index) => ({
          path: `Fitness/Exercises/Accepted${index}.md`,
          basename: `Accepted${index}`,
          frontmatter: { type: 'exercise', kind: entry.raw },
        })),
        ...rejected.map((kind, index) => ({
          path: `Fitness/Exercises/Rejected${index}.md`,
          basename: `Rejected${index}`,
          frontmatter: { type: 'exercise', kind },
        })),
        {
          path: 'Fitness/Exercises/Missing.md',
          basename: 'Missing',
          frontmatter: { type: 'exercise' },
        },
      ]),
      settings(),
    )

    expect(snapshot.entries.map((entry) => entry.kind)).toEqual(accepted.map((entry) => entry.kind))
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
      'Fitness/Exercises/Missing.md',
      'Fitness/Exercises/Rejected0.md',
      'Fitness/Exercises/Rejected1.md',
      'Fitness/Exercises/Rejected2.md',
      'Fitness/Exercises/Rejected3.md',
    ])
    for (const diagnostic of snapshot.diagnostics) {
      expect(diagnostic.warnings).toEqual(['Exercise note is missing a valid kind.'])
    }
  })

  it('diagnoses and skips exercise notes with invalid or missing kind', () => {
    const snapshot = readExerciseCatalog(
      mockApp([
        {
          path: 'Fitness/Exercises/Run.md',
          basename: 'Run',
          frontmatter: { type: 'exercise', kind: 'cardio' },
        },
        {
          path: 'Fitness/Exercises/Unknown.md',
          basename: 'Unknown',
          frontmatter: { type: 'exercise' },
        },
      ]),
      settings(),
    )

    expect(snapshot.entries).toEqual([])
    expect(snapshot.diagnostics).toEqual([
      {
        path: 'Fitness/Exercises/Run.md',
        warnings: ['Exercise note is missing a valid kind.'],
      },
      {
        path: 'Fitness/Exercises/Unknown.md',
        warnings: ['Exercise note is missing a valid kind.'],
      },
    ])
  })

  it('keeps a bodyweight ladder in author order', () => {
    const snapshot = readExerciseCatalog(
      mockApp([
        {
          path: 'Fitness/Exercises/Push-up.md',
          basename: 'Push-up',
          frontmatter: {
            type: 'exercise',
            kind: 'bodyweight',
            levels: ['Support hold', 'Tuck', 'Advanced tuck'],
          },
        },
      ]),
      settings(),
    )

    expect(snapshot.entries).toEqual([
      {
        name: 'Push-up',
        path: 'Fitness/Exercises/Push-up.md',
        kind: 'bodyweight',
        levels: ['Support hold', 'Tuck', 'Advanced tuck'],
      },
    ])
    expect(snapshot.diagnostics).toEqual([])
  })

  it('trims rungs and drops blank entries', () => {
    const snapshot = readExerciseCatalog(
      mockApp([
        {
          path: 'Fitness/Exercises/Push-up.md',
          basename: 'Push-up',
          frontmatter: {
            type: 'exercise',
            kind: 'bodyweight',
            levels: ['  Tuck  ', '', '   ', 'Advanced tuck '],
          },
        },
      ]),
      settings(),
    )

    expect(snapshot.entries).toEqual([
      {
        name: 'Push-up',
        path: 'Fitness/Exercises/Push-up.md',
        kind: 'bodyweight',
        levels: ['Tuck', 'Advanced tuck'],
      },
    ])
    expect(snapshot.diagnostics).toEqual([])
  })

  it('reads a bare string as a one-rung ladder', () => {
    const snapshot = readExerciseCatalog(
      mockApp([
        {
          path: 'Fitness/Exercises/Push-up.md',
          basename: 'Push-up',
          frontmatter: { type: 'exercise', kind: 'bodyweight', levels: '  Tuck  ' },
        },
      ]),
      settings(),
    )

    expect(snapshot.entries).toEqual([
      {
        name: 'Push-up',
        path: 'Fitness/Exercises/Push-up.md',
        kind: 'bodyweight',
        levels: ['Tuck'],
      },
    ])
    expect(snapshot.diagnostics).toEqual([])
  })

  it('leaves levels absent and warns when the ladder is not a string list', () => {
    const snapshot = readExerciseCatalog(
      mockApp([
        {
          path: 'Fitness/Exercises/Push-up.md',
          basename: 'Push-up',
          frontmatter: { type: 'exercise', kind: 'bodyweight', levels: 42 },
        },
      ]),
      settings(),
    )

    expect(snapshot.entries).toEqual([
      { name: 'Push-up', path: 'Fitness/Exercises/Push-up.md', kind: 'bodyweight' },
    ])
    expect(snapshot.entries[0]?.levels).toBeUndefined()
    expect(snapshot.diagnostics).toEqual([
      {
        path: 'Fitness/Exercises/Push-up.md',
        warnings: ['Exercise note has an invalid levels list.'],
      },
    ])
  })

  it('leaves levels absent and warns when every rung is blank', () => {
    const snapshot = readExerciseCatalog(
      mockApp([
        {
          path: 'Fitness/Exercises/Push-up.md',
          basename: 'Push-up',
          frontmatter: { type: 'exercise', kind: 'bodyweight', levels: ['', '   '] },
        },
      ]),
      settings(),
    )

    expect(snapshot.entries[0]?.levels).toBeUndefined()
    expect(snapshot.diagnostics).toEqual([
      {
        path: 'Fitness/Exercises/Push-up.md',
        warnings: ['Exercise note has an invalid levels list.'],
      },
    ])
  })

  it('ignores a ladder on a note whose kind is not bodyweight', () => {
    const snapshot = readExerciseCatalog(
      mockApp([
        {
          path: 'Fitness/Exercises/Squat.md',
          basename: 'Squat',
          frontmatter: {
            type: 'exercise',
            kind: 'strength',
            unit: 'kg',
            levels: ['Tuck', 'Advanced tuck'],
          },
        },
      ]),
      settings(),
    )

    expect(snapshot.entries).toEqual([
      { name: 'Squat', path: 'Fitness/Exercises/Squat.md', kind: 'strength', unit: 'kg' },
    ])
    expect(snapshot.entries[0]?.levels).toBeUndefined()
    expect(snapshot.diagnostics).toEqual([])
  })
})

describe('findExerciseNotePath', () => {
  it('returns the catalog path when an exercise note exists', () => {
    const app = mockApp([
      {
        path: 'Fitness/Exercises/Push-up.md',
        basename: 'Push-up',
        frontmatter: { type: 'exercise', kind: 'bodyweight' },
      },
    ])

    expect(findExerciseNotePath(app, settings(), 'Push-up')).toBe('Fitness/Exercises/Push-up.md')
  })

  it('returns null when no exercise note exists', () => {
    const app = mockApp([
      {
        path: 'Fitness/Exercises/Squat.md',
        basename: 'Squat',
        frontmatter: { type: 'exercise', kind: 'strength' },
      },
    ])

    expect(findExerciseNotePath(app, settings(), 'Push-up')).toBeNull()
  })
})
