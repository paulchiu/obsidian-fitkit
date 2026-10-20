import type { ComponentChildren, JSX, Ref } from 'preact'

/** A modal's bottom button row; `cls` adds a variant such as the sheet-pinned bar. */
export function ActionBar({
  cls,
  barRef,
  children,
}: {
  cls?: string
  barRef?: Ref<HTMLDivElement>
  children: ComponentChildren
}): JSX.Element {
  return (
    <div ref={barRef} class={cls ? `fitkit-confirm-actions ${cls}` : 'fitkit-confirm-actions'}>
      {children}
    </div>
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

/** The button row of the rename, registry entry and import modals. */
export function ButtonRow({ children }: { children: ComponentChildren }): JSX.Element {
  return <div class="fitkit-import-actions">{children}</div>
}
