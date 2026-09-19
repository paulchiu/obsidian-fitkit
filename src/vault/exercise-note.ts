import type { ExerciseKind } from '../domain/exercise-registry'
import { buildNotesBlock, buildRecentSessionsBlock } from '../domain/exercise-note-template'
import { DEFAULT_WEIGHT_UNIT, type WeightUnit } from '../domain/weight-unit'

/**
 * Usable starting ladder for a bodyweight exercise with no rungs yet: one
 * rung named after the exercise, so the level menu is never empty.
 */
export function defaultBodyweightLevels(exerciseName: string): string[] {
  return [exerciseName]
}

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
  levels: string[] = defaultBodyweightLevels(exerciseName),
): string {
  const lines: string[] = []
  lines.push('---')
  lines.push('type: exercise')
  lines.push(`kind: ${kind}`)
  /** Strength-only rule: metric and unit are strength concerns; other kinds need neither. */
  if (kind === 'strength') {
    lines.push('metric: e1rm')
    lines.push(`unit: ${unit}`)
  }
  /** A new bodyweight note starts with a usable ladder instead of an empty menu. */
  if (kind === 'bodyweight') {
    lines.push('levels:')
    for (const rung of levels) {
      lines.push(`  - ${rung}`)
    }
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
