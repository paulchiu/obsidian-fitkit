/**
 * A user-authored note to self about how to load an exercise next session.
 * Written into the workout note as `[next:: up 2.5]` and surfaced on the
 * exercise card the next time the exercise comes up.
 */

import type { ExerciseKind } from './exercise-kind'

export type NextPlanDirection = 'up' | 'down' | 'stay'

export interface NextPlan {
  direction: NextPlanDirection
  /** Change to make next session: kilograms for strength, rungs for bodyweight. Absent means the direction alone. */
  step?: number
}

const DIRECTIONS: ReadonlySet<string> = new Set<NextPlanDirection>(['up', 'down', 'stay'])

/**
 * Read a `[next:: ...]` value. Anything that does not start with a known
 * direction is ignored rather than reported, so hand-written notes with other
 * wording pass through untouched.
 */
export function parseNextPlan(value: string | undefined): NextPlan | null {
  if (value === undefined) {
    return null
  }
  const [rawDirection, rawStep] = value.trim().toLowerCase().split(/\s+/)
  if (rawDirection === undefined || !DIRECTIONS.has(rawDirection)) {
    return null
  }
  const direction = rawDirection as NextPlanDirection
  if (direction === 'stay') {
    return { direction }
  }
  const step = parseStep(rawStep)
  return step === null ? { direction } : { direction, step }
}

export function formatNextPlan(plan: NextPlan): string {
  return plan.step === undefined ? plan.direction : `${plan.direction} ${formatNumber(plan.step)}`
}

/** Sentence-case description for badges and previews, without the unit. */
export function formatNextPlanLabel(plan: NextPlan, kind: ExerciseKind): string {
  if (plan.direction === 'stay') {
    return kind === 'bodyweight' ? 'Same level' : 'Same weight'
  }
  const direction = plan.direction === 'up' ? 'Up' : 'Down'
  return plan.step === undefined ? direction : `${direction} ${formatNumber(plan.step)}`
}

/**
 * Apply the plan to the rung it was recorded against. The step counts rungs,
 * so a fractional step lands on the nearest rung and the target clamps to
 * the ends of the ladder. Returns null when the plan carries no step or
 * names no usable base. The caller always passes a real ladder length, so a
 * missing ladder never reaches here as an empty one.
 */
export function nextPlanTargetLevel(
  plan: NextPlan,
  baseLevel: number,
  levelCount: number,
): number | null {
  if (!Number.isFinite(baseLevel)) {
    return null
  }
  const count = Math.floor(levelCount)
  if (plan.direction === 'stay') {
    return Math.min(Math.max(Math.round(baseLevel), 1), count)
  }
  if (plan.step === undefined) {
    return null
  }
  const target = plan.direction === 'up' ? baseLevel + plan.step : baseLevel - plan.step
  return Math.min(Math.max(Math.round(target), 1), count)
}

/**
 * Apply the plan to the weight it was recorded against. Returns null when the
 * plan carries no step, since a bare direction names no target.
 */
export function nextPlanTargetWeight(plan: NextPlan, baseWeight: number): number | null {
  if (!Number.isFinite(baseWeight)) {
    return null
  }
  if (plan.direction === 'stay') {
    return baseWeight
  }
  if (plan.step === undefined) {
    return null
  }
  const target = plan.direction === 'up' ? baseWeight + plan.step : baseWeight - plan.step
  return Math.max(target, 0)
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

function parseStep(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null
  }
  const step = Number(raw)
  return Number.isFinite(step) && step > 0 ? step : null
}
