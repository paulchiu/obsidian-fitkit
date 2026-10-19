import type { JSX } from 'preact'

import type { ExerciseType } from '../../domain/exercise-type'
import { ActionBar } from './action-bar'

export type KindSwitchChoice = 'cancel' | 'workout' | 'workout-and-registry'

export interface KindSwitchChoiceProps {
  exerciseName: string
  currentType: ExerciseType
  nextType: ExerciseType
  /** True when the switch changes the stored kind and the card has rows to lose. */
  clearsRows: boolean
  registryType: ExerciseType | null
  onChoose: (choice: KindSwitchChoice) => void
}

/** What a kind switch does to the rows and the registry, with a button per way forward. */
export function KindSwitchChoiceBody({
  exerciseName,
  currentType,
  nextType,
  clearsRows,
  registryType,
  onChoose,
}: KindSwitchChoiceProps): JSX.Element {
  const registryLine =
    registryType === nextType
      ? `The exercise registry already records ${exerciseName} as ${nextType}.`
      : registryType === null
        ? `${exerciseName} is not yet in the exercise registry.`
        : `The exercise registry currently records ${exerciseName} as ${registryType}.`
  return (
    <>
      {clearsRows && <p>{`Existing ${currentType} rows in this workout will be cleared.`}</p>}
      <p>{`${registryLine} New cards default their type from the registry.`}</p>
      <ActionBar>
        <button class="fitkit-btn" onClick={() => onChoose('cancel')}>
          Cancel
        </button>
        <button class="fitkit-btn" onClick={() => onChoose('workout')}>
          Just this workout
        </button>
        {registryType !== nextType && (
          <button
            class="fitkit-btn fitkit-btn-primary"
            onClick={() => onChoose('workout-and-registry')}
          >
            Update registry too
          </button>
        )}
      </ActionBar>
    </>
  )
}
