import { render, type JSX } from 'preact'
import { describe, expect, it } from 'vitest'

import { useIcon, type Host } from '../../../src/ui/components/host'
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

describe('timer screens through the host', () => {
  it('draw each control icon with the host the caller supplies', () => {
    const root = createTestRoot()
    const model = { exerciseName: 'Plank', set: 2, seconds: 30, running: false }
    renderSetTimer(root, model, handlers, fakeHost)
    const icons = Array.from(root.querySelectorAll('.fitkit-runner-icon'), (el) =>
      el.getAttribute('data-icon'),
    )
    expect(icons).toEqual(['play', 'rotate-ccw', 'check'])
  })

  it('shows the clock as m:ss and takes the screen down on unmount', () => {
    const root = createTestRoot()
    const mounted = renderRestTimer(root, 75, { stop: () => {} }, fakeHost)
    expect(root.querySelector('.fitkit-runner-clock')?.textContent).toBe('1:15')
    mounted.unmount()
    expect(root.childElementCount).toBe(0)
  })

  it('fails loudly when no host is provided', () => {
    const root = createTestRoot()
    expect(() => render(<Probe />, root)).toThrow('No Host provided')
  })
})

function Probe(): JSX.Element {
  const ref = useIcon<HTMLSpanElement>('play')
  return <span ref={ref} />
}
