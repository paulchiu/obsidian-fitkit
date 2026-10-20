import { createRef, render } from 'preact'
import { describe, expect, it } from 'vitest'

import { HostContext, type Host } from '../../../src/ui/components/host'
import { RestTimer, SetTimer, type SetTimerModel } from '../../../src/ui/components/timer-screen'
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

const drawSetTimer = (root: HTMLElement, model: SetTimerModel): void => {
  render(
    <HostContext.Provider value={fakeHost}>
      <SetTimer model={model} handlers={handlers} clock={createRef()} />
    </HostContext.Provider>,
    root,
  )
}

describe('set timer screen', () => {
  it('draws each control icon with the host the caller supplies', () => {
    const root = createTestRoot()
    drawSetTimer(root, { exerciseName: 'Plank', set: 2, seconds: 30, running: false })
    expect(iconsIn(root)).toEqual(['play', 'rotate-ccw', 'check'])
  })

  it('writes the clock on every draw, even when the seconds drawn are unchanged', () => {
    const root = createTestRoot()
    const model = { exerciseName: 'Plank', set: 1, seconds: 0, running: true }
    drawSetTimer(root, model)
    const clock = root.querySelector('.fitkit-runner-clock')
    if (clock) clock.textContent = '0:07'

    drawSetTimer(root, model)

    expect(root.querySelector('.fitkit-runner-clock')?.textContent).toBe('0:00')
  })
})

describe('rest timer screen', () => {
  it('draws without a host, since it has no icons, and hands the view its clock', () => {
    const root = createTestRoot()
    const clock = createRef<HTMLDivElement>()

    render(<RestTimer seconds={75} stop={() => {}} clock={clock} />, root)

    expect(root.querySelector('.fitkit-runner.is-rest')).not.toBeNull()
    expect(clock.current?.textContent).toBe('1:15')
  })
})
