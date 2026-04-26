import { describe, expect, it } from 'vitest'

import { epleyE1rm, pickBestSet } from '../src/domain/epley'

describe('index helpers', () => {
  it('calculates Epley e1RM', () => {
    expect(epleyE1rm(100, 5)).toBeCloseTo(100 * (1 + 5 / 30), 5)
  })

  it('picks the best Tier A set from the 1 to 12 rep range', () => {
    expect(
      pickBestSet([
        { weight: 50, reps: 10 },
        { weight: 60, reps: 8 },
        { weight: 80, reps: 1 },
      ]),
    ).toEqual({
      weight: 80,
      reps: 1,
      e1rm: epleyE1rm(80, 1),
    })
  })

  it('picks the best Tier B set when all reps are above 12', () => {
    expect(
      pickBestSet([
        { weight: 50, reps: 20 },
        { weight: 45, reps: 30 },
      ]),
    ).toEqual({
      weight: 45,
      reps: 30,
      e1rm: epleyE1rm(45, 30),
    })
  })

  it('picks the most reps for Tier C when all weights are zero', () => {
    expect(
      pickBestSet([
        { weight: 0, reps: 6 },
        { weight: 0, reps: 12 },
      ]),
    ).toEqual({
      weight: 0,
      reps: 12,
      e1rm: 0,
    })
  })

  it('returns null for empty sets', () => {
    expect(pickBestSet([])).toBeNull()
  })

  it('returns null when every strength set has zero reps', () => {
    expect(
      pickBestSet([
        { weight: 20, reps: 0 },
        { weight: 30, reps: 0 },
      ]),
    ).toBeNull()
  })

  it('picks the best set from non-zero-rep candidates', () => {
    expect(
      pickBestSet([
        { weight: 200, reps: 0 },
        { weight: 80, reps: 5 },
        { weight: 90, reps: 3 },
      ]),
    ).toEqual({
      weight: 90,
      reps: 3,
      e1rm: epleyE1rm(90, 3),
    })
  })
})
