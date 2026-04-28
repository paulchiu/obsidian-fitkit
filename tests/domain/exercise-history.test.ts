import { describe, expect, it } from 'vitest'

import {
  buildExerciseHistoryMap,
  formatExerciseHistoryBadges,
  pickMaxWeightSet,
  resolveWorkoutAnchorDate,
} from '../../src/domain/exercise-history'
import type { ExerciseIndexRow, FitKitIndex, IndexEntry } from '../../src/domain/types'

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

describe('exercise history aggregation', () => {
  it('uses the highest absolute strength weight for PB and the latest prior session for Last', () => {
    const history = buildExerciseHistoryMap(
      fitKitIndex([
        entry('Fitness/Workouts/2026-04-20.md', '2026-04-20', [
          {
            exerciseName: 'Squat',
            kind: 'strength',
            maxWeightSet: { weight: 100, reps: 1 },
          },
        ]),
        entry('Fitness/Workouts/2026-04-22.md', '2026-04-22', [
          {
            exerciseName: 'Squat',
            kind: 'strength',
            maxWeightSet: { weight: 90, reps: 12 },
          },
        ]),
        entry('Fitness/Workouts/2026-04-23.md', '2026-04-23', [
          {
            exerciseName: 'Squat',
            kind: 'strength',
            maxWeightSet: { weight: 95, reps: 8 },
          },
        ]),
      ]),
      {
        sourcePath: 'Fitness/Workouts/2026-04-24.md',
        date: '2026-04-24',
      },
    )

    expect(history.get('Squat')?.strength?.lastSessionMax).toEqual({
      value: { weight: 95, reps: 8 },
      date: '2026-04-23',
    })
    expect(formatExerciseHistoryBadges(history.get('Squat'), 'strength')).toEqual([
      {
        text: 'PB 100 kg x 1',
        title: 'Heaviest weight lifted (not 1RM)',
      },
      {
        text: 'Last max: 95 kg x 8 (2026-04-23)',
        title: 'Heaviest weight in latest prior session',
      },
    ])
  })

  it('filters by the workout anchor date and excludes the current path', () => {
    const history = buildExerciseHistoryMap(
      fitKitIndex([
        entry('Fitness/Workouts/2026-04-22.md', '2026-04-22', [
          {
            exerciseName: 'Bench press',
            kind: 'strength',
            maxWeightSet: { weight: 80, reps: 5 },
          },
        ]),
        entry('Fitness/Workouts/2026-04-24 Draft.md', '2026-04-24', [
          {
            exerciseName: 'Bench press',
            kind: 'strength',
            maxWeightSet: { weight: 120, reps: 1 },
          },
        ]),
        entry('Fitness/Workouts/2026-04-25.md', '2026-04-25', [
          {
            exerciseName: 'Bench press',
            kind: 'strength',
            maxWeightSet: { weight: 100, reps: 3 },
          },
        ]),
      ]),
      {
        sourcePath: 'Fitness/Workouts/2026-04-24 Draft.md',
        date: '',
        today: '2026-04-27',
      },
    )

    expect(history.get('Bench press')?.strength?.lastSessionMax).toEqual({
      value: { weight: 80, reps: 5 },
      date: '2026-04-22',
    })
    expect(formatExerciseHistoryBadges(history.get('Bench press'), 'strength')).toEqual([
      {
        text: 'PB 80 kg x 5',
        title: 'Heaviest weight lifted (not 1RM)',
      },
      {
        text: 'Last max: 80 kg x 5 (2026-04-22)',
        title: 'Heaviest weight in latest prior session',
      },
    ])
  })

  it('returns no badges when there is no eligible history', () => {
    const history = buildExerciseHistoryMap(
      fitKitIndex([
        entry('Fitness/Workouts/2026-04-24.md', '2026-04-24', [
          {
            exerciseName: 'Curl',
            kind: 'strength',
            totalSets: 2,
          },
          {
            exerciseName: 'Plank',
            kind: 'duration',
            totalDurationSeconds: 0,
          },
        ]),
      ]),
      {
        sourcePath: 'Fitness/Workouts/2026-04-25.md',
        date: '2026-04-25',
      },
    )

    expect(history.has('Curl')).toBe(false)
    expect(history.has('Plank')).toBe(false)
    expect(formatExerciseHistoryBadges(history.get('Curl'), 'strength')).toEqual([])
  })

  it('uses session total duration for duration PB and Last', () => {
    const history = buildExerciseHistoryMap(
      fitKitIndex([
        entry('Fitness/Workouts/2026-04-20.md', '2026-04-20', [
          {
            exerciseName: 'Plank',
            kind: 'duration',
            totalDurationSeconds: 270,
          },
        ]),
        entry('Fitness/Workouts/2026-04-22.md', '2026-04-22', [
          {
            exerciseName: 'Plank',
            kind: 'duration',
            totalDurationSeconds: 240,
          },
        ]),
      ]),
      {
        sourcePath: 'Fitness/Workouts/2026-04-24.md',
        date: '2026-04-24',
      },
    )

    expect(formatExerciseHistoryBadges(history.get('Plank'), 'duration')).toEqual([
      {
        text: 'PB 270s',
        title: 'Longest session total duration',
      },
      {
        text: 'Last max: 240s (2026-04-22)',
        title: 'Latest prior session total duration',
      },
    ])
  })

  it('keeps zero-weight strength values and ignores missing strength values', () => {
    expect(pickMaxWeightSet([{ weight: 0, reps: 10 }, { weight: 50 }, { reps: 5 }])).toEqual({
      weight: 0,
      reps: 10,
    })
  })

  it('resolves the current workout anchor date from frontmatter, filename, then today', () => {
    expect(
      resolveWorkoutAnchorDate({
        sourcePath: 'Fitness/Workouts/2026-04-24 Draft.md',
        date: '2026-04-23',
        today: '2026-04-27',
      }),
    ).toBe('2026-04-23')
    expect(
      resolveWorkoutAnchorDate({
        sourcePath: 'Fitness/Workouts/2026-04-24 Draft.md',
        date: '',
        today: '2026-04-27',
      }),
    ).toBe('2026-04-24')
    expect(
      resolveWorkoutAnchorDate({
        sourcePath: 'Fitness/Workouts/Draft.md',
        date: '',
        today: '2026-04-27',
      }),
    ).toBe('2026-04-27')
  })
})
