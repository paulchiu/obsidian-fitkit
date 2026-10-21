import type { App } from 'obsidian'

import {
  normalize,
  overlayKnownKeys,
  type ExerciseKind,
  type ExerciseRegistryEntry,
} from '../domain/exercise-registry'
import type { FitKitSettings } from '../settings'
import { collectHistoryOnlyCandidates } from './exercise-registry-history'
import { readExerciseCatalog } from './exercise-catalog'

export interface RegistryBackfillPlan {
  entriesToAdd: ExerciseRegistryEntry[]
  addedFromNotes: number
  addedFromHistory: number
  alreadyPresent: number
  skippedTombstoned: number
}

interface BackfillSource {
  name: string
  kind: ExerciseKind
}

/**
 * Pure merge step for "Rebuild registry": adds a unit-less overlay entry for every note-backed or
 * history-only name missing from it (matched via `normalize()` over names and aliases).
 * Idempotent, and dedupes sources that normalize to the same key.
 */
export function computeRegistryBackfillPlan(
  catalogEntries: readonly BackfillSource[],
  historyOnlyCandidates: readonly BackfillSource[],
  existingOverlay: readonly ExerciseRegistryEntry[],
  deletedExercises: readonly string[],
): RegistryBackfillPlan {
  const knownKeys = overlayKnownKeys(existingOverlay)
  const deletedKeys = new Set(deletedExercises.map((name) => normalize(name)))
  const entriesToAdd: ExerciseRegistryEntry[] = []
  let addedFromNotes = 0
  let addedFromHistory = 0
  let alreadyPresent = 0
  let skippedTombstoned = 0

  const consider = (source: BackfillSource, fromNotes: boolean): void => {
    const key = normalize(source.name)
    if (knownKeys.has(key)) {
      alreadyPresent += 1
      return
    }
    if (deletedKeys.has(key)) {
      skippedTombstoned += 1
      return
    }
    knownKeys.add(key)
    entriesToAdd.push({ name: source.name, kind: source.kind, aliases: [] })
    if (fromNotes) {
      addedFromNotes += 1
    } else {
      addedFromHistory += 1
    }
  }

  for (const note of catalogEntries) {
    consider(note, true)
  }
  for (const candidate of historyOnlyCandidates) {
    consider(candidate, false)
  }

  entriesToAdd.sort((left, right) => left.name.localeCompare(right.name))
  return { entriesToAdd, addedFromNotes, addedFromHistory, alreadyPresent, skippedTombstoned }
}

/**
 * Gathers the current exercise catalog and history-only candidates from the
 * vault (fresh reads, since this drives a settings write) and computes the
 * backfill plan against them.
 */
export async function buildRegistryBackfillPlan(
  app: App,
  settings: FitKitSettings,
): Promise<RegistryBackfillPlan> {
  const catalog = readExerciseCatalog(app, settings)
  const noteKeys = new Set(catalog.entries.map((entry) => normalize(entry.name)))
  const knownKeys = new Set([...noteKeys, ...overlayKnownKeys(settings.exerciseRegistry)])
  const historyOnlyCandidates = await collectHistoryOnlyCandidates(
    app,
    settings,
    knownKeys,
    'fresh',
  )

  return computeRegistryBackfillPlan(
    catalog.entries,
    historyOnlyCandidates,
    settings.exerciseRegistry,
    settings.deletedExercises ?? [],
  )
}

/**
 * Appends a backfill plan's new entries to the overlay, sorted by name.
 * Existing entries are returned untouched (aliases, kind, and unit are the
 * user's curation).
 */
export function applyRegistryBackfillPlan(
  existingOverlay: readonly ExerciseRegistryEntry[],
  entriesToAdd: readonly ExerciseRegistryEntry[],
): ExerciseRegistryEntry[] {
  return [
    ...existingOverlay.map((entry) => ({ ...entry, aliases: [...entry.aliases] })),
    ...entriesToAdd.map((entry) => ({ ...entry, aliases: [...entry.aliases] })),
  ].sort((left, right) => left.name.localeCompare(right.name))
}
