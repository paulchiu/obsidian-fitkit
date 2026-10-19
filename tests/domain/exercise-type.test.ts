import { describe, expect, it } from 'vitest'

import {
  EXERCISE_TYPES,
  EXERCISE_TYPE_LABELS,
  exerciseTypeOf,
  loggedTypeOf,
  kindOfType,
  parseExerciseType,
} from '../../src/domain/exercise-type'

describe('exercise type', () => {
  it('offers interval between duration and bodyweight', () => {
    expect([...EXERCISE_TYPES]).toEqual(['strength', 'duration', 'interval', 'bodyweight'])
    expect(EXERCISE_TYPE_LABELS.interval).toBe('Interval')
  })

  it('reads a duration exercise with the interval marker as interval', () => {
    expect(exerciseTypeOf({ kind: 'duration', interval: true })).toBe('interval')
    expect(exerciseTypeOf({ kind: 'duration' })).toBe('duration')
  })

  it('ignores the interval marker on a kind that is not duration', () => {
    expect(exerciseTypeOf({ kind: 'strength', interval: true })).toBe('strength')
  })

  it('stores interval as duration', () => {
    expect(kindOfType('interval')).toBe('duration')
    expect(kindOfType('bodyweight')).toBe('bodyweight')
  })

  it('parses types case-insensitively and rejects unknown values', () => {
    expect(parseExerciseType(' Interval ')).toBe('interval')
    expect(parseExerciseType('strength')).toBe('strength')
    expect(parseExerciseType('cardio')).toBeNull()
    expect(parseExerciseType(3)).toBeNull()
  })

  it('reads a logged duration exercise with a plan as interval', () => {
    expect(loggedTypeOf({ kind: 'duration', plan: '8 x 30s, 90s rest' })).toBe('interval')
    expect(loggedTypeOf({ kind: 'duration' })).toBe('duration')
    expect(loggedTypeOf({ kind: 'strength' })).toBe('strength')
  })
})
