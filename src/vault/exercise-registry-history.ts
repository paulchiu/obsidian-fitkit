import type { App } from 'obsidian'

import { normalize, type ExerciseKind } from '../domain/exercise-registry'
import { parseWorkoutNote, type WorkoutNoteModel } from '../domain/workout-note-model'
import type { FitKitSettings } from '../settings'
import { workoutsFolder } from '../settings-paths'
import { markdownFilesInFolder } from './folder-scan'

export interface HistoryOnlyCandidate {
  name: string
  kind: ExerciseKind
  sourcePaths: string[]
}

/**
 * Exercise names referenced by `[exercise:: [[Name]]]` inline fields in workout
 * notes whose normalized key is absent from `knownKeys` (the union of exercise
 * note names and overlay registry names and aliases). `readMode: 'fresh'` reads current disk
 * contents via `vault.read`; `'cached'` uses `vault.cachedRead` for cheaper
 * display-only scans.
 */
export async function collectHistoryOnlyCandidates(
  app: App,
  settings: FitKitSettings,
  knownKeys: ReadonlySet<string>,
  readMode: 'cached' | 'fresh' = 'cached',
): Promise<HistoryOnlyCandidate[]> {
  const files = markdownFilesInFolder(app, workoutsFolder(settings))

  const byKey = new Map<string, HistoryOnlyCandidate>()
  for (const file of files) {
    const text =
      readMode === 'fresh' ? await app.vault.read(file) : await app.vault.cachedRead(file)
    const result = parseWorkoutNote(text, file.path)
    if (!result.isWorkout || !result.model) {
      continue
    }
    collectFromModel(result.model, knownKeys, byKey)
  }

  return [...byKey.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function collectFromModel(
  model: WorkoutNoteModel,
  knownKeys: ReadonlySet<string>,
  byKey: Map<string, HistoryOnlyCandidate>,
): void {
  for (const exercise of model.exercises) {
    const key = normalize(exercise.exerciseName)
    if (key.length === 0 || knownKeys.has(key)) {
      continue
    }
    const existing = byKey.get(key)
    if (existing) {
      if (!existing.sourcePaths.includes(model.sourcePath)) {
        existing.sourcePaths.push(model.sourcePath)
      }
      continue
    }
    byKey.set(key, {
      name: exercise.exerciseName,
      kind: exercise.kind,
      sourcePaths: [model.sourcePath],
    })
  }
}
