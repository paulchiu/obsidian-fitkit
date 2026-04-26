/* eslint-disable import/no-nodejs-modules */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { ExerciseRegistryEntry } from '../src/exercise-registry'
import { createRegistry, resolve as resolveExercise } from '../src/exercise-registry'
import { parseJournal } from '../src/journal-grammar'
import type { WorkoutNoteModel } from '../src/workout-note-model'
import { parseWorkoutNote, semanticEqual, serializeWorkoutNote } from '../src/workout-note-model'
import type { CanonicalWorkout } from '../src/workout-note-serializer'
import { serializeWorkout } from '../src/workout-note-serializer'

const here = fileURLToPath(new URL('.', import.meta.url))
function fixture(rel: string): string {
  return readFileSync(resolve(here, 'fixtures', rel), 'utf8')
}

const workoutFixtures = [
  'workouts/2026-04-19.md',
  'workouts/2026-04-09.md',
  'workouts/2026-03-16.md',
  'workouts/2026-03-25.md',
  'workouts/2026-04-08.md',
  'workouts/fence-block.md',
] as const

function expectWorkoutModel(source: string, sourcePath: string): WorkoutNoteModel {
  const result = parseWorkoutNote(source, sourcePath)
  expect(result.isWorkout).toBe(true)
  expect(result.model).not.toBeNull()
  if (!result.model) {
    throw new Error(`${sourcePath} did not parse as a workout`)
  }
  return result.model
}

describe('workout note model', () => {
  it.each(workoutFixtures)('round-trips %s semantically', (path) => {
    const model = expectWorkoutModel(fixture(path), path)
    const serialized = serializeWorkoutNote(model)
    const reparsed = expectWorkoutModel(serialized, path)

    expect(semanticEqual(model, reparsed)).toBe(true)
  })

  it('warns when a workout fixture skips strength set numbers', () => {
    const result = parseWorkoutNote(fixture('workouts/2026-03-25.md'), 'workouts/2026-03-25.md')

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some((warning) => warning.includes('set'))).toBe(true)
  })

  it('warns before dropping strength data when an exercise mixes row kinds', () => {
    const result = parseWorkoutNote(
      [
        '---',
        'type: workout',
        'date: 2026-04-24',
        'name: Mixed Rows',
        '---',
        '',
        '## [[Squat]]',
        '',
        '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
        '- [exercise:: [[Squat]]] [duration:: 60]',
      ].join('\n'),
      'mixed-rows.md',
    )

    expect(
      result.warnings.some(
        (warning) => warning.includes('dropping') && warning.includes('strength'),
      ),
    ).toBe(true)
  })

  it('preserves fenced blocks in serialized output', () => {
    const model = expectWorkoutModel(fixture('workouts/fence-block.md'), 'workouts/fence-block.md')
    const serialized = serializeWorkoutNote(model)

    expect(serialized).toContain('Note block: this should be preserved verbatim.')
  })

  it('preserves multiple fenced blocks in original relative order', () => {
    const model = expectWorkoutModel(
      [
        '---',
        'type: workout',
        'date: 2026-04-24',
        'name: Multi Fence',
        '---',
        '',
        '## [[Squat]]',
        '',
        '```txt',
        'FENCE_ONE_BODY',
        '```',
        '```txt',
        'FENCE_TWO_BODY',
        '```',
        '- [exercise:: [[Squat]]] [set:: 1] [weight:: 10] [reps:: 10]',
      ].join('\n'),
      'multi-fence.md',
    )
    const serialized = serializeWorkoutNote(model)
    const firstFenceIndex = serialized.indexOf('FENCE_ONE_BODY')
    const secondFenceIndex = serialized.indexOf('FENCE_TWO_BODY')
    const reparsed = expectWorkoutModel(serialized, 'multi-fence.md')

    expect(firstFenceIndex).toBeGreaterThanOrEqual(0)
    expect(secondFenceIndex).toBeGreaterThanOrEqual(0)
    expect(firstFenceIndex).toBeLessThan(secondFenceIndex)
    expect(semanticEqual(model, reparsed)).toBe(true)
  })

  it('serializes blank strength sets without zero weight or reps', () => {
    const serialized = serializeWorkoutNote({
      date: '2026-04-24',
      name: 'Blank Set',
      sourcePath: 'blank-set.md',
      preserveBlocks: [],
      exercises: [
        {
          exerciseName: 'Squat',
          kind: 'strength',
          strengthSets: [
            { set: 1, weight: 10, reps: 10 },
            { set: 2, weight: 20, reps: 8 },
            { set: 3 },
          ],
        },
      ],
    })

    expect(serialized).toContain('- [exercise:: [[Squat]]] [set:: 3]\n')
    expect(serialized).not.toContain('[set:: 3] [weight:: 0]')
    expect(serialized).not.toContain('[set:: 3] [reps:: 0]')
  })

  it('reports non-workout markdown without a model', () => {
    const result = parseWorkoutNote('hello world', 'x')

    expect(result.isWorkout).toBe(false)
    expect(result.model).toBeNull()
  })

  it('serializes parsed journal input into canonical workout markdown', () => {
    const parsed = parseJournal(fixture('journals/sample-strength.md'))
    const entries: ExerciseRegistryEntry[] = parsed.exercises.map((exercise) => ({
      name: exercise.rawName,
      kind: 'strength',
      aliases: [],
    }))
    const registry = createRegistry(entries)
    const workout: CanonicalWorkout = {
      name: parsed.name,
      date: '2026-04-24',
      exercises: parsed.exercises.map((exercise) => {
        const resolution = resolveExercise(registry, exercise.rawName)
        if (resolution.kind !== 'match') {
          throw new Error(`${exercise.rawName} did not resolve`)
        }
        return {
          canonicalName: resolution.entry.name,
          note: exercise.note,
          rows: exercise.rows,
        }
      }),
    }

    const result = parseWorkoutNote(serializeWorkout(workout), 'imported.md')

    expect(result.isWorkout).toBe(true)
    expect(result.model?.exercises).toHaveLength(3)
  })
})
