import { createContext } from 'preact'
import { useContext, useLayoutEffect, useRef } from 'preact/hooks'

/** What components need to know about the pane's size changing. */
export interface Layout {
  /** Calls `refit` whenever the pane resizes; the result stops it. */
  onResize(refit: () => void): () => void
}

/** The default never reports a resize, so a tree drawn outside the editor needs no provider. */
export const LayoutContext = createContext<Layout>({ onResize: () => () => {} })

/** Runs the latest `refit` on every resize while mounted. */
export function useResize(refit: () => void): void {
  const layout = useContext(LayoutContext)
  const latest = useRef(refit)
  latest.current = refit
  useLayoutEffect(() => layout.onResize(() => latest.current()), [layout])
}
