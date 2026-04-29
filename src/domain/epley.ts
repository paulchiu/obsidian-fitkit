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
  sets: ReadonlyArray<{ weight?: number; reps?: number; set?: number }>,
): WeightSet | null {
  const candidates = sets.map(toHeaviestSetCandidate).filter((set) => set !== null)
  const first = candidates[0]
  if (!first) {
    return null
  }

  const positiveWeightSets = candidates.filter((set) => set.weight > 0)
  const firstPositive = positiveWeightSets[0]
  const picked = firstPositive
    ? positiveWeightSets.slice(1).reduce(pickHeavierSet, firstPositive)
    : candidates.slice(1).reduce(pickMoreRepsSet, first)
  return toWeightSet(picked)
}

function isBestSetCandidate(set: { weight?: number; reps?: number }): set is {
  weight: number
  reps: number
} {
  return set.weight !== undefined && set.reps !== undefined && set.reps !== 0
}

interface WeightSetCandidate extends WeightSet {
  set?: number
  setNumber: number
}

function toHeaviestSetCandidate(
  set: { weight?: number; reps?: number; set?: number },
  index: number,
): WeightSetCandidate | null {
  if (
    set.weight === undefined ||
    set.reps === undefined ||
    !Number.isFinite(set.weight) ||
    !Number.isFinite(set.reps) ||
    set.weight < 0 ||
    set.reps <= 0
  ) {
    return null
  }
  return {
    weight: set.weight,
    reps: set.reps,
    set: set.set,
    setNumber: set.set ?? index + 1,
  }
}

function toWeightSet(candidate: WeightSetCandidate): WeightSet {
  if (candidate.set === undefined) {
    return { weight: candidate.weight, reps: candidate.reps }
  }
  const result = { weight: candidate.weight, reps: candidate.reps, set: candidate.set }
  return result
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

function pickHeavierSet(left: WeightSetCandidate, right: WeightSetCandidate): WeightSetCandidate {
  if (right.weight > left.weight) {
    return right
  }
  if (right.weight === left.weight && right.reps > left.reps) {
    return right
  }
  if (
    right.weight === left.weight &&
    right.reps === left.reps &&
    right.setNumber < left.setNumber
  ) {
    return right
  }
  return left
}

function pickMoreRepsSet(left: WeightSetCandidate, right: WeightSetCandidate): WeightSetCandidate {
  if (right.reps > left.reps) {
    return right
  }
  if (right.reps === left.reps && right.setNumber < left.setNumber) {
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
