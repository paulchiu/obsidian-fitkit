import type { App } from 'obsidian'

import type { FitKitIndex, IndexDiagnostic } from '../domain/types'
import type { FitKitSettings } from '../settings'
import { rebuildIndex, updateIndexEntry } from './index'

export interface WorkoutIndex {
  cachedIndex: FitKitIndex | null
  lastDiagnostics: IndexDiagnostic[]
  invalidate(): void
  getIndex(): Promise<FitKitIndex>
  refreshEntry(path: string): Promise<void>
}

export function createWorkoutIndex(app: App, settings: () => FitKitSettings): WorkoutIndex {
  let cachedIndex: FitKitIndex | null = null
  let lastDiagnostics: IndexDiagnostic[] = []
  let generation = 0
  let pendingBuild: Promise<FitKitIndex> | null = null
  let refreshQueue: Promise<void> = Promise.resolve()

  const invalidate = (): void => {
    generation += 1
    cachedIndex = null
    pendingBuild = null
  }

  const getIndex = async (): Promise<FitKitIndex> => {
    while (cachedIndex === null) {
      const startedGeneration = generation
      const build = (pendingBuild ??= rebuildIndex(app, { ...settings() }))
      let index: FitKitIndex
      try {
        index = await build
      } catch (error) {
        if (startedGeneration !== generation) {
          continue
        }
        pendingBuild = null
        throw error
      }
      if (startedGeneration !== generation) {
        continue
      }
      cachedIndex = index
      lastDiagnostics = index.diagnostics
    }
    return cachedIndex
  }

  const refreshEntry = (path: string): Promise<void> => {
    const startedGeneration = generation
    const run = refreshQueue.then(async () => {
      const index = cachedIndex
      if (index === null || startedGeneration !== generation) {
        return
      }
      const updated = await updateIndexEntry(app, settings(), index, path)
      if (startedGeneration === generation && cachedIndex === index) {
        cachedIndex = updated
        lastDiagnostics = updated.diagnostics
      }
    })
    refreshQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return {
    get cachedIndex() {
      return cachedIndex
    },
    set cachedIndex(index) {
      invalidate()
      cachedIndex = index
    },
    get lastDiagnostics() {
      return lastDiagnostics
    },
    set lastDiagnostics(diagnostics) {
      lastDiagnostics = diagnostics
    },
    invalidate,
    getIndex,
    refreshEntry,
  }
}
