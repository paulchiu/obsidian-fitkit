import type { JSX } from 'preact'

import type { ExerciseKind } from '../../domain/exercise-kind'
import { planStepLabel, planStepPlaceholder } from '../model/plan-step'
import { ActionBar } from './action-bar'
import { useDomEffect } from './dom-effect'

export interface PlanStepFormProps {
  kind: ExerciseKind
  initial: string
  onSave: (text: string) => void
  onCancel: () => void
  /** Receives the input once it holds `initial`, so the shell can focus it. */
  onFilled: (input: HTMLInputElement) => void
}

/** A labelled step box over Cancel and Save; Enter in the box saves. */
export function PlanStepForm({
  kind,
  initial,
  onSave,
  onCancel,
  onFilled,
}: PlanStepFormProps): JSX.Element {
  const input = useDomEffect<HTMLInputElement>(
    (el) => {
      el.value = initial
      onFilled(el)
    },
    [initial],
  )
  const read = (): string => input.current?.value ?? ''
  return (
    <>
      <div class="fitkit-set-note-field">
        <label class="fitkit-label" for="fitkit-plan-step-input">
          {planStepLabel(kind)}
        </label>
        <input
          ref={input}
          class="fitkit-input"
          id="fitkit-plan-step-input"
          type="text"
          inputmode="decimal"
          placeholder={planStepPlaceholder(kind)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onSave(read())
            }
          }}
        />
      </div>
      <ActionBar cls="fitkit-set-note-actions">
        <button class="fitkit-btn" onClick={onCancel}>
          Cancel
        </button>
        <button class="fitkit-btn fitkit-btn-primary" onClick={() => onSave(read())}>
          Save
        </button>
      </ActionBar>
    </>
  )
}
