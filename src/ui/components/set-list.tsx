import type { ComponentChildren, JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

import { useResize } from './layout'

/**
 * A card's set rows, clipped when taller than half the window behind a toggle that shows them
 * all, so one long card does not take over the editor. The toggle's text and visibility depend on
 * measured heights, so they are written after each render, not drawn.
 */
export function SetList({
  expanded,
  setExpanded,
  children,
}: {
  /** Whether the list is shown in full past the cap; the view holds it so it survives a redraw. */
  expanded: () => boolean
  setExpanded: (expanded: boolean) => void
  children: ComponentChildren
}): JSX.Element {
  const rows = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const refit = (): void => {
    const list = rows.current
    const button = toggle.current
    const win = list?.ownerDocument.defaultView
    if (!list || !button || !win) {
      return
    }
    /** A phone keyboard shrinks the window; re-capping then would hide the row being typed in. */
    if (list.contains(list.ownerDocument.activeElement)) {
      return
    }
    const limit = Math.round(win.innerHeight / 2)
    list.style.setProperty('--fitkit-set-cap', `${limit}px`)
    const tall = list.scrollHeight > limit
    const capped = tall && !expanded()
    list.classList.toggle('is-capped', capped)
    button.hidden = !tall
    button.textContent = capped ? `Show all ${list.children.length} sets` : 'Show fewer sets'
    button.setAttribute('aria-expanded', String(!capped))
  }
  useLayoutEffect(refit)
  useResize(refit)
  return (
    <>
      <div class="fitkit-set-rows" ref={rows}>
        {children}
      </div>
      <button
        ref={toggle}
        type="button"
        class="fitkit-btn fitkit-btn-muted fitkit-set-toggle"
        onClick={() => {
          setExpanded(!expanded())
          refit()
        }}
      />
    </>
  )
}
