import { describe, expect, it } from 'vitest'

import { defaultWorkoutName } from '../../src/domain/workout-name'

/** Friday 20 November 2026 at the given local hour and minute. */
const friday = (hours: number, minutes = 0): Date => new Date(2026, 10, 20, hours, minutes)

describe('defaultWorkoutName', () => {
  it('fills {{weekday}} with the full weekday', () => {
    expect(defaultWorkoutName('{{weekday}} workout', friday(7))).toBe('Friday workout')
  })
  it('fills {{date}} with the local date as yyyy-mm-dd', () => {
    expect(defaultWorkoutName('Session {{date}}', friday(7))).toBe('Session 2026-11-20')
  })
  it.each([
    { time: '05:00', expected: 'Morning' },
    { time: '11:59', expected: 'Morning' },
    { time: '12:00', expected: 'Afternoon' },
    { time: '16:59', expected: 'Afternoon' },
    { time: '17:00', expected: 'Evening' },
    { time: '20:59', expected: 'Evening' },
    { time: '21:00', expected: 'Night' },
    { time: '00:30', expected: 'Night' },
    { time: '04:59', expected: 'Night' },
  ])('fills {{time-of-day}} at $time with $expected', ({ time, expected }) => {
    const [hours = 0, minutes = 0] = time.split(':').map(Number)

    expect(defaultWorkoutName('{{time-of-day}} session', friday(hours, minutes))).toBe(
      `${expected} session`,
    )
  })
  it('leaves an unknown token as written', () => {
    expect(defaultWorkoutName('{{month}} {{weekday}}', friday(7))).toBe('{{month}} Friday')
  })

  it('trims the whitespace around the name', () => {
    expect(defaultWorkoutName('  Leg day  ', friday(7))).toBe('Leg day')
  })
})
