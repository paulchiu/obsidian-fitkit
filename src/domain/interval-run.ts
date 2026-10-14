/**
 * The interval run as a pure function of the note. A run's whole state is the plan,
 * the rows and one `[started::]` stamp on the open row, the same accumulator-plus-stamp
 * rule the duration timer uses. The stamp times `rest` when the row has a rest field,
 * and `duration` otherwise. Nothing lives only in memory, so a killed app loses nothing.
 */

import type { IntervalProgram, PlanStep } from './interval-program'
import type { DurationEntry } from './workout-note-model'
import { formatLocalTimestamp } from './local-timestamp'

/** A duration row while a run may still be filling it in, so its time can be missing. */
export type RunRow = Partial<DurationEntry>

/**
 * Opens the next rep after the reps already done, on the first not-done row so any
 * intensity or note typed there carries into the rep; later not-done rows are dropped.
 */
export function startRun(rows: readonly RunRow[], program: IntervalProgram, now: number): RunRow[] {
  const done = loggedReps(rows)
  const { durationSeconds: _work, restSeconds: _rest, step: _step, ...typed } = rows[done] ?? {}
  return [...rows.slice(0, done), { ...typed, ...openedRep(program, done, now) }]
}

/** The fields of a rep the runner opens at `index` in the plan. */
function openedRep(program: IntervalProgram, index: number, now: number): RunRow {
  const name = program.steps[index]?.name
  return {
    set: index + 1,
    durationSeconds: 0,
    startedAt: stamp(now),
    ...(name === undefined ? {} : { step: name }),
  }
}

/**
 * The step the row at `index` runs. Rows match steps by position, and a row past the end
 * of a plan shortened mid-run runs as the last step, so the run can still finish.
 */
export function stepAt(program: IntervalProgram, index: number): PlanStep | undefined {
  return program.steps[Math.min(index, program.steps.length - 1)]
}

/** The step the open or last row runs. */
function stepOf(rows: readonly RunRow[], program: IntervalProgram): PlanStep | undefined {
  return stepAt(program, rows.length - 1)
}

/** Whether a rest follows the step's work, rather than the next step starting at once. */
export function restsAfter(step: PlanStep): boolean {
  return step.restSeconds > 0 || step.everySeconds !== undefined
}

/** Reps done so far, ignoring trailing rows with neither work nor rest time, like a fresh card's seeded row. */
export function loggedReps(rows: readonly RunRow[]): number {
  let count = rows.length
  while (count > 0 && isNotDone(rows[count - 1])) {
    count--
  }
  return count
}

function isNotDone(row: RunRow | undefined): boolean {
  return (
    row !== undefined &&
    !row.durationSeconds &&
    !row.restSeconds &&
    row.startedAt === undefined &&
    !row.paused
  )
}

function stamp(ms: number): string {
  return formatLocalTimestamp(new Date(ms))
}

export type RunPhase =
  | { kind: 'idle' }
  | {
      kind: 'work' | 'rest'
      rep: number
      elapsed: number
      remaining: number | null
      paused: boolean
    }

export function runPhase(rows: readonly RunRow[], program: IntervalProgram, now: number): RunPhase {
  const row = openRow(rows)
  const step = stepOf(rows, program)
  if (!row || !step) {
    return { kind: 'idle' }
  }
  const elapsed = Math.floor(liveSeconds(row, now))
  const target = phaseTarget(row, step)
  return {
    kind: isResting(row) ? 'rest' : 'work',
    rep: rows.length,
    elapsed,
    remaining: target === null ? null : Math.max(0, target - elapsed),
    paused: row.paused === true,
  }
}

/** True while the note holds a run under way: its last row is timed or paused. */
export function hasOpenRep(rows: readonly RunRow[]): boolean {
  return openRow(rows) !== undefined
}

/** Reps whose work is over: every row except an open rep still working. */
export function repsWithWorkDone(rows: readonly RunRow[]): RunRow[] {
  const open = openRow(rows)
  return open && !isResting(open) ? rows.slice(0, -1) : [...rows]
}

/** The last row, while it is still being timed or is paused mid-run. */
function openRow(rows: readonly RunRow[]): RunRow | undefined {
  const last = rows[rows.length - 1]
  return last && (last.startedAt !== undefined || last.paused) ? last : undefined
}

function isResting(row: RunRow): boolean {
  return row.restSeconds !== undefined
}

/** Seconds the open phase has banked on the row, before any time since its stamp. */
function bankedSeconds(row: RunRow): number {
  return (isResting(row) ? row.restSeconds : row.durationSeconds) ?? 0
}

/** Seconds in the open phase: what the row has banked plus the time since its stamp. */
function liveSeconds(row: RunRow, now: number): number {
  const started = Date.parse(row.startedAt ?? '')
  return bankedSeconds(row) + (Number.isNaN(started) ? 0 : Math.max(0, (now - started) / 1000))
}

/**
 * How long the open phase runs: the work time (null for open work), or the rest,
 * which under an every pace starts with whatever the rep left of the period.
 */
