import { options } from 'preact'

/**
 * Records the name of every component Preact unmounts until `stop()` is called, so a test can
 * prove a surface took its component down rather than just emptying its element.
 */
export function watchUnmounts(): { names: string[]; stop: () => void } {
  const names: string[] = []
  const previous = { ...options }
  options.unmount = (vnode) => {
    if (typeof vnode.type === 'function') {
      names.push(vnode.type.name)
    }
    previous.unmount?.(vnode)
  }
  return {
    names,
    stop: () => {
      Object.assign(options, previous)
    },
  }
}
