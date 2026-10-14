import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTabScreens, type ScreenStop, type WakeHold } from '../../src/ui/tab-screens'

interface Screen {
  name: string
}

/** A wake hold that logs what was asked of it under its own name. */
const wakeFor = (name: string, log: string[]): WakeHold => ({
  keepAwake: () => void log.push(`${name} awake`),
  release: () => void log.push(`${name} released`),
})

interface Rig {
  screens: ReturnType<typeof createTabScreens<Screen>>
  scroller: { scrollTop: number }
  log: string[]
  /** Interval callbacks still registered, by id. */
  intervals: Map<number, () => void>
}

function rig(): Rig {
  const log: string[] = []
  const scroller = { scrollTop: 0 }
  const intervals = new Map<number, () => void>()
  let nextId = 1
  vi.stubGlobal('window', {
    setInterval: (callback: () => void, ms: number): number => {
      const id = nextId++
      intervals.set(id, callback)
      log.push(`clock ${ms}`)
      return id
    },
    clearInterval: (id: number): void => {
      intervals.delete(id)
    },
  })
  const screens = createTabScreens<Screen>({
    scroller: () => scroller as unknown as HTMLElement,
    render: () => void log.push(`render at ${scroller.scrollTop}`),
    stop: (screen: Screen, how: ScreenStop) => {
      log.push(`stop ${screen.name} ${how} (current ${screens.current()?.name ?? 'none'})`)
    },
  })
  return { screens, scroller, log, intervals }
}

describe('createTabScreens', () => {
  let r: Rig

  beforeEach(() => {
    r = rig()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('takes over the tab from the top and holds the screen awake', () => {
    r.scroller.scrollTop = 420

    r.screens.enter({ name: 'rest' }, { wake: wakeFor('rest', r.log) })

    expect(r.screens.current()).toEqual({ name: 'rest' })
    expect(r.scroller.scrollTop).toBe(0)
    expect(r.log).toEqual(['rest awake'])
  })

  it('leaves the scroll alone for a screen reopened from the note', () => {
    r.scroller.scrollTop = 420

    r.screens.enter({ name: 'run' }, { wake: wakeFor('run', r.log), keepScroll: true })

    expect(r.scroller.scrollTop).toBe(420)
  })

  it('gives the tab back where the list was scrolled, after rendering it', () => {
    r.scroller.scrollTop = 420
    r.screens.enter({ name: 'rest' }, { wake: wakeFor('rest', r.log) })
    r.screens.startClock(() => undefined, 1000)

    r.screens.leave()

    expect(r.screens.current()).toBeNull()
    expect(r.intervals.size).toBe(0)
    expect(r.scroller.scrollTop).toBe(420)
    expect(r.log).toEqual([
      'rest awake',
      'clock 1000',
      'stop rest discard (current rest)',
      'rest released',
      'render at 0',
    ])
  })

  it('returns to the scroll it was given rather than the current one', () => {
    r.scroller.scrollTop = 420
    r.screens.enter({ name: 'set' }, { wake: wakeFor('set', r.log), returnScrollTop: 0 })
    r.scroller.scrollTop = 0

    r.screens.leave()

    expect(r.scroller.scrollTop).toBe(0)
  })

  it('banks and ends the screen showing before another takes the tab', () => {
    r.scroller.scrollTop = 300
    r.screens.enter({ name: 'set' }, { wake: wakeFor('set', r.log) })
    r.screens.startClock(() => undefined, 1000)

    r.screens.enter({ name: 'rest' }, { wake: wakeFor('rest', r.log) })

    expect(r.screens.current()).toEqual({ name: 'rest' })
    expect(r.intervals.size).toBe(0)
    expect(r.log).toEqual([
      'set awake',
      'clock 1000',
      'stop set bank (current set)',
      'set released',
      'rest awake',
    ])
  })

  it('ends the screen the way it is told without rendering or scrolling', () => {
    r.screens.enter({ name: 'run' }, { wake: wakeFor('run', r.log) })
    r.screens.startClock(() => undefined, 500)
    r.scroller.scrollTop = 0

    r.screens.teardown('discard')

    expect(r.screens.current()).toBeNull()
    expect(r.intervals.size).toBe(0)
    expect(r.scroller.scrollTop).toBe(0)
    expect(r.log).toEqual([
      'run awake',
      'clock 500',
      'stop run discard (current run)',
      'run released',
    ])
  })

  it('does nothing when no screen holds the tab', () => {
    r.scroller.scrollTop = 420

    r.screens.leave()
    r.screens.teardown('bank')
    r.screens.wakeAgain()
    r.screens.startClock(() => undefined, 1000)

    expect(r.scroller.scrollTop).toBe(420)
    expect(r.intervals.size).toBe(0)
    expect(r.log).toEqual([])
  })

  it('keeps one clock per screen, replacing it on restart and dropping it on stop', () => {
    const ticks: string[] = []
    r.screens.enter({ name: 'set' }, { wake: wakeFor('set', r.log) })

    r.screens.startClock(() => void ticks.push('first'), 1000)
    r.screens.startClock(() => void ticks.push('second'), 1000)
    for (const tick of r.intervals.values()) {
      tick()
    }
    r.screens.stopClock()

    expect(ticks).toEqual(['second'])
    expect(r.intervals.size).toBe(0)
    expect(r.screens.current()).toEqual({ name: 'set' })
  })

  it('takes the wake lock again for the screen holding the tab', () => {
    r.screens.enter({ name: 'run' }, { wake: wakeFor('run', r.log) })

    r.screens.wakeAgain()

    expect(r.log).toEqual(['run awake', 'run awake'])
  })
})
