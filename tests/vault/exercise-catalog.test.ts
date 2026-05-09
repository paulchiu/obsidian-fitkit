import type { App, TFile } from 'obsidian'
import { describe, expect, it, vi } from 'vitest'

import type { FitKitSettings } from '../../src/settings'
import { readExerciseCatalog } from '../../src/vault/exercise-catalog'

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
    vault: {
      getMarkdownFiles: () => markdownFiles as unknown as TFile[],
    },
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
    autoUpdateDashboard: true,
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
          frontmatter: { type: ' exercise ', kind: 'strength' },
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
      { name: 'Squat', path: 'Fitness/Exercises/Squat.md', kind: 'strength' },
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
})
