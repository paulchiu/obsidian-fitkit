export const EXERCISE_KINDS = ['strength', 'duration'] as const

export type ExerciseKind = (typeof EXERCISE_KINDS)[number]

export const EXERCISE_KIND_LABELS: Record<ExerciseKind, string> = {
  strength: 'Strength',
  duration: 'Duration',
}

/** Exhaustiveness guard: a new `EXERCISE_KINDS` member makes every caller stop compiling. */
export function assertUnreachableKind(value: never): never {
  throw new Error(`Unhandled exercise kind: ${describeUnreachableKind(value)}`)
}

/** Best-effort runtime description: callers pass either the kind or the entry carrying it. */
function describeUnreachableKind(value: never): string {
  if (typeof value === 'object' && value !== null && 'kind' in value) {
    return String((value as { kind: unknown }).kind)
  }
  return String(value)
}

export function parseExerciseKind(value: unknown): ExerciseKind | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  const match = EXERCISE_KINDS.find((kind) => kind === normalized)
  return match ?? null
}
