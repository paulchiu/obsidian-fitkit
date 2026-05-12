import { describe, expect, it } from 'vitest'

import { DEFAULT_WEIGHT_UNIT, parseWeightUnit, type WeightUnit } from '../../src/domain/weight-unit'

describe('weight unit', () => {
  it('defaults to kg', () => {
    expect(DEFAULT_WEIGHT_UNIT satisfies WeightUnit).toBe('kg')
  })

  it('parses known weight units case-insensitively', () => {
    expect(parseWeightUnit(' kg ')).toBe('kg')
    expect(parseWeightUnit('LBS')).toBe('lbs')
  })

  it('rejects non-string and unknown values', () => {
    expect(parseWeightUnit(null)).toBeNull()
    expect(parseWeightUnit('stone')).toBeNull()
  })
})
