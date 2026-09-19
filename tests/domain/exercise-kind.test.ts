import { describe, expect, it } from 'vitest'

import {
  EXERCISE_KINDS,
  EXERCISE_KIND_LABELS,
  parseExerciseKind,
  type ExerciseKind,
} from '../../src/domain/exercise-kind'
import type { ExerciseIndexRow } from '../../src/domain/types'

describe('exercise kind', () => {
  it('declares strength, duration and bodyweight as the kinds in order', () => {
    expect([...EXERCISE_KINDS] satisfies ExerciseKind[]).toEqual([
      'strength',
      'duration',
      'bodyweight',
    ])
  })

  it('provides a display label for every kind', () => {
    // At three kinds a literal table and a derived one produce identical values, so this pins the labels, not their source.
    expect(EXERCISE_KIND_LABELS satisfies Record<ExerciseKind, string>).toEqual({
      strength: 'Strength',
      duration: 'Duration',
      bodyweight: 'Bodyweight',
    })
  })

  it('parses known exercise kinds case-insensitively', () => {
    expect(parseExerciseKind(' strength ')).toBe('strength')
    expect(parseExerciseKind('DURATION')).toBe('duration')
  })

  it('rejects non-string and unknown values', () => {
    expect(parseExerciseKind(null)).toBeNull()
    expect(parseExerciseKind(42)).toBeNull()
    expect(parseExerciseKind('cardio')).toBeNull()
  })

  it('accepts the kind carried by an exercise index row', () => {
    const row: ExerciseIndexRow = { exerciseName: 'Squat', kind: 'strength' }

    expect(parseExerciseKind(row.kind)).toBe('strength')
  })
})
