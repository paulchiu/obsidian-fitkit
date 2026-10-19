import type { ComponentChildren, JSX } from 'preact'

/** The bottom button row every simple modal ends with; `cls` adds the sheet-pinned variant. */
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
