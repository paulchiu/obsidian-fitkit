import { describe, expect, it } from 'vitest'

import { composeDashboard } from '../src/dashboard'
import type { FitKitIndex } from '../src/domain/types'

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
    expect(composeDashboard(emptyIndex, 'Fitness/Workouts', new Set())).toMatch(
      /^# FitKit Dashboard/,
    )
  })

  it('renders PBs and an exercise section for strength entries', () => {
    const markdown = composeDashboard(mixedIndex, 'Fitness/Workouts', new Set())

    expect(markdown).toContain('## PBs')
    expect(markdown).toContain('## Squat')
  })

  it('hides exercise sections by hidden key', () => {
    const markdown = composeDashboard(mixedIndex, 'Fitness/Workouts', new Set(['exercise:Squat']))

    expect(markdown).not.toContain('## Squat')
  })

  it('is idempotent for the same index input', () => {
    expect(composeDashboard(mixedIndex, 'Fitness/Workouts', new Set())).toBe(
      composeDashboard(mixedIndex, 'Fitness/Workouts', new Set()),
    )
  })

  it('renders strength and duration exercise phrasing', () => {
    const markdown = composeDashboard(mixedIndex, 'Fitness/Workouts', new Set())

    expect(markdown).toContain('50 kg x 20')
    expect(markdown).toContain('e1rm 73.3')
    expect(markdown).toContain('total 120s across 1 session')
    expect(markdown).toContain('duration + "s" as Duration')
  })

  it('renders strength Dataview tables using list fields', () => {
    const markdown = composeDashboard(mixedIndex, 'Fitness/Workouts', new Set())

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
      new Set(),
    )

    expect(markdown).toContain('- **Machine Pushdown:** no completed sets')
  })
})
