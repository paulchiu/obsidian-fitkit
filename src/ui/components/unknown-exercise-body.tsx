import type { JSX } from 'preact'

import { ButtonRow } from './action-bar'

export interface UnknownExerciseBodyProps {
  message: string
  /** Whether the checkbox starts ticked; it is not redrawn, so the shell reads changes from `onToggle`. */
  createNote: boolean
  onToggle: (createNote: boolean) => void
  onChoose: (add: boolean) => void
}

/** The question asked when an exercise missing from the registry is added: skip it, or add it with or without a note. */
export function UnknownExerciseBody({
  message,
  createNote,
  onToggle,
  onChoose,
}: UnknownExerciseBodyProps): JSX.Element {
  return (
    <>
      <p class="fitkit-import-muted">{message}</p>
      <label class="fitkit-import-checkbox-row">
        <input
          type="checkbox"
          checked={createNote}
          onChange={(evt) => onToggle(evt.currentTarget.checked)}
        />
        <span>Create exercise note</span>
      </label>
      <ButtonRow>
        <button class="fitkit-btn" onClick={() => onChoose(false)}>
          Skip
        </button>
        <button class="fitkit-btn fitkit-btn-primary" onClick={() => onChoose(true)}>
          Add exercise
        </button>
      </ButtonRow>
    </>
  )
}
