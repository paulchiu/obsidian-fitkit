import type { App, TFile } from 'obsidian'
import { describe, expect, it, vi } from 'vitest'

import type { FitKitSettings } from '../../src/settings'
import {
  buildExerciseRegistrySnapshot,
  exerciseRegistryWithVaultNotes,
} from '../../src/vault/exercise-registry-vault'

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

function settingsWithRegistry(
  exerciseRegistry: FitKitSettings['exerciseRegistry'],
  deletedExercises: string[] = [],
): FitKitSettings {
  return {
    fitnessRoot: 'Fitness',
    autoOpenWorkoutEditor: true,
    strengthRestTimerEnabled: true,
    autoUpdateDashboard: true,
    autosaveDebounceMs: 600,
    chartSessionsWindow: 30,
    exerciseRegistry,
    deletedExercises,
    hiddenDashboardSectionsByPath: {},
    schemaVersion: 1,
  }
}

describe('exercise registry vault merge', () => {
  it('adds typed exercise notes from the configured folder without requiring saved registry data', () => {
    const app = mockApp([
      {
        path: 'Fitness/Exercises/Squat.md',
        basename: 'Squat',
        frontmatter: { type: 'exercise', kind: 'strength' },
      },
      {
        path: 'Fitness/Exercises/Plank.md',
        basename: 'Plank',
        frontmatter: { type: 'exercise', kind: 'duration' },
      },
      {
        path: 'Fitness/Exercises/Draft.md',
        basename: 'Draft',
        frontmatter: { type: 'workout', kind: 'strength' },
      },
      {
        path: 'Fitness/Workouts/2026-04-26.md',
        basename: '2026-04-26',
        frontmatter: { type: 'workout' },
      },
      {
        path: 'Other/Exercises/Ignored.md',
        basename: 'Ignored',
        frontmatter: { type: 'exercise', kind: 'strength' },
      },
    ])

    const merged = exerciseRegistryWithVaultNotes(app, settingsWithRegistry([]))

    expect(merged.map((entry) => entry.name)).toEqual(['Plank', 'Squat'])
    expect(merged.map((entry) => entry.kind)).toEqual(['duration', 'strength'])
  })

  it('preserves existing saved registry entries and aliases when a vault note also exists', () => {
    const app = mockApp([
      {
        path: 'Fitness/Exercises/Squat.md',
        basename: 'Squat',
        frontmatter: { type: 'exercise', kind: 'strength' },
      },
    ])
    const merged = exerciseRegistryWithVaultNotes(
      app,
      settingsWithRegistry([{ name: 'Squat', kind: 'strength', aliases: ['back squat'] }]),
    )

    expect(merged).toEqual([{ name: 'Squat', kind: 'strength', aliases: ['back squat'] }])
  })

  it('keeps no-note registry entries', () => {
    const snapshot = buildExerciseRegistrySnapshot(
      mockApp([]),
      settingsWithRegistry([{ name: 'Air bike', kind: 'duration', aliases: ['bike'] }]),
    )

    expect(snapshot.entries).toEqual([{ name: 'Air bike', kind: 'duration', aliases: ['bike'] }])
    expect(snapshot.diagnostics).toEqual([])
  })

  it('prefers note kind over saved registry kind and emits a diagnostic', () => {
    const snapshot = buildExerciseRegistrySnapshot(
      mockApp([
        {
          path: 'Fitness/Exercises/Plank.md',
          basename: 'Plank',
          frontmatter: { type: 'exercise', kind: 'duration' },
        },
      ]),
      settingsWithRegistry([{ name: 'Plank', kind: 'strength', aliases: ['front plank'] }]),
    )

    expect(snapshot.entries).toEqual([
      { name: 'Plank', kind: 'duration', aliases: ['front plank'] },
    ])
    expect(snapshot.diagnostics).toEqual([
      {
        kind: 'registry-kind-conflict',
        name: 'Plank',
        path: 'Fitness/Exercises/Plank.md',
        warnings: [
          "Saved registry kind 'strength' differs from note kind 'duration'; using note kind.",
        ],
      },
    ])
  })

  it('excludes tombstoned vault-derived entries unless a saved overlay exists', () => {
    const app = mockApp([
      {
        path: 'Fitness/Exercises/Deleted.md',
        basename: 'Deleted',
        frontmatter: { type: 'exercise', kind: 'strength' },
      },
      {
        path: 'Fitness/Exercises/Restored.md',
        basename: 'Restored',
        frontmatter: { type: 'exercise', kind: 'duration' },
      },
    ])

    const snapshot = buildExerciseRegistrySnapshot(
      app,
      settingsWithRegistry(
        [{ name: 'Restored', kind: 'strength', aliases: ['again'] }],
        ['deleted', 'restored'],
      ),
    )

    expect(snapshot.entries).toEqual([{ name: 'Restored', kind: 'duration', aliases: ['again'] }])
  })
})
