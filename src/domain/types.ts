export interface BestSet {
  weight: number
  reps: number
  e1rm: number
}

export interface WeightSet {
  weight: number
  reps: number
}

export interface LastSessionMax<T> {
  value: T
  date: string
}

export interface ExerciseIndexRow {
  exerciseName: string
  kind: 'strength' | 'duration'
  bestSet?: BestSet
  maxWeightSet?: WeightSet
  totalSets?: number
  totalDurationSeconds?: number
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
