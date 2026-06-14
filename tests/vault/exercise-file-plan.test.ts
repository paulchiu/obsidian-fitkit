import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', () => ({
  normalizePath: (path: string) => path.replace(/\/+/g, '/'),
}))

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
    expect(planExerciseFileOpen({ ...baseInput, noteExists: () => true })).toEqual({
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
        noteExists: () => false,
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
        noteExists: () => false,
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

  it('opens the canonical exercise note when the card name is an alias', () => {
    expect(
      planExerciseFileOpen({
        ...baseInput,
        name: 'Squat',
        noteExists: (path) => path === 'Fitness/Exercises/Back squat.md',
        registryEntries: [
          {
            name: 'Back squat',
            kind: 'strength',
            unit: 'lbs',
            aliases: ['Squat'],
          },
        ],
      }),
    ).toEqual({
      kind: 'open',
      path: 'Fitness/Exercises/Back squat.md',
      sourcePath: 'Fitness/Workouts/2026-06-15.md',
    })
  })

  it('creates the canonical exercise note when an alias has no existing note', () => {
    expect(
      planExerciseFileOpen({
        ...baseInput,
        name: 'Squat',
        noteExists: () => false,
        registryEntries: [
          {
            name: 'Back squat',
            kind: 'strength',
            unit: 'lbs',
            aliases: ['Squat'],
          },
        ],
      }),
    ).toEqual({
      kind: 'create',
      path: 'Fitness/Exercises/Back squat.md',
      sourcePath: 'Fitness/Workouts/2026-06-15.md',
      name: 'Back squat',
      exerciseKind: 'strength',
      workoutsFolderPath: 'Fitness/Workouts',
      unit: 'lbs',
    })
  })

  it('passes a normalized path to existence checks and intents', () => {
    const checkedPaths: string[] = []
    const plan = planExerciseFileOpen({
      ...baseInput,
      exercisesFolderPath: 'Fitness//Exercises/',
      noteExists: (path) => {
        checkedPaths.push(path)
        return false
      },
    })

    expect(checkedPaths).toEqual(['Fitness/Exercises/Squat.md'])
    expect(plan).toMatchObject({
      kind: 'create',
      path: 'Fitness/Exercises/Squat.md',
    })
  })

  it('trims the exercise name and folder slash for the canonical note path', () => {
    expect(exerciseFilePathForName('  Squat  ', 'Fitness/Exercises/')).toBe(
      'Fitness/Exercises/Squat.md',
    )
  })

  it('returns an error intent when the exercise name is blank', () => {
    expect(planExerciseFileOpen({ ...baseInput, name: '  ', noteExists: () => false })).toEqual({
      kind: 'error',
      message: 'Cannot open an exercise file without an exercise name.',
    })
  })
})
