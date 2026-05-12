import type { App, TFile } from 'obsidian'
import { normalizePath } from 'obsidian'

import {
  createRegistry,
  kindForName,
  normalize,
  resolve,
  upsertEntry,
  type ExerciseKind,
} from '../domain/exercise-registry'
import { DEFAULT_WEIGHT_UNIT, type WeightUnit } from '../domain/weight-unit'
import type { ExerciseEntry, WorkoutNoteModel } from '../domain/workout-note-model'
import { parseWorkoutNote } from '../domain/workout-note-model'
import type { FitKitSettings } from '../settings'
import { exercisesFolder, normalizeFolder, workoutsFolder } from '../settings-paths'
import { composeExerciseNote } from './exercise-note'
import { buildExerciseRegistrySnapshot } from './exercise-registry-vault'
import { ensureParentFolder } from './vault-utils'

export type ExerciseImportRowStatus = 'known' | 'missing' | 'ignored'

export interface ExerciseImportPlanRow {
  name: string
  kind: ExerciseKind
  unit: WeightUnit
  status: ExerciseImportRowStatus
  registryName: string | null
  notePath: string | null
  noteExists: boolean
  tombstoned: boolean
  createNote: boolean
  createNoNoteEntry: boolean
  restoreIgnored: boolean
  sourcePaths: string[]
}

export interface ExerciseImportPlan {
  rows: ExerciseImportPlanRow[]
}

export interface ExerciseImportApplyResult {
  notesCreated: number
  notePathsCreated: string[]
  registryEntriesCreated: number
  tombstonesRemoved: number
  settingsChanged: boolean
}

export interface ExerciseImportApplyFailureResult {
  notesCreated: number
  notePathsCreated: string[]
  settingsChanged: false
}

export class ExerciseImportApplyError extends Error {
  readonly partialResult: ExerciseImportApplyFailureResult
  readonly originalError: unknown

  constructor(
    message: string,
    partialResult: ExerciseImportApplyFailureResult,
    originalError: unknown,
  ) {
    super(message)
    this.name = 'ExerciseImportApplyError'
    this.partialResult = partialResult
    this.originalError = originalError
  }
}

export async function buildExerciseImportPlan(
  app: App,
  settings: FitKitSettings,
): Promise<ExerciseImportPlan> {
  const snapshot = buildExerciseRegistrySnapshot(app, settings)
  const registry = createRegistry(snapshot.entries)
  const noteByKey = new Map(snapshot.catalog.entries.map((entry) => [normalize(entry.name), entry]))
  const deletedKeys = new Set((settings.deletedExercises ?? []).map((name) => normalize(name)))
  const candidates = await collectCandidates(app, settings)
  const rows: ExerciseImportPlanRow[] = []

  for (const candidate of candidates) {
    const key = normalize(candidate.name)
    const match = resolve(registry, candidate.name)
    const matchedKind = match.kind === 'match' ? match.entry.kind : null
    const matchedUnit = match.kind === 'match' ? match.entry.unit : null
    const registryName = match.kind === 'match' ? match.entry.name : null
    const note = noteByKey.get(key)
    const tombstoned = deletedKeys.has(key)
    const status: ExerciseImportRowStatus = tombstoned
      ? 'ignored'
      : matchedKind || note
        ? 'known'
        : 'missing'
    const kind = matchedKind ?? note?.kind ?? candidate.kind
    const unit = matchedUnit ?? note?.unit ?? DEFAULT_WEIGHT_UNIT
    rows.push({
      name: candidate.name,
      kind,
      unit,
      status,
      registryName,
      notePath: note?.path ?? null,
      noteExists: note !== undefined,
      tombstoned,
      createNote: status === 'missing' && note === undefined,
      createNoNoteEntry: false,
      restoreIgnored: false,
      sourcePaths: candidate.sourcePaths,
    })
  }

  rows.sort((left, right) => left.name.localeCompare(right.name))
  return { rows }
}

