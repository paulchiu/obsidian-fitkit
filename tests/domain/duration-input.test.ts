import { describe, expect, it } from 'vitest'

import {
  durationPartsFromSeconds,
  formatDurationInput,
  secondsFromDurationParts,
} from '../../src/domain/duration-input'

describe('duration input helpers', () => {
  it.each([
    [undefined, ''],
    [0, '0s'],
    [45, '45s'],
    [60, '1:00'],
    [90, '1:30'],
    [3600, '1:00:00'],
    [3723, '1:02:03'],
  ] as const)('formats %s seconds as %s', (seconds, expected) => {
    expect(formatDurationInput(seconds)).toBe(expected)
  })

  it.each([
    [undefined, { hours: 0, minutes: 0, seconds: 0 }],
    [45, { hours: 0, minutes: 0, seconds: 45 }],
    [90, { hours: 0, minutes: 1, seconds: 30 }],
    [3723, { hours: 1, minutes: 2, seconds: 3 }],
  ] as const)('splits %s seconds into parts', (seconds, expected) => {
    expect(durationPartsFromSeconds(seconds)).toEqual(expected)
  })

  it('combines structured duration parts into seconds', () => {
    expect(secondsFromDurationParts({ hours: 1, minutes: 2, seconds: 3 })).toBe(3723)
    expect(secondsFromDurationParts({ hours: 0, minutes: 90, seconds: 0 })).toBe(5400)
  })
})
