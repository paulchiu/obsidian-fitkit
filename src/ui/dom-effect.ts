import type { RefObject } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

/**
 * Runs `apply` on the element the returned ref is attached to, after mount and again only when a
 * value in `deps` changes, and runs its cleanup before the next apply and on unmount. Components
 * reach imperative DOM helpers such as `setIcon` only through this, synchronously with the render.
 */
export function useDomEffect<T extends HTMLElement>(
  apply: (el: T) => void | (() => void),
  deps: readonly unknown[],
): RefObject<T | null> {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    return el ? apply(el) : undefined
  }, deps)
  return ref
}
