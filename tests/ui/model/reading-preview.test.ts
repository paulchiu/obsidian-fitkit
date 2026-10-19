import { describe, expect, it } from 'vitest'

import type { ExerciseEntry } from '../../../src/domain/workout-note-model'
import { buildReadingPreview } from '../../../src/ui/model/reading-preview'

const durationRows = (seconds: Array<number | undefined>): ExerciseEntry =>
  ({
    kind: 'duration',
    exerciseName: 'Plank',
    durationEntries: seconds.map((durationSeconds) => ({ durationSeconds })),
  }) as unknown as ExerciseEntry

const cells = (exercise: ExerciseEntry, column: number): string[] => {
  const { table } = buildReadingPreview(exercise, 'kg', undefined)
  return 'rows' in table ? table.rows.map((row) => row[column] ?? '') : []
}

describe('reading preview text', () => {
  it('formats durations across minute and hour boundaries', () => {
    expect(cells(durationRows([undefined, 1, 45, 60, 65, 3600, 3660]), 1)).toEqual([
      '-',
      '1s',
      '45s',
      '1m',
      '1m5s',
      '1h',
      '1h1m',
    ])
  })

  it('numbers duration rows that carry no set number', () => {
    expect(cells(durationRows([30, 40]), 0)).toEqual(['1', '2'])
  })

  it('writes weights with the unit and missing reps as a dash', () => {
    const strength = {
      kind: 'strength',
      exerciseName: 'Squat',
      strengthSets: [
        { set: 1, weight: 100, reps: 5 },
        { set: 2, weight: Number.NaN },
      ],
    } as unknown as ExerciseEntry

    expect(buildReadingPreview(strength, 'lbs', undefined).table).toEqual({
      headings: ['Set', 'Weight', 'Reps', 'Notes'],
      rows: [
        ['1', '100 lbs', '5', '-'],
        ['2', '-', '-', '-'],
      ],
    })
  })

  it('labels the type and counts the rows', () => {
    const preview = buildReadingPreview(durationRows([30]), 'kg', undefined)

    expect([preview.typeLabel, preview.rowCountLabel]).toEqual(['Duration', '1 row'])
  })
})
