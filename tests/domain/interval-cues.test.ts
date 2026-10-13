import { describe, expect, it } from 'vitest'

import { cueBetween } from '../../src/domain/interval-cues'
import type { RunPhase } from '../../src/domain/interval-run'

const work = (rep: number, remaining: number | null): RunPhase => ({
  kind: 'work',
  rep,
  elapsed: 0,
  remaining,
  paused: false,
})

describe('cueBetween', () => {
  it('counts down with a short cue as each of the last three seconds arrives', () => {
    expect([
      cueBetween(work(1, 5), work(1, 4)),
      cueBetween(work(1, 4), work(1, 3)),
      cueBetween(work(1, 3), work(1, 3)),
      cueBetween(work(1, 2), work(1, 1)),
    ]).toEqual([null, 'count', null, 'count'])
  })

  it('gives the phase change its own cue', () => {
    const rest: RunPhase = { kind: 'rest', rep: 1, elapsed: 0, remaining: 90, paused: false }

    expect([cueBetween(work(1, 0), rest), cueBetween(rest, work(2, 30))]).toEqual(['go', 'go'])
  })

  it('stays quiet for open work, which has no countdown', () => {
    expect(cueBetween(work(1, null), work(1, null))).toBeNull()
  })

  it('counts down the end of rest too', () => {
    const rest = (remaining: number): RunPhase => ({
      kind: 'rest',
      rep: 1,
      elapsed: 0,
      remaining,
      paused: false,
    })

    expect([cueBetween(rest(4), rest(3)), cueBetween(rest(1), rest(0))]).toEqual(['count', null])
  })

  it('gives work running straight into the next step a cue of its own', () => {
    expect(cueBetween(work(1, 0), work(2, 30))).toBe('shift')
  })
})
