import { describe, expect, it } from 'vitest'

import type { FitKitIndex } from '../../src/domain/types'
import { composeDashboard } from '../../src/vault/dashboard'

const emptyIndex: FitKitIndex = {
  schemaVersion: 1,
  builtAt: 0,
  entries: [],
  diagnostics: [],
}

const mixedIndex: FitKitIndex = {
  schemaVersion: 1,
  builtAt: 0,
  entries: [
    {
      path: 'Fitness/Workouts/2026-04-24.md',
      mtime: 1,
      date: '2026-04-24',
      name: 'Workout',
      exercises: [
        {
          exerciseName: 'Squat',
          kind: 'strength',
          bestSet: {
            weight: 50,
            reps: 20,
            e1rm: 73.3333333333,
          },
          totalSets: 1,
        },
        {
          exerciseName: 'Plank',
          kind: 'duration',
          totalSets: 1,
          totalDurationSeconds: 120,
        },
      ],
    },
  ],
  diagnostics: [],
}

describe('dashboard composer', () => {
  it('renders an empty dashboard', () => {
    expect(
      composeDashboard(emptyIndex, 'Fitness/Workouts', 'Fitness/Exercises', new Set()),
    ).toMatch(/^# FitKit Dashboard/)
  })

  it('renders PBs and an exercise section for strength entries', () => {
    const markdown = composeDashboard(
      mixedIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('## PBs')
    expect(markdown).toContain('## Squat')
  })

  it('hides exercise sections by hidden key', () => {
    const markdown = composeDashboard(
      mixedIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(['exercise:Squat']),
    )

    expect(markdown).not.toContain('## Squat')
    expect(markdown).not.toContain('[[#Squat|Squat]]')
    expect(markdown).not.toContain('[[Fitness/Exercises/Squat|Squat]]')
  })

  it('is idempotent for the same index input', () => {
    expect(composeDashboard(mixedIndex, 'Fitness/Workouts', 'Fitness/Exercises', new Set())).toBe(
      composeDashboard(mixedIndex, 'Fitness/Workouts', 'Fitness/Exercises', new Set()),
    )
  })

  it('renders strength and duration exercise phrasing', () => {
    const markdown = composeDashboard(
      mixedIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('50 kg x 20')
    expect(markdown).toContain('e1rm 73.3')
    expect(markdown).toContain('total 120s across 1 session')
    expect(markdown).toContain('duration + "s" as Duration')
  })

  it('defaults strength PB ranking and display to e1rm', () => {
    const markdown = composeDashboard(
      {
        ...emptyIndex,
        entries: [
          {
            path: 'Fitness/Workouts/2026-04-24.md',
            mtime: 1,
            date: '2026-04-24',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Bench Press',
                kind: 'strength',
                bestSet: { weight: 90, reps: 10, e1rm: 120 },
                maxWeightSet: { weight: 105, reps: 1 },
                totalSets: 2,
              },
            ],
          },
          {
            path: 'Fitness/Workouts/2026-04-25.md',
            mtime: 1,
            date: '2026-04-25',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Bench Press',
                kind: 'strength',
                bestSet: { weight: 100, reps: 3, e1rm: 110 },
                maxWeightSet: { weight: 110, reps: 1 },
                totalSets: 2,
              },
            ],
          },
        ],
      },
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('- **[[#Bench Press|Bench Press]]:** 90 kg x 10 (e1rm 120.0)')
  })

  it('honors weight metric by ranking the heaviest set and omitting e1rm', () => {
    const markdown = composeDashboard(
      {
        ...emptyIndex,
        entries: [
          {
            path: 'Fitness/Workouts/2026-04-24.md',
            mtime: 1,
            date: '2026-04-24',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Bench Press',
                kind: 'strength',
                bestSet: { weight: 90, reps: 10, e1rm: 120 },
                maxWeightSet: { weight: 105, reps: 1 },
                totalSets: 2,
              },
            ],
          },
          {
            path: 'Fitness/Workouts/2026-04-25.md',
            mtime: 1,
            date: '2026-04-25',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Bench Press',
                kind: 'strength',
                bestSet: { weight: 100, reps: 3, e1rm: 110 },
                maxWeightSet: { weight: 105, reps: 3 },
                totalSets: 2,
              },
            ],
          },
        ],
      },
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
      new Map([['Bench Press', 'weight'] as const]),
    )

    expect(markdown).toContain('- **[[#Bench Press|Bench Press]]:** 105 kg x 3')
    expect(markdown).not.toContain('e1rm')
  })

  it('renders zero-weight PBs for bodyweight exercises in weight metric mode', () => {
    const markdown = composeDashboard(
      {
        ...emptyIndex,
        entries: [
          {
            path: 'Fitness/Workouts/2026-04-25.md',
            mtime: 1,
            date: '2026-04-25',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Push-up',
                kind: 'strength',
                maxWeightSet: { weight: 0, reps: 12 },
                totalSets: 2,
              },
            ],
          },
        ],
      },
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
      new Map([['Push-up', 'weight'] as const]),
    )

    expect(markdown).toContain('- **[[#Push-up|Push-up]]:** 0 kg x 12')
  })

  it('renders zero-weight eight-rep PBs in weight metric mode', () => {
    const markdown = composeDashboard(
      {
        ...emptyIndex,
        entries: [
          {
            path: 'Fitness/Workouts/2026-04-25.md',
            mtime: 1,
            date: '2026-04-25',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Push-up',
                kind: 'strength',
                maxWeightSet: { weight: 0, reps: 8 },
                totalSets: 1,
              },
            ],
          },
        ],
      },
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
      new Map([['Push-up', 'weight'] as const]),
    )

    expect(markdown).toContain('- **[[#Push-up|Push-up]]:** 0 kg x 8')
  })

  it('links each PB row to its dashboard section', () => {
    const markdown = composeDashboard(
      mixedIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('- **[[#Squat|Squat]]:** 50 kg x 20')
    expect(markdown).toContain('- **[[#Plank|Plank]]:** total 120s across 1 session')
  })

  it('places a path-qualified wikilink to the exercise note under each section heading', () => {
    const markdown = composeDashboard(
      mixedIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('## Squat\n\n[[Fitness/Exercises/Squat|Squat]]\n\n```dataview')
    expect(markdown).toContain('## Plank\n\n[[Fitness/Exercises/Plank|Plank]]\n\n```dataview')
  })

  it('renders strength Dataview tables using list fields', () => {
    const markdown = composeDashboard(
      mixedIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain(
      [
        'TABLE WITHOUT ID',
        '  file.link AS Workout,',
        '  L.set AS Set,',
        '  L.weight AS Weight,',
        '  L.reps AS Reps',
        'FROM "Fitness/Workouts"',
        'FLATTEN file.lists AS L',
        'WHERE L.exercise = link("Squat") AND L.set',
        'SORT file.name DESC, L.set ASC',
        'LIMIT 10',
      ].join('\n'),
    )
    expect(markdown).not.toContain('contains(item.text, "[exercise:: [[Squat]]]")')
  })

  it('ignores zero-rep best sets when rendering PBs', () => {
    const markdown = composeDashboard(
      {
        ...emptyIndex,
        entries: [
          {
            path: 'Fitness/Workouts/2026-04-24.md',
            mtime: 1,
            date: '2026-04-24',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Machine Pushdown',
                kind: 'strength',
                bestSet: {
                  weight: 18.1,
                  reps: 0,
                  e1rm: 18.1,
                },
                totalSets: 1,
              },
            ],
          },
        ],
      },
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('- **[[#Machine Pushdown|Machine Pushdown]]:** no completed sets')
  })
})
