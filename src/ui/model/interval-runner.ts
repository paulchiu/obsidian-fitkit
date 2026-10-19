import { formatTarget, type IntensityKind } from '../../domain/interval-plan'
import type { IntervalProgram, PlanStep } from '../../domain/interval-program'
import {
  hasOpenRep,
  isOnTarget,
  repsWithWorkDone,
  restsAfter,
  runPhase,
  targetedSteps,
  type RunPhase,
  type RunRow,
} from '../../domain/interval-run'

/** What the runner is drawn from, apart from which screen it is on. */
export interface RunnerTimeline {
  program: IntervalProgram
  rows: readonly RunRow[]
  now: number
}

/** A planned step's dot: on target, short of it, done with no target, under way, or to come. */
export type DotState = 'hit' | 'miss' | 'done' | 'current' | 'pending'

/** How far one tap of the rest stepper moves each kind of intensity. */
const ADJUST_STEP: Record<IntensityKind, number> = { watts: 5, load: 2.5, level: 1 }

const UNIT: Record<IntensityKind, string> = { watts: ' W', load: ' kg', level: '' }

/** The big clock's value for `phase`: time left, or time so far for open work. */
export function phaseSeconds(phase: RunPhase): number {
  return phase.kind === 'idle' ? 0 : (phase.remaining ?? phase.elapsed)
}

/** {@link phaseSeconds} for the timeline as it stands at `now`. */
export function clockSeconds({ rows, program, now }: RunnerTimeline): number {
  return phaseSeconds(runPhase(rows, program, now))
}

function formatIntensity(kind: IntensityKind, value: number): string {
  return kind === 'level' ? `L${value}` : `${value}${UNIT[kind]}`
}

export function phaseLabel(resting: boolean, rep: number, program: IntervalProgram): string {
  return `${resting ? 'Rest' : 'Work'} · rep ${rep} of ${program.steps.length}`
}

/** What the clock is counting towards: rest, the step's target, or nothing for an untargeted step. */
export function targetLabel(resting: boolean, step: PlanStep): string | null {
  if (resting) {
    return 'rest'
  }
  return step.target ? `${formatTarget(step.target)} target` : null
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

/** One dot per planned step. */
export function dotStates({ rows, program }: RunnerTimeline): DotState[] {
  const done = repsWithWorkDone(rows)
  const working = hasOpenRep(rows) && done.length < rows.length
  return program.steps.map((step, i) => {
    const row = done[i]
    if (row) {
      return !step.target ? 'done' : isOnTarget(row, step) ? 'hit' : 'miss'
    }
    return working && i === done.length ? 'current' : 'pending'
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

/** The rest stepper for the rep just done: how far a tap moves it and its value, or null for a plan with no intensity. */
export function restStepper({
  rows,
  program,
}: RunnerTimeline): { step: number; value: string } | null {
  const kind = program.intensity
  if (!kind) {
    return null
  }
  const value = rows[rows.length - 1]?.[kind]
  return {
    step: ADJUST_STEP[kind],
    value: value === undefined ? '' : `Rep ${rows.length}: ${formatIntensity(kind, value)}`,
  }
}

/** The big number and its caption once a run is over. */
export function finishedScore(
  { rows, program }: RunnerTimeline,
  hits: number,
): { count: string; caption: string } {
  const targeted = targetedSteps(program)
  return targeted > 0
    ? { count: `${hits}/${targeted}`, caption: 'reps on target' }
    : { count: String(rows.length), caption: 'reps done' }
}

/** The banner and resume button for a run Obsidian closed on until the plan was over. */
export function cutOffLabels(
  cut: { rep: number; resting: boolean },
  exerciseName: string,
): { phase: string; note: string; resume: string } {
  const where = cut.resting ? `rep ${cut.rep} rest` : `rep ${cut.rep}`
  return {
    phase: `Run cut off at ${where}`,
    note: `Obsidian closed during ${where} of ${exerciseName}, and the clock has since passed the end of the plan, so no reps were filled in.`,
    resume: `Resume rep ${cut.resting ? cut.rep + 1 : cut.rep}`,
  }
}
