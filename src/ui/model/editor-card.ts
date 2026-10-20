import { INTENSITY_KINDS } from '../../domain/interval-plan'
import { parseIntervalProgram } from '../../domain/interval-program'
import { restsAfter } from '../../domain/interval-run'
import type { NextPlan } from '../../domain/next-plan'
import type { ExerciseKind } from '../../domain/workout-note-model'
import type {
  EditableBodyweightSet,
  EditableDurationEntry,
  EditableStrengthSet,
  IntervalColumns,
} from './set-rows'

/** An exercise as the editor holds it: the rows are edited in place and written back on save. */
export interface ExerciseCard {
  name: string
  kind: ExerciseKind
  exerciseNotes?: string
  next?: NextPlan
  /** Raw `[plan::]` text; only a duration card writes it back. */
  plan?: string
  strengthSets: EditableStrengthSet[]
  durationEntries: EditableDurationEntry[]
  bodyweightSets: EditableBodyweightSet[]
}

/** Which interval columns a duration card shows: the plan's intensity, or whichever its rows already log. */
export function intervalColumns(card: ExerciseCard): IntervalColumns {
  const parsed = card.plan === undefined ? null : parseIntervalProgram(card.plan)
  const plan = parsed?.ok ? parsed.program : null
  const logged = INTENSITY_KINDS.find((kind) =>
    card.durationEntries.some((entry) => entry[kind] !== undefined),
  )
  return {
    plan,
    intensity: plan?.intensity ?? logged ?? null,
    rest:
      plan?.steps.some(restsAfter) === true ||
      card.durationEntries.some((entry) => entry.restSeconds !== undefined),
  }
}
