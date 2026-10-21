import { frontmatterBlock } from '../domain/exercise-note-frontmatter'
import { kindOfType, type ExerciseType } from '../domain/exercise-type'
import { buildNotesBlock, buildRecentSessionsBlock } from '../domain/exercise-note-template'
import { DEFAULT_WEIGHT_UNIT, type WeightUnit } from '../domain/weight-unit'

/**
 * Pure: build the seeded markdown body for a freshly-created exercise note.
 * The Recent sessions Dataview block must stay byte-aligned with `dataviewQuery`
 * in `src/vault/dashboard.ts` so the two views agree.
 */
export function composeExerciseNote(
  exerciseName: string,
  type: ExerciseType,
  workoutsFolderPath: string,
  unit: WeightUnit = DEFAULT_WEIGHT_UNIT,
): string {
  const kind = kindOfType(type)
  const lines: string[] = []
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
  return `${frontmatterBlock(type, exerciseName, unit)}${lines.join('\n')}\n`
}

function fitnessRootFromWorkouts(workoutsFolderPath: string): string {
  return workoutsFolderPath.replace(/\/Workouts$/, '')
}
