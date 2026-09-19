import type { ExerciseKind } from './exercise-kind'

export type ExerciseMetric = 'weight' | 'e1rm' | 'level' | 'reps'

export const DEFAULT_EXERCISE_METRIC: ExerciseMetric = 'e1rm'

export const DEFAULT_BODYWEIGHT_EXERCISE_METRIC: ExerciseMetric = 'level'

/**
 * Chart metrics each kind may plot. Total, so a new kind must choose its metrics to compile.
 */
export const VALID_EXERCISE_METRICS: Record<ExerciseKind, readonly ExerciseMetric[]> = {
  strength: ['weight', 'e1rm'],
  duration: [],
  bodyweight: ['level', 'reps'],
}

/** Exhaustiveness guard: a new `ExerciseMetric` member makes every caller stop compiling. */
export function assertUnreachableMetric(value: never): never {
  throw new Error(`Unhandled exercise metric: ${String(value)}`)
}

export function parseExerciseMetric(value: unknown): ExerciseMetric | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  if (
    normalized === 'weight' ||
    normalized === 'e1rm' ||
    normalized === 'level' ||
    normalized === 'reps'
  ) {
    return normalized
  }
  return null
}
