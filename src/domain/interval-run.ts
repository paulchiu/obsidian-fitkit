/**
 * The interval run as a pure function of the note. A run's whole state is the plan,
 * the rows and one `[started::]` stamp on the open row, the same accumulator-plus-stamp
 * rule the duration timer uses. The stamp times `rest` when the row has a rest field,
 * and `duration` otherwise. Nothing lives only in memory, so a killed app loses nothing.
 */

import type { IntervalPlan } from './interval-plan'
import { formatLocalTimestamp } from './local-timestamp'

export interface RunRow {
  set?: number
  durationSeconds?: number
  watts?: number
  load?: number
  level?: number
  restSeconds?: number
  startedAt?: string
  paused?: boolean
  note?: string
}

/** Opens the next rep after the rows already logged, taking the place of any trailing blank rows. */
export function startRun(rows: readonly RunRow[], now: number): RunRow[] {
  const logged = rows.slice(0, loggedReps(rows))
  return [...logged, { set: logged.length + 1, durationSeconds: 0, startedAt: stamp(now) }]
}

/** Rows that record something, ignoring the blank rows a fresh card or `Add set` leaves at the end. */
export function loggedReps(rows: readonly RunRow[]): number {
  let count = rows.length
  while (count > 0 && isBlankRow(rows[count - 1])) {
    count--
  }
  return count
}