function phaseTarget(row: RunRow, step: PlanStep): number | null {
  if (!isResting(row)) {
    return step.workSeconds
  }
  const period = step.everySeconds
  return (
    step.restSeconds + (period === undefined ? 0 : Math.max(0, period - (row.durationSeconds ?? 0)))
  )
}

export interface RunAdvance {
  rows: RunRow[]
  finished: boolean
}

/** Closes every phase whose planned end has passed, as a live tick does. */
export function advanceRun(
  rows: readonly RunRow[],
  program: IntervalProgram,
  now: number,
): RunAdvance {
  const { rows: next, finished } = advance(rows, program, now)
  return { rows: next, finished }
}

/** `note` marks each rep whose work this closes, and `closed` counts them. */
function advance(
  rows: readonly RunRow[],
  program: IntervalProgram,
  now: number,
  note?: string,
): RunAdvance & { closed: number; endedAt?: number } {
  const next = rows.map((row) => ({ ...row }))
  let closed = 0
  for (;;) {
    const row = next[next.length - 1]
    const step = stepOf(next, program)
    if (!row || !step || row.startedAt === undefined || row.paused) {
      return { rows: next, finished: false, closed }
    }
    const target = phaseTarget(row, step)
    if (target === null) {
      return { rows: next, finished: false, closed }
    }
    const boundary = phaseStartMs(row) + target * 1000
    if (now < boundary) {
      return { rows: next, finished: false, closed }
    }
    if (isResting(row)) {
      row.restSeconds = target
      delete row.startedAt
      next.push(openedRep(program, next.length, boundary))
      continue
    }
    closed++
    if (note !== undefined) {
      row.note ??= note
    }
    if (closeWork(next, program, target, boundary)) {
      return { rows: next, finished: true, closed, endedAt: boundary }
    }
  }
}

/**
 * Ends the open rep's work with `seconds` done at `endMs`, prefilling the target, then
 * starts its rest, or the next step when none follows. Returns true when that was the
 * last step, which takes no rest.
 */
function closeWork(
  rows: RunRow[],
  program: IntervalProgram,
  seconds: number,
  endMs: number,
): boolean {
  const row = rows[rows.length - 1]
  const step = stepOf(rows, program)
  if (!row || !step) {
    return false
  }
  row.durationSeconds = seconds
  if (step.target) {
    row[step.target.kind] ??= step.target.target
  }
  if (rows.length >= program.steps.length) {
    delete row.startedAt
    return true
  }
  if (restsAfter(step)) {
    row.restSeconds = 0
    row.startedAt = stamp(endMs)
  } else {
    delete row.startedAt
    rows.push(openedRep(program, rows.length, endMs))
  }
  return false
}

/** When the open phase would have started had it never been paused: its stamp minus what it banked. */
function phaseStartMs(row: RunRow): number {
  return Date.parse(row.startedAt ?? '') - bankedSeconds(row) * 1000
}

/** The Rest button: ends the open rep's work now, with the time actually done. */
export function endWork(
  rows: readonly RunRow[],
  program: IntervalProgram,
  now: number,
): RunAdvance {
  const next = rows.map((row) => ({ ...row }))
  const row = openRow(next)
  if (!row || isResting(row)) {
    return { rows: next, finished: false }
  }
  const finished = closeWork(next, program, Math.round(liveSeconds(row, now)), now)
  return { rows: next, finished }
}

/** The Skip button: ends the open rest now and starts the next rep. */
export function skipRest(rows: readonly RunRow[], program: IntervalProgram, now: number): RunRow[] {
  const next = rows.map((row) => ({ ...row }))
  const row = openRow(next)
  if (!row || !isResting(row)) {
    return next
  }
  bankLiveSeconds(row, now)
  return startRun(next, program, now)
}

/**
 * Closes any boundary that has already passed, then banks the open phase's time on the
 * row and swaps its stamp for `[paused:: true]`, so a late pause never stretches a phase.
 */
export function pauseRun(
  rows: readonly RunRow[],
  program: IntervalProgram,
  now: number,
): RunAdvance {
  const { rows: next, finished } = advanceRun(rows, program, now)
  const row = openRow(next)
  if (finished || !row || row.paused) {
    return { rows: next, finished }
  }
  bankLiveSeconds(row, now)
  row.paused = true
  return { rows: next, finished: false }
}

export function resumeRun(rows: readonly RunRow[], now: number): RunRow[] {
  const next = rows.map((row) => ({ ...row }))
  const row = openRow(next)
  if (!row?.paused) {
    return next
  }
  delete row.paused
  row.startedAt = stamp(now)
  return next
}

/** Moves the time since the stamp into the phase's field and drops the stamp. */
function bankLiveSeconds(row: RunRow, now: number): void {
  const seconds = Math.round(liveSeconds(row, now))
  if (isResting(row)) {
    row.restSeconds = seconds
  } else {
    row.durationSeconds = seconds
  }
  delete row.startedAt
}

