import type { IntensityKind } from './interval-plan'

/** How far one tap of the interval runner's stepper moves a rep: a share of its intensity, or a fixed amount. */
export type StepperStep = { kind: 'percent'; percent: number } | { kind: 'amount'; amount: number }

const DEFAULT_PERCENT = 10

/** The setting's default, as the text it is stored as. */
export const DEFAULT_STEPPER_STEP = `${DEFAULT_PERCENT}%`

/** The finest step each kind of intensity takes: whole watts, half kilograms, whole levels. */
const UNIT_STEP: Record<IntensityKind, number> = { watts: 1, load: 0.5, level: 1 }

/** Reads a step written as a percentage (`10%`) or an amount (`5`), or null for anything else. */
export function parseStepperStep(raw: string): StepperStep | null {
  const match = /^(\d+(?:\.\d+)?)\s*(%?)$/.exec(raw.trim())
  const value = match ? Number(match[1]) : 0
  if (!match || value <= 0) {
    return null
  }
  return match[2] ? { kind: 'percent', percent: value } : { kind: 'amount', amount: value }
}

/** The step as it is written in a setting or a plan: `10%` or `5`. */
export function formatStepperStep(step: StepperStep): string {
  return step.kind === 'percent' ? `${step.percent}%` : String(step.amount)
}

/** The step a setting names, or the default for text it cannot read. */
export function stepperStepFrom(raw: string): StepperStep {
  return parseStepperStep(raw) ?? { kind: 'percent', percent: DEFAULT_PERCENT }
}

/** The amount one tap moves a rep of `base` intensity; a percentage is rounded to the kind's unit and never below one. */
export function stepperAmount(step: StepperStep, kind: IntensityKind, base: number): number {
  if (step.kind === 'amount') {
    return step.amount
  }
  const unit = UNIT_STEP[kind]
  return Math.max(unit, Math.round((base * step.percent) / 100 / unit) * unit)
}