function isBlankRow(row: RunRow | undefined): boolean {
  if (!row) {
    return false
  }
  const { set: _set, durationSeconds, ...rest } = row
  return !durationSeconds && Object.values(rest).every((value) => value === undefined)
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

export function runPhase(rows: readonly RunRow[], plan: IntervalPlan, now: number): RunPhase {
  const row = openRow(rows)
  if (!row) {
    return { kind: 'idle' }
  }
  const elapsed = Math.floor(liveSeconds(row, now))
  const target = phaseTarget(row, plan)
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
 * How long the open phase runs: the work time (null for open work), the fixed rest,
 * or for an every pace whatever the rep left of the period.
 */
function phaseTarget(row: RunRow, plan: IntervalPlan): number | null {
  if (!isResting(row)) {
    return plan.workSeconds
  }
  return plan.pace.kind === 'rest'
    ? plan.pace.seconds
    : Math.max(0, plan.pace.seconds - (row.durationSeconds ?? 0))
}

export interface RunAdvance {
  rows: RunRow[]
  finished: boolean
}

/** Closes every phase whose planned end has passed, as a live tick does. */
export function advanceRun(rows: readonly RunRow[], plan: IntervalPlan, now: number): RunAdvance {
  const { rows: next, finished } = advance(rows, plan, now)
  return { rows: next, finished }
}

/** `note` marks each rep whose work this closes, and `closed` counts them. */
function advance(
  rows: readonly RunRow[],
  plan: IntervalPlan,
  now: number,
  note?: string,
): RunAdvance & { closed: number; endedAt?: number } {
  const next = rows.map((row) => ({ ...row }))
  let closed = 0
  for (;;) {
    const row = next[next.length - 1]
    if (!row || row.startedAt === undefined || row.paused) {
      return { rows: next, finished: false, closed }
    }
    const target = phaseTarget(row, plan)
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
      next.push({ set: next.length + 1, durationSeconds: 0, startedAt: stamp(boundary) })
      continue
    }
    closed++
    if (note !== undefined) {
      row.note ??= note
    }
    if (closeWork(next, plan, target, boundary)) {
      return { rows: next, finished: true, closed, endedAt: boundary }
    }
  }
}

/**
 * Ends the open rep's work with `seconds` done at `endMs`, prefilling the target, and
 * starts its rest. Returns true when that was the last rep, which takes no rest.
 */
function closeWork(rows: RunRow[], plan: IntervalPlan, seconds: number, endMs: number): boolean {
  const row = rows[rows.length - 1]
  if (!row) {
    return false
  }
  row.durationSeconds = seconds
  row[plan.intensity.kind] ??= plan.intensity.target
  if (rows.length >= plan.reps) {
    delete row.startedAt
    return true
  }
  row.restSeconds = 0
  row.startedAt = stamp(endMs)
  return false
}

/** When the open phase would have started had it never been paused: its stamp minus what it banked. */
function phaseStartMs(row: RunRow): number {
  return Date.parse(row.startedAt ?? '') - bankedSeconds(row) * 1000
}

/** The Rest button: ends the open rep's work now, with the time actually done. */
export function endWork(rows: readonly RunRow[], plan: IntervalPlan, now: number): RunAdvance {
  const next = rows.map((row) => ({ ...row }))
  const row = openRow(next)
  if (!row || isResting(row)) {
    return { rows: next, finished: false }
  }
  const finished = closeWork(next, plan, Math.round(liveSeconds(row, now)), now)
  return { rows: next, finished }
}

/** The Skip button: ends the open rest now and starts the next rep. */
export function skipRest(rows: readonly RunRow[], now: number): RunRow[] {
  const next = rows.map((row) => ({ ...row }))
  const row = openRow(next)
  if (!row || !isResting(row)) {
    return next
  }
  bankLiveSeconds(row, now)
  return startRun(next, now)
}

/**
 * Closes any boundary that has already passed, then banks the open phase's time on the
 * row and swaps its stamp for `[paused:: true]`, so a late pause never stretches a phase.
 */
export function pauseRun(rows: readonly RunRow[], plan: IntervalPlan, now: number): RunAdvance {
  const { rows: next, finished } = advanceRun(rows, plan, now)
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
export function catchUpRun(rows: readonly RunRow[], plan: IntervalPlan, now: number): RunCatchUp {
  const result = advance(rows, plan, now, CAUGHT_UP_NOTE)
  const row = openRow(rows)
  const stoppedBy = result.endedAt ?? (row && openWorkLimit(row, plan))
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
function openWorkLimit(row: RunRow, plan: IntervalPlan): number | undefined {
  return plan.workSeconds === null && !isResting(row)
    ? phaseStartMs(row) + plan.pace.seconds * 1000
    : undefined
}

/** Resume after a cut-off: a rep cut off in work starts over, and a cut-off rest counts as taken in full. */
export function resumeCutRun(rows: readonly RunRow[], plan: IntervalPlan, now: number): RunRow[] {
  const next = rows.map((row) => ({ ...row }))
  const row = openRow(next)
  if (!row) {
    return next
  }
  if (!isResting(row)) {
    row.durationSeconds = 0
    row.startedAt = stamp(now)
    return next
  }
  row.restSeconds = phaseTarget(row, plan) ?? 0
  delete row.startedAt
  return startRun(next, now)
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

export function isOnTarget(row: RunRow, plan: IntervalPlan): boolean {
  const intensity = row[plan.intensity.kind]
  const heldIntensity =
    intensity !== undefined && intensity >= plan.intensity.target * ON_TARGET_RATIO
  const fullTime = plan.workSeconds === null || (row.durationSeconds ?? 0) >= plan.workSeconds
  return heldIntensity && fullTime
}

export function hitCount(rows: readonly RunRow[], plan: IntervalPlan): number {
  return rows.filter((row) => isOnTarget(row, plan)).length
}

/** The runner's big button: Rest while working, Skip while resting. */
export function pressRunButton(
  rows: readonly RunRow[],
  plan: IntervalPlan,
  now: number,
): RunAdvance {
  const row = openRow(rows)
  return row && isResting(row)
    ? { rows: skipRest(rows, now), finished: false }
    : endWork(rows, plan, now)
}

export function togglePauseRun(
  rows: readonly RunRow[],
  plan: IntervalPlan,
  now: number,
): RunAdvance {
  return openRow(rows)?.paused
    ? { rows: resumeRun(rows, now), finished: false }
    : pauseRun(rows, plan, now)
}
