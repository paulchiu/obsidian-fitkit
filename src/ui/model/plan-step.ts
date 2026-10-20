import type { ExerciseKind } from '../../domain/exercise-kind'
import { DEFAULT_WEIGHT_UNIT } from '../../domain/weight-unit'

/** Modal heading naming the plan step for this exercise. */
export function planStepTitle(exerciseName: string, kind: ExerciseKind): string {
  return kind === 'bodyweight'
    ? `Rung change for ${exerciseName}`
    : `Weight change for ${exerciseName}`
}

/** Field label naming the plan step unit. */
export function planStepLabel(kind: ExerciseKind): string {
  return kind === 'bodyweight' ? 'Rung change' : 'Weight change'
}

/** What the empty field hints at. */
export function planStepPlaceholder(kind: ExerciseKind): string {
  return kind === 'bodyweight' ? 'rungs' : DEFAULT_WEIGHT_UNIT
}

/** The step the text means, or undefined when it is blank or not a positive number. */
export function parsePlanStep(raw: string): number | undefined {
  const step = Number(raw.trim())
  return Number.isFinite(step) && step > 0 ? step : undefined
}
