import type { ExerciseKind } from '../domain/exercise-registry'

/**
 * Pure: build the seeded markdown body for a freshly-created exercise note.
 *
 * The Recent sessions Dataview block must stay byte-aligned with `dataviewQuery`
 * in `src/vault/dashboard.ts` so the two views over the same data agree.
 */
export function composeExerciseNote(
  exerciseName: string,
  kind: ExerciseKind,
  workoutsFolderPath: string,
): string {
  const lines: string[] = []
  lines.push('---')
  lines.push('type: exercise')
  lines.push(`kind: ${kind}`)
  lines.push('---')
  lines.push('')
  lines.push('## Recent sessions')
  lines.push('')
  lines.push('```dataview')
  lines.push(...recentSessionsQuery(exerciseName, kind, workoutsFolderPath))
  lines.push('```')
  lines.push('')
  lines.push('## Notes')
  lines.push('')
  lines.push('```dataview')
  lines.push(...notesQuery(exerciseName, workoutsFolderPath))
  lines.push('```')
  return `${lines.join('\n')}\n`
}

function recentSessionsQuery(
  exerciseName: string,
  kind: ExerciseKind,
  workoutsFolderPath: string,
): string[] {
  if (kind === 'duration') {
    return [
      'table without id file.link as Session, duration + "s" as Duration',
      `from "${workoutsFolderPath}"`,
      'flatten file.lists as item',
      `where contains(item.text, "[exercise:: [[${exerciseName}]]]") and item.duration`,
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
    `FROM "${workoutsFolderPath}"`,
    'FLATTEN file.lists AS L',
    `WHERE L.exercise = link("${exerciseName}") AND L.set`,
    'SORT file.name DESC, L.set ASC',
    'LIMIT 10',
  ]
}

function notesQuery(exerciseName: string, workoutsFolderPath: string): string[] {
  return [
    'TABLE WITHOUT ID',
    '  file.link AS Workout,',
    '  L.notes AS Note',
    `FROM "${workoutsFolderPath}"`,
    'FLATTEN file.lists AS L',
    `WHERE L.exercise = link("${exerciseName}") AND L.notes`,
    'SORT file.name DESC',
    'LIMIT 20',
  ]
}
