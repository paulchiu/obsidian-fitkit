import type { ComponentChildren, JSX } from 'preact'

/** A modal's bottom button row; `cls` adds a variant such as the sheet-pinned bar. */
export function ActionBar({
  cls,
  children,
}: {
  cls?: string
  children: ComponentChildren
}): JSX.Element {
  return (
    <div class={cls ? `fitkit-confirm-actions ${cls}` : 'fitkit-confirm-actions'}>{children}</div>
  )
}

/** A neutral cancel button beside a destructive confirm button, reporting which was pressed. */
export function DestructiveActions({
  cancelText,
  confirmText,
  onChoose,
}: {
  cancelText: string
  confirmText: string
  onChoose: (confirmed: boolean) => void
}): JSX.Element {
  return (
    <ActionBar>
      <button class="fitkit-btn" onClick={() => onChoose(false)}>
        {cancelText}
      </button>
      <button class="fitkit-btn fitkit-destructive-button" onClick={() => onChoose(true)}>
        {confirmText}
      </button>
    </ActionBar>
  )
}

/** The button row of the import and registry modals. */
export function ImportActions({ children }: { children: ComponentChildren }): JSX.Element {
  return <div class="fitkit-import-actions">{children}</div>
}
