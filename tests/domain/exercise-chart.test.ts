import { describe, expect, it } from 'vitest'

import {
  buildExerciseChartSeries,
  niceRange,
  pickXTickIndices,
} from '../../src/domain/exercise-chart'
import { createRegistry } from '../../src/domain/exercise-registry'
import type { ExerciseIndexRow, FitKitIndex, IndexEntry } from '../../src/domain/types'
import {
  chartYAxisTitle,
  formatChartTooltip,
  formatChartValue,
} from '../../src/ui/exercise-chart-svg'

function fitKitIndex(entries: IndexEntry[]): FitKitIndex {
  return {
    schemaVersion: 1,
    builtAt: 0,
    entries,
    diagnostics: [],
  }
}

function entry(path: string, date: string, exercises: ExerciseIndexRow[]): IndexEntry {
  return {
    path,
    date,
    mtime: 1,
    name: path,
    exercises,
  }
}

describe('buildExerciseChartSeries', () => {
  const registry = createRegistry([
    {
      name: 'Bench Press',
      kind: 'strength',
      aliases: ['Bench', 'BB Bench'],
    },
    {
      name: 'Plank',
      kind: 'duration',
      aliases: ['Front Plank'],
    },
  ])

  it('returns empty series when the index has no entries', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([]),
      registry,
      'Bench Press',
      'strength',
      30,
      'weight',
    )
    expect(series.points).toEqual([])
    expect(series.totalDates).toBe(0)
    expect(series.unit).toBe('kg')
    expect(series.kind).toBe('strength')
  })

  it('plots one point per workout date for strength using maxWeightSet', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01.md', '2026-04-01', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 80, reps: 5 } },
        ]),
        entry('w/2026-04-03.md', '2026-04-03', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 85, reps: 3 } },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      30,
      'weight',
    )
    expect(series.points).toEqual([
      { date: '2026-04-01', value: 80, workoutPath: 'w/2026-04-01.md' },
      { date: '2026-04-03', value: 85, workoutPath: 'w/2026-04-03.md' },
    ])
    expect(series.totalDates).toBe(2)
  })

  it('plots one point per workout date for duration using totalDurationSeconds', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01.md', '2026-04-01', [
          { exerciseName: 'Plank', kind: 'duration', totalDurationSeconds: 120 },
        ]),
      ]),
      registry,
      'Plank',
      'duration',
      30,
    )
    expect(series.points).toEqual([
      { date: '2026-04-01', value: 120, workoutPath: 'w/2026-04-01.md' },
    ])
    expect(series.unit).toBe('s')
  })

  it('filters by kind: duration rows ignored when querying strength', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01.md', '2026-04-01', [
          { exerciseName: 'Bench Press', kind: 'duration', totalDurationSeconds: 60 },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      30,
      'weight',
    )
    expect(series.points).toEqual([])
  })

  it('matches by normalized name regardless of case', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01.md', '2026-04-01', [
          { exerciseName: 'bench press', kind: 'strength', maxWeightSet: { weight: 80, reps: 5 } },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      30,
      'weight',
    )
    expect(series.points).toHaveLength(1)
  })

  it('matches via registry aliases (workouts logged under an alias appear on the canonical chart)', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01.md', '2026-04-01', [
          { exerciseName: 'Bench', kind: 'strength', maxWeightSet: { weight: 70, reps: 5 } },
        ]),
        entry('w/2026-04-02.md', '2026-04-02', [
          {
            exerciseName: 'BB Bench',
            kind: 'strength',
            maxWeightSet: { weight: 75, reps: 5 },
          },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      30,
      'weight',
    )
    expect(series.points.map((point) => point.value)).toEqual([70, 75])
  })

  it('falls back to normalize-only matching for an unregistered name', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01.md', '2026-04-01', [
          { exerciseName: 'Mystery Lift', kind: 'strength', maxWeightSet: { weight: 50, reps: 5 } },
        ]),
      ]),
      createRegistry([]),
      'Mystery Lift',
      'strength',
      30,
      'weight',
    )
    expect(series.points).toHaveLength(1)
  })

  it('aggregates same-date workouts to the max value, recording the contributing workout path', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01-A.md', '2026-04-01', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 70, reps: 5 } },
        ]),
        entry('w/2026-04-01-B.md', '2026-04-01', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 90, reps: 1 } },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      30,
      'weight',
    )
    expect(series.points).toEqual([
      { date: '2026-04-01', value: 90, workoutPath: 'w/2026-04-01-B.md' },
    ])
    expect(series.totalDates).toBe(1)
  })

  it('plots e1rm by picking the highest estimated max per workout date', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01-A.md', '2026-04-01', [
          {
            exerciseName: 'Bench Press',
            kind: 'strength',
            bestSet: { weight: 100, reps: 3, e1rm: 0 },
            maxWeightSet: { weight: 100, reps: 3 },
          },
        ]),
        entry('w/2026-04-01-B.md', '2026-04-01', [
          {
            exerciseName: 'Bench Press',
            kind: 'strength',
            bestSet: { weight: 90, reps: 8, e1rm: 0 },
            maxWeightSet: { weight: 90, reps: 8 },
          },
        ]),
        entry('w/2026-04-08.md', '2026-04-08', [
          {
            exerciseName: 'Bench Press',
            kind: 'strength',
            bestSet: { weight: 105, reps: 5, e1rm: 0 },
            maxWeightSet: { weight: 105, reps: 5 },
          },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      30,
      'e1rm',
    )

    expect(series.metric).toBe('e1rm')
    expect(
      series.points.map((point) => ({ date: point.date, workoutPath: point.workoutPath })),
    ).toEqual([
      { date: '2026-04-01', workoutPath: 'w/2026-04-01-B.md' },
      { date: '2026-04-08', workoutPath: 'w/2026-04-08.md' },
    ])
    expect(series.points[0]?.value).toBeCloseTo(114)
    expect(series.points[1]?.value).toBeCloseTo(122.5)
  })

  it('defaults strength series to e1rm when no metric is supplied', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01.md', '2026-04-01', [
          {
            exerciseName: 'Bench Press',
            kind: 'strength',
            bestSet: { weight: 100, reps: 10, e1rm: 0 },
            maxWeightSet: { weight: 120, reps: 1 },
          },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      30,
    )

    expect(series.metric).toBe('e1rm')
    expect(series.points[0]?.value).toBeCloseTo(133.3333333333)
  })

  it('formats e1rm chart axis values and tooltips without kg', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01.md', '2026-04-01', [
          {
            exerciseName: 'Bench Press',
            kind: 'strength',
            bestSet: { weight: 90, reps: 8, e1rm: 0 },
          },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      30,
      'e1rm',
    )
    const point = series.points[0]
    if (!point) {
      throw new Error('Expected chart point')
    }

    expect(chartYAxisTitle(series)).toBe('e1rm')
    expect(formatChartValue(point.value, series)).toBe('114.0')
    expect(formatChartTooltip(point.date, point.value, series)).toBe('2026-04-01: e1rm 114.0')
  })

  it('breaks same-date same-value ties on lexicographic workoutPath', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01-B.md', '2026-04-01', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 80, reps: 5 } },
        ]),
        entry('w/2026-04-01-A.md', '2026-04-01', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 80, reps: 5 } },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      30,
      'weight',
    )
    expect(series.points[0]?.workoutPath).toBe('w/2026-04-01-A.md')
  })

  it('counts totalDates as distinct date buckets, not raw rows', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01-A.md', '2026-04-01', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 70, reps: 5 } },
        ]),
        entry('w/2026-04-01-B.md', '2026-04-01', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 75, reps: 5 } },
        ]),
        entry('w/2026-04-02.md', '2026-04-02', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 80, reps: 5 } },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      30,
      'weight',
    )
    expect(series.totalDates).toBe(2)
  })

  it('windows to the most recent N dates, sorted ascending', () => {
    const dates = Array.from({ length: 5 }, (_unused, index) => {
      const day = String(index + 1).padStart(2, '0')
      return `2026-04-${day}`
    })
    const entries = dates.map((date, index) =>
      entry(`w/${date}.md`, date, [
        {
          exerciseName: 'Bench Press',
          kind: 'strength',
          maxWeightSet: { weight: 70 + index, reps: 5 },
        },
      ]),
    )
    const series = buildExerciseChartSeries(
      fitKitIndex(entries),
      registry,
      'Bench Press',
      'strength',
      3,
      'weight',
    )
    expect(series.points.map((point) => point.date)).toEqual([
      '2026-04-03',
      '2026-04-04',
      '2026-04-05',
    ])
    expect(series.totalDates).toBe(5)
    expect(series.windowRequested).toBe(3)
  })

  it('window: 1 returns the single most recent point', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01.md', '2026-04-01', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 70, reps: 5 } },
        ]),
        entry('w/2026-04-02.md', '2026-04-02', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 75, reps: 5 } },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      1,
      'weight',
    )
    expect(series.points).toEqual([
      { date: '2026-04-02', value: 75, workoutPath: 'w/2026-04-02.md' },
    ])
  })

  it('skips strength rows with missing or non-positive weight', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01.md', '2026-04-01', [{ exerciseName: 'Bench Press', kind: 'strength' }]),
        entry('w/2026-04-02.md', '2026-04-02', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 0, reps: 5 } },
        ]),
        entry('w/2026-04-03.md', '2026-04-03', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 75, reps: 5 } },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      30,
      'weight',
    )
    expect(series.points).toEqual([
      { date: '2026-04-03', value: 75, workoutPath: 'w/2026-04-03.md' },
    ])
  })

  it('skips strength rows where weight is NaN or non-finite', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01.md', '2026-04-01', [
          {
            exerciseName: 'Bench Press',
            kind: 'strength',
            maxWeightSet: { weight: Number.NaN, reps: 5 },
          },
        ]),
        entry('w/2026-04-02.md', '2026-04-02', [
          {
            exerciseName: 'Bench Press',
            kind: 'strength',
            maxWeightSet: { weight: Number.POSITIVE_INFINITY, reps: 5 },
          },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      30,
      'weight',
    )
    expect(series.points).toEqual([])
  })

  it('skips duration rows where totalDurationSeconds is missing, zero, NaN, or non-finite', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-01.md', '2026-04-01', [{ exerciseName: 'Plank', kind: 'duration' }]),
        entry('w/2026-04-02.md', '2026-04-02', [
          { exerciseName: 'Plank', kind: 'duration', totalDurationSeconds: 0 },
        ]),
        entry('w/2026-04-03.md', '2026-04-03', [
          { exerciseName: 'Plank', kind: 'duration', totalDurationSeconds: Number.NaN },
        ]),
        entry('w/2026-04-04.md', '2026-04-04', [
          {
            exerciseName: 'Plank',
            kind: 'duration',
            totalDurationSeconds: Number.POSITIVE_INFINITY,
          },
        ]),
        entry('w/2026-04-05.md', '2026-04-05', [
          { exerciseName: 'Plank', kind: 'duration', totalDurationSeconds: 60 },
        ]),
      ]),
      registry,
      'Plank',
      'duration',
      30,
    )
    expect(series.points).toEqual([
      { date: '2026-04-05', value: 60, workoutPath: 'w/2026-04-05.md' },
    ])
  })

  it('sorts points ascending even when index entries are out of order', () => {
    const series = buildExerciseChartSeries(
      fitKitIndex([
        entry('w/2026-04-03.md', '2026-04-03', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 80, reps: 5 } },
        ]),
        entry('w/2026-04-01.md', '2026-04-01', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 70, reps: 5 } },
        ]),
        entry('w/2026-04-02.md', '2026-04-02', [
          { exerciseName: 'Bench Press', kind: 'strength', maxWeightSet: { weight: 75, reps: 5 } },
        ]),
      ]),
      registry,
      'Bench Press',
      'strength',
      30,
      'weight',
    )
    expect(series.points.map((point) => point.date)).toEqual([
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
    ])
  })
})

