import type { JSX } from 'preact'

import { DestructiveActions } from './action-bar'

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
      <DestructiveActions cancelText={cancelText} confirmText={confirmText} onChoose={onChoose} />
    </>
  )
}
