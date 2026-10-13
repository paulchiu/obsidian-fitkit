import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseIntervalPlan, type IntervalPlan } from '../../src/domain/interval-plan'
import {
  advanceRun,
  catchUpRun,
  endCutRun,
  endRun,
  endWork,
  hitCount,
  pauseRun,
  resumeCutRun,
  resumeRun,
  runPhase,
  skipRest,
  startRun,
  type RunRow,
} from '../../src/domain/interval-run'

/** Epoch ms for a Brisbane wall-clock time on the workout's day. */
const at = (time: string): number => Date.parse(`2026-10-12T${time}+10:00`)

const plan = (line: string): IntervalPlan => {
  const result = parseIntervalPlan(line)
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return result.plan
}

const BIKE = plan('3 x 30s @ 300W, 90s rest')
const EMOM = plan('3 x 40s @ 300W, every 1m')
const SLED = plan('3 x open @ 120kg, every 1m')

describe('interval run', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Australia/Brisbane')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('starts the next rep as a row stamped with the start time', () => {
    const done: RunRow[] = [{ set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 }]

    expect(startRun(done, at('07:15:00'))).toEqual([
      { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
      { set: 2, durationSeconds: 0, startedAt: '2026-10-12T07:15:00+10:00' },
    ])
  })

  it('reports the open rep as work, with the time left counted from its stamp', () => {
    const rows = startRun(
      [{ set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 }],
      at('07:15:00'),
    )

    expect(runPhase(rows, BIKE, at('07:15:12'))).toEqual({
      kind: 'work',
      rep: 2,
      elapsed: 12,
      remaining: 18,
      paused: false,
    })
  })

  it('reports a row with a rest field as resting, timing the rest', () => {
    const rows: RunRow[] = [
      {
        set: 1,
        durationSeconds: 30,
        watts: 300,
        restSeconds: 0,
        startedAt: '2026-10-12T07:15:30+10:00',
      },
    ]

    expect(runPhase(rows, BIKE, at('07:16:00'))).toEqual({
      kind: 'rest',
      rep: 1,
      elapsed: 30,
      remaining: 60,
      paused: false,
    })
  })

  it('is idle when no row is open', () => {
    expect(runPhase([{ set: 1, durationSeconds: 30 }], BIKE, at('07:16:00'))).toEqual({
      kind: 'idle',
    })
  })

  it('closes work whose time has run out, prefilling the target and starting rest at the boundary', () => {
    const rows = startRun([], at('07:15:00'))

    expect(advanceRun(rows, BIKE, at('07:15:31')).rows).toEqual([
      {
        set: 1,
        durationSeconds: 30,
        watts: 300,
        restSeconds: 0,
        startedAt: '2026-10-12T07:15:30+10:00',
      },
    ])
  })

  it('closes rest that has run out and opens the next rep at the boundary', () => {
    const rows: RunRow[] = [
      {
        set: 1,
        durationSeconds: 30,
        watts: 300,
        restSeconds: 0,
        startedAt: '2026-10-12T07:15:30+10:00',
      },
    ]

    expect(advanceRun(rows, BIKE, at('07:17:01')).rows).toEqual([
      { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
      { set: 2, durationSeconds: 0, startedAt: '2026-10-12T07:17:00+10:00' },
    ])
  })

  it('walks every boundary a late tick missed', () => {
    const rows = startRun([], at('07:15:00'))

    expect(advanceRun(rows, BIKE, at('07:17:10')).rows).toEqual([
      { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
      { set: 2, durationSeconds: 0, startedAt: '2026-10-12T07:17:00+10:00' },
    ])
  })

  it("finishes the run when the last rep's work ends, leaving that rep without rest", () => {
    const rows: RunRow[] = [
      { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
      { set: 2, durationSeconds: 30, watts: 300, restSeconds: 90 },
      { set: 3, durationSeconds: 0, startedAt: '2026-10-12T07:19:00+10:00' },
    ]

    expect(advanceRun(rows, BIKE, at('07:19:30'))).toEqual({
      finished: true,
      rows: [
        { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
        { set: 2, durationSeconds: 30, watts: 300, restSeconds: 90 },
        { set: 3, durationSeconds: 30, watts: 300 },
      ],
    })
  })

  it('records the seconds actually done when Rest ends work early', () => {
    const rows = startRun([], at('07:15:00'))

    expect(endWork(rows, BIKE, at('07:15:22')).rows).toEqual([
      {
        set: 1,
        durationSeconds: 22,
        watts: 300,
        restSeconds: 0,
        startedAt: '2026-10-12T07:15:22+10:00',
      },
    ])
  })

  it('keeps the rest actually taken and starts the next rep when Skip cuts rest short', () => {
    const rows: RunRow[] = [
      {
        set: 1,
        durationSeconds: 30,
        watts: 300,
        restSeconds: 0,
        startedAt: '2026-10-12T07:15:30+10:00',
      },
    ]

    expect(skipRest(rows, at('07:16:15'))).toEqual([
      { set: 1, durationSeconds: 30, watts: 300, restSeconds: 45 },
      { set: 2, durationSeconds: 0, startedAt: '2026-10-12T07:16:15+10:00' },
    ])
  })

  it('rests for what the rep left of the period when paced every minute', () => {
    const rows = startRun([], at('07:15:00'))

    expect(advanceRun(rows, EMOM, at('07:16:01')).rows).toEqual([
      { set: 1, durationSeconds: 40, watts: 300, restSeconds: 20 },
      { set: 2, durationSeconds: 0, startedAt: '2026-10-12T07:16:00+10:00' },
    ])
  })

  it('counts open work up without ending it', () => {
    const rows = startRun([], at('07:15:00'))

    expect([
      runPhase(rows, SLED, at('07:15:50')),
      advanceRun(rows, SLED, at('07:20:00')).rows,
    ]).toEqual([{ kind: 'work', rep: 1, elapsed: 50, remaining: null, paused: false }, rows])
  })

  it('gives a rep that overruns the period no rest and starts the next one at once', () => {
    const worked = endWork(startRun([], at('07:15:00')), SLED, at('07:16:15')).rows

    expect(advanceRun(worked, SLED, at('07:16:15')).rows).toEqual([
      { set: 1, durationSeconds: 75, load: 120, restSeconds: 0 },
      { set: 2, durationSeconds: 0, startedAt: '2026-10-12T07:16:15+10:00' },
    ])
  })

  it('banks the elapsed time and marks the row paused when the run pauses', () => {
    const rows = startRun([], at('07:15:00'))

    expect(pauseRun(rows, at('07:15:12'))).toEqual([{ set: 1, durationSeconds: 12, paused: true }])
  })

  it('carries on from the banked time when a paused run resumes', () => {
    const paused: RunRow[] = [{ set: 1, durationSeconds: 12, paused: true }]
    const resumed = resumeRun(paused, at('07:20:00'))

    expect([resumed, runPhase(resumed, BIKE, at('07:20:05'))]).toEqual([
      [{ set: 1, durationSeconds: 12, startedAt: '2026-10-12T07:20:00+10:00' }],
      { kind: 'work', rep: 1, elapsed: 17, remaining: 13, paused: false },
    ])
  })

  it('keeps the time done on a rep cut off by End run, and leaves nothing open', () => {
    const rows = startRun(
      [{ set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 }],
      at('07:17:00'),
    )

    expect(endRun(rows, at('07:17:12'))).toEqual([
      { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
      { set: 2, durationSeconds: 12 },
    ])
  })

  it('drops a rep End run cuts off before any work was done', () => {
    const rows = startRun(
      [{ set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 }],
      at('07:17:00'),
    )

    expect(endRun(rows, at('07:17:00'))).toEqual([
      { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
    ])
  })

  it('keeps the rest taken when End run comes during rest', () => {
    const rows: RunRow[] = [
      {
        set: 1,
        durationSeconds: 30,
        watts: 300,
        restSeconds: 0,
        startedAt: '2026-10-12T07:15:30+10:00',
      },
    ]

    expect(endRun(rows, at('07:15:50'))).toEqual([
      { set: 1, durationSeconds: 30, watts: 300, restSeconds: 20 },
    ])
  })

  it('fills reps that ended while Obsidian was closed with the target, and flags them', () => {
    const rows = startRun(
      [{ set: 1, durationSeconds: 30, watts: 280, restSeconds: 90 }],
      at('07:17:00'),
    )

    expect(catchUpRun(rows, plan('4 x 30s @ 300W, 90s rest'), at('07:19:40'))).toEqual({
      kind: 'caught-up',
      filled: 2,
      rows: [
        { set: 1, durationSeconds: 30, watts: 280, restSeconds: 90 },
        {
          set: 2,
          durationSeconds: 30,
          watts: 300,
          restSeconds: 90,
          note: 'logged while Obsidian was closed',
        },
        {
          set: 3,
          durationSeconds: 30,
          watts: 300,
          note: 'logged while Obsidian was closed',
          restSeconds: 0,
          startedAt: '2026-10-12T07:19:30+10:00',
        },
      ],
    })
  })

  it('cuts the run off instead of inventing reps when the clock has passed the end of the plan', () => {
    const rows: RunRow[] = [
      { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
      {
        set: 2,
        durationSeconds: 30,
        watts: 300,
        restSeconds: 0,
        startedAt: '2026-10-12T07:17:30+10:00',
      },
    ]

    expect(catchUpRun(rows, BIKE, at('07:45:00'))).toEqual({
      kind: 'cut-off',
      rep: 2,
      resting: true,
      startedAt: '2026-10-12T07:17:30+10:00',
    })
  })

  it('restarts a cut-off rep from zero when the run resumes during work', () => {
    const rows: RunRow[] = [{ set: 1, durationSeconds: 0, startedAt: '2026-10-12T07:15:00+10:00' }]

    expect(resumeCutRun(rows, BIKE, at('07:45:00'))).toEqual([
      { set: 1, durationSeconds: 0, startedAt: '2026-10-12T07:45:00+10:00' },
    ])
  })

  it('credits the planned rest and starts the next rep when a run cut off in rest resumes', () => {
    const rows: RunRow[] = [
      {
        set: 1,
        durationSeconds: 30,
        watts: 300,
        restSeconds: 0,
        startedAt: '2026-10-12T07:15:30+10:00',
      },
    ]

    expect(resumeCutRun(rows, BIKE, at('07:45:00'))).toEqual([
      { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
      { set: 2, durationSeconds: 0, startedAt: '2026-10-12T07:45:00+10:00' },
    ])
  })

  it('ends a cut-off run at the last finished rep, without an unknown rest or rep', () => {
    const resting: RunRow[] = [
      {
        set: 1,
        durationSeconds: 30,
        watts: 300,
        restSeconds: 0,
        startedAt: '2026-10-12T07:15:30+10:00',
      },
    ]
    const working: RunRow[] = [
      { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
      { set: 2, durationSeconds: 0, startedAt: '2026-10-12T07:17:00+10:00' },
    ]

    expect([endCutRun(resting), endCutRun(working)]).toEqual([
      [{ set: 1, durationSeconds: 30, watts: 300 }],
      [{ set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 }],
    ])
  })

  it('counts reps that held at least 95% of the target for the full work time', () => {
    const rows: RunRow[] = [
      { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
      { set: 2, durationSeconds: 30, watts: 285, restSeconds: 90 },
      { set: 3, durationSeconds: 30, watts: 284, restSeconds: 90 },
      { set: 4, durationSeconds: 22, watts: 310, restSeconds: 90 },
      { set: 5, durationSeconds: 30 },
    ]

    expect(hitCount(rows, plan('5 x 30s @ 300W, 90s rest'))).toBe(2)
  })

  it('judges open work on intensity alone', () => {
    const rows: RunRow[] = [
      { set: 1, durationSeconds: 18, load: 120, restSeconds: 42 },
      { set: 2, durationSeconds: 75, load: 120, restSeconds: 0 },
      { set: 3, durationSeconds: 20, load: 100 },
    ]

    expect(hitCount(rows, SLED)).toBe(2)
  })
})
