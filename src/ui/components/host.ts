import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import type { RefObject } from 'preact'
import { useDomEffect } from './dom-effect'

/** What components need from the platform: Obsidian's helpers in the plugin, a fake in tests. */
export interface Host {
  icon(el: HTMLElement, name: string): void
}

const missing = (): never => {
  throw new Error('No Host provided')
}

/** The host components draw through; the default throws so a missing provider fails loudly. */
export const HostContext = createContext<Host>({ icon: missing })

/** Sets icon `name` on the ref's element when it changes. */
export function useIcon<T extends HTMLElement>(name: string): RefObject<T | null> {
  const host = useContext(HostContext)
  return useDomEffect<T>((el) => host.icon(el, name), [name])
}
