export const EXERCISE_KINDS = ['strength', 'duration'] as const

export type ExerciseKind = (typeof EXERCISE_KINDS)[number]

export function parseExerciseKind(value: unknown): ExerciseKind | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  const match = EXERCISE_KINDS.find((kind) => kind === normalized)
  return match ?? null
}
