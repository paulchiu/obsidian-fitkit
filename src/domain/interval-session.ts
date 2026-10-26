/**
 * The interval runner as a pure state machine: the note's rows plus what the screen shows,
 * stepped by one transition that tells the view what to write, play, say and draw.
 */

import { cueBetween, type RunCue } from './interval-cues'
import type { IntervalProgram } from './interval-program'
import {
  advanceRun,
  catchUpRun,
  correctableRep,
  endCutRun,
  endRun,
  hasOpenRep,
  hitCount,
  pauseRun,
  pressRunButton,
  resumeCutRun,
  runPhase,
  startRun,
  togglePauseRun,
  type RunPhase,
  type RunRow,
} from './interval-run'

export type RunScreen =
  | { kind: 'running' }
  | { kind: 'finished'; hits: number }
  | { kind: 'cut-off'; rep: number; resting: boolean }

export interface RunSession {
  readonly program: IntervalProgram
  readonly rows: readonly RunRow[]
  readonly screen: RunScreen
  /** The phase the last tick saw, so the next one knows which cue it crossed. */
  readonly lastPhase: RunPhase
  readonly lastTickAt: number
}

export type RunEvent =
  | { kind: 'tick' }
  | { kind: 'press' }
  | { kind: 'toggle-pause' }
  | { kind: 'end' }
  | { kind: 'adjust'; delta: number }
  | { kind: 'resume-cut' }
  | { kind: 'end-cut' }
  | { kind: 'back' }
  | { kind: 'close' }

export interface RunEffects {
  /** Rows to write into the note, present only when they changed. */
  rows?: RunRow[]
  cue?: RunCue
  notice?: string
  /** The run is over, so the view returns to the card list. */
  leave?: boolean
  /** `full` rebuilds the runner; `clock` only moves the clock. */
  redraw?: 'full' | 'clock'
}

export interface RunTransition {
  session: RunSession
  effects: RunEffects
}

/** A tick this late means the app was suspended, so it catches up the way a reopen does. */
const LATE_TICK_MS = 5000

/** The Start button: opens the next rep and shows the runner. */
export function startSession(
  rows: readonly RunRow[],
  program: IntervalProgram,
  now: number,
): RunTransition {
  const started = startRun(rows, program, now)
  return { session: openSession(started, program, now), effects: { rows: started, redraw: 'full' } }
}

/**
 * Picks up the run a reopened note holds, or null when it holds none. A run still being
 * timed catches up on the time away. The caller draws the first frame.
 */
export function resumeSession(
  rows: readonly RunRow[],
  program: IntervalProgram,
  now: number,
): RunTransition | null {
  if (!hasOpenRep(rows)) {
    return null
  }
  const session = openSession(rows, program, now)
  return rows[rows.length - 1]?.startedAt === undefined
    ? { session, effects: {} }
    : catchUp(session, now)
}

export function stepSession(session: RunSession, event: RunEvent, now: number): RunTransition {
  const { rows, program } = session
  switch (event.kind) {
    case 'tick':
      return tick(session, now)
    case 'press':
      return settle(session, pressRunButton(rows, program, now), now)
    case 'toggle-pause':
      return settle(session, togglePauseRun(rows, program, now), now)
    case 'end':
      return leaving(settle(session, { rows: endRun(rows, now) }, now))
    case 'adjust':
      return adjustRep(session, event.delta, now)
    case 'resume-cut':
      return settle(
        { ...session, screen: { kind: 'running' } },
        { rows: resumeCutRun(rows, program, now) },
        now,
      )
    case 'end-cut':
      return leaving(settle(session, { rows: endCutRun(rows) }, now))
    case 'back':
      return { session, effects: { leave: true } }
    case 'close':
      return closeSession(session, now)
  }
}

function openSession(rows: readonly RunRow[], program: IntervalProgram, now: number): RunSession {
  return {
    program,
    rows,
    screen: { kind: 'running' },
    lastPhase: runPhase(rows, program, now),
    lastTickAt: now,
  }
}

