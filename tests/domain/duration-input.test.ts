import { describe, expect, it } from 'vitest'

import { formatDurationInput, parseDurationInput } from '../../src/domain/duration-input'

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
    ['90', 90],
    ['90s', 90],
    ['90 sec', 90],
    ['3min', 180],
    ['3 minutes', 180],
    ['1.5h', 5400],
    ['1h 2m 3s', 3723],
    ['1 hour, 2 minutes and 3 seconds', 3723],
    ['1:30', 90],
    ['1:02:03', 3723],
  ] as const)('parses %s as %s seconds', (input, expected) => {
    expect(parseDurationInput(input)).toBe(expected)
  })

  it.each(['', '   ', 'soon', '1:75', '1:70:00', '3min later'])('rejects %s', (input) => {
    expect(parseDurationInput(input)).toBeNull()
  })
})
