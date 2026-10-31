import type { JSX, RefObject } from 'preact'
import { useLayoutEffect } from 'preact/hooks'

import { useIcon } from './host'
import { formatClock } from '../model/clock'

/** The clock's text is set outside the render, since the view rewrites it on every tick; each render writes it again. */
export function Clock({
  seconds,
  clock,
}: {
  seconds: number
  clock: RefObject<HTMLDivElement | null>
}): JSX.Element {
  useLayoutEffect(() => {
    if (clock.current) clock.current.textContent = formatClock(seconds)
  })
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
