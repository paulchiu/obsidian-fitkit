import { createRef, render, type JSX, type RefObject } from 'preact'
import { useLayoutEffect } from 'preact/hooks'

import { useIcon } from './host'
import { formatClock } from '../model/clock'

/** A drawn full-tab screen: the clock the view refreshes every tick, if it drew one, and how to take it down. */
export interface ScreenMount {
  clock: HTMLElement | null
  unmount: () => void
}

/** Renders `tree` into `parent`, or again in place if it is already there; the result takes it down. */
export function mountTree(parent: HTMLElement, tree: JSX.Element): () => void {
  render(tree, parent)
  return () => render(null, parent)
}

/** Renders `screen` into `parent`, handing it the ref its clock (if any) attaches to. */
export function mountScreen(
  parent: HTMLElement,
  screen: (clock: RefObject<HTMLDivElement>) => JSX.Element,
): ScreenMount {
  const clock = createRef<HTMLDivElement>()
  const unmount = mountTree(parent, screen(clock))
  return { clock: clock.current, unmount }
}

/** The clock's text is set outside the render, since the view rewrites it on every tick. */
export function Clock({
  seconds,
  clock,
}: {
  seconds: number
  clock: RefObject<HTMLDivElement>
}): JSX.Element {
  useLayoutEffect(() => {
    if (clock.current) clock.current.textContent = formatClock(seconds)
  }, [seconds])
  return <div class="fitkit-runner-clock" ref={clock} />
}

/** A labelled icon button; the icon is drawn through the host. */
export function Control({
  icon,
  text,
  label,
  onClick,
}: {
  icon: string
  text: string
  label: string
  onClick: () => void
}): JSX.Element {
  const glyph = useIcon<HTMLSpanElement>(icon)
  return (
    <button type="button" class="fitkit-btn" aria-label={label} onClick={onClick}>
      <span class="fitkit-runner-icon" ref={glyph} />
      <span>{text}</span>
    </button>
  )
}
