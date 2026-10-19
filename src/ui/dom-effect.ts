import type { RefObject } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

/**
 * Runs `apply` on the ref's element after mount and whenever `deps` change, cleaning up before the
 * next run and on unmount. Layout timing keeps it synchronous with Preact's top-level `render`.
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
