import type { JSX } from 'preact'

import { ActionBar } from './action-bar'

export interface ConfirmBodyProps {
  message: string
  confirmText: string
  cancelText: string
  onChoose: (confirmed: boolean) => void
}

/** A message over a neutral cancel button and a destructive confirm button. */
export function ConfirmBody({
  message,
  confirmText,
  cancelText,
  onChoose,
}: ConfirmBodyProps): JSX.Element {
  return (
    <>
      <p>{message}</p>
      <ActionBar>
        <button class="fitkit-btn" onClick={() => onChoose(false)}>
          {cancelText}
        </button>
        <button class="fitkit-btn fitkit-destructive-button" onClick={() => onChoose(true)}>
          {confirmText}
        </button>
      </ActionBar>
    </>
  )
}
