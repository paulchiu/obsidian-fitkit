import { describe, expect, it } from 'vitest'

import { PLAN_EXAMPLES, planPreview, tidyPlan } from '../../../src/ui/model/plan-form'
import { parseIntervalProgram } from '../../../src/domain/interval-program'

describe('planPreview', () => {
  it('counts the reps and the time a plan comes to', () => {
    expect([
      planPreview('(x 8 (work 20s 400W) (rest 10s))', null),
      planPreview('(work 40s)', null),
    ]).toEqual([
      { ok: true, summary: '8 reps · 3m50s' },
      { ok: true, summary: '1 rep · 40s' },
    ])
  })

  it('gives the reason a plan cannot run', () => {
    expect(planPreview('(x 3 (over 1m 300W)', null)).toEqual({
      ok: false,
      reason: 'Missing ) to close (x.',
    })
  })

  it('puts a row problem ahead of a plan that would run', () => {
    expect(planPreview('(work 40s)', 'Give work a time.')).toEqual({
      ok: false,
      reason: 'Give work a time.',
    })
  })
})

describe('tidyPlan', () => {
  it('collapses spacing outside quoted names and spells a one-line plan the usual way', () => {
    expect([
      tidyPlan('(warmup 10m)\n   (x 3  (over 1m))'),
      tidyPlan('("big  gear" 2m)'),
      tidyPlan(' 6 x OPEN @ 120KG ,  every 2:00 '),
    ]).toEqual(['(warmup 10m) (x 3 (over 1m))', '("big  gear" 2m)', '6 x open @ 120kg, every 2m'])
  })
})

describe('PLAN_EXAMPLES', () => {
  it('only offers plans that run', () => {
    expect(PLAN_EXAMPLES.filter((example) => !parseIntervalProgram(example.plan).ok)).toEqual([])
  })
})
