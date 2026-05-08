import type { App, TFile } from 'obsidian'
import { describe, expect, it, vi } from 'vitest'

import type { FitKitSettings } from '../../src/settings'
import {
  applyExerciseImportPlan,
  buildExerciseImportPlan,
} from '../../src/vault/exercise-import-planner'

vi.mock('obsidian', () => ({
  normalizePath: (path: string) => path.replace(/\/+/g, '/'),
}))

type MockMarkdownFile = {
  path: string
  basename: string
  body?: string
  frontmatter?: Record<string, unknown>
}

interface MockAppState {
  createdFiles: Map<string, string>
  createdFolders: string[]
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

function workout(path: string, body: string): MockMarkdownFile {
  return {
    path,
    basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
    body,
    frontmatter: { type: 'workout' },
  }
}

function exercise(path: string, kind: 'strength' | 'duration'): MockMarkdownFile {
  return {
    path,
    basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
    frontmatter: { type: 'exercise', kind },
  }
}

function mockApp(
  markdownFiles: MockMarkdownFile[],
  failCreatePaths: readonly string[] = [],
): { app: App; state: MockAppState } {
  const createdFiles = new Map<string, string>()
  const createdFolders: string[] = []
  const failingCreates = new Set(failCreatePaths)
  const frontmatterByPath = new Map(
    markdownFiles.map((file) => [file.path, file.frontmatter] as const),
  )
  const bodyByPath = new Map(markdownFiles.map((file) => [file.path, file.body ?? ''] as const))
  const existingPaths = new Set(markdownFiles.map((file) => file.path))
  existingPaths.add('Fitness')
  existingPaths.add('Fitness/Exercises')
  existingPaths.add('Fitness/Workouts')

  const app = {
    vault: {
      getMarkdownFiles: () => markdownFiles as unknown as TFile[],
      cachedRead: (file: TFile) => Promise.resolve(bodyByPath.get(file.path) ?? ''),
      getAbstractFileByPath: (path: string) =>
        existingPaths.has(path) || createdFiles.has(path) ? { path } : null,
      createFolder: (path: string) => {
        createdFolders.push(path)
        existingPaths.add(path)
        return Promise.resolve()
      },
      create: (path: string, body: string) => {
        if (failingCreates.has(path)) {
          return Promise.reject(new Error(`Failed to create ${path}`))
        }
        createdFiles.set(path, body)
        existingPaths.add(path)
        return Promise.resolve({ path })
      },
    },
    metadataCache: {
      getFileCache: (file: TFile) => ({
        frontmatter: frontmatterByPath.get(file.path),
      }),
    },
  } as unknown as App

  return { app, state: { createdFiles, createdFolders } }
}

function workoutNote(exercises: string): string {
  return `---
type: workout
date: 2026-05-08
name: Test
---

${exercises}`
}

describe('exercise import planner', () => {
  it('marks tombstoned workout names as ignored instead of recreating them', async () => {
    const config = settings()
    config.deletedExercises = ['Deleted lift']
    const { app } = mockApp([
      exercise('Fitness/Exercises/Squat.md', 'strength'),
      workout(
        'Fitness/Workouts/2026-05-08.md',
        workoutNote(`## [[Squat]]

- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]

## [[Deleted lift]]

- [exercise:: [[Deleted lift]]] [set:: 1] [weight:: 20] [reps:: 10]

## [[Plank]]

- [exercise:: [[Plank]]] [duration:: 60]`),
      ),
    ])

    const plan = await buildExerciseImportPlan(app, config)

    expect(plan.rows.map((row) => [row.name, row.status, row.kind, row.createNote])).toEqual([
      ['Deleted lift', 'ignored', 'strength', false],
      ['Plank', 'missing', 'duration', true],
      ['Squat', 'known', 'strength', false],
    ])
  })

  it('creates note files, no-note registry entries, and restores tombstones from selected rows', async () => {
    const config = settings()
    config.deletedExercises = ['Deleted lift']
    const { app, state } = mockApp([
      workout(
        'Fitness/Workouts/2026-05-08.md',
        workoutNote(`## [[New lift]]

- [exercise:: [[New lift]]] [set:: 1] [weight:: 20] [reps:: 10]

## [[No note]]

- [exercise:: [[No note]]] [duration:: 45]

## [[Deleted lift]]

- [exercise:: [[Deleted lift]]] [set:: 1] [weight:: 20] [reps:: 10]`),
      ),
    ])
    const plan = await buildExerciseImportPlan(app, config)
    const rows = plan.rows.map((row) => ({ ...row }))
    const deleted = rows.find((row) => row.name === 'Deleted lift')
    const noNote = rows.find((row) => row.name === 'No note')
    expect(deleted).toBeDefined()
    expect(noNote).toBeDefined()
    if (deleted) {
      deleted.restoreIgnored = true
      deleted.createNoNoteEntry = true
    }
    if (noNote) {
      noNote.createNote = false
      noNote.createNoNoteEntry = true
    }

    const result = await applyExerciseImportPlan(app, config, rows)

    expect(result).toEqual({
      notesCreated: 1,
      registryEntriesCreated: 2,
      tombstonesRemoved: 1,
      settingsChanged: true,
    })
    expect([...state.createdFiles.keys()]).toEqual(['Fitness/Exercises/New lift.md'])
    expect(state.createdFiles.get('Fitness/Exercises/New lift.md')).toContain('kind: strength')
    expect(config.exerciseRegistry).toEqual([
      { name: 'Deleted lift', kind: 'strength', aliases: [] },
      { name: 'No note', kind: 'duration', aliases: [] },
    ])
    expect(config.deletedExercises).toEqual([])
  })

  it('does not mutate settings when applying selected rows fails', async () => {
    const config = settings()
    config.deletedExercises = ['Deleted lift']
    const { app, state } = mockApp(
      [
        workout(
          'Fitness/Workouts/2026-05-08.md',
          workoutNote(`## [[Deleted lift]]

- [exercise:: [[Deleted lift]]] [set:: 1] [weight:: 20] [reps:: 10]

## [[New lift]]

- [exercise:: [[New lift]]] [set:: 1] [weight:: 20] [reps:: 10]`),
        ),
      ],
      ['Fitness/Exercises/New lift.md'],
    )
    const plan = await buildExerciseImportPlan(app, config)
    const rows = plan.rows.map((row) => ({ ...row }))
    const deleted = rows.find((row) => row.name === 'Deleted lift')
    expect(deleted).toBeDefined()
    if (deleted) {
      deleted.restoreIgnored = true
      deleted.createNoNoteEntry = true
    }

    await expect(applyExerciseImportPlan(app, config, rows)).rejects.toThrow(
      'Failed to create Fitness/Exercises/New lift.md',
    )

    expect([...state.createdFiles.keys()]).toEqual([])
    expect(config.exerciseRegistry).toEqual([])
    expect(config.deletedExercises).toEqual(['Deleted lift'])
  })
})
