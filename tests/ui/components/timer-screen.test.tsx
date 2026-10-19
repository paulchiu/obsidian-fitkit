import { describe, expect, it } from 'vitest'

import type { Host } from '../../../src/ui/components/host'
import { renderRestTimer, renderSetTimer } from '../../../src/ui/components/timer-screen'
import { createTestRoot } from '../../harness/obsidian-dom'

/** A host that marks each icon as a data attribute, so a test can see where one was drawn. */
const fakeHost: Host = { icon: (el, name) => el.setAttribute('data-icon', name) }

const handlers = {
  stop: () => {},
  resume: () => {},
  reset: () => {},
  next: () => {},
  done: () => {},
}

const iconsIn = (root: HTMLElement): (string | null)[] =>
  Array.from(root.querySelectorAll('.fitkit-runner-icon'), (el) => el.getAttribute('data-icon'))

describe('set timer screen', () => {
  it('draws each control icon with the host the caller supplies', () => {
    const root = createTestRoot()
    const model = { exerciseName: 'Plank', set: 2, seconds: 30, running: false }
    renderSetTimer(root, model, handlers, fakeHost)
    expect(iconsIn(root)).toEqual(['play', 'rotate-ccw', 'check'])
  })

  it('takes the screen down on unmount', () => {
    const root = createTestRoot()
    const model = { exerciseName: 'Plank', set: 1, seconds: 0, running: true }
    const mounted = renderSetTimer(root, model, handlers, fakeHost)
    mounted.unmount()
    expect(root.childElementCount).toBe(0)
  })
})

describe('rest timer screen', () => {
  it('draws without a host, since it has no icons', () => {
    const root = createTestRoot()
    const mounted = renderRestTimer(root, 75, { stop: () => {} })
    expect(root.querySelector('.fitkit-runner.is-rest')).not.toBeNull()
    mounted.unmount()
    expect(root.childElementCount).toBe(0)
  })
})
