import { describe, expect, it } from 'vitest'

import { formatDurationInput, parseDurationInput } from '../../src/domain/duration-input'

describe('duration input helpers', () => {
  const minute = 60
  const hour = 60 * minute
  const day = 24 * hour
  const year = 365 * day

  it.each([
    [undefined, ''],
    [Number.NaN, ''],
    [-1, '0s'],
    [0, '0s'],
    [1, '1s'],
    [45, '45s'],
    [59, '59s'],
    [60, '1m'],
    [61, '1m1s'],
    [90, '1m30s'],
    [hour - 1, '59m59s'],
    [hour, '1h'],
    [hour + 1, '1h1s'],
    [hour + minute, '1h1m'],
    [3723, '1h2m3s'],
    [day - 1, '23h59m59s'],
    [day, '1d'],
    [day + 1, '1d1s'],
    [year - 1, '364d23h59m59s'],
    [year, '1y'],
    [year + minute + 1, '1y1m1s'],
    [2 * year + day + hour + minute + 1, '2y1d1h1m1s'],
  ] as const)('formats %s seconds as %s', (seconds, expected) => {
    expect(formatDurationInput(seconds)).toBe(expected)
  })

  it.each([
    ['', { seconds: undefined, display: '' }],
    ['60', { seconds: minute, display: '1m' }],
    ['5m', { seconds: 5 * minute, display: '5m' }],
    ['60m', { seconds: hour, display: '1h' }],
    ['24h', { seconds: day, display: '1d' }],
    ['365d', { seconds: year, display: '1y' }],
    ['1y2d3h4m5s', { seconds: year + 2 * day + 3 * hour + 4 * minute + 5, display: '1y2d3h4m5s' }],
    ['5:30', { seconds: 330, display: '5m30s' }],
    ['1:00:00', { seconds: hour, display: '1h' }],
    ['1:02:03', { seconds: hour + 2 * minute + 3, display: '1h2m3s' }],
    ['1h 2m 3s', { seconds: 3723, display: '1h2m3s' }],
    ['90s', { seconds: 90, display: '1m30s' }],
  ] as const)('parses %s', (raw, expected) => {
    expect(parseDurationInput(raw)).toEqual(expected)
  })

  it.each(['five', '5:99', '1:75:00', '1m2m', '1y2y', '1d2d', '1x', '5:'])(
    'rejects invalid duration input %s',
    (raw) => {
      expect(parseDurationInput(raw)).toBeNull()
    },
  )

  it('normalizes overlarge unit values through stored seconds', () => {
    expect(parseDurationInput('90m')).toEqual({ seconds: hour + 30 * minute, display: '1h30m' })
  })
})