describe('niceRange', () => {
  it('returns a sensible default for no values', () => {
    expect(niceRange([])).toEqual({ min: 0, max: 1 })
  })

  it('expands a single value to a non-zero band', () => {
    const range = niceRange([100])
    expect(range.min).toBeLessThan(100)
    expect(range.max).toBeGreaterThan(100)
  })

  it('returns 0..1 when all values are zero', () => {
    expect(niceRange([0, 0, 0])).toEqual({ min: 0, max: 1 })
  })

  it('rounds bounds onto nice step multiples for a typical range', () => {
    const range = niceRange([47, 103])
    expect(range).toEqual({ min: 40, max: 120 })
  })
})

describe('pickXTickIndices', () => {
  it('returns no indices when count is zero', () => {
    expect(pickXTickIndices(0)).toEqual([])
  })

  it('returns every index when count is small', () => {
    expect(pickXTickIndices(5)).toEqual([0, 1, 2, 3, 4])
  })

  it('returns five indices at first, last, and evenly-spaced midpoints for a dense series', () => {
    expect(pickXTickIndices(30)).toEqual([0, 7, 15, 22, 29])
  })

  it('returns five indices for a 20-point series', () => {
    expect(pickXTickIndices(20)).toEqual([0, 5, 10, 14, 19])
  })
})
