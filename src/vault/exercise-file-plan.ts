import {
  createRegistry,
  unitForName,
  type ExerciseKind,
  type ExerciseRegistryEntry,
} from '../domain/exercise-registry'
import { DEFAULT_WEIGHT_UNIT, type WeightUnit } from '../domain/weight-unit'

export interface ExerciseFilePlanInput {
  name: string
  kind: ExerciseKind
  noteExists: boolean
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
  return `${exercisesFolderPath.replace(/\/+$/, '')}/${trimmed}.md`
}

export function planExerciseFileOpen(input: ExerciseFilePlanInput): ExerciseFilePlan {
  const trimmed = input.name.trim()
  const path = exerciseFilePathForName(trimmed, input.exercisesFolderPath)
  if (!path) {
    return { kind: 'error', message: 'Cannot open an exercise file without an exercise name.' }
  }

  if (input.noteExists) {
    return {
      kind: 'open',
      path,
      sourcePath: input.sourcePath,
    }
  }

  const registry = createRegistry(input.registryEntries)
  return {
    kind: 'create',
    path,
    sourcePath: input.sourcePath,
    name: trimmed,
    exerciseKind: input.kind,
    workoutsFolderPath: input.workoutsFolderPath,
    unit: unitForName(registry, trimmed) ?? DEFAULT_WEIGHT_UNIT,
  }
}
