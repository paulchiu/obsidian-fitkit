import type { IntensityKind } from '../../domain/interval-plan'
import type { IntervalProgram, PlanStep } from '../../domain/interval-program'
import {
  hasOpenRep,
  isOnTarget,
  repsWithWorkDone,
  restsAfter,
  runPhase,
  type RunRow,
} from '../../domain/interval-run'

/** What the runner is drawn from, apart from which screen it is on. */
export interface RunnerTimeline {
  program: IntervalProgram
  rows: readonly RunRow[]
  now: number
}

/** How far one tap of the rest stepper moves each kind of intensity. */
export const ADJUST_STEP: Record<IntensityKind, number> = { watts: 5, load: 2.5, level: 1 }

const UNIT: Record<IntensityKind, string> = { watts: ' W', load: ' kg', level: '' }

/** The big clock's value: time left, or time so far for open work. */
export function clockSeconds({ rows, program, now }: RunnerTimeline): number {
  const phase = runPhase(rows, program, now)
  if (phase.kind === 'idle') {
    return 0
  }
  return phase.remaining ?? phase.elapsed
}

export function formatIntensity(kind: IntensityKind, value: number): string {
  return kind === 'level' ? `L${value}` : `${value}${UNIT[kind]}`
}

/** Skip during rest; during work, Rest when a rest follows, Next when a step does, Finish on the last. */
export function primaryLabel(
  resting: boolean,
  step: PlanStep,
  upcoming: PlanStep | undefined,
): string {
  if (resting) {
    return 'Skip'
  }
  if (!upcoming) {
    return 'Finish'
  }
  return restsAfter(step) ? 'Rest' : 'Next'
}

/**
 * Where the step sits in its repeats, or null when that would only repeat the rep count:
 * `Round 3 of 10` for one repeat, `Set 2 of 3 · round 1 of 3` for two.
 */
export function roundsLabel(step: PlanStep, program: IntervalProgram): string | null {
  const [outer, inner, ...deeper] = step.rounds
  if (!outer || (!inner && outer.of === program.steps.length)) {
    return null
  }
  if (!inner) {
    return `Round ${outer.round} of ${outer.of}`
  }
  if (deeper.length === 0) {
    return `Set ${outer.round} of ${outer.of} · round ${inner.round} of ${inner.of}`
  }
  return step.rounds.map(({ round, of }) => `${round}/${of}`).join(' · ')
}

/** One state per planned step: on target, short of it, done with no target, under way, or to come (''). */
export function dotStates({ rows, program }: RunnerTimeline): string[] {
  const done = repsWithWorkDone(rows)
  const working = hasOpenRep(rows) && done.length < rows.length
  return program.steps.map((step, i) => {
    const row = done[i]
    if (row) {
      return !step.target ? 'is-done' : isOnTarget(row, step) ? 'is-hit' : 'is-miss'
    }
    return working && i === done.length ? 'is-current' : ''
  })
}

/** The last finished rep and the average so far, or null before any rep has a value. */
export function statsLabel({ rows, program }: RunnerTimeline): string | null {
  const kind = program.intensity
  if (!kind) {
    return null
  }
  const done = repsWithWorkDone(rows)
    .map((row) => row[kind])
    .filter((value): value is number => value !== undefined)
  const last = done[done.length - 1]
  if (last === undefined) {
    return null
  }
  const average = done.reduce((sum, value) => sum + value, 0) / done.length
  return `Last ${formatIntensity(kind, last)} · avg ${formatIntensity(kind, Math.round(average * 10) / 10)}`
}

/** The rep the rest stepper corrects, or '' when it has no value yet. */
export function stepperValue({ rows, program }: RunnerTimeline): string {
  const kind = program.intensity
  const value = kind ? rows[rows.length - 1]?.[kind] : undefined
  return kind && value !== undefined ? `Rep ${rows.length}: ${formatIntensity(kind, value)}` : ''
}
