import { describe, expect, it } from 'vitest'

import { formatIntervalPlan, parseIntervalPlan } from '../../src/domain/interval-plan'

describe('parseIntervalPlan', () => {
  it('reads reps, timed work, a watts target and a fixed rest', () => {
    expect(parseIntervalPlan('8 x 30s @ 300W, 90s rest')).toEqual({
      ok: true,
      plan: {
        reps: 8,
        workSeconds: 30,
        intensity: { kind: 'watts', target: 300 },
        pace: { kind: 'rest', seconds: 90 },
      },
    })
  })

  it('reads open work paced every two minutes against a load target', () => {
    expect(parseIntervalPlan('6 x open @ 120kg, every 2m')).toEqual({
      ok: true,
      plan: {
        reps: 6,
        workSeconds: null,
        intensity: { kind: 'load', target: 120 },
        pace: { kind: 'every', seconds: 120 },
      },
    })
  })

  it('reads a level target', () => {
    const result = parseIntervalPlan('10 x 20s @ L12, 40s rest')
    expect(result.ok && result.plan.intensity).toEqual({ kind: 'level', target: 12 })
  })

  it('rejects open work with a fixed rest, since there is no clock to rest against', () => {
    expect(parseIntervalPlan('6 x open @ 120kg, 90s rest')).toEqual({
      ok: false,
      reason: 'Open work needs a pace of every, so each rep has a start to rest against.',
    })
  })

  it('rejects timed work that is not shorter than the every period', () => {
    expect(parseIntervalPlan('10 x 1m @ 300W, every 1m')).toEqual({
      ok: false,
      reason: 'Work (1m) has to be shorter than the period (1m).',
    })
  })

  it('rejects a zero target, which is what an empty target field produces', () => {
    expect(parseIntervalPlan('8 x 30s @ 0W, 90s rest')).toEqual({
      ok: false,
      reason: 'The target has to be more than zero.',
    })
  })

  it('rejects a plan with no reps or no work time', () => {
    expect([
      parseIntervalPlan('0 x 30s @ 300W, 90s rest').ok,
      parseIntervalPlan('8 x 0s @ 300W, 90s rest').ok,
    ]).toEqual([false, false])
  })
})

describe('formatIntervalPlan', () => {
  it('writes plans in the canonical line, whole minutes as m and the rest as s', () => {
    expect([
      formatIntervalPlan({
        reps: 8,
        workSeconds: 30,
        intensity: { kind: 'watts', target: 300 },
        pace: { kind: 'rest', seconds: 90 },
      }),
      formatIntervalPlan({
        reps: 6,
        workSeconds: null,
        intensity: { kind: 'load', target: 120 },
        pace: { kind: 'every', seconds: 120 },
      }),
      formatIntervalPlan({
        reps: 10,
        workSeconds: 20,
        intensity: { kind: 'level', target: 12 },
        pace: { kind: 'rest', seconds: 40 },
      }),
    ]).toEqual([
      '8 x 30s @ 300W, 90s rest',
      '6 x open @ 120kg, every 2m',
      '10 x 20s @ L12, 40s rest',
    ])
  })
})
