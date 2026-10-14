import { describe, expect, it } from 'vitest'

import { createCuePlayer } from '../../src/ui/interval-cues'

/** A wake lock that records requests and can drop its sentinels the way a browser does when the page hides. */
const fakeWakeLock = () => {
  const events: string[] = []
  const sentinels: Array<{ drop: () => void }> = []
  const pending: Array<() => void> = []
  let held = true
  const wakeLock = {
    request: (type: string): Promise<WakeLockSentinel> => {
      events.push(`acquire ${type}`)
      const listeners: Array<() => void> = []
      const sentinel = {
        released: false,
        addEventListener: (name: string, listener: () => void) => {
          if (name === 'release') {
            listeners.push(listener)
          }
        },
        release: async () => {
          sentinel.released = true
          events.push('release')
          listeners.forEach((listener) => listener())
        },
      }
      sentinels.push({
        drop: () => {
          sentinel.released = true
          listeners.forEach((listener) => listener())
        },
      })
      const granted = sentinel as unknown as WakeLockSentinel
      return held
        ? Promise.resolve(granted)
        : new Promise((resolve) => pending.push(() => resolve(granted)))
    },
  }
  const win = { navigator: { wakeLock } } as unknown as Window
  return {
    win,
    events,
    dropAll: () => sentinels.forEach((sentinel) => sentinel.drop()),
    holdRequests: () => {
      held = false
    },
    grantPending: () => pending.splice(0).forEach((grant) => grant()),
  }
}

/** Lets the granted requests' then-callbacks run. */
const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 3; tick++) {
    await Promise.resolve()
  }
}

describe('createCuePlayer wake lock', () => {
  it('takes the lock again after the platform drops it while the page was hidden', async () => {
    const lock = fakeWakeLock()
    const player = createCuePlayer(lock.win, true)

    player.keepAwake()
    await settle()
    lock.dropAll()
    player.keepAwake()
    await settle()

    expect(lock.events).toEqual(['acquire screen', 'acquire screen'])
  })

  it('asks once when asked twice before the first request is granted', async () => {
    const lock = fakeWakeLock()
    lock.holdRequests()
    const player = createCuePlayer(lock.win, true)

    player.keepAwake()
    player.keepAwake()
    lock.grantPending()
    await settle()
    player.release()
    await settle()

    expect(lock.events).toEqual(['acquire screen', 'release'])
  })
})
