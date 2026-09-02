import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'

import { epleyE1rm, pickBestSet, pickHeaviestSet } from '../../src/domain/epley'
import type { FitKitSettings } from '../../src/settings'
import { rebuildIndex } from '../../src/vault/index'
import { buildMockVaultFolderTree } from '../fixtures/mock-vault-folder-tree'

describe('index helpers', () => {
  it('calculates Epley e1RM', () => {
    expect(epleyE1rm(100, 5)).toBeCloseTo(100 * (1 + 5 / 30), 5)
  })

  it('picks the best Tier A set from the 1 to 12 rep range', () => {
    expect(
      pickBestSet([
        { weight: 50, reps: 10 },
        { weight: 60, reps: 8 },
        { weight: 80, reps: 1 },
      ]),
    ).toEqual({
      weight: 80,
      reps: 1,
      e1rm: epleyE1rm(80, 1),
    })
  })

  it('picks the best Tier B set when all reps are above 12', () => {
    expect(
      pickBestSet([
        { weight: 50, reps: 20 },
        { weight: 45, reps: 30 },
      ]),
    ).toEqual({
      weight: 45,
      reps: 30,
      e1rm: epleyE1rm(45, 30),
    })
  })

  it('picks the most reps for Tier C when all weights are zero', () => {
    expect(
      pickBestSet([
        { weight: 0, reps: 6 },
        { weight: 0, reps: 12 },
      ]),
    ).toEqual({
      weight: 0,
      reps: 12,
      e1rm: 0,
    })
  })

  it('treats missing weight with completed reps as a bodyweight best set', () => {
    expect(pickBestSet([{ reps: 8 }, { reps: 12 }])).toEqual({
      weight: 0,
      reps: 12,
      e1rm: 0,
    })
  })

  it('returns null for empty sets', () => {
    expect(pickBestSet([])).toBeNull()
  })

  it('returns null when every strength set has zero reps', () => {
    expect(
      pickBestSet([
        { weight: 20, reps: 0 },
        { weight: 30, reps: 0 },
      ]),
    ).toBeNull()
  })

  it('picks the best set from non-zero-rep candidates', () => {
    expect(
      pickBestSet([
        { weight: 200, reps: 0 },
        { weight: 80, reps: 5 },
        { weight: 90, reps: 3 },
      ]),
    ).toEqual({
      weight: 90,
      reps: 3,
      e1rm: epleyE1rm(90, 3),
    })
  })

  it('picks the heaviest set and breaks ties by reps', () => {
    expect(
      pickHeaviestSet([
        { weight: 100, reps: 3 },
        { weight: 95, reps: 8 },
        { weight: 100, reps: 5 },
      ]),
    ).toEqual({ weight: 100, reps: 5 })
  })

  it('ignores a set carrying a weight but no reps, so a set in progress never counts', () => {
    expect(pickHeaviestSet([{ set: 1, weight: 200 }])).toBeNull()
    expect(
      pickHeaviestSet([
        { set: 1, weight: 100, reps: 5 },
        { set: 2, weight: 200 },
      ]),
    ).toEqual({ weight: 100, reps: 5, set: 1 })
    expect(pickBestSet([{ weight: 200 }])).toBeNull()
  })

  it('picks positive-weight sets before zero-weight sets', () => {
    expect(
      pickHeaviestSet([
        { set: 1, weight: 0, reps: 20 },
        { set: 2, weight: 15, reps: 5 },
      ]),
    ).toEqual({ weight: 15, reps: 5, set: 2 })
  })

  it('picks the most reps from zero-weight sets when there are no positive weights', () => {
    expect(
      pickHeaviestSet([
        { set: 1, weight: 0, reps: 8 },
        { set: 2, weight: 0, reps: 12 },
        { set: 3, weight: 0, reps: 10 },
      ]),
    ).toEqual({ weight: 0, reps: 12, set: 2 })
  })

  it('treats missing weight with completed reps as a bodyweight heaviest set', () => {
    expect(
      pickHeaviestSet([
        { set: 1, reps: 8 },
        { set: 2, reps: 12 },
        { set: 3, reps: 10 },
      ]),
    ).toEqual({ weight: 0, reps: 12, set: 2 })
  })

  it('returns null when heaviest-set candidates have no completed reps', () => {
    expect(
      pickHeaviestSet([{ set: 1 }, { set: 2, weight: 0 }, { set: 3, weight: 10, reps: 0 }]),
    ).toBeNull()
  })

  it('breaks zero-weight heaviest-set ties by lower set number', () => {
    expect(
      pickHeaviestSet([
        { set: 3, weight: 0, reps: 12 },
        { set: 2, weight: 0, reps: 12 },
      ]),
    ).toEqual({ weight: 0, reps: 12, set: 2 })
  })

  it('ignores incomplete heaviest-set candidates', () => {
    expect(
      pickHeaviestSet([
        { weight: 100, reps: 0 },
        { weight: Number.POSITIVE_INFINITY, reps: 5 },
        { weight: 90, reps: 8 },
      ]),
    ).toEqual({ weight: 90, reps: 8 })
  })
})

describe('rebuildIndex', () => {
  const settings: FitKitSettings = {
    fitnessRoot: '',
    autoOpenWorkoutEditor: true,
    strengthRestTimerEnabled: true,
    autosaveDebounceMs: 600,
    chartSessionsWindow: 30,
    exerciseRegistry: [],
    deletedExercises: [],
    hiddenDashboardSectionsByPath: {},
    schemaVersion: 1,
  }

  it('finds workout notes under a root-anchored Workouts folder when the fitness root is the vault root', async () => {
    const path = 'Workouts/2026-01-01.md'
    const source = ['---', 'type: workout', 'date: 2026-01-01', 'name: Push day', '---', ''].join(
      '\n',
    )
    const tree = buildMockVaultFolderTree([{ path, stat: { mtime: 1000 } }])
    const app = {
      vault: {
        getFolderByPath: tree.getFolderByPath,
        read: async () => source,
      },
    } as unknown as App

    const index = await rebuildIndex(app, settings)

    expect(index.entries.map((entry) => entry.path)).toEqual([path])
  })
})
