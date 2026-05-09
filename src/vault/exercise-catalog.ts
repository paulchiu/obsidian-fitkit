import type { App, CachedMetadata, TFile } from 'obsidian'

import type { ExerciseKind } from '../domain/exercise-registry'
import type { FitKitSettings } from '../settings'
import { exercisesFolder, normalizeFolder } from '../settings-paths'

export interface ExerciseCatalogEntry {
  name: string
  path: string
  kind: ExerciseKind
}

export interface ExerciseCatalogDiagnostic {
  path: string
  warnings: string[]
}

export interface ExerciseCatalogSnapshot {
  entries: ExerciseCatalogEntry[]
  diagnostics: ExerciseCatalogDiagnostic[]
}

export function readExerciseCatalog(app: App, settings: FitKitSettings): ExerciseCatalogSnapshot {
  const folder = normalizeFolder(exercisesFolder(settings))
  const entries: ExerciseCatalogEntry[] = []
  const diagnostics: ExerciseCatalogDiagnostic[] = []

  for (const file of app.vault.getMarkdownFiles()) {
    if (!isFileInFolder(file, folder)) {
      continue
    }

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
    })
  }

  entries.sort((left, right) => left.name.localeCompare(right.name))
  diagnostics.sort((left, right) => left.path.localeCompare(right.path))

  return { entries, diagnostics }
}

function isFileInFolder(file: TFile, folder: string): boolean {
  return file.path.startsWith(`${folder}/`)
}

function isExerciseFrontmatter(frontmatter: CachedMetadata['frontmatter'] | undefined): boolean {
  const type = readFrontmatterField(frontmatter, 'type')
  return typeof type === 'string' && type.trim().toLowerCase() === 'exercise'
}

function parseExerciseKind(value: unknown): ExerciseKind | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'strength' || normalized === 'duration') {
    return normalized
  }
  return null
}

function readFrontmatterField(
  frontmatter: CachedMetadata['frontmatter'] | undefined,
  key: string,
): unknown {
  const record: Record<string, unknown> | null = frontmatter ?? null
  return record === null ? undefined : record[key]
}
