import type { ExerciseKind } from './exercise-registry'
import { workoutsFolder } from '../settings-paths'

export function buildRecentSessionsBlock(
  name: string,
  kind: ExerciseKind,
  fitnessRoot: string,
): string {
  return ['```dataview', ...recentSessionsQuery(name, kind, fitnessRoot), '```'].join('\n')
}

export function buildNotesBlock(name: string, fitnessRoot: string): string {
  return ['```dataview', ...notesQuery(name, fitnessRoot), '```'].join('\n')
}

function recentSessionsQuery(name: string, kind: ExerciseKind, fitnessRoot: string): string[] {
  const workouts = workoutsFolder({ fitnessRoot })
  if (kind === 'duration') {
    return [
      'table without id file.link as Session, duration + "s" as Duration',
      `from "${workouts}"`,
      'flatten file.lists as item',
      `where contains(item.text, "[exercise:: [[${name}]]]") and item.duration`,
      'sort file.name desc',
      'limit 12',
    ]
  }
  return [
    'TABLE WITHOUT ID',
    '  file.link AS Workout,',
    '  L.set AS Set,',
    '  L.weight AS Weight,',
    '  L.reps AS Reps',
    `FROM "${workouts}"`,
    'FLATTEN file.lists AS L',
    `WHERE L.exercise = link("${name}") AND L.set`,
    'SORT file.name DESC, L.set ASC',
    'LIMIT 10',
  ]
}

function notesQuery(name: string, fitnessRoot: string): string[] {
  const workouts = workoutsFolder({ fitnessRoot })
  return [
    'TABLE WITHOUT ID',
    '  file.link AS Workout,',
    '  L.notes AS Note',
    `FROM "${workouts}"`,
    'FLATTEN file.lists AS L',
    `WHERE L.exercise = link("${name}") AND L.notes`,
    'SORT file.name DESC',
    'LIMIT 20',
  ]
}
