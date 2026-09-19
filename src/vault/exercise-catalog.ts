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
  /** Present only when a bodyweight note declares a usable levels ladder. */
  levels?: string[]
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
 * Path of the exercise note that owns `name`, or null when no note exists.
 * A catalog hit wins; the folder scan only covers notes whose frontmatter
 * never reached the cache.
 */
export function findExerciseNotePath(
  app: App,
  settings: FitKitSettings,
  name: string,
): string | null {
  const key = normalize(name)
  const catalog = readExerciseCatalog(app, settings)
  const catalogPath = catalog.entries.find((entry) => normalize(entry.name) === key)?.path
  if (catalogPath !== undefined) {
    return catalogPath
  }
  return findExerciseNoteFile(app, settings, name)?.path ?? null
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

    const ladder = levelsFromFrontmatter(frontmatter, kind)
    entries.push({
      name: file.basename,
      path: file.path,
      kind,
      unit: unitFromFrontmatter(frontmatter, kind),
      levels: ladder.levels,
    })
    if (ladder.warning) {
      diagnostics.push({ path: file.path, warnings: [ladder.warning] })
    }
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

/**
 * Bodyweight-only rule: only bodyweight notes carry a ladder, so other kinds
 * read as absent without a warning. Frontmatter is user-edited, so anything
 * that is not a usable rung list warns instead of throwing.
 */
function levelsFromFrontmatter(
  frontmatter: CachedMetadata['frontmatter'] | undefined,
  kind: ExerciseKind,
): { levels?: string[]; warning?: string } {
  if (kind !== 'bodyweight') {
    return {}
  }
  const raw = readFrontmatterField(frontmatter, 'levels')
  if (raw === undefined || raw === null) {
    return {}
  }
  if (!Array.isArray(raw) && typeof raw !== 'string') {
    return { warning: 'Exercise note has an invalid levels list.' }
  }
  const candidates: unknown[] = Array.isArray(raw) ? raw : [raw]
  const rungs: string[] = []
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      return { warning: 'Exercise note has an invalid levels list.' }
    }
    rungs.push(candidate)
  }
  const levels = rungs.map((rung) => rung.trim()).filter((rung) => rung.length > 0)
  if (levels.length === 0) {
    return { warning: 'Exercise note has an invalid levels list.' }
  }
  return { levels }
}

function readFrontmatterField(
  frontmatter: CachedMetadata['frontmatter'] | undefined,
  key: string,
): unknown {
  const record: Record<string, unknown> | null = frontmatter ?? null
  return record === null ? undefined : record[key]
}
