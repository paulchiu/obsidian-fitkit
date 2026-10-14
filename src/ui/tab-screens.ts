/** Keeps the device screen on while a screen holds the tab; the runner's cue player is one. */
export interface WakeHold {
  keepAwake(): void
  release(): void
}

/** `bank` keeps the time a screen has run in the rows; `discard` drops it. */
export type ScreenStop = 'bank' | 'discard'

export interface TabScreensDeps<S> {
  /** The element a screen scrolls to the top and gives back where it was. */
  scroller: () => HTMLElement
  /** Draws the tab for whatever `current()` now returns. */
  render: () => void
  /** Ends what `screen` is timing. `current()` still returns it while this runs. */
  stop: (screen: S, how: ScreenStop) => void
}

export interface EnterOptions {
  wake: WakeHold
  /** Where leaving scrolls back to; defaults to where the tab is scrolled now. */
  returnScrollTop?: number
  /** Leaves the scroll alone, for a screen reopened from the note as it loads. */
  keepScroll?: boolean
}

export interface TabScreens<S> {
  current(): S | null
  /** Shows `screen` in place of whatever held the tab, which is banked and ended first. Does not render. */
  enter(screen: S, options: EnterOptions): void
  /** Runs `tick` every `everyMs` for the current screen, replacing any clock it had. */
  startClock(tick: () => void, everyMs: number): void
  stopClock(): void
  /** Ends the current screen and renders the tab back where it was scrolled. */
  leave(): void
  /** Ends the current screen without rendering, for closing, swapping and reloading the note. */
  teardown(how: ScreenStop): void
  /** Takes the wake lock again, since the OS drops it whenever the app is hidden. */
  wakeAgain(): void
}

interface Held<S> {
  screen: S
  wake: WakeHold
  returnScrollTop: number
}

/**
 * Owns the tab while a full-tab screen (set timer, rest timer, interval run) is
 * up: one screen at a time, with its clock, wake lock and the scroll to return to.
 */
export function createTabScreens<S>(deps: TabScreensDeps<S>): TabScreens<S> {
  let held: Held<S> | null = null
  let clock: number | null = null

  const stopClock = (): void => {
    if (clock !== null) {
      window.clearInterval(clock)
      clock = null
    }
  }

  const end = (how: ScreenStop): Held<S> | null => {
    const ending = held
    if (!ending) {
      return null
    }
    deps.stop(ending.screen, how)
    stopClock()
    ending.wake.release()
    held = null
    return ending
  }

  return {
    current: () => held?.screen ?? null,
    enter: (screen, { wake, returnScrollTop, keepScroll }) => {
      end('bank')
      const scroller = deps.scroller()
      held = { screen, wake, returnScrollTop: returnScrollTop ?? scroller.scrollTop }
      wake.keepAwake()
      if (!keepScroll) {
        scroller.scrollTop = 0
      }
    },
    startClock: (tick, everyMs) => {
      if (!held) {
        return
      }
      stopClock()
      clock = window.setInterval(tick, everyMs)
    },
    stopClock,
    leave: () => {
      const left = end('discard')
      if (left) {
        deps.render()
        deps.scroller().scrollTop = left.returnScrollTop
      }
    },
    teardown: (how) => {
      end(how)
    },
    wakeAgain: () => held?.wake.keepAwake(),
  }
}
