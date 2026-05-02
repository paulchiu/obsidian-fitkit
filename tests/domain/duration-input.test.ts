import { describe, expect, it } from 'vitest'

import { formatDurationInput, parseDurationInput } from '../../src/domain/duration-input'

describe('duration input helpers', () => {
  it.each([
    [undefined, ''],
    [0, '0s'],
    [45, '45s'],
    [60, '1m0s'],
    [90, '1m30s'],
    [3600, '1h0m0s'],
    [3723, '1h2m3s'],
  ] as const)('formats %s seconds as %s', (seconds, expected) => {
    expect(formatDurationInput(seconds)).toBe(expected)
  })

  it.each([
    ['', { seconds: undefined, display: '' }],
    ['60', { seconds: 60, display: '1m0s' }],
    ['5m', { seconds: 300, display: '5m0s' }],
    ['5:30', { seconds: 330, display: '5m30s' }],
    ['1:02:03', { seconds: 3723, display: '1h2m3s' }],
    ['1h 2m 3s', { seconds: 3723, display: '1h2m3s' }],
    ['90s', { seconds: 90, display: '1m30s' }],
  ] as const)('parses %s', (raw, expected) => {
    expect(parseDurationInput(raw)).toEqual(expected)
  })

  it.each(['five', '5:99', '1:75:00', '1m2m', '1x', '5:'])(
    'rejects invalid duration input %s',
    (raw) => {
      expect(parseDurationInput(raw)).toBeNull()
    },
  )

  it('normalizes overlarge unit values through stored seconds', () => {
    expect(parseDurationInput('90m')).toEqual({ seconds: 5400, display: '1h30m0s' })
  })
})