function tick(session: RunSession, now: number): RunTransition {
  if (session.screen.kind !== 'running') {
    return { session, effects: {} }
  }
  const ticked = { ...session, lastTickAt: now }
  if (now - session.lastTickAt > LATE_TICK_MS) {
    const caught = catchUp(ticked, now)
    const lastPhase = runPhase(caught.session.rows, session.program, now)
    return {
      session: { ...caught.session, lastPhase },
      effects: { ...caught.effects, redraw: 'full' },
    }
  }
  const result = advanceRun(session.rows, session.program, now)
  const next = settle(ticked, result, now)
  const cue = result.finished ? 'go' : cueBetween(session.lastPhase, next.session.lastPhase)
  return {
    session: next.session,
    effects: {
      ...next.effects,
      redraw: next.effects.redraw ?? 'clock',
      ...(cue === null ? {} : { cue }),
    },
  }
}

/** Takes the next rows, flagging a write when they differ and a redraw on a change or a finish. */
function settle(
  session: RunSession,
  next: { rows: RunRow[]; finished?: boolean },
  now: number,
): RunTransition {
  const changed = !sameRows(next.rows, session.rows)
  const rows = changed ? next.rows : session.rows
  const screen: RunScreen = next.finished
    ? { kind: 'finished', hits: hitCount(next.rows, session.program) }
    : session.screen
  return {
    session: { ...session, rows, screen, lastPhase: runPhase(rows, session.program, now) },
    effects: {
      ...(changed ? { rows: next.rows } : {}),
      ...(changed || next.finished === true ? { redraw: 'full' } : {}),
    },
  }
}

/** Leaving redraws the card list, so the runner needs no redraw of its own. */
function leaving({ session, effects }: RunTransition): RunTransition {
  return { session, effects: { ...(effects.rows ? { rows: effects.rows } : {}), leave: true } }
}

/** Catches up after the app was away, or reports a cut-off; only filled reps are written. */
function catchUp(session: RunSession, now: number): RunTransition {
  const result = catchUpRun(session.rows, session.program, now)
  if (result.kind === 'cut-off') {
    const screen: RunScreen = { kind: 'cut-off', rep: result.rep, resting: result.resting }
    return { session: { ...session, screen }, effects: {} }
  }
  const screen: RunScreen = result.finished
    ? { kind: 'finished', hits: hitCount(result.rows, session.program) }
    : session.screen
  if (result.filled === 0) {
    return { session: { ...session, screen }, effects: {} }
  }
  return {
    session: {
      ...session,
      screen,
      rows: result.rows,
      lastPhase: runPhase(result.rows, session.program, now),
    },
    effects: { rows: result.rows, notice: caughtUpNotice(result.filled, session.program) },
  }
}

/** An intensity kind's name doubles as its noun: watts, load, level. */
function caughtUpNotice(filled: number, program: IntervalProgram): string {
  const label = program.intensity ?? 'times'
  return filled === 1
    ? `1 rep finished while Obsidian was closed. It has the target filled in, so check its ${label}.`
    : `${filled} reps finished while Obsidian was closed. They have the target filled in, so check their ${label}.`
}

/** The stepper: nudges the {@link correctableRep}'s intensity, starting from the target when none is logged. */
function adjustRep(session: RunSession, delta: number, now: number): RunTransition {
  const kind = session.program.intensity
  const index = correctableRep(session.rows, session.program)
  const rows = session.rows.map((row) => ({ ...row }))
  const rep = index === null ? undefined : rows[index]
  if (index === null || !rep || !kind) {
    return { session, effects: {} }
  }
  const target = session.program.steps[index]?.target?.target ?? 0
  rep[kind] = Math.max(0, Math.round(((rep[kind] ?? target) + delta) * 10) / 10)
  return settle(session, { rows }, now)
}

/** Closing the tab pauses a running run, banking the time so far. */
function closeSession(session: RunSession, now: number): RunTransition {
  if (session.screen.kind !== 'running') {
    return { session, effects: {} }
  }
  const { rows } = pauseRun(session.rows, session.program, now)
  return sameRows(rows, session.rows)
    ? { session, effects: {} }
    : { session: { ...session, rows }, effects: { rows } }
}

function sameRows(a: readonly RunRow[], b: readonly RunRow[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
