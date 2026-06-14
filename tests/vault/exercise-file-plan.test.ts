import { describe, expect, it } from 'vitest'

import { exerciseFilePathForName, planExerciseFileOpen } from '../../src/vault/exercise-file-plan'

describe('exercise file plan', () => {
  const baseInput = {
    name: 'Squat',
    kind: 'strength' as const,
    registryEntries: [],
    exercisesFolderPath: 'Fitness/Exercises',
    workoutsFolderPath: 'Fitness/Workouts',
    sourcePath: 'Fitness/Workouts/2026-06-15.md',
  }

  it('plans to open an existing exercise note', () => {
    expect(planExerciseFileOpen({ ...baseInput, noteExists: true })).toEqual({
      kind: 'open',
      path: 'Fitness/Exercises/Squat.md',
      sourcePath: 'Fitness/Workouts/2026-06-15.md',
    })
  })

  it('plans to create a missing exercise note with the card kind', () => {
    expect(
      planExerciseFileOpen({
        ...baseInput,
        name: 'Jump rope',
        kind: 'duration',
        noteExists: false,
      }),
    ).toEqual({
      kind: 'create',
      path: 'Fitness/Exercises/Jump rope.md',
      sourcePath: 'Fitness/Workouts/2026-06-15.md',
      name: 'Jump rope',
      exerciseKind: 'duration',
      workoutsFolderPath: 'Fitness/Workouts',
      unit: 'kg',
    })
  })

  it('uses the merged registry unit when creating a strength note', () => {
    expect(
      planExerciseFileOpen({
        ...baseInput,
        noteExists: false,
        registryEntries: [
          {
            name: 'Squat',
            kind: 'strength',
            unit: 'lbs',
            aliases: ['Back squat'],
          },
        ],
      }),
    ).toMatchObject({
      kind: 'create',
      unit: 'lbs',
    })
  })

  it('trims the exercise name and folder slash for the canonical note path', () => {
    expect(exerciseFilePathForName('  Squat  ', 'Fitness/Exercises/')).toBe(
      'Fitness/Exercises/Squat.md',
    )
  })

  it('returns an error intent when the exercise name is blank', () => {
    expect(planExerciseFileOpen({ ...baseInput, name: '  ', noteExists: false })).toEqual({
      kind: 'error',
      message: 'Cannot open an exercise file without an exercise name.',
    })
  })
})
