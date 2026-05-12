import type { ExerciseKind } from '../domain/exercise-registry'
import { buildNotesBlock, buildRecentSessionsBlock } from '../domain/exercise-note-template'
import { DEFAULT_WEIGHT_UNIT, type WeightUnit } from '../domain/weight-unit'

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
  unit: WeightUnit = DEFAULT_WEIGHT_UNIT,
): string {
  const lines: string[] = []
  lines.push('---')
  lines.push('type: exercise')
  lines.push(`kind: ${kind}`)
  if (kind === 'strength') {
    lines.push('metric: e1rm')
    lines.push(`unit: ${unit}`)
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
  lines.push(buildNotesBlock(exerciseName, fitnessRootFromWorkouts(workoutsFolderPath)))
  return `${lines.join('\n')}\n`
}

function fitnessRootFromWorkouts(workoutsFolderPath: string): string {
  return workoutsFolderPath.replace(/\/Workouts$/, '')
}
