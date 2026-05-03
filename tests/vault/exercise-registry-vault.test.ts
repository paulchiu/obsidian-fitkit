import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'

import type { FitKitSettings } from '../../src/settings'
import { exerciseRegistryWithVaultNotes } from '../../src/vault/exercise-registry-vault'

function mockApp(markdownFiles: Array<{ path: string; basename: string }>): App {
  return {
    vault: {
      getMarkdownFiles: () => markdownFiles,
    },
  } as unknown as App
}

function settingsWithRegistry(
  exerciseRegistry: FitKitSettings['exerciseRegistry'],
): FitKitSettings {
  return {
    fitnessRoot: 'Fitness',
    journalFolder: '',
    autoCreateMissingExercises: false,
    autoOpenWorkoutEditor: true,
    strengthRestTimerEnabled: true,
    autoUpdateDashboard: true,
    autosaveDebounceMs: 600,
    chartSessionsWindow: 30,
    exerciseRegistry,
    hiddenDashboardSectionsByPath: {},
    schemaVersion: 1,
  }
}

describe('exercise registry vault merge', () => {
  it('adds exercise notes from the configured folder without requiring saved registry data', () => {
    const app = mockApp([
      { path: 'Fitness/Exercises/Squat.md', basename: 'Squat' },
      { path: 'Fitness/Exercises/Plank.md', basename: 'Plank' },
      { path: 'Fitness/Workouts/2026-04-26.md', basename: '2026-04-26' },
      { path: 'Other/Exercises/Ignored.md', basename: 'Ignored' },
    ])

    const merged = exerciseRegistryWithVaultNotes(app, settingsWithRegistry([]))

    expect(merged.map((entry) => entry.name)).toEqual(['Plank', 'Squat'])
  })

  it('preserves existing saved registry entries and aliases when a vault note also exists', () => {
    const app = mockApp([{ path: 'Fitness/Exercises/Squat.md', basename: 'Squat' }])
    const merged = exerciseRegistryWithVaultNotes(
      app,
      settingsWithRegistry([{ name: 'Squat', kind: 'strength', aliases: ['back squat'] }]),
    )

    expect(merged).toEqual([{ name: 'Squat', kind: 'strength', aliases: ['back squat'] }])
  })
})
