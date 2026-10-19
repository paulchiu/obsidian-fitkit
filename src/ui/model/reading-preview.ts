import { assertUnreachableKind } from '../../domain/exercise-kind'
import { EXERCISE_TYPE_LABELS, loggedTypeOf } from '../../domain/exercise-type'
import { bodyweightLevelName, type BodyweightLadder } from '../../domain/bodyweight-levels'
import { formatDurationInput } from '../../domain/duration-input'
import { formatNextPlanLabel, planStepUnit } from '../../domain/next-plan'
import type { ExerciseEntry } from '../../domain/workout-note-model'
import type { WeightUnit } from '../../domain/weight-unit'

/** The set table of a preview: column headings over rows of cell text, or why there is none. */
export type ReadingTable = { headings: string[]; rows: string[][] } | { emptyMessage: string }

/** What the reading-mode preview of one exercise shows. */
export interface ReadingPreview {
  kind: string
  count: string
  note?: string
  /** Plan lines in display order. */
  plans: string[]
  table: ReadingTable
}

export function formatWeight(value: number | undefined, unit: WeightUnit): string {
  return value === undefined || !Number.isFinite(value) ? '-' : `${value} ${unit}`
}

export function formatReps(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '-' : String(value)
}

export function formatDurationSeconds(value: number | undefined): string {
  return formatDurationInput(value) || '-'
}

function formatSet(value: number): string {
  return Number.isFinite(value) && value > 0 ? String(value) : '-'
}

function rowCount(count: number): string {
  return count === 1 ? '1 row' : `${count} rows`
}

/** The preview of `exercise`, with weights in `unit` and bodyweight rungs named from `levels`. */
export function buildReadingPreview(
  exercise: ExerciseEntry,
  unit: WeightUnit,
  levels: BodyweightLadder | undefined,
): ReadingPreview {
  const plans: string[] = []
  if (exercise.kind === 'duration' && exercise.plan !== undefined) {
    plans.push(`Plan: ${exercise.plan}`)
  }
  if (exercise.next) {
    plans.push(
      `Next time: ${formatNextPlanLabel(exercise.next, exercise.kind).toLowerCase()}${planStepSuffix(exercise, unit)}`,
    )
  }
  const { count, table } = countAndTable(exercise, unit, levels)
  return {
    kind: EXERCISE_TYPE_LABELS[loggedTypeOf(exercise)],
    count: rowCount(count),
    ...(exercise.note ? { note: exercise.note } : {}),
    plans,
    table,
  }
}

function countAndTable(
  exercise: ExerciseEntry,
  unit: WeightUnit,
  levels: BodyweightLadder | undefined,
): { count: number; table: ReadingTable } {
  switch (exercise.kind) {
    case 'strength': {
      const sets = exercise.strengthSets
      return {
        count: sets.length,
        table:
          sets.length === 0
            ? { emptyMessage: 'No strength rows recorded.' }
            : {
                headings: ['Set', 'Weight', 'Reps', 'Notes'],
                rows: sets.map((set) => [
                  formatSet(set.set),
                  formatWeight(set.weight, unit),
                  formatReps(set.reps),
                  set.note ?? '-',
                ]),
              },
      }
    }
    case 'bodyweight': {
      const sets = exercise.bodyweightSets
      return {
        count: sets.length,
        table:
          sets.length === 0
            ? { emptyMessage: 'No bodyweight rows recorded.' }
            : {
                headings: ['Set', 'Level', 'Reps', 'Load', 'Notes'],
                rows: sets.map((set, index) => [
                  formatSet(set.set ?? index + 1),
                  bodyweightLevelName(levels, set.level),
                  formatReps(set.reps),
                  formatWeight(set.load, unit),
                  set.note ?? '-',
                ]),
              },
      }
    }
    case 'duration': {
      const entries = exercise.durationEntries
      return {
        count: entries.length,
        table:
          entries.length === 0
            ? { emptyMessage: 'No duration rows recorded.' }
            : {
                headings: ['Set', 'Duration', 'Notes'],
                rows: entries.map((entry, index) => [
                  formatSet(entry.set ?? index + 1),
                  formatDurationSeconds(entry.durationSeconds),
                  entry.note ?? '-',
                ]),
              },
      }
    }
    default:
      return assertUnreachableKind(exercise)
  }
}

function planStepSuffix(exercise: ExerciseEntry, unit: WeightUnit): string {
  const step = exercise.next?.step
  return step === undefined || exercise.kind === 'duration'
    ? ''
    : ` ${planStepUnit(exercise.kind, step, unit)}`
}
