import { describe, expect, it } from 'vitest'

import type { FitKitIndex } from '../../src/domain/types'
import { composeDashboard } from '../../src/vault/dashboard'
import { composeExerciseNote } from '../../src/vault/exercise-note'

describe('exercise-note composer', () => {
  it('seeds a strength exercise note with Recent sessions and Notes Dataview blocks', () => {
    const markdown = composeExerciseNote('Squat', 'strength', 'Fitness/Workouts')

    expect(markdown).toBe(
      [
        '---',
        'type: exercise',
        'kind: strength',
        'metric: e1rm',
        '---',
        '',
        '## Recent sessions',
        '',
        '```dataview',
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
        '```',
        '',
        '## Progress chart',
        '',
        '```fitkit-chart',
        '```',
        '',
        '## Notes',
        '',
        '```dataview',
        'TABLE WITHOUT ID',
        '  file.link AS Workout,',
        '  L.notes AS Note',
        'FROM "Fitness/Workouts"',
        'FLATTEN file.lists AS L',
        'WHERE L.exercise = link("Squat") AND L.notes',
        'SORT file.name DESC',
        'LIMIT 20',
        '```',
        '',
      ].join('\n'),
    )
  })

  it('seeds a duration exercise note with the duration query and the same Notes block', () => {
    const markdown = composeExerciseNote('Plank', 'duration', 'Fitness/Workouts')

    expect(markdown).toBe(
      [
        '---',
        'type: exercise',
        'kind: duration',
        '---',
        '',
        '## Recent sessions',
        '',
        '```dataview',
        'table without id file.link as Session, duration + "s" as Duration',
        'from "Fitness/Workouts"',
        'flatten file.lists as item',
        'where contains(item.text, "[exercise:: [[Plank]]]") and item.duration',
        'sort file.name desc',
        'limit 12',
        '```',
        '',
        '## Progress chart',
        '',
        '```fitkit-chart',
        '```',
        '',
        '## Notes',
        '',
        '```dataview',
        'TABLE WITHOUT ID',
        '  file.link AS Workout,',
        '  L.notes AS Note',
        'FROM "Fitness/Workouts"',
        'FLATTEN file.lists AS L',
        'WHERE L.exercise = link("Plank") AND L.notes',
        'SORT file.name DESC',
        'LIMIT 20',
        '```',
        '',
      ].join('\n'),
    )
  })

  it('respects the configured workouts folder', () => {
    const markdown = composeExerciseNote('Bench', 'strength', 'Custom/Path/Workouts')

    expect(markdown).toContain('FROM "Custom/Path/Workouts"')
    expect(markdown).not.toContain('FROM "Fitness/Workouts"')
  })

  it('passes unusual exercise names through verbatim', () => {
    const markdown = composeExerciseNote('Machine Pushdown', 'strength', 'Fitness/Workouts')

    expect(markdown).toContain('WHERE L.exercise = link("Machine Pushdown") AND L.set')
    expect(markdown).toContain('WHERE L.exercise = link("Machine Pushdown") AND L.notes')
  })

  it('is idempotent for the same inputs', () => {
    expect(composeExerciseNote('Squat', 'strength', 'Fitness/Workouts')).toBe(
      composeExerciseNote('Squat', 'strength', 'Fitness/Workouts'),
    )
  })

  it('keeps the Recent sessions Dataview byte-aligned with the dashboard composer', () => {
    const indexFor = (name: string, kind: 'strength' | 'duration'): FitKitIndex => ({
      schemaVersion: 1,
      builtAt: 0,
      entries: [
        {
          path: 'Fitness/Workouts/2026-04-28.md',
          mtime: 1,
          date: '2026-04-28',
          name: 'Workout',
          exercises: [
            kind === 'strength'
              ? {
                  exerciseName: name,
                  kind: 'strength',
                  bestSet: { weight: 50, reps: 5, e1rm: 58.3 },
                  totalSets: 1,
                }
              : {
                  exerciseName: name,
                  kind: 'duration',
                  totalSets: 1,
                  totalDurationSeconds: 60,
                },
          ],
        },
      ],
      diagnostics: [],
    })

    const extractDataview = (markdown: string, heading: string): string => {
      const after = markdown.split(`## ${heading}`)[1]
      if (!after) throw new Error(`heading not found: ${heading}`)
      const match = after.match(/```dataview\n([\s\S]*?)\n```/)
      if (!match || !match[1]) throw new Error('dataview block not found')
      return match[1]
    }

    for (const kind of ['strength', 'duration'] as const) {
      const name = kind === 'strength' ? 'Squat' : 'Plank'
      const dashboard = composeDashboard(
        indexFor(name, kind),
        'Fitness/Workouts',
        'Fitness/Exercises',
        new Set(),
      )
      const exerciseNote = composeExerciseNote(name, kind, 'Fitness/Workouts')

      expect(extractDataview(exerciseNote, 'Recent sessions')).toBe(
        extractDataview(dashboard, name),
      )
    }
  })
})
