import type { App, TAbstractFile, TFile } from 'obsidian'

import { pickBestSet } from '../domain/epley'
import { pickMaxWeightSet } from '../domain/exercise-history'
import type { ExerciseIndexRow, FitKitIndex, IndexDiagnostic, IndexEntry } from '../domain/types'
import {
  parseWorkoutNote,
  type ExerciseEntry,
  type WorkoutNoteModel,
} from '../domain/workout-note-model'
import type { FitKitSettings } from '../settings'
import { normalizeFolder, workoutsFolder } from '../settings-paths'

/**
 * Full vault scan. Lists markdown files under the configured workouts folder.
 */
export async function rebuildIndex(app: App, settings: FitKitSettings): Promise<FitKitIndex> {
  const folder = workoutsFolder(settings)
  const entries: IndexEntry[] = []
  const diagnostics: IndexDiagnostic[] = []

  for (const file of app.vault.getMarkdownFiles()) {
    if (!isInFolder(file.path, folder)) {
      continue
    }

    const source = await app.vault.read(file)
    const result = parseWorkoutNote(source, file.path)
    if (!result.isWorkout || !result.model) {
      continue
    }

    entries.push(toEntry(file, result.model))
    if (result.warnings.length > 0) {
      diagnostics.push({ path: file.path, warnings: result.warnings })
    }
  }

  return {
    schemaVersion: 1,
    builtAt: Date.now(),
    entries: sortEntries(entries),
    diagnostics: sortDiagnostics(diagnostics),
  }
}

/**
 * Incremental update. Re-reads one file and returns a new immutable index.
 */
export async function updateIndexEntry(
  app: App,
  settings: FitKitSettings,
  index: FitKitIndex,
  path: string,
): Promise<FitKitIndex> {
  const normalizedPath = normalizeFolder(path)
  const existingEntries = index.entries.filter((entry) => entry.path !== normalizedPath)
  const existingDiagnostics = index.diagnostics.filter(
    (diagnostic) => diagnostic.path !== normalizedPath,
  )
  const file = app.vault.getAbstractFileByPath(normalizedPath)
  const folder = workoutsFolder(settings)

  if (!isMarkdownFile(file) || !isInFolder(file.path, folder)) {
    return {
      ...index,
      builtAt: Date.now(),
      entries: existingEntries,
      diagnostics: existingDiagnostics,
    }
  }

  const source = await app.vault.read(file)
  const result = parseWorkoutNote(source, file.path)
  if (!result.isWorkout || !result.model) {
    return {
      ...index,
      builtAt: Date.now(),
      entries: existingEntries,
      diagnostics: existingDiagnostics,
    }
  }

  const diagnostics =
    result.warnings.length > 0
      ? [...existingDiagnostics, { path: file.path, warnings: result.warnings }]
      : existingDiagnostics

  return {
    ...index,
    builtAt: Date.now(),
    entries: sortEntries([...existingEntries, toEntry(file, result.model)]),
    diagnostics: sortDiagnostics(diagnostics),
  }
}

function toEntry(file: TFile, model: WorkoutNoteModel): IndexEntry {
  return {
    path: file.path,
    mtime: file.stat.mtime,
    date: model.date,
    name: model.name,
    exercises: model.exercises.map(toRow),
  }
}

function toRow(exercise: ExerciseEntry): ExerciseIndexRow {
  if (exercise.kind === 'duration') {
    const durationEntries = exercise.durationEntries ?? []
    return {
      exerciseName: exercise.exerciseName,
      kind: exercise.kind,
      totalSets: durationEntries.length,
      totalDurationSeconds: durationEntries.reduce(
        (total, entry) => total + entry.durationSeconds,
        0,
      ),
    }
  }

  const strengthSets = exercise.strengthSets ?? []
  return {
    exerciseName: exercise.exerciseName,
    kind: exercise.kind,
    bestSet: pickBestSet(strengthSets) ?? undefined,
    maxWeightSet: pickMaxWeightSet(strengthSets) ?? undefined,
    totalSets: strengthSets.length,
  }
}

function isInFolder(path: string, folder: string): boolean {
  return path !== folder && path.startsWith(`${folder}/`)
}

function isMarkdownFile(file: TAbstractFile | null): file is TFile {
  return file !== null && (file as { extension?: unknown }).extension === 'md'
}

function sortEntries(entries: ReadonlyArray<IndexEntry>): IndexEntry[] {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path))
}

function sortDiagnostics(diagnostics: ReadonlyArray<IndexDiagnostic>): IndexDiagnostic[] {
  return [...diagnostics].sort((left, right) => left.path.localeCompare(right.path))
}
