import { describe, expect, it } from 'vitest'

import {
  formatStep,
  parseIntervalProgram,
  programSeconds,
  type IntervalProgram,
} from '../../src/domain/interval-program'

const program = (raw: string): IntervalProgram => {
  const result = parseIntervalProgram(raw)
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return result.program
}

describe('parseIntervalProgram', () => {
  it('reads a one-line plan as one step per rep, with no rest after the last', () => {
    expect(parseIntervalProgram('3 x 30s @ 300W, 90s rest')).toEqual({
      ok: true,
      program: {
        intensity: 'watts',
        steps: [
          {
            workSeconds: 30,
            target: { kind: 'watts', target: 300 },
            restSeconds: 90,
            rounds: [{ round: 1, of: 3 }],
          },
          {
            workSeconds: 30,
            target: { kind: 'watts', target: 300 },
            restSeconds: 90,
            rounds: [{ round: 2, of: 3 }],
          },
          {
            workSeconds: 30,
            target: { kind: 'watts', target: 300 },
            restSeconds: 0,
            rounds: [{ round: 3, of: 3 }],
          },
        ],
      },
    })
  })

  it('paces every rep of a one-line every plan by its period', () => {
    const steps = program('2 x open @ 120kg, every 2m').steps

    expect(steps).toEqual([
      {
        workSeconds: null,
        target: { kind: 'load', target: 120 },
        restSeconds: 0,
        everySeconds: 120,
        rounds: [{ round: 1, of: 2 }],
      },
      {
        workSeconds: null,
        target: { kind: 'load', target: 120 },
        restSeconds: 0,
        everySeconds: 120,
        rounds: [{ round: 2, of: 2 }],
      },
    ])
  })

  it('passes on why a one-line plan cannot be read', () => {
    expect(parseIntervalProgram('6 x open @ 120kg, 90s rest')).toEqual({
      ok: false,
      reason: 'Open work needs a pace of every, so each rep has a start to rest against.',
    })
  })

  it('names each step by its first word and puts the rest of a repeat between its rounds', () => {
    expect(program('(x 2 (work 20s 400W) (rest 10s))')).toEqual({
      intensity: 'watts',
      steps: [
        {
          name: 'work',
          workSeconds: 20,
          target: { kind: 'watts', target: 400 },
          restSeconds: 10,
          rounds: [{ round: 1, of: 2 }],
        },
        {
          name: 'work',
          workSeconds: 20,
          target: { kind: 'watts', target: 400 },
          restSeconds: 0,
          rounds: [{ round: 2, of: 2 }],
        },
      ],
    })
  })

  it('runs steps with no rest between them straight on', () => {
    const steps = program('(x 2 (on 30s 350W) (off 30s 150W))').steps

    expect(steps.map((step) => [step.name, step.target?.target, step.restSeconds])).toEqual([
      ['on', 350, 0],
      ['off', 150, 0],
      ['on', 350, 0],
      ['off', 150, 0],
    ])
  })

  it('nests repeats, tracking the round of each', () => {
    const steps = program(
      '(warmup 10m 150W) (x 3 (x 3 (over 1m 300W) (under 2m 220W)) (rest 4m)) (cooldown 5m 120W)',
    ).steps

    expect(steps).toHaveLength(20)
    expect(steps[0]).toEqual({
      name: 'warmup',
      workSeconds: 600,
      target: { kind: 'watts', target: 150 },
      restSeconds: 0,
      rounds: [],
    })
    expect(steps[6]).toEqual({
      name: 'under',
      workSeconds: 120,
      target: { kind: 'watts', target: 220 },
      restSeconds: 240,
      rounds: [
        { round: 1, of: 3 },
        { round: 3, of: 3 },
      ],
    })
    expect(steps[7]?.rounds).toEqual([
      { round: 2, of: 3 },
      { round: 1, of: 3 },
    ])
    expect(steps[18]).toMatchObject({ name: 'under', restSeconds: 0 })
    expect(steps[19]).toMatchObject({ name: 'cooldown', workSeconds: 300, restSeconds: 0 })
  })

  it('keeps a quoted name with spaces, and allows a step with no target', () => {
    expect(program('("big gear" 2m 260W) (spin 5m)').steps).toEqual([
      {
        name: 'big gear',
        workSeconds: 120,
        target: { kind: 'watts', target: 260 },
        restSeconds: 0,
        rounds: [],
      },
      { name: 'spin', workSeconds: 300, restSeconds: 0, rounds: [] },
    ])
  })

  it('has no intensity when no step has a target', () => {
    expect(program('(x 2 (sprint 20s) (rest 40s))').intensity).toBeNull()
  })

  it('adds up rests in a row and drops a rest that ends the plan', () => {
    const steps = program('(a 30s 300W) (rest 1m) (rest 30s) (b 30s 300W) (rest 2m)').steps

    expect(steps.map((step) => step.restSeconds)).toEqual([90, 0])
  })

  it('takes the next target in a list each round, starting over when it runs out', () => {
    const steps = program('(x 3 (climb 1m (L8 L10)) (rest 1m))').steps

    expect(steps.map((step) => step.target)).toEqual([
      { kind: 'level', target: 8 },
      { kind: 'level', target: 10 },
      { kind: 'level', target: 8 },
    ])
  })

  it('starts each step inside every on the period, adding any rest after it', () => {
    const steps = program('(x 2 (every 2m (push open 120kg))) (rest 3m) (sprint 20s 120kg)').steps

    expect(steps).toEqual([
      {
        name: 'push',
        workSeconds: null,
        target: { kind: 'load', target: 120 },
        restSeconds: 0,
        everySeconds: 120,
        rounds: [{ round: 1, of: 2 }],
      },
      {
        name: 'push',
        workSeconds: null,
        target: { kind: 'load', target: 120 },
        restSeconds: 180,
        everySeconds: 120,
        rounds: [{ round: 2, of: 2 }],
      },
      {
        name: 'sprint',
        workSeconds: 20,
        target: { kind: 'load', target: 120 },
        restSeconds: 0,
        rounds: [],
      },
    ])
  })

  it.each([
    ['(x 2 (a 30s 300W)', 'Missing ) to close (x.'],
    ['(a 30s 300W))', 'There is a ) with nothing to close.'],
    ['("big gear 2m 260W)', 'A quoted name needs its closing ".'],
    ['(rest 1m)', 'Write at least one step, like (over 1m 300W).'],
    [
      '(hard] 1m 300W)',
      'A plan cannot hold square brackets, since the note keeps it inside [plan:: …].',
    ],
    [
      '("big [gear]" 2m 260W)',
      'A plan cannot hold square brackets, since the note keeps it inside [plan:: …].',
    ],
    ['()', 'Empty brackets: write a step like (over 1m 300W).'],
    ['(a 30s 300W) b', 'Put each step in brackets, like (over 1m 300W), not "b" on its own.'],
    ['(a 30s 300W) ()', 'Empty brackets: write a step like (over 1m 300W).'],
    ['(a 30s fast)', '"fast" is not a target like 300W, 120kg or L12.'],
    ['(a 30s 0W)', 'The target has to be more than zero.'],
    ['(a soon 300W)', '"soon" is not a work time like 30s, 2m or open.'],
    ['(a)', 'Write a step as (a 1m 300W): a name, a time or open, then an optional target.'],
    [
      '(a 30s 300W) (b 30s L8)',
      'Use one kind of target in a plan: watts (300W), load (120kg) or level (L12).',
    ],
    [
      '(a open 120kg)',
      'Open work needs (every …) around it, so each rep has a start to rest against.',
    ],
    ['(every 30s (a 40s 300W))', 'Work (40s) has to be shorter than the period (30s).'],
    ['(rest 1m) (a 30s 300W)', 'A plan cannot start with a rest.'],
    [
      '(a 1m (L8 L10))',
      'A list of targets needs (x …) around it, which takes the next one each round.',
    ],
    [
      '(x 0 (a 30s 300W))',
      'Write a repeat as (x 3 (step 1m 300W)), with a whole number of rounds.',
    ],
    ['(a 30s 300W) (rest)', 'Write a rest as (rest 90s).'],
    ['(x 30 (x 30 (a 30s 300W)))', 'That plan is too long to run. Keep it under 500 steps.'],
  ])('explains why %s cannot be read', (raw, reason) => {
    expect(parseIntervalProgram(raw)).toEqual({ ok: false, reason })
  })
})

describe('formatStep', () => {
  it.each([
    ['(x 2 (under 2m 220W))', 'under 2m @ 220W'],
    ['8 x 30s @ 300W, 90s rest', '30s @ 300W'],
    ['(x 2 (every 2m (push open 120kg)))', 'push open @ 120kg'],
    ['(warmup 10m)', 'warmup 10m'],
    ['(spin 90s L8)', 'spin 90s @ L8'],
  ])('labels the first step of %s as %s', (raw, label) => {
    const [first] = program(raw).steps
    expect(first && formatStep(first)).toBe(label)
  })
})

describe('programSeconds', () => {
  it('adds up work and rest, with no rest after the last step', () => {
    expect(programSeconds(program('(x 8 (work 20s 400W) (rest 10s))'))).toBe(230)
  })

  it('counts a step inside every as its whole period', () => {
    expect(programSeconds(program('3 x 40s @ 300W, every 1m'))).toBe(160)
  })

  it('counts open work by its period, and the last open rep as nothing', () => {
    expect(programSeconds(program('3 x open @ 120kg, every 2m'))).toBe(240)
  })
})
