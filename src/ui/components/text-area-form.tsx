import type { JSX } from 'preact'

import { useDomEffect } from './dom-effect'
import { ActionBar } from './action-bar'

export interface TextAreaFormProps {
  label: string
  id: string
  rows: number
  initial: string
  onSave: (text: string) => void
  onCancel: () => void
  /** Receives the text box once it holds `initial`, so the shell can focus it. */
  onFilled: (textarea: HTMLTextAreaElement) => void
}

/**
 * A labelled text box over Cancel and Save. It wears the set note modal's classes, which every
 * one-text-box modal shares for its keyboard-safe sheet layout.
 */
export function TextAreaForm({
  label,
  id,
  rows,
  initial,
  onSave,
  onCancel,
  onFilled,
}: TextAreaFormProps): JSX.Element {
  const textarea = useDomEffect<HTMLTextAreaElement>(
    (el) => {
      el.value = initial
      onFilled(el)
    },
    [initial],
  )
  return (
    <>
      <div class="fitkit-set-note-field">
        <label class="fitkit-label" for={id}>
          {label}
        </label>
        <textarea
          ref={textarea}
          class="fitkit-textarea fitkit-set-note-textarea"
          id={id}
          rows={rows}
        />
      </div>
      <ActionBar cls="fitkit-set-note-actions">
        <button class="fitkit-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          class="fitkit-btn fitkit-btn-primary"
          onClick={() => onSave(textarea.current?.value ?? '')}
        >
          Save
        </button>
      </ActionBar>
    </>
  )
}
