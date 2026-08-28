import { describe, expect, it } from 'vitest'

import {
  buildExerciseHistoryMap,
  formatExerciseHistoryBadges,
  formatNextPlanBadge,
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
        text: 'PB 100',
        title: 'Heaviest weight lifted (not 1RM): 100 kg x 1',
      },
      {
        text: 'last 95x8',
        title: 'Heaviest weight in latest prior session: 95 kg x 8 (2026-04-23)',
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
        text: 'PB 80',
        title: 'Heaviest weight lifted (not 1RM): 80 kg x 5',
      },
      {
        text: 'last 80x5',
        title: 'Heaviest weight in latest prior session: 80 kg x 5 (2026-04-22)',
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

  it('renders bodyweight-only strength history as reps', () => {
    const history = buildExerciseHistoryMap(
      fitKitIndex([
        entry('Fitness/Workouts/2026-04-20.md', '2026-04-20', [
          {
            exerciseName: 'Pull-up',
            kind: 'strength',
            maxWeightSet: { weight: 0, reps: 20 },
          },
        ]),
        entry('Fitness/Workouts/2026-04-22.md', '2026-04-22', [
          {
            exerciseName: 'Pull-up',
            kind: 'strength',
            maxWeightSet: { weight: 0, reps: 12 },
          },
        ]),
      ]),
      {
        sourcePath: 'Fitness/Workouts/2026-04-24.md',
        date: '2026-04-24',
      },
    )

    expect(formatExerciseHistoryBadges(history.get('Pull-up'), 'strength')).toEqual([
      {
        text: 'PB 20 reps',
        title: 'Heaviest weight lifted (not 1RM): 20 reps',
      },
      {
        text: 'last 12 reps',
        title: 'Heaviest weight in latest prior session: 12 reps (2026-04-22)',
      },
    ])
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
        text: 'PB 4m30s',
        title: 'Longest session total duration: 4m30s',
      },
      {
        text: 'last 4m',
        title: 'Latest prior session total duration: 4m (2026-04-22)',
      },
    ])
  })

  it('carries the most recent next-time plan forward', () => {
    const history = buildExerciseHistoryMap(
      fitKitIndex([
        entry('Fitness/Workouts/2026-08-03.md', '2026-08-03', [
          {
            exerciseName: 'Squat',
            kind: 'strength',
            maxWeightSet: { weight: 95, reps: 5 },
            next: { direction: 'down', step: 5 },
          },
        ]),
        entry('Fitness/Workouts/2026-08-10.md', '2026-08-10', [
          {
            exerciseName: 'Squat',
            kind: 'strength',
            maxWeightSet: { weight: 100, reps: 5 },
            next: { direction: 'up', step: 2.5 },
          },
        ]),
      ]),
      { sourcePath: 'Fitness/Workouts/2026-08-17.md', date: '2026-08-17' },
    )

    expect(history.get('Squat')?.nextPlan).toEqual({
      value: { direction: 'up', step: 2.5 },
      date: '2026-08-10',
    })
  })

  it('keeps a plan from an older session when later sessions recorded none', () => {
    const history = buildExerciseHistoryMap(
      fitKitIndex([
        entry('Fitness/Workouts/2026-05-01.md', '2026-05-01', [
          {
            exerciseName: 'Squat',
            kind: 'strength',
            maxWeightSet: { weight: 90, reps: 5 },
            next: { direction: 'up', step: 2.5 },
          },
        ]),
        entry('Fitness/Workouts/2026-08-10.md', '2026-08-10', [
          { exerciseName: 'Squat', kind: 'strength', maxWeightSet: { weight: 100, reps: 5 } },
        ]),
      ]),
      { sourcePath: 'Fitness/Workouts/2026-08-17.md', date: '2026-08-17' },
    )

    expect(history.get('Squat')?.nextPlan?.value).toEqual({ direction: 'up', step: 2.5 })
  })

  it('prefers the most recently written note when two sessions share a date', () => {
    const early: IndexEntry = {
      ...entry('Fitness/Workouts/2026-08-10 morning.md', '2026-08-10', [
        {
          exerciseName: 'Squat',
          kind: 'strength',
          maxWeightSet: { weight: 100, reps: 5 },
          next: { direction: 'up', step: 2.5 },
        },
      ]),
      mtime: 10,
    }
    const late: IndexEntry = {
      ...entry('Fitness/Workouts/2026-08-10 evening.md', '2026-08-10', [
        {
          exerciseName: 'Squat',
          kind: 'strength',
          maxWeightSet: { weight: 80, reps: 5 },
          next: { direction: 'down', step: 5 },
        },
      ]),
      mtime: 20,
    }

    const history = buildExerciseHistoryMap(fitKitIndex([early, late]), {
      sourcePath: 'Fitness/Workouts/2026-08-17.md',
      date: '2026-08-17',
    })

    expect(history.get('Squat')?.nextPlan?.value).toEqual({ direction: 'down', step: 5 })
  })

  it('shows the resulting weight when the plan carries a step', () => {
    const summary = {
      strength: { lastSessionMax: { value: { weight: 100, reps: 5 }, date: '2026-08-10' } },
      nextPlan: { value: { direction: 'up' as const, step: 2.5 }, date: '2026-08-10' },
    }

    expect(formatNextPlanBadge(summary, 'strength')).toEqual({
      text: 'Next: 102.5 kg',
      title: 'Planned on 2026-08-10: up 2.5 kg from 100 kg',
      icon: 'arrow-up',
    })
  })

  it('falls back to the direction when the plan carries no step', () => {
    const badge = formatNextPlanBadge(
      {
        strength: { lastSessionMax: { value: { weight: 100, reps: 5 }, date: '2026-08-10' } },
        nextPlan: { value: { direction: 'down' }, date: '2026-08-10' },
      },
      'strength',
    )

    expect(badge?.text).toBe('Next: down')
    expect(badge?.icon).toBe('arrow-down')
  })

  it('prefers a plan recorded on the open card, measured against that card own heaviest set', () => {
    expect(
      formatNextPlanBadge(
        {
          strength: { lastSessionMax: { value: { weight: 80, reps: 5 }, date: '2026-08-10' } },
          nextPlan: { value: { direction: 'down', step: 5 }, date: '2026-08-10' },
        },
        'strength',
        { plan: { direction: 'up', step: 2.5 }, sessionMax: { weight: 100, reps: 5 } },
      ),
    ).toEqual({
      text: 'Next: 102.5 kg',
      title: 'Planned for next time: up 2.5 kg from 100 kg',
      icon: 'arrow-up',
    })
  })

  it('measures a plan on a card with no completed set against the last session', () => {
    expect(
      formatNextPlanBadge(
        { strength: { lastSessionMax: { value: { weight: 100, reps: 5 }, date: '2026-08-10' } } },
        'strength',
        { plan: { direction: 'up', step: 2.5 } },
      ),
    ).toEqual({
      text: 'Next: 102.5 kg',
      title: 'Planned for next time: up 2.5 kg from 100 kg',
      icon: 'arrow-up',
    })
  })

  it('shows a plan recorded on a card that has no history at all', () => {
    const badge = formatNextPlanBadge(undefined, 'strength', {
      plan: { direction: 'up', step: 2.5 },
    })

    expect(badge?.text).toBe('Next: up 2.5 kg')
    expect(badge?.title).toBe('Planned for next time: up 2.5 kg')
  })

  it('has no plan badge for duration exercises or absent plans', () => {
    expect(
      formatNextPlanBadge(
        { nextPlan: { value: { direction: 'up' }, date: '2026-08-10' } },
        'duration',
      ),
    ).toBeNull()
    expect(formatNextPlanBadge({}, 'strength')).toBeNull()
    expect(formatNextPlanBadge(undefined, 'strength')).toBeNull()
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