export async function applyExerciseImportPlan(
  app: App,
  settings: FitKitSettings,
  rows: ExerciseImportPlanRow[],
): Promise<ExerciseImportApplyResult> {
  let registry = createRegistry(settings.exerciseRegistry)
  let registryEntriesCreated = 0
  let notesCreated = 0
  let tombstonesRemoved = 0
  let settingsChanged = false
  const notePathsCreated: string[] = []
  let deletedExercises = [...(settings.deletedExercises ?? [])]
  const removedTombstones = new Set<string>()
  const folder = exercisesFolder(settings)
  const workouts = workoutsFolder(settings)

  for (const row of rows) {
    if (row.status === 'ignored' && !row.restoreIgnored) {
      continue
    }

    if (row.restoreIgnored && row.tombstoned) {
      const key = normalize(row.name)
      deletedExercises = deletedExercises.filter((name) => normalize(name) !== key)
      if (!removedTombstones.has(key)) {
        removedTombstones.add(key)
        tombstonesRemoved += 1
      }
      settingsChanged = true
    }

    if (row.createNoNoteEntry && kindForName(registry, row.name) === null) {
      registry = upsertEntry(registry, {
        name: row.name,
        kind: row.kind,
        unit: row.unit,
        aliases: [],
      })
      registryEntriesCreated += 1
      settingsChanged = true
    }

    if (!row.createNote || row.noteExists) {
      continue
    }

    const path = normalizePath(`${folder}/${row.name}.md`)
    if (app.vault.getAbstractFileByPath(path)) {
      continue
    }
    try {
      await ensureParentFolder(app, path)
      await app.vault.create(path, composeExerciseNote(row.name, row.kind, workouts, row.unit))
    } catch (error) {
      throw new ExerciseImportApplyError(
        error instanceof Error ? error.message : `Failed to create ${path}`,
        {
          notesCreated,
          notePathsCreated: [...notePathsCreated],
          settingsChanged: false,
        },
        error,
      )
    }
    notesCreated += 1
    notePathsCreated.push(path)
  }

  if (settingsChanged) {
    settings.exerciseRegistry = registry.entries
    settings.deletedExercises = normalizeTombstones(deletedExercises)
  }

  return {
    notesCreated,
    notePathsCreated,
    registryEntriesCreated,
    tombstonesRemoved,
    settingsChanged,
  }
}

interface Candidate {
  name: string
  kind: ExerciseKind
  sourcePaths: string[]
}

async function collectCandidates(app: App, settings: FitKitSettings): Promise<Candidate[]> {
  const folder = normalizeFolder(workoutsFolder(settings))
  const models: WorkoutNoteModel[] = []
  const files = app.vault
    .getMarkdownFiles()
    .filter((file) => isFileInFolder(file, folder))
    .sort((left, right) => left.path.localeCompare(right.path))

  for (const file of files) {
    const text = await app.vault.cachedRead(file)
    const result = parseWorkoutNote(text, file.path)
    if (result.isWorkout && result.model) {
      models.push(result.model)
    }
  }

  return candidatesFromModels(models)
}

function candidatesFromModels(models: WorkoutNoteModel[]): Candidate[] {
  const byKey = new Map<string, Candidate>()

  for (const model of models) {
    for (const exercise of dedupeExercises(model.exercises)) {
      const key = normalize(exercise.exerciseName)
      if (key.length === 0) {
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

  return [...byKey.values()]
}

function dedupeExercises(exercises: ExerciseEntry[]): ExerciseEntry[] {
  const byName = new Map<string, ExerciseEntry>()
  for (const exercise of exercises) {
    const key = normalize(exercise.exerciseName)
    if (key.length === 0 || byName.has(key)) {
      continue
    }
    byName.set(key, exercise)
  }
  return [...byName.values()]
}

function isFileInFolder(file: TFile, folder: string): boolean {
  return file.path.startsWith(`${folder}/`)
}

function normalizeTombstones(names: readonly string[]): string[] {
  const tombstones: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    const key = normalize(name)
    if (key.length === 0 || seen.has(key)) {
      continue
    }
    seen.add(key)
    tombstones.push(key)
  }
  return tombstones
}
