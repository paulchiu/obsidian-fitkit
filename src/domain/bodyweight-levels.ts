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

/** A logged position whose rung name an edit would change, with both meanings. */
export interface BodyweightLadderChange {
  level: number
  from: string
  to: string
}

/**
 * Occupied positions whose rung name differs between ladders, in level
 * order. Appending rungs changes nothing logged and reports nothing; only
 * levels some logged set occupies can appear.
 */
export function describeBodyweightLadderChanges(
  oldLevels: readonly string[],
  newLevels: readonly string[],
  occupiedLevels: readonly number[],
): BodyweightLadderChange[] {
  const seen = new Set<number>()
  const changes: BodyweightLadderChange[] = []
  for (const level of [...occupiedLevels].sort((left, right) => left - right)) {
    if (!Number.isInteger(level) || level < 1 || seen.has(level)) {
      continue
    }
    seen.add(level)
    const from = bodyweightLevelName(oldLevels, level)
    const to = bodyweightLevelName(newLevels, level)
    if (from !== to) {
      changes.push({ level, from, to })
    }
  }
  return changes
}

/**
 * Rung names from a one-per-line edit box. Blank lines carry no rung, so
 * they drop out; an all-blank box parses to empty, which the caller refuses.
 */
export function parseBodyweightLadderText(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
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
