import { describe, expect, it } from 'vitest'

import type { CanonicalExercise, CanonicalWorkout } from '../src/domain/workout-note-serializer'
import { serializeWorkout } from '../src/domain/workout-note-serializer'

function serializeExercise(exercise: CanonicalExercise): string {
  const workout: CanonicalWorkout = {
    name: 'Serializer Test',
    date: '2026-04-24',
    exercises: [exercise],
  }
  return serializeWorkout(workout)
}

describe('workout note serializer', () => {
  it('formats integer weights without trailing decimal noise', () => {
    const output = serializeExercise({
      canonicalName: 'Squat',
      note: '',
      rows: [{ kind: 'strength', weight: 10, reps: 10, raw: '10 x 10' }],
    })

    expect(output).toContain('[weight:: 10]')
    expect(output).not.toContain('[weight:: 10.0]')
  })

  it('keeps floating-point weights', () => {
    const output = serializeExercise({
      canonicalName: 'Squat',
      note: '',
      rows: [{ kind: 'strength', weight: 10.5, reps: 10, raw: '10.5 x 10' }],
    })

    expect(output).toContain('[weight:: 10.5]')
  })

  it('serializes duration rows in seconds', () => {
    const output = serializeExercise({
      canonicalName: 'Plank',
      note: '',
      rows: [{ kind: 'duration', seconds: 60, raw: '60s' }],
    })

    expect(output).toContain('[duration:: 60]')
  })

  it('numbers multi-set strength exercises from one', () => {
    const output = serializeExercise({
      canonicalName: 'Bench',
      note: '',
      rows: [
        { kind: 'strength', weight: 10, reps: 10, raw: '10 x 10' },
        { kind: 'strength', weight: 20, reps: 8, raw: '20 x 8' },
        { kind: 'strength', weight: 30, reps: 6, raw: '30 x 6' },
      ],
    })

    expect(output).toContain('[set:: 1]')
    expect(output).toContain('[set:: 2]')
    expect(output).toContain('[set:: 3]')
  })

  it('serializes exercise notes as Dataview notes fields', () => {
    const output = serializeExercise({
      canonicalName: 'Squat',
      note: 'Keep chest tall',
      rows: [{ kind: 'strength', weight: 10, reps: 10, raw: '10 x 10' }],
    })

    expect(output).toContain('[notes:: Keep chest tall]')
  })
})
