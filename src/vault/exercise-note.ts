import type { ExerciseKind } from '../domain/exercise-registry'
import { buildRecentSessionsBlock } from '../domain/exercise-note-template'

/**
 * Pure: build the seeded markdown body for a freshly-created exercise note.
 *
 * The Recent sessions Dataview block must stay byte-aligned with `dataviewQuery`
 * in `src/vault/dashboard.ts` so the two views over the same data agree. The
 * Progress chart block is rendered by the plugin's `fitkit-chart` code-block
 * processor; an empty body inherits all defaults (name from filename, kind
 * from frontmatter, window from settings).
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
  if (kind === 'strength') {
    lines.push('metric: e1rm')
  }
  lines.push('---')
  lines.push('')
  lines.push('## Progress chart')
  lines.push('')
  lines.push('```fitkit-chart')
  lines.push('```')
  lines.push('')
  lines.push('## Recent sessions')
  lines.push('')
  lines.push(
    buildRecentSessionsBlock(exerciseName, kind, fitnessRootFromWorkouts(workoutsFolderPath)),
  )
  lines.push('')
  lines.push('## Notes')
  lines.push('')
  lines.push('```dataview')
  lines.push(...notesQuery(exerciseName, workoutsFolderPath))
  lines.push('```')
  return `${lines.join('\n')}\n`
}

function fitnessRootFromWorkouts(workoutsFolderPath: string): string {
  return workoutsFolderPath.replace(/\/Workouts$/, '')
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
