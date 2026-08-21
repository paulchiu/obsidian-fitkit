import type { App } from 'obsidian'

import { normalize } from '../domain/exercise-registry'
import type { ExerciseRegistryEntry } from '../domain/exercise-registry'
import type { FitKitSettings } from '../settings'
import { readExerciseCatalog, type ExerciseCatalogSnapshot } from './exercise-catalog'

export interface ExerciseRegistrySnapshotDiagnostic {
  kind: 'catalog' | 'registry-kind-conflict'
  path?: string
  name?: string
  warnings: string[]
}

export interface ExerciseRegistrySnapshot {
  entries: ExerciseRegistryEntry[]
  diagnostics: ExerciseRegistrySnapshotDiagnostic[]
  catalog: ExerciseCatalogSnapshot
}

export function exerciseRegistryWithVaultNotes(
  app: App,
  settings: FitKitSettings,
): ExerciseRegistryEntry[] {
  return buildExerciseRegistrySnapshot(app, settings).entries
}

export function buildExerciseRegistrySnapshot(
  app: App,
  settings: FitKitSettings,
): ExerciseRegistrySnapshot {
  const catalog = readExerciseCatalog(app, settings)
  const diagnostics: ExerciseRegistrySnapshotDiagnostic[] = catalog.diagnostics.map(
    (diagnostic) => ({
      kind: 'catalog',
      path: diagnostic.path,
      warnings: [...diagnostic.warnings],
    }),
  )
  const savedByKey = new Map<string, ExerciseRegistryEntry>()
  for (const entry of settings.exerciseRegistry) {
    savedByKey.set(normalize(entry.name), entry)
  }
  const deletedKeys = new Set((settings.deletedExercises ?? []).map((name) => normalize(name)))
  const entriesByKey = new Map<string, ExerciseRegistryEntry>()

  for (const note of catalog.entries) {
    const key = normalize(note.name)
    const saved = savedByKey.get(key)
    if (deletedKeys.has(key) && !saved) {
      continue
    }

    if (saved && saved.kind !== note.kind) {
      diagnostics.push({
        kind: 'registry-kind-conflict',
        name: note.name,
        path: note.path,
        warnings: [
          `Saved registry kind '${saved.kind}' differs from note kind '${note.kind}'; using note kind.`,
        ],
      })
    }

    /** Frontmatter unit wins when the note has one; the saved registry unit is only a fallback. */
    entriesByKey.set(key, {
      name: note.name,
      kind: note.kind,
      unit: note.unit ?? saved?.unit,
      aliases: saved ? [...saved.aliases] : [],
    })
  }

  for (const entry of settings.exerciseRegistry) {
    const key = normalize(entry.name)
    if (entriesByKey.has(key)) {
      continue
    }
    entriesByKey.set(key, {
      name: entry.name,
      kind: entry.kind,
      unit: entry.unit,
      aliases: [...entry.aliases],
    })
  }

  const entries = [...entriesByKey.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  )

  return { entries, diagnostics, catalog }
}
