import type { ExerciseKind } from './exercise-kind'
import type { NextPlan } from './next-plan'

export interface BestSet {
  weight: number
  reps: number
  e1rm: number
}

export interface WeightSet {
  weight: number
  reps: number
}

/** Best bodyweight set of a session, normalized so missing reps or load read as 0. */
export interface BodyweightBestSet {
  level: number
  reps: number
  load: number
}

export interface LastSessionMax<T> {
  value: T
  date: string
}

export interface ExerciseIndexRow {
  exerciseName: string
  kind: ExerciseKind
  bestSet?: BestSet
  maxWeightSet?: WeightSet
  totalSets?: number
  totalDurationSeconds?: number
  /** Best bodyweight set of the session: highest level, then reps, then load. */
  maxBodyweightSet?: BodyweightBestSet
  next?: NextPlan
}

export interface IndexEntry {
  path: string
  mtime: number
  date: string
  name: string
  exercises: ExerciseIndexRow[]
}

export interface IndexDiagnostic {
  path: string
  warnings: string[]
}

export interface FitKitIndex {
  schemaVersion: 1
  builtAt: number
  entries: IndexEntry[]
  diagnostics: IndexDiagnostic[]
}
