export type ExerciseMetric = 'weight' | 'e1rm'

export const DEFAULT_EXERCISE_METRIC: ExerciseMetric = 'e1rm'

export function parseExerciseMetric(value: unknown): ExerciseMetric | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'weight' || normalized === 'e1rm') {
    return normalized
  }
  return null
}
