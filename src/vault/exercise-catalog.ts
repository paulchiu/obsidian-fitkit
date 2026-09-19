import type { App, CachedMetadata, TFile } from 'obsidian'

import { parseExerciseKind } from '../domain/exercise-kind'
import { normalize, type ExerciseKind } from '../domain/exercise-registry'
import { parseWeightUnit, type WeightUnit } from '../domain/weight-unit'
import type { FitKitSettings } from '../settings'
import { exercisesFolder } from '../settings-paths'
import { markdownFilesInFolder } from './folder-scan'

export interface ExerciseCatalogEntry {
  name: string
  path: string
  kind: ExerciseKind
  /** Present only when the note frontmatter has an explicit, valid unit. */
  unit?: WeightUnit
}

export interface ExerciseCatalogDiagnostic {
  path: string
  warnings: string[]
}

export interface ExerciseCatalogSnapshot {
  entries: ExerciseCatalogEntry[]
  diagnostics: ExerciseCatalogDiagnostic[]
}

/**
 * Bypasses the catalog because malformed frontmatter is absent from Obsidian's
 * metadata cache and therefore from `readExerciseCatalog`. Resolving by folder
 * and basename lets callers distinguish an unreadable note from no note.
 */
export function findExerciseNoteFile(
  app: App,
  settings: FitKitSettings,
  name: string,
): TFile | null {
  const key = normalize(name)
  return (
    markdownFilesInFolder(app, exercisesFolder(settings)).find(
      (file) => normalize(file.basename) === key,
    ) ?? null
  )
}

export function readExerciseCatalog(app: App, settings: FitKitSettings): ExerciseCatalogSnapshot {
  const entries: ExerciseCatalogEntry[] = []
  const diagnostics: ExerciseCatalogDiagnostic[] = []

  for (const file of markdownFilesInFolder(app, exercisesFolder(settings))) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
    if (!isExerciseFrontmatter(frontmatter)) {
      continue
    }

    const kind = parseExerciseKind(readFrontmatterField(frontmatter, 'kind'))
    if (!kind) {
      diagnostics.push({
        path: file.path,
        warnings: ['Exercise note is missing a valid kind.'],
      })
      continue
    }

    entries.push({
      name: file.basename,
      path: file.path,
      kind,
      unit: unitFromFrontmatter(frontmatter, kind),
    })
  }

  entries.sort((left, right) => left.name.localeCompare(right.name))
  diagnostics.sort((left, right) => left.path.localeCompare(right.path))

  return { entries, diagnostics }
}

function isExerciseFrontmatter(frontmatter: CachedMetadata['frontmatter'] | undefined): boolean {
  const type = readFrontmatterField(frontmatter, 'type')
  return typeof type === 'string' && type.trim().toLowerCase() === 'exercise'
}

/** Strength-only rule: only strength notes carry a unit; other kinds have none. */
function unitFromFrontmatter(
  frontmatter: CachedMetadata['frontmatter'] | undefined,
  kind: ExerciseKind,
): WeightUnit | undefined {
  return kind === 'strength'
    ? (parseWeightUnit(readFrontmatterField(frontmatter, 'unit')) ?? undefined)
    : undefined
}

function readFrontmatterField(
  frontmatter: CachedMetadata['frontmatter'] | undefined,
  key: string,
): unknown {
  const record: Record<string, unknown> | null = frontmatter ?? null
  return record === null ? undefined : record[key]
}
