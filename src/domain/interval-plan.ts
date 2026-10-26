/**
 * The one-line interval plan on a duration card: `[plan:: 8 x 30s @ 300W, 90s rest]`.
 * Work is a duration or `open`; the target is watts (`300W`), load (`120kg`) or a
 * level (`L12`); the pace is a fixed rest after each rep or `every <period>` (EMOM).
 */

import { formatDurationInput, parseDurationInput } from './duration-input'
import { formatStepperStep, parseStepperStep, type StepperStep } from './interval-stepper'

export const INTENSITY_KINDS = ['watts', 'load', 'level'] as const

export type IntensityKind = (typeof INTENSITY_KINDS)[number]

/** A row's intensity fields, named after the kind of target they record. */
export type IntensityFields = { [K in IntensityKind]?: number }

export interface IntervalPlan {
  reps: number
  /** Null for open work, which ends when the athlete taps Rest. */
  workSeconds: number | null
  intensity: { kind: IntensityKind; target: number }
  pace: { kind: 'rest'; seconds: number } | { kind: 'every'; seconds: number }
  /** The `adjust` after the pace. */
  stepperStep?: StepperStep
}

export type IntervalPlanResult = { ok: true; plan: IntervalPlan } | { ok: false; reason: string }

const PLAN = /^(\d+)\s*x\s*(\S+)\s*@\s*(\S+)\s*,\s*(.+)$/i
const TARGET = /^(?:(\d+(?:\.\d+)?)(w|kg)|l(\d+(?:\.\d+)?))$/i
const EVERY = /^every\s+(.+)$/i
const REST = /^(.+?)\s+rest$/i
const ADJUST = /^adjust\s+(.+)$/i

export function parseIntervalPlan(raw: string): IntervalPlanResult {
  const match = raw.trim().match(PLAN)
  if (!match) {
    return { ok: false, reason: 'Write the plan as "8 x 30s @ 300W, 90s rest".' }
  }
  const [, rawReps = '', rawWork = '', rawTarget = '', rawTail = ''] = match
  const [rawPace = '', ...rawOptions] = rawTail.split(',').map((part) => part.trim())
  if (rawOptions.length > 1 && rawOptions.every((option) => ADJUST.test(option))) {
    return { ok: false, reason: 'Write adjust once in a plan.' }
  }
  const rawAdjust = rawOptions.join(', ')
  const stepperStep = rawOptions.length === 0 ? undefined : adjustOf(rawAdjust)
  if (stepperStep === null) {
    return {
      ok: false,
      reason: `"${rawAdjust}" is not a stepper step like "adjust 10%" or "adjust 5".`,
    }
  }
  const intensity = parseTarget(rawTarget)
  if (!intensity) {
    return { ok: false, reason: `"${rawTarget}" is not a target like 300W, 120kg or L12.` }
  }
  if (intensity.target <= 0) {
    return { ok: false, reason: 'The target has to be more than zero.' }
  }
  const workSeconds = /^open$/i.test(rawWork) ? null : seconds(rawWork)
  if (workSeconds === undefined) {
    return { ok: false, reason: `"${rawWork}" is not a work time like 30s or open.` }
  }
  const pace = parsePace(rawPace)
  if (!pace) {
    return { ok: false, reason: `"${rawPace}" is not a pace like "90s rest" or "every 1m".` }
  }
  const reps = Number(rawReps)
  if (reps < 1 || workSeconds === 0) {
    return { ok: false, reason: 'A plan needs at least one rep and some work time.' }
  }
  if (workSeconds === null && pace.kind === 'rest') {
    return {
      ok: false,
      reason: 'Open work needs a pace of every, so each rep has a start to rest against.',
    }
  }
  if (workSeconds !== null && pace.kind === 'every' && workSeconds >= pace.seconds) {
    return {
      ok: false,
      reason: `Work (${formatDurationInput(workSeconds)}) has to be shorter than the period (${formatDurationInput(pace.seconds)}).`,
    }
  }
  return {
    ok: true,
    plan: { reps, workSeconds, intensity, pace, ...(stepperStep ? { stepperStep } : {}) },
  }
}

function adjustOf(raw: string): StepperStep | null {
  const value = ADJUST.exec(raw)?.[1]
  return value === undefined ? null : parseStepperStep(value)
}

export function parseTarget(raw: string): IntervalPlan['intensity'] | null {
  const match = raw.match(TARGET)
  if (!match) {
    return null
  }
  const [, amount, unit, level] = match
  if (level !== undefined) {
    return { kind: 'level', target: Number(level) }
  }
  return { kind: unit?.toLowerCase() === 'w' ? 'watts' : 'load', target: Number(amount) }
}

function parsePace(raw: string): IntervalPlan['pace'] | null {
  const every = raw.match(EVERY)
  const rest = raw.match(REST)
  const kind = every ? 'every' : rest ? 'rest' : null
  const value = seconds((every ?? rest)?.[1] ?? '')
  return kind === null || value === undefined ? null : { kind, seconds: value }
}

/** Seconds for a duration like `30s`, `2m` or `1:30`, or undefined when it is not one. */
function seconds(raw: string): number | undefined {
  return parseDurationInput(raw)?.seconds
}

export function formatIntervalPlan(plan: IntervalPlan): string {
  const work = plan.workSeconds === null ? 'open' : formatPlanSeconds(plan.workSeconds)
  const pace =
    plan.pace.kind === 'every'
      ? `every ${formatPlanSeconds(plan.pace.seconds)}`
      : `${formatPlanSeconds(plan.pace.seconds)} rest`
  const adjust = plan.stepperStep ? `, adjust ${formatStepperStep(plan.stepperStep)}` : ''
  return `${plan.reps} x ${work} @ ${formatTarget(plan.intensity)}, ${pace}${adjust}`
}

export function formatTarget(intensity: IntervalPlan['intensity']): string {
  switch (intensity.kind) {
    case 'watts':
      return `${intensity.target}W`
    case 'load':
      return `${intensity.target}kg`
    case 'level':
      return `L${intensity.target}`
  }
}

/** `90s` rather than `1m30s`, so a rest reads the way people say it. */
export function formatPlanSeconds(value: number): string {
  return value > 0 && value % 60 === 0 ? `${value / 60}m` : `${value}s`
}
