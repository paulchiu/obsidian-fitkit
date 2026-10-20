import { describe, expect, it } from 'vitest'

import {
  parsePlanStep,
  planStepLabel,
  planStepPlaceholder,
  planStepTitle,
} from '../../../src/ui/model/plan-step'

describe('plan step wording', () => {
  it('speaks of rungs for bodyweight and weight for the rest', () => {
    expect([
      planStepTitle('Push-up', 'bodyweight'),
      planStepLabel('bodyweight'),
      planStepPlaceholder('bodyweight'),
      planStepTitle('Squat', 'strength'),
      planStepLabel('duration'),
      planStepPlaceholder('strength'),
    ]).toEqual([
      'Rung change for Push-up',
      'Rung change',
      'rungs',
      'Weight change for Squat',
      'Weight change',
      'kg',
    ])
  })
})

describe('parsePlanStep', () => {
  it.each([
    ['2.5', 2.5],
    [' 5 ', 5],
    ['', undefined],
    ['0', undefined],
    ['-1', undefined],
    ['heavy', undefined],
    ['Infinity', undefined],
  ])('reads %j as %j', (raw, expected) => {
    expect(parsePlanStep(raw)).toBe(expected)
  })
})
