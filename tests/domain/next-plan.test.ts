import { describe, expect, it } from 'vitest'

import {
  formatNextPlan,
  formatNextPlanLabel,
  nextPlanTargetWeight,
  parseNextPlan,
} from '../../src/domain/next-plan'

describe('next plan parsing', () => {
  it('reads a bare direction', () => {
    expect(parseNextPlan('up')).toEqual({ direction: 'up' })
    expect(parseNextPlan('down')).toEqual({ direction: 'down' })
    expect(parseNextPlan('stay')).toEqual({ direction: 'stay' })
  })

  it('reads a direction with a step', () => {
    expect(parseNextPlan('up 2.5')).toEqual({ direction: 'up', step: 2.5 })
    expect(parseNextPlan('down 5')).toEqual({ direction: 'down', step: 5 })
  })

  it('tolerates casing and surrounding whitespace', () => {
    expect(parseNextPlan('  UP   2.5 ')).toEqual({ direction: 'up', step: 2.5 })
  })

  it('drops a step that is not a positive number', () => {
    expect(parseNextPlan('up soon')).toEqual({ direction: 'up' })
    expect(parseNextPlan('up 0')).toEqual({ direction: 'up' })
    expect(parseNextPlan('up -5')).toEqual({ direction: 'up' })
  })

  it('never keeps a step on stay', () => {
    expect(parseNextPlan('stay 2.5')).toEqual({ direction: 'stay' })
  })

  it('ignores values that do not start with a known direction', () => {
    expect(parseNextPlan('heavier')).toBeNull()
    expect(parseNextPlan('')).toBeNull()
    expect(parseNextPlan(undefined)).toBeNull()
  })
})

describe('next plan formatting', () => {
  it('round-trips through the inline field value', () => {
    for (const value of ['up', 'down 5', 'stay', 'up 2.5']) {
      const plan = parseNextPlan(value)
      expect(plan).not.toBeNull()
      expect(formatNextPlan(plan!)).toBe(value)
    }
  })

  it('labels plans in sentence case', () => {
    expect(formatNextPlanLabel({ direction: 'up', step: 2.5 })).toBe('Up 2.5')
    expect(formatNextPlanLabel({ direction: 'down' })).toBe('Down')
    expect(formatNextPlanLabel({ direction: 'stay' })).toBe('Same weight')
  })
})

describe('next plan targets', () => {
  it('applies the step in the planned direction', () => {
    expect(nextPlanTargetWeight({ direction: 'up', step: 2.5 }, 100)).toBe(102.5)
    expect(nextPlanTargetWeight({ direction: 'down', step: 5 }, 100)).toBe(95)
  })

  it('holds the base weight for stay', () => {
    expect(nextPlanTargetWeight({ direction: 'stay' }, 100)).toBe(100)
  })

  it('has no target without a step', () => {
    expect(nextPlanTargetWeight({ direction: 'up' }, 100)).toBeNull()
  })

  it('never plans a negative weight', () => {
    expect(nextPlanTargetWeight({ direction: 'down', step: 5 }, 2.5)).toBe(0)
  })
})
