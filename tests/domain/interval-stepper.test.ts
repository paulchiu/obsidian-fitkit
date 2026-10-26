import { describe, expect, it } from 'vitest'

import { parseStepperStep } from '../../src/domain/interval-stepper'

describe('parseStepperStep', () => {
  it.each([
    ['10%', { kind: 'percent', percent: 10 }],
    [' 2.5 % ', { kind: 'percent', percent: 2.5 }],
    ['5', { kind: 'amount', amount: 5 }],
    ['2.5', { kind: 'amount', amount: 2.5 }],
    ['0%', null],
    ['0', null],
    ['-5', null],
    ['1e3', null],
    ['', null],
  ])('reads %j as %j', (raw, step) => {
    expect(parseStepperStep(raw)).toEqual(step)
  })
})
