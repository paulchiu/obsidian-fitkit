import type { BodyweightBestSet } from './types'

/**
 * Human-readable labels for a bodyweight ladder rung. Levels are 1-based
 * while the ladder is a plain array, so every lookup is `levels[level - 1]`.
 */

/**
 * Rung name for a table cell, falling back to a bare number when the ladder
 * is missing or no longer names this level (a ladder can shrink after sets
 * were logged against its longer self).
 */
export function bodyweightLevelName(levels: readonly string[] | undefined, level: number): string {
  return levels?.[level - 1] ?? `Level ${level}`
}

/**
 * Numbered rung label for the level menu and the current-level badge.
 */
export function formatBodyweightLevelLabel(
  levels: readonly string[] | undefined,
  level: number,
): string {
  return `${level} · ${bodyweightLevelName(levels, level)}`
}

/** Compact rung label for where the name will not fit. */
export function formatBodyweightLevelShort(level: number): string {
  return `L${level}`
}

/**
 * Pick the best bodyweight set: highest level wins outright, then reps,
 * then load. Sets without a usable level are ignored. Returns null when
 * no set names a rung.
 */
export function pickBestBodyweightSet(
  sets: ReadonlyArray<{ level?: number; reps?: number; load?: number }>,
): BodyweightBestSet | null {
  const candidates = sets.flatMap(toBodyweightSetCandidate)
  const first = candidates[0]
  if (!first) {
    return null
  }
  return candidates.slice(1).reduce(pickHigherBodyweightSet, first)
}

/**
 * Normalize a raw set for comparison. A missing level names no rung, so the
 * set contributes nothing; missing reps or load only break ties, so they
 * read as 0 rather than disqualifying the set.
 */
function toBodyweightSetCandidate(set: {
  level?: number
  reps?: number
  load?: number
}): BodyweightBestSet[] {
  if (set.level === undefined || !Number.isFinite(set.level) || set.level < 1) {
    return []
  }
  const reps = set.reps ?? 0
  const load = set.load ?? 0
  return [
    {
      level: set.level,
      reps: Number.isFinite(reps) && reps > 0 ? reps : 0,
      load: Number.isFinite(load) && load > 0 ? load : 0,
    },
  ]
}

/** Higher level wins outright; reps break level ties, then load. Earlier sets hold exact ties. */
function pickHigherBodyweightSet(
  left: BodyweightBestSet,
  right: BodyweightBestSet,
): BodyweightBestSet {
  if (right.level !== left.level) {
    return right.level > left.level ? right : left
  }
  if (right.reps !== left.reps) {
    return right.reps > left.reps ? right : left
  }
  return right.load > left.load ? right : left
}
