import type { BestSet, WeightSet } from './types'

/** Epley formula: weight * (1 + reps / 30). */
export function epleyE1rm(weight: number, reps: number): number {
  return weight * (1 + reps / 30)
}

/**
 * Pick best strength set per tier rules:
 * - Tier A: max e1RM among sets with reps in [1,12] and weight > 0
 * - Tier B: max e1RM among sets with reps >= 1 and weight > 0
 * - Tier C: heaviest set, or most reps when all weights are 0
 * - Sets with reps 0 or blank weight/reps are ignored.
 * Returns null if no sets are eligible.
 */
export function pickBestSet(
  sets: ReadonlyArray<{ weight?: number; reps?: number }>,
): BestSet | null {
  const eligibleSets = sets.filter(isBestSetCandidate)
  if (eligibleSets.length === 0) {
    return null
  }

  const tierA = pickMaxE1rm(
    eligibleSets.filter((set) => set.weight > 0 && set.reps >= 1 && set.reps <= 12),
  )
  if (tierA) {
    return tierA
  }

  const tierB = pickMaxE1rm(eligibleSets.filter((set) => set.weight > 0 && set.reps >= 1))
  if (tierB) {
    return tierB
  }

  if (eligibleSets.every((set) => set.weight === 0)) {
    const mostReps = pickByScore(eligibleSets, (set) => set.reps)
    return { weight: mostReps.weight, reps: mostReps.reps, e1rm: 0 }
  }

  const heaviest = pickByScore(eligibleSets, (set) => set.weight)
  return {
    weight: heaviest.weight,
    reps: heaviest.reps,
    e1rm: epleyE1rm(heaviest.weight, heaviest.reps),
  }
}

export function pickHeaviestSet(
  sets: ReadonlyArray<{ weight?: number; reps?: number }>,
): WeightSet | null {
  const candidates = sets.filter(isWeightedSetCandidate)
  const first = candidates[0]
  if (!first) {
    return null
  }

  return candidates.slice(1).reduce(pickHeavierSet, first)
}

function isBestSetCandidate(set: { weight?: number; reps?: number }): set is {
  weight: number
  reps: number
} {
  return set.weight !== undefined && set.reps !== undefined && set.reps !== 0
}

function isWeightedSetCandidate(set: { weight?: number; reps?: number }): set is WeightSet {
  return (
    set.weight !== undefined &&
    set.reps !== undefined &&
    Number.isFinite(set.weight) &&
    Number.isFinite(set.reps) &&
    set.weight > 0 &&
    set.reps > 0
  )
}

function pickMaxE1rm(sets: ReadonlyArray<{ weight: number; reps: number }>): BestSet | null {
  if (sets.length === 0) {
    return null
  }

  const best = pickByScore(sets, (set) => epleyE1rm(set.weight, set.reps))
  return {
    weight: best.weight,
    reps: best.reps,
    e1rm: epleyE1rm(best.weight, best.reps),
  }
}

function pickHeavierSet(left: WeightSet, right: WeightSet): WeightSet {
  if (right.weight > left.weight) {
    return right
  }
  if (right.weight === left.weight && right.reps > left.reps) {
    return right
  }
  return left
}

function pickByScore<T>(items: ReadonlyArray<T>, score: (item: T) => number): T {
  const first = items[0]
  if (first === undefined) {
    throw new Error('Cannot pick from an empty collection.')
  }

  return items.slice(1).reduce((best, item) => (score(item) > score(best) ? item : best), first)
}
