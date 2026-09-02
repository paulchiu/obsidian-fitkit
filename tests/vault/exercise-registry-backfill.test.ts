import type { App, TFile } from 'obsidian'
import { describe, expect, it, vi } from 'vitest'

import type { ExerciseRegistryEntry } from '../../src/domain/exercise-registry'
import type { FitKitSettings } from '../../src/settings'
import {
  applyRegistryBackfillPlan,
  buildRegistryBackfillPlan,
  computeRegistryBackfillPlan,
} from '../../src/vault/exercise-registry-backfill'
import { buildMockVaultFolderTree } from '../fixtures/mock-vault-folder-tree'

vi.mock('obsidian', () => ({
  normalizePath: (path: string) => path.replace(/\/+/g, '/'),
}))

describe('computeRegistryBackfillPlan', () => {
  it('adds note-backed and history-only entries with no unit and correct counts', () => {
    const plan = computeRegistryBackfillPlan(
      [{ name: 'Squat', kind: 'strength' }],
      [{ name: 'New Plank', kind: 'duration' }],
      [],
      [],
    )

    expect(plan.entriesToAdd).toEqual([
      { name: 'New Plank', kind: 'duration', aliases: [] },
      { name: 'Squat', kind: 'strength', aliases: [] },
    ])
    expect(plan.entriesToAdd.every((entry) => entry.unit === undefined)).toBe(true)
    expect(plan.addedFromNotes).toBe(1)
    expect(plan.addedFromHistory).toBe(1)
    expect(plan.alreadyPresent).toBe(0)
    expect(plan.skippedTombstoned).toBe(0)
  })

  it('never overwrites an existing overlay entry, keyed on normalize()', () => {
    const overlay: ExerciseRegistryEntry[] = [
      { name: 'squat', kind: 'strength', unit: 'lbs', aliases: ['back squat'] },
    ]

    const plan = computeRegistryBackfillPlan([{ name: 'Squat', kind: 'strength' }], [], overlay, [])

    expect(plan.entriesToAdd).toEqual([])
    expect(plan.alreadyPresent).toBe(1)
    expect(overlay).toEqual([
      { name: 'squat', kind: 'strength', unit: 'lbs', aliases: ['back squat'] },
    ])
  })

  it('skips tombstoned names from both sources and counts them', () => {
    const plan = computeRegistryBackfillPlan(
      [{ name: 'Deleted note lift', kind: 'strength' }],
      [{ name: 'Deleted history lift', kind: 'duration' }],
      [],
      ['Deleted note lift', 'deleted history lift'],
    )

    expect(plan.entriesToAdd).toEqual([])
    expect(plan.skippedTombstoned).toBe(2)
    expect(plan.addedFromNotes).toBe(0)
    expect(plan.addedFromHistory).toBe(0)
  })

  it('treats a name already covered by an existing overlay alias as already present', () => {
    const overlay: ExerciseRegistryEntry[] = [
      { name: 'Push Up', kind: 'strength', aliases: ['push-up'] },
    ]

    const plan = computeRegistryBackfillPlan(
      [],
      [{ name: 'push-up', kind: 'strength' }],
      overlay,
      [],
    )

    expect(plan.entriesToAdd).toEqual([])
    expect(plan.alreadyPresent).toBe(1)
    expect(plan.addedFromHistory).toBe(0)
  })

  it('dedupes within a single run when two sources normalize to the same key', () => {
    const plan = computeRegistryBackfillPlan(
      [
        { name: 'Sit  Ups', kind: 'strength' },
        { name: 'Sit Ups', kind: 'strength' },
      ],
      [],
      [],
      [],
    )

    expect(plan.entriesToAdd).toHaveLength(1)
    expect(plan.addedFromNotes).toBe(1)
    expect(plan.alreadyPresent).toBe(1)
  })

  it('is idempotent: replaying against an overlay extended by the prior run adds nothing', () => {
    const catalog = [{ name: 'Squat', kind: 'strength' as const }]
    const history = [{ name: 'New Plank', kind: 'duration' as const }]

    const first = computeRegistryBackfillPlan(catalog, history, [], [])
    expect(first.entriesToAdd).toHaveLength(2)

    const second = computeRegistryBackfillPlan(catalog, history, first.entriesToAdd, [])

    expect(second.entriesToAdd).toEqual([])
    expect(second.alreadyPresent).toBe(2)
    expect(second.addedFromNotes).toBe(0)
    expect(second.addedFromHistory).toBe(0)
  })
})

