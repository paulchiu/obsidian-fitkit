import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RunCue } from '../../src/domain/interval-cues'
import { parseIntervalProgram, type IntervalProgram } from '../../src/domain/interval-program'
import type { RunRow } from '../../src/domain/interval-run'
import {
  resumeSession,
  startSession,
  stepSession,
  type RunSession,
  type RunTransition,
} from '../../src/domain/interval-session'

const plan = (line: string): IntervalProgram => {
  const result = parseIntervalProgram(line)
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return result.program
}

const BIKE = plan('3 x 30s @ 300W, 90s rest')
const FOUR_BIKE = plan('4 x 30s @ 300W, 90s rest')
const EMOM = plan('3 x 40s @ 300W, every 1m')
const SLED = plan('3 x open @ 120kg, every 1m')
const ON_OFF = plan('(x 2 (on 30s 350W) (off 30s 150W))')
const NO_INTENSITY = plan('(x 2 (on 30s) (off 30s))')
const WARMUP_THEN_HARD = plan('(warmup 30s) (hard 30s 300W)')

/** Epoch ms `seconds` after 07:15:00 Brisbane on the workout's day. */
const sec = (seconds: number): number => Date.parse('2026-10-12T07:15:00+10:00') + seconds * 1000

/** Epoch ms for a Brisbane wall-clock time on the workout's day. */
const at = (time: string): number => Date.parse(`2026-10-12T${time}+10:00`)

/** Ticks once a second from `from` through `to`, as the view's timer would, keeping each cue with its second. */
const tickThrough = (
  start: RunSession,
  from: number,
  to: number,
): { session: RunSession; cues: Array<[number, RunCue]> } => {
  let session = start
  const cues: Array<[number, RunCue]> = []
  for (let second = from; second <= to; second++) {
    const next = stepSession(session, { kind: 'tick' }, sec(second))
    session = next.session
    if (next.effects.cue) {
      cues.push([second, next.effects.cue])
    }
  }
  return { session, cues }
}

const started = (program: IntervalProgram, rows: RunRow[] = []): RunSession =>
  startSession(rows, program, sec(0)).session

const resumed = (rows: RunRow[], program: IntervalProgram, now: number): RunTransition => {
  const result = resumeSession(rows, program, now)
  if (!result) {
    throw new Error('no open rep to resume')
  }
  return result
}

