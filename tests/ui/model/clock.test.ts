import { describe, expect, it } from 'vitest'

import { formatClock } from '../../../src/ui/model/clock'

describe('formatClock', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [59.2, '1:00'],
    [75, '1:15'],
    [600, '10:00'],
    [-3, '0:00'],
  ])('shows %s seconds as %s', (seconds, text) => {
    expect(formatClock(seconds)).toBe(text)
  })
})
