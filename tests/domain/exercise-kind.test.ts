import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  EXERCISE_KINDS,
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
    expectTypeOf<RegistryExerciseKind>().toEqualTypeOf<ExerciseKind>()
    expectTypeOf<ModelExerciseKind>().toEqualTypeOf<ExerciseKind>()
    const viaRegistry: readonly RegistryExerciseKind[] = EXERCISE_KINDS
    const viaModel: readonly ModelExerciseKind[] = EXERCISE_KINDS
    expect([...viaRegistry, ...viaModel]).toEqual(['strength', 'duration', 'strength', 'duration'])
  })

  it('is the kind of every exercise index row', () => {
    expectTypeOf<ExerciseIndexRow['kind']>().toEqualTypeOf<ExerciseKind>()
  })
})
