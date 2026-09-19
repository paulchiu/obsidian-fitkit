import { describe, expect, it } from 'vitest'

import {
  EXERCISE_KINDS,
  EXERCISE_KIND_LABELS,
  parseExerciseKind,
  type ExerciseKind,
} from '../../src/domain/exercise-kind'
import type { ExerciseKind as RegistryExerciseKind } from '../../src/domain/exercise-registry'
import type { ExerciseIndexRow } from '../../src/domain/types'
import type { ExerciseKind as ModelExerciseKind } from '../../src/domain/workout-note-model'

describe('exercise kind', () => {
  it('declares strength and duration as the only kinds', () => {
    expect([...EXERCISE_KINDS] satisfies ExerciseKind[]).toEqual(['strength', 'duration'])
  })

  it('labels every kind without deriving the display name from the wire value', () => {
    expect(EXERCISE_KIND_LABELS satisfies Record<ExerciseKind, string>).toEqual({
      strength: 'Strength',
      duration: 'Duration',
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

  it('is the single ExerciseKind behind the registry and model aliases', () => {
    const viaRegistry: readonly RegistryExerciseKind[] = EXERCISE_KINDS
    const viaModel: readonly ModelExerciseKind[] = EXERCISE_KINDS
    expect([...viaRegistry, ...viaModel]).toEqual(['strength', 'duration', 'strength', 'duration'])
  })

  it('accepts the kind carried by an exercise index row', () => {
    const row: ExerciseIndexRow = { exerciseName: 'Squat', kind: 'strength' }

    expect(parseExerciseKind(row.kind)).toBe('strength')
  })
})
