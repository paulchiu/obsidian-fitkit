import { EXERCISE_KIND_LABELS, type ExerciseKind } from './exercise-kind'

/**
 * What an exercise or card is shown as. Interval is stored as `kind: duration`
 * plus an interval marker, so an older FitKit reads it as plain duration.
 */
export const EXERCISE_TYPES = ['strength', 'duration', 'interval', 'bodyweight'] as const

export type ExerciseType = (typeof EXERCISE_TYPES)[number]

export const EXERCISE_TYPE_LABELS: Record<ExerciseType, string> = {
  ...EXERCISE_KIND_LABELS,
  interval: 'Interval',
}

export function exerciseTypeOf(entry: { kind: ExerciseKind; interval?: boolean }): ExerciseType {
  return entry.kind === 'duration' && entry.interval === true ? 'interval' : entry.kind
}

export function kindOfType(type: ExerciseType): ExerciseKind {
  return type === 'interval' ? 'duration' : type
}

export function parseExerciseType(value: unknown): ExerciseType | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  return EXERCISE_TYPES.find((type) => type === normalized) ?? null
}