/** Closes the run for good: the open phase keeps the time it ran, and an empty rep is dropped. */
export function endRun(rows: readonly RunRow[], now: number): RunRow[] {
  const next = rows.map((row) => ({ ...row }))
  const row = openRow(next)
  if (!row) {
    return next
  }
  bankLiveSeconds(row, now)
  delete row.paused
  return !isResting(row) && row.durationSeconds === 0 ? next.slice(0, -1) : next
}

export type RunCatchUp =
  | { kind: 'caught-up'; rows: RunRow[]; filled: number; finished: boolean }
  | { kind: 'cut-off'; rep: number; resting: boolean; startedAt: string }

export const CAUGHT_UP_NOTE = 'logged while Obsidian was closed'

/** A plan that ended this recently was probably finished behind a locked screen, not abandoned. */
const CUT_OFF_GRACE_MS = 2 * 60 * 1000

/**
 * Picks a run back up after the app was away. Reps whose end passed in the meantime are
 * filled with the target and flagged. A plan that ended, or open work that ran a whole
 * period, more than a grace period ago means the athlete stopped, so it reports a
 * cut-off and leaves the rows alone.
 */
export function catchUpRun(
  rows: readonly RunRow[],
  program: IntervalProgram,
  now: number,
): RunCatchUp {
  const result = advance(rows, program, now, CAUGHT_UP_NOTE)
  const row = openRow(rows)
  const step = stepOf(rows, program)
  const stoppedBy = result.endedAt ?? (row && step && openWorkLimit(row, step))
  if (
    stoppedBy !== undefined &&
    now - stoppedBy > CUT_OFF_GRACE_MS &&
    row?.startedAt !== undefined
  ) {
    return { kind: 'cut-off', rep: rows.length, resting: isResting(row), startedAt: row.startedAt }
  }
  return { kind: 'caught-up', rows: result.rows, filled: result.closed, finished: result.finished }
}

/** Open work has no planned end, so a rep still going a whole period after it began was abandoned. */
function openWorkLimit(row: RunRow, step: PlanStep): number | undefined {
  return step.workSeconds === null && step.everySeconds !== undefined && !isResting(row)
    ? phaseStartMs(row) + step.everySeconds * 1000
    : undefined
}

/** Resume after a cut-off: a rep cut off in work starts over, and a cut-off rest counts as taken in full. */
export function resumeCutRun(
  rows: readonly RunRow[],
  program: IntervalProgram,
  now: number,
): RunRow[] {
  const next = rows.map((row) => ({ ...row }))
  const row = openRow(next)
  const step = stepOf(next, program)
  if (!row || !step) {
    return next
  }
  if (!isResting(row)) {
    row.durationSeconds = 0
    row.startedAt = stamp(now)
    return next
  }
  row.restSeconds = phaseTarget(row, step) ?? 0
  delete row.startedAt
  return startRun(next, program, now)
}

/** End a cut-off run at the last rep known to be done, dropping the rest or rep the clock cannot vouch for. */
export function endCutRun(rows: readonly RunRow[]): RunRow[] {
  const next = rows.map((row) => ({ ...row }))
  const row = openRow(next)
  if (!row) {
    return next
  }
  if (!isResting(row)) {
    return next.slice(0, -1)
  }
  delete row.restSeconds
  delete row.startedAt
  return next
}

/** Within 5% of the target counts, since a console's average wobbles; open work is judged on intensity alone. */
const ON_TARGET_RATIO = 0.95

/** Whether the rep held its step's target; a step with no target is never a hit or a miss. */
export function isOnTarget(row: RunRow, step: PlanStep): boolean {
  if (!step.target) {
    return false
  }
  const intensity = row[step.target.kind]
  const heldIntensity = intensity !== undefined && intensity >= step.target.target * ON_TARGET_RATIO
  const fullTime = step.workSeconds === null || (row.durationSeconds ?? 0) >= step.workSeconds
  return heldIntensity && fullTime
}

export function hitCount(rows: readonly RunRow[], program: IntervalProgram): number {
  return rows.filter((row, index) => {
    const step = stepAt(program, index)
    return step !== undefined && isOnTarget(row, step)
  }).length
}

/** Seconds the rows spent on steps with a target, matching each row to the step at its position. */
export function targetedSeconds(rows: readonly RunRow[], program: IntervalProgram): number {
  return rows.reduce(
    (total, row, index) =>
      stepAt(program, index)?.target === undefined ? total : total + (row.durationSeconds ?? 0),
    0,
  )
}

/** Steps a hit can be scored against: those with a target. */
export function targetedSteps(program: IntervalProgram): number {
  return program.steps.filter((step) => step.target !== undefined).length
}

/** The runner's big button: Rest while working, Skip while resting. */
export function pressRunButton(
  rows: readonly RunRow[],
  program: IntervalProgram,
  now: number,
): RunAdvance {
  const row = openRow(rows)
  return row && isResting(row)
    ? { rows: skipRest(rows, program, now), finished: false }
    : endWork(rows, program, now)
}

export function togglePauseRun(
  rows: readonly RunRow[],
  program: IntervalProgram,
  now: number,
): RunAdvance {
  return openRow(rows)?.paused
    ? { rows: resumeRun(rows, now), finished: false }
    : pauseRun(rows, program, now)
}