describe('interval session', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Australia/Brisbane')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('starts by writing rep 1 and showing the runner', () => {
    const { session, effects } = startSession([{ durationSeconds: 0 }], BIKE, sec(0))

    expect({ screen: session.screen, rows: session.rows, effects }).toEqual({
      screen: { kind: 'running' },
      rows: [{ set: 1, durationSeconds: 0, startedAt: '2026-10-12T07:15:00+10:00' }],
      effects: {
        rows: [{ set: 1, durationSeconds: 0, startedAt: '2026-10-12T07:15:00+10:00' }],
        redraw: 'full',
      },
    })
  })

  describe('cues', () => {
    it.each<[string, IntervalProgram, number, Array<[number, RunCue]>]>([
      [
        'counts down the last three seconds of work and sounds the change to rest',
        BIKE,
        31,
        [
          [27, 'count'],
          [28, 'count'],
          [29, 'count'],
          [30, 'go'],
        ],
      ],
      [
        'counts down the end of rest too and sounds the next rep',
        BIKE,
        121,
        [
          [27, 'count'],
          [28, 'count'],
          [29, 'count'],
          [30, 'go'],
          [117, 'count'],
          [118, 'count'],
          [119, 'count'],
          [120, 'go'],
        ],
      ],
      [
        'double-beeps when work runs straight into the next step',
        ON_OFF,
        31,
        [
          [27, 'count'],
          [28, 'count'],
          [29, 'count'],
          [30, 'shift'],
        ],
      ],
      ['stays quiet through open work, which has no countdown', SLED, 50, []],
    ])('%s', (_name, program, to, cues) => {
      expect(tickThrough(started(program), 1, to).cues).toEqual(cues)
    })

    it('sounds the finish when the last rep ends', () => {
      const rows: RunRow[] = [
        { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
        { set: 2, durationSeconds: 30, watts: 300, restSeconds: 90 },
      ]

      expect(tickThrough(started(BIKE, rows), 1, 31).cues).toEqual([
        [27, 'count'],
        [28, 'count'],
        [29, 'count'],
        [30, 'go'],
      ])
    })

    it.each<[string, number, number[], Array<[number, RunCue]>]>([
      [
        'a tick three seconds late counts down once',
        26,
        [29, 30],
        [
          [29, 'count'],
          [30, 'go'],
        ],
      ],
      ['a tick five seconds late still sounds the boundary it crossed', 26, [31], [[31, 'go']]],
      ['a tick over five seconds late catches up without a cue', 20, [31, 32], []],
    ])('%s', (_name, onTimeUntil, lateTicks, cues) => {
      let session = tickThrough(started(BIKE), 1, onTimeUntil).session
      const heard: Array<[number, RunCue]> = []
      for (const second of lateTicks) {
        const next = stepSession(session, { kind: 'tick' }, sec(second))
        session = next.session
        if (next.effects.cue) {
          heard.push([second, next.effects.cue])
        }
      }

      expect(heard).toEqual(cues)
    })
  })

  describe('ticks', () => {
    it('only moves the clock while nothing changes', () => {
      const session = started(BIKE)

      const next = stepSession(session, { kind: 'tick' }, sec(1))

      expect([next.effects, next.session.rows === session.rows]).toEqual([
        { redraw: 'clock' },
        true,
      ])
    })

    it('ends work by itself when its time runs out, writing the rep with the target', () => {
      const session = tickThrough(started(BIKE), 1, 29).session

      expect(stepSession(session, { kind: 'tick' }, sec(30)).effects).toEqual({
        rows: [
          {
            set: 1,
            durationSeconds: 30,
            watts: 300,
            restSeconds: 0,
            startedAt: '2026-10-12T07:15:30+10:00',
          },
        ],
        cue: 'go',
        redraw: 'full',
      })
    })

    it('rests for what is left of the period on an every pace', () => {
      const working = tickThrough(started(EMOM), 1, 30).session
      const resting = stepSession(working, { kind: 'press' }, sec(30)).session

      expect(tickThrough(resting, 31, 61).session.rows).toEqual([
        { set: 1, durationSeconds: 30, watts: 300, restSeconds: 30 },
        { set: 2, durationSeconds: 0, startedAt: '2026-10-12T07:16:00+10:00' },
      ])
    })

    it('finishes the run with how many reps hit the target, and stops ticking', () => {
      const rows: RunRow[] = [
        { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
        { set: 2, durationSeconds: 30, watts: 250, restSeconds: 90 },
      ]
      const finished = tickThrough(started(BIKE, rows), 1, 30).session

      expect([finished.screen, stepSession(finished, { kind: 'tick' }, sec(31))]).toEqual([
        { kind: 'finished', hits: 2 },
        { session: finished, effects: {} },
      ])
    })

    it('scores the finish against targeted steps only', () => {
      const rows: RunRow[] = [{ set: 1, step: 'warmup', durationSeconds: 30 }]

      expect(tickThrough(started(WARMUP_THEN_HARD, rows), 1, 30).session).toMatchObject({
        screen: { kind: 'finished', hits: 1 },
        rows: [
          { set: 1, step: 'warmup', durationSeconds: 30 },
          { set: 2, step: 'hard', durationSeconds: 30, watts: 300 },
        ],
      })
    })

    it('catches up a late tick that crossed a boundary, saying what it filled', () => {
      const session = tickThrough(started(BIKE), 1, 20).session

      const next = stepSession(session, { kind: 'tick' }, sec(31))

      expect([next.effects, next.session.lastPhase]).toEqual([
        {
          rows: [
            {
              set: 1,
              durationSeconds: 30,
              watts: 300,
              restSeconds: 0,
              startedAt: '2026-10-12T07:15:30+10:00',
              note: 'logged while Obsidian was closed',
            },
          ],
          notice:
            '1 rep finished while Obsidian was closed. It has the target filled in, so check its watts.',
          redraw: 'full',
        },
        { kind: 'rest', rep: 1, elapsed: 1, remaining: 89, paused: false },
      ])
    })

    it('only redraws after a late tick with nothing to fill', () => {
      const session = tickThrough(started(BIKE), 1, 10).session

      expect(stepSession(session, { kind: 'tick' }, sec(20)).effects).toEqual({ redraw: 'full' })
    })
  })

  describe('the big button', () => {
    it.each<[string, IntervalProgram, number, RunRow[]]>([
      [
        'Rest ends work early with the seconds done',
        BIKE,
        22,
        [
          {
            set: 1,
            durationSeconds: 22,
            watts: 300,
            restSeconds: 0,
            startedAt: '2026-10-12T07:15:22+10:00',
          },
        ],
      ],
      [
        'Next moves straight to the next step under its own name',
        ON_OFF,
        20,
        [
          { set: 1, step: 'on', durationSeconds: 20, watts: 350 },
          { set: 2, step: 'off', durationSeconds: 0, startedAt: '2026-10-12T07:15:20+10:00' },
        ],
      ],
    ])('%s', (_name, program, second, rows) => {
      expect(stepSession(started(program), { kind: 'press' }, sec(second)).effects).toEqual({
        rows,
        redraw: 'full',
      })
    })

    it('Skip ends rest with the rest taken and opens the next rep', () => {
      const resting = stepSession(started(BIKE), { kind: 'press' }, sec(22)).session

      expect(stepSession(resting, { kind: 'press' }, sec(60)).session.rows).toEqual([
        { set: 1, durationSeconds: 22, watts: 300, restSeconds: 38 },
        { set: 2, durationSeconds: 0, startedAt: '2026-10-12T07:16:00+10:00' },
      ])
    })

    it('Finish on the last step shows the finished screen', () => {
      const rows: RunRow[] = [{ set: 1, step: 'warmup', durationSeconds: 30 }]

      const next = stepSession(started(WARMUP_THEN_HARD, rows), { kind: 'press' }, sec(30))

      expect([next.session.screen, next.effects.redraw]).toEqual([
        { kind: 'finished', hits: 1 },
        'full',
      ])
    })
  })

  it('pauses with the time banked, resumes, and End run keeps the rows and leaves', () => {
    const working = tickThrough(started(BIKE), 1, 12).session
    const paused = stepSession(working, { kind: 'toggle-pause' }, sec(12))
    const tickWhilePaused = stepSession(paused.session, { kind: 'tick' }, sec(13))
    const running = stepSession(tickWhilePaused.session, { kind: 'toggle-pause' }, sec(300))
    const ended = stepSession(running.session, { kind: 'end' }, sec(305))

    expect([paused.effects, tickWhilePaused.effects, running.effects, ended.effects]).toEqual([
      { rows: [{ set: 1, durationSeconds: 12, paused: true }], redraw: 'full' },
      { redraw: 'clock' },
      {
        rows: [{ set: 1, durationSeconds: 12, startedAt: '2026-10-12T07:20:00+10:00' }],
        redraw: 'full',
      },
      { rows: [{ set: 1, durationSeconds: 17 }], leave: true },
    ])
  })

  it('leaves on Back to workout without touching the rows', () => {
    const session = started(BIKE)

    expect(stepSession(session, { kind: 'back' }, sec(1))).toEqual({
      session,
      effects: { leave: true },
    })
  })

  describe('adjusting the last rep', () => {
    it.each<[string, IntervalProgram, RunRow, number[], RunRow]>([
      [
        'nudges the intensity the rep logged',
        BIKE,
        { set: 1, durationSeconds: 20, watts: 300, restSeconds: 0 },
        [-5, -5],
        { set: 1, durationSeconds: 20, watts: 290, restSeconds: 0 },
      ],
      [
        'starts from the target when the rep logged none',
        BIKE,
        { set: 1, durationSeconds: 30, restSeconds: 0 },
        [5],
        { set: 1, durationSeconds: 30, watts: 305, restSeconds: 0 },
      ],
      [
        'never goes below zero',
        plan('3 x 30s @ L8, 90s rest'),
        { set: 1, durationSeconds: 30, level: 0.4, restSeconds: 0 },
        [-1],
        { set: 1, durationSeconds: 30, level: 0, restSeconds: 0 },
      ],
    ])('%s', (_name, program, row, deltas, expected) => {
      const opened = { ...row, startedAt: '2026-10-12T07:15:30+10:00' }
      const { session } = resumed([opened], program, sec(30))

      const last = deltas.reduce<RunTransition>(
        (step, delta) => stepSession(step.session, { kind: 'adjust', delta }, sec(31)),
        { session, effects: {} },
      )

      expect(last.effects).toEqual({
        rows: [{ ...expected, startedAt: '2026-10-12T07:15:30+10:00' }],
        redraw: 'full',
      })
    })

    it('does nothing on a plan with no intensity', () => {
      expect(
        stepSession(started(NO_INTENSITY), { kind: 'adjust', delta: 5 }, sec(1)).effects,
      ).toEqual({})
    })
  })

  describe('reopening', () => {
    it('has nothing to resume when no rep is open', () => {
      expect(
        resumeSession([{ set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 }], BIKE, sec(0)),
      ).toBeNull()
    })

    it('picks a paused run up as it was, without catching up', () => {
      const rows: RunRow[] = [{ set: 1, durationSeconds: 12, paused: true }]

      const { session, effects } = resumed(rows, BIKE, at('09:00:00'))

      expect([session.screen, session.rows === rows, effects]).toEqual([
        { kind: 'running' },
        true,
        {},
      ])
    })

    it('fills reps that ended while Obsidian was closed with the target and says how many', () => {
      const rows: RunRow[] = [
        { set: 1, durationSeconds: 30, watts: 280, restSeconds: 90 },
        { set: 2, durationSeconds: 0, startedAt: '2026-10-12T07:17:00+10:00' },
      ]

      const { session, effects } = resumed(rows, FOUR_BIKE, at('07:19:40'))

      expect([session.screen, effects]).toEqual([
        { kind: 'running' },
        {
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
              restSeconds: 0,
              startedAt: '2026-10-12T07:19:30+10:00',
              note: 'logged while Obsidian was closed',
            },
          ],
          notice:
            '2 reps finished while Obsidian was closed. They have the target filled in, so check their watts.',
        },
      ])
    })

    it.each<[string, IntervalProgram, RunRow, string]>([
      [
        'names the intensity of the plan',
        plan('3 x 30s @ L8, 90s rest'),
        { set: 1, durationSeconds: 0, startedAt: '2026-10-12T07:15:00+10:00' },
        '1 rep finished while Obsidian was closed. It has the target filled in, so check its level.',
      ],
      [
        'asks for times on a plan with no intensity',
        NO_INTENSITY,
        { set: 1, step: 'on', durationSeconds: 0, startedAt: '2026-10-12T07:15:00+10:00' },
        '1 rep finished while Obsidian was closed. It has the target filled in, so check its times.',
      ],
    ])('%s in the caught-up notice', (_name, program, row, notice) => {
      expect(resumed([row], program, sec(35)).effects.notice).toBe(notice)
    })

    it('finishes a run whose plan ended moments ago', () => {
      const rows: RunRow[] = [
        { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
        { set: 2, durationSeconds: 30, watts: 300, restSeconds: 90 },
        { set: 3, durationSeconds: 0, startedAt: '2026-10-12T07:15:00+10:00' },
      ]

      expect(resumed(rows, BIKE, at('07:16:00')).session.screen).toEqual({
        kind: 'finished',
        hits: 3,
      })
    })

    it.each<[string, RunRow, { rep: number; resting: boolean }]>([
      [
        'during rest',
        {
          set: 1,
          durationSeconds: 30,
          watts: 300,
          restSeconds: 0,
          startedAt: '2026-10-12T07:15:30+10:00',
        },
        { rep: 1, resting: true },
      ],
      [
        'during work',
        { set: 1, durationSeconds: 0, startedAt: '2026-10-12T07:15:00+10:00' },
        { rep: 1, resting: false },
      ],
    ])(
      'reports a run cut off %s more than two minutes past the plan, leaving the rows',
      (_name, row, cut) => {
        expect(resumed([row], BIKE, at('08:00:00'))).toMatchObject({
          session: { screen: { kind: 'cut-off', ...cut }, rows: [row] },
          effects: {},
        })
      },
    )

    describe('after a cut-off', () => {
      const cutInRest = (): RunSession =>
        resumed(
          [
            {
              set: 1,
              durationSeconds: 30,
              watts: 300,
              restSeconds: 0,
              startedAt: '2026-10-12T07:15:30+10:00',
            },
          ],
          BIKE,
          at('08:00:00'),
        ).session

      it('resumes from the next rep, crediting the planned rest', () => {
        const { session, effects } = stepSession(
          cutInRest(),
          { kind: 'resume-cut' },
          at('08:00:05'),
        )

        expect([session.screen, effects]).toEqual([
          { kind: 'running' },
          {
            rows: [
              { set: 1, durationSeconds: 30, watts: 300, restSeconds: 90 },
              { set: 2, durationSeconds: 0, startedAt: '2026-10-12T08:00:05+10:00' },
            ],
            redraw: 'full',
          },
        ])
      })

      it('restarts a rep cut off in work from zero', () => {
        const { session } = resumed(
          [{ set: 1, durationSeconds: 0, startedAt: '2026-10-12T07:15:00+10:00' }],
          BIKE,
          at('08:00:00'),
        )

        expect(stepSession(session, { kind: 'resume-cut' }, at('08:00:05')).effects.rows).toEqual([
          { set: 1, durationSeconds: 0, startedAt: '2026-10-12T08:00:05+10:00' },
        ])
      })

      it('ends the run at the last rep known to be done', () => {
        expect(stepSession(cutInRest(), { kind: 'end-cut' }, at('08:00:05')).effects).toEqual({
          rows: [{ set: 1, durationSeconds: 30, watts: 300 }],
          leave: true,
        })
      })

      it('ignores ticks while the cut-off screen shows', () => {
        const session = cutInRest()

        expect(stepSession(session, { kind: 'tick' }, at('08:00:01'))).toEqual({
          session,
          effects: {},
        })
      })
    })
  })

  describe('closing the tab', () => {
    it('pauses a running run, banking the time so far', () => {
      expect(stepSession(started(BIKE), { kind: 'close' }, sec(12)).effects).toEqual({
        rows: [{ set: 1, durationSeconds: 12, paused: true }],
      })
    })

    it('writes nothing for a run already paused', () => {
      const paused = stepSession(started(BIKE), { kind: 'toggle-pause' }, sec(12)).session

      expect(stepSession(paused, { kind: 'close' }, sec(20)).effects).toEqual({})
    })

    it('writes nothing while the cut-off screen shows', () => {
      const { session } = resumed(
        [{ set: 1, durationSeconds: 0, startedAt: '2026-10-12T07:15:00+10:00' }],
        BIKE,
        at('08:00:00'),
      )

      expect(stepSession(session, { kind: 'close' }, at('08:00:01')).effects).toEqual({})
    })
  })
})
