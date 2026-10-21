import { describe, expect, it } from 'vitest'

import { formatNumber, formatReps } from '../../src/domain/number-format'

describe('formatNumber', () => {
  it('prints integers without decimals', () => {
    expect(formatNumber(5)).toBe('5')
    expect(formatNumber(0)).toBe('0')
  })

  it('rounds to one decimal by default', () => {
    expect(formatNumber(2.5)).toBe('2.5')
    expect(formatNumber(2.25)).toBe('2.3')
    expect(formatNumber(2.04)).toBe('2')
  })

  it('honours a custom precision', () => {
    expect(formatNumber(2.25, 2)).toBe('2.25')
    expect(formatNumber(0.5, 2)).toBe('0.5')
    expect(formatNumber(1.234, 2)).toBe('1.23')
  })
})

describe('formatReps', () => {
  it('pluralises except for exactly one', () => {
    expect(formatReps(1)).toBe('1 rep')
    expect(formatReps(0)).toBe('0 reps')
    expect(formatReps(8)).toBe('8 reps')
    expect(formatReps(1.04)).toBe('1 rep')
    expect(formatReps(2.5)).toBe('2.5 reps')
  })
})