describe('applyRegistryBackfillPlan', () => {
  it('appends new entries to the existing overlay, sorted by name, without mutating originals', () => {
    const existing: ExerciseRegistryEntry[] = [
      { name: 'Zercher squat', kind: 'strength', unit: 'kg', aliases: [] },
    ]
    const toAdd: ExerciseRegistryEntry[] = [{ name: 'Air bike', kind: 'duration', aliases: [] }]

    const result = applyRegistryBackfillPlan(existing, toAdd)

    expect(result).toEqual([
      { name: 'Air bike', kind: 'duration', aliases: [] },
      { name: 'Zercher squat', kind: 'strength', unit: 'kg', aliases: [] },
    ])
    expect(existing).toEqual([{ name: 'Zercher squat', kind: 'strength', unit: 'kg', aliases: [] }])
  })
})

type MockMarkdownFile = {
  path: string
  basename: string
  body?: string
  frontmatter?: Record<string, unknown>
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
      ...buildMockVaultFolderTree(markdownFiles),
      read: (file: TFile) => Promise.resolve(bodyByPath.get(file.path) ?? ''),
      cachedRead: () => Promise.reject(new Error('must use vault.read, not cachedRead')),
    },
    metadataCache: {
      getFileCache: (file: TFile) => ({
        frontmatter: frontmatterByPath.get(file.path),
      }),
    },
  } as unknown as App
}

describe('buildRegistryBackfillPlan', () => {
  it('reads workout notes fresh via vault.read and combines notes plus history-only names', async () => {
    const config = settings()
    config.deletedExercises = ['Deleted lift']
    const app = mockApp([
      {
        path: 'Fitness/Exercises/Squat.md',
        basename: 'Squat',
        frontmatter: { type: 'exercise', kind: 'strength' },
      },
      {
        path: 'Fitness/Workouts/2026-05-08.md',
        basename: '2026-05-08',
        frontmatter: { type: 'workout' },
        body: workoutNote(`## [[Squat]]

- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]

## [[New Plank]]

- [exercise:: [[New Plank]]] [duration:: 60]

## [[Deleted lift]]

- [exercise:: [[Deleted lift]]] [set:: 1] [weight:: 20] [reps:: 10]`),
      },
    ])

    const plan = await buildRegistryBackfillPlan(app, config)

    expect(plan.entriesToAdd).toEqual([
      { name: 'New Plank', kind: 'duration', aliases: [] },
      { name: 'Squat', kind: 'strength', aliases: [] },
    ])
    expect(plan.addedFromNotes).toBe(1)
    expect(plan.addedFromHistory).toBe(1)
    expect(plan.skippedTombstoned).toBe(1)
  })

  it('treats a history-only name already covered by an overlay alias as already present', async () => {
    const config = settings()
    config.exerciseRegistry = [{ name: 'Push Up', kind: 'strength', aliases: ['push-up'] }]
    const app = mockApp([
      {
        path: 'Fitness/Workouts/2026-05-08.md',
        basename: '2026-05-08',
        frontmatter: { type: 'workout' },
        body: workoutNote(`## [[push-up]]

- [exercise:: [[push-up]]] [set:: 1] [weight:: 20] [reps:: 10]`),
      },
    ])

    const plan = await buildRegistryBackfillPlan(app, config)

    expect(plan.entriesToAdd).toEqual([])
    expect(plan.addedFromHistory).toBe(0)
    expect(plan.alreadyPresent).toBe(0)
  })
})
