import { options } from 'preact'

/** How many times components of `type` render while `run` runs, read from Preact's `diffed` hook. */
export function countRenders(type: unknown, run: () => void): number {
  let n = 0
  const saved = Object.getOwnPropertyDescriptor(options, 'diffed')
  options.diffed = (vnode) => {
    if (vnode.type === type) n++
  }
  try {
    run()
  } finally {
    delete options.diffed
    if (saved) Object.defineProperty(options, 'diffed', saved)
  }
  return n
}

/** As {@link countRenders}, waiting out the re-renders Preact queues (a context change, say) before it stops counting. */
export async function countRendersSettled(
  type: unknown,
  run: () => void | Promise<void>,
): Promise<number> {
  let n = 0
  const saved = Object.getOwnPropertyDescriptor(options, 'diffed')
  options.diffed = (vnode) => {
    if (vnode.type === type) n++
  }
  try {
    await run()
    for (let i = 0; i < 10; i++) await Promise.resolve()
  } finally {
    delete options.diffed
    if (saved) Object.defineProperty(options, 'diffed', saved)
  }
  return n
}
