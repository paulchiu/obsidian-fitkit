import type { App } from 'obsidian'

import {
  intervalMarker,
  normalize,
  overlayKnownKeys,
  type ExerciseKind,
} from '../domain/exercise-registry'
import type { WeightUnit } from '../domain/weight-unit'
import type { FitKitSettings } from '../settings'
import { collectHistoryOnlyCandidates } from './exercise-registry-history'
import { buildExerciseRegistrySnapshot } from './exercise-registry-vault'

export type RegistryRowProvenance = 'note' | 'overlay' | 'history'

export interface RegistryTableRow {
  name: string
  kind: ExerciseKind
  unit?: WeightUnit
  levels?: string[]
  interval?: true
  aliases: string[]
  /**
   * 'note': backed by an exercise note, which wins on read. 'overlay': a no-note entry, fully editable.
   * 'history': seen only in workout notes.
   */
  provenance: RegistryRowProvenance
  notePath: string | null
  sourcePaths: string[]
}

/**
 * The settings table's registry list: every exercise note, overlay entry and history-only name (minus tombstones),
 * each tagged with the provenance that decides whether editing it takes effect.
 */
export async function buildRegistryTableRows(
  app: App,
  settings: FitKitSettings,
): Promise<RegistryTableRow[]> {
  const snapshot = buildExerciseRegistrySnapshot(app, settings)
  const notePathByKey = new Map(
    snapshot.catalog.entries.map((entry) => [normalize(entry.name), entry.path] as const),
  )
  const knownKeys = new Set([
    ...notePathByKey.keys(),
    ...overlayKnownKeys(settings.exerciseRegistry),
  ])
  const deletedKeys = new Set((settings.deletedExercises ?? []).map((name) => normalize(name)))

  const rows: RegistryTableRow[] = snapshot.entries.map((entry) => {
    const key = normalize(entry.name)
    const notePath = notePathByKey.get(key) ?? null
    return {
      name: entry.name,
      kind: entry.kind,
      unit: entry.unit,
      levels: entry.levels ? [...entry.levels] : undefined,
      ...intervalMarker(entry),
      aliases: entry.aliases,
      provenance: notePath ? 'note' : 'overlay',
      notePath,
      sourcePaths: [],
    }
  })

  const historyOnly = await collectHistoryOnlyCandidates(app, settings, knownKeys, 'cached')
  for (const candidate of historyOnly) {
    if (deletedKeys.has(normalize(candidate.name))) {
      continue
    }
    rows.push({
      name: candidate.name,
      kind: candidate.kind,
      unit: undefined,
      levels: undefined,
      aliases: [],
      provenance: 'history',
      notePath: null,
      sourcePaths: candidate.sourcePaths,
    })
  }

  rows.sort((left, right) => left.name.localeCompare(right.name))
  return rows
}

/**
 * Rows whose name or an alias contains the (normalized) query as a
 * substring. An empty query returns every row unchanged.
 */
export function filterRegistryTableRows(
  rows: readonly RegistryTableRow[],
  query: string,
): RegistryTableRow[] {
  const queryKey = normalize(query)
  if (!queryKey) {
    return [...rows]
  }
  return rows.filter((row) => {
    if (normalize(row.name).includes(queryKey)) {
      return true
    }
    return row.aliases.some((alias) => normalize(alias).includes(queryKey))
  })
}
