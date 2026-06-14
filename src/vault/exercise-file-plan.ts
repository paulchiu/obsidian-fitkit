import { normalizePath } from 'obsidian'

import {
  createRegistry,
  resolve,
  unitForName,
  type ExerciseKind,
  type ExerciseRegistryEntry,
} from '../domain/exercise-registry'
import { DEFAULT_WEIGHT_UNIT, type WeightUnit } from '../domain/weight-unit'

export interface ExerciseFilePlanInput {
  name: string
  kind: ExerciseKind
  noteExists: (path: string) => boolean
  registryEntries: ExerciseRegistryEntry[]
  exercisesFolderPath: string
  workoutsFolderPath: string
  sourcePath: string
}

export type ExerciseFilePlan =
  | {
      kind: 'open'
      path: string
      sourcePath: string
      name: string
    }
  | {
      kind: 'create'
      path: string
      sourcePath: string
      name: string
      exerciseKind: ExerciseKind
      workoutsFolderPath: string
      unit: WeightUnit
    }
  | {
      kind: 'error'
      message: string
    }

export function exerciseFilePathForName(
  exerciseName: string,
  exercisesFolderPath: string,
): string | null {
  const trimmed = exerciseName.trim()
  if (trimmed.length === 0) {
    return null
  }
  return normalizePath(`${exercisesFolderPath.replace(/\/+$/, '')}/${trimmed}.md`)
}

export function planExerciseFileOpen(input: ExerciseFilePlanInput): ExerciseFilePlan {
  const trimmed = input.name.trim()
  const registry = createRegistry(input.registryEntries)
  const match = resolve(registry, trimmed)
  const canonicalEntry = match.kind === 'match' ? match.entry : null
  const canonicalName = canonicalEntry?.name ?? trimmed
  const path = exerciseFilePathForName(canonicalName, input.exercisesFolderPath)
  if (!path) {
    return { kind: 'error', message: 'Cannot open an exercise file without an exercise name.' }
  }

  if (input.noteExists(path)) {
    return {
      kind: 'open',
      path,
      sourcePath: input.sourcePath,
      name: canonicalName,
    }
  }

  return {
    kind: 'create',
    path,
    sourcePath: input.sourcePath,
    name: canonicalName,
    exerciseKind: canonicalEntry?.kind ?? input.kind,
    workoutsFolderPath: input.workoutsFolderPath,
    unit: unitForName(registry, canonicalName) ?? DEFAULT_WEIGHT_UNIT,
  }
}
