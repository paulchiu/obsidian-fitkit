import { options } from 'preact'

/**
 * Records the name of every component Preact unmounts until `stop()` is called, so a test can
 * prove a surface took its component down rather than just emptying its element. `stop()` puts
 * back the hook that was there before, or removes the key if there was none.
 */
export function watchUnmounts(): { names: string[]; stop: () => void } {
  const names: string[] = []
  const previous = Object.getOwnPropertyDescriptor(options, 'unmount')
  const saved = { ...options }
  options.unmount = (vnode) => {
    if (typeof vnode.type === 'function') {
      names.push(vnode.type.name)
    }
    saved.unmount?.(vnode)
  }
  return {
    names,
    stop: () => {
      delete options.unmount
      if (previous) {
        Object.defineProperty(options, 'unmount', previous)
      }
    },
  }
}
