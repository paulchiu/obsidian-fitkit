import type { BodyweightLadder } from './bodyweight-levels'
import {
  frontmatterKind,
  isIntervalMarkerLine,
  isStrengthOnlyFrontmatterKey,
  repairFrontmatter,
  type ExerciseNoteFrontmatterWarning,
  type SkippedExerciseNoteMigrationStatus,
} from './exercise-note-frontmatter'
import {
  ensureChartBlock,
  repairNotesSection,
  repairRecentSessions,
  rewriteRecentSessionsForKind,
  type ExerciseNoteQueryOptions,
  type ExerciseNoteSectionWarning,
} from './exercise-note-sections'
import type { ExerciseRegistry } from './exercise-registry'
import { kindOfType, type ExerciseType } from './exercise-type'
import {
  findFrontmatterBounds,
  findFrontmatterKeyLine,
  insertLines,
  normalizeMarkdownSource,
  replaceLine,
  restoreMarkdownSource,
} from './markdown-lines'

export type { ExerciseNoteQueryOptions } from './exercise-note-sections'

export interface ExerciseNoteMigrationOptions {
  name: string
  registry: ExerciseRegistry
  fitnessRoot: string
}

export type ExerciseNoteMigrationStatus =
  'already' | 'updated' | 'unknown' | SkippedExerciseNoteMigrationStatus

export type ExerciseNoteMigrationWarning =
  ExerciseNoteSectionWarning | ExerciseNoteFrontmatterWarning

export interface ExerciseNoteMigrationResult {
  markdown: string
  changed: boolean
  status: ExerciseNoteMigrationStatus
  unknownKind: boolean
  warnings: ExerciseNoteMigrationWarning[]
}

export interface ExerciseNoteKindUpdateResult {
  markdown: string
  changed: boolean
  warnings: ExerciseNoteMigrationWarning[]
}

export interface ExerciseNoteLevelsUpdateResult {
  markdown: string
  changed: boolean
}

export function migrateExerciseNote(
  source: string,
  options: ExerciseNoteMigrationOptions,
): ExerciseNoteMigrationResult {
  const normalizedSource = normalizeMarkdownSource(source)
  const frontmatter = repairFrontmatter(normalizedSource.markdown, options.name, options.registry)
  if (frontmatter.skippedStatus) {
    return {
      markdown: source,
      changed: false,
      status: frontmatter.skippedStatus,
      unknownKind: false,
      warnings: [],
    }
  }

  const recent = frontmatter.kind
    ? repairRecentSessions(frontmatter.markdown, options, frontmatter.kind)
    : { markdown: frontmatter.markdown, warnings: [] }
  const withChart = ensureChartBlock(recent.markdown)
  const notes = repairNotesSection(withChart, options)
  const markdown = restoreMarkdownSource(notes.markdown, normalizedSource)

  return {
    markdown,
    changed: markdown !== source,
    status: frontmatter.unknownKind ? 'unknown' : markdown === source ? 'already' : 'updated',
    unknownKind: frontmatter.unknownKind,
    warnings: [...frontmatter.warnings, ...recent.warnings, ...notes.warnings],
  }
}

/**
 * Rewrites the `levels:` ladder in an exercise note's frontmatter, inserting a block list
 * after `kind:` when the note has none. A one-line flow list is replaced, not extended.
 */
export function setExerciseNoteLevels(
  source: string,
  levels: BodyweightLadder,
): ExerciseNoteLevelsUpdateResult {
  const normalizedSource = normalizeMarkdownSource(source)
  const bounds = findFrontmatterBounds(normalizedSource.markdown)
  if (bounds.status !== 'found') {
    return { markdown: source, changed: false }
  }
  const lines = normalizedSource.markdown.split('\n')
  const frontmatterLines = lines.slice(bounds.start + 1, bounds.end)
  const replacement = ['levels:', ...levels.map((rung) => `  - ${rung}`)]
  const levelsLineIndex = findFrontmatterKeyLine(frontmatterLines, 'levels')
  const nextFrontmatterLines =
    levelsLineIndex < 0
      ? insertLines(frontmatterLines, levelsInsertIndex(frontmatterLines), replacement)
      : [
          ...frontmatterLines.slice(0, levelsLineIndex),
          ...replacement,
          ...frontmatterLines.slice(
            levelsLineIndex + 1 + countListItemLines(frontmatterLines, levelsLineIndex + 1),
          ),
        ]
  const markdown = [
    ...lines.slice(0, bounds.start + 1),
    ...nextFrontmatterLines,
    ...lines.slice(bounds.end),
  ].join('\n')
  const restored = restoreMarkdownSource(markdown, normalizedSource)
  if (restored === source) {
    return { markdown: source, changed: false }
  }
  return { markdown: restored, changed: true }
}

/** Insertion point for a new ladder: after `kind:`, else after `type:`, else last. */
function levelsInsertIndex(lines: ReadonlyArray<string>): number {
  const kindIndex = findFrontmatterKeyLine(lines, 'kind')
  if (kindIndex >= 0) {
    return kindIndex + 1
  }
  const typeIndex = findFrontmatterKeyLine(lines, 'type')
  if (typeIndex >= 0) {
    return typeIndex + 1
  }
  return lines.length
}

/** Contiguous block-sequence items (`  - rung`) from `start`, for ladder replacement. */
function countListItemLines(lines: ReadonlyArray<string>, start: number): number {
  let count = 0
  for (let index = start; index < lines.length; index += 1) {
    if (!/^\s+-\s/.test(lines[index] ?? '')) {
      break
    }
    count += 1
  }
  return count
}

/**
 * Writes an explicit kind switch into the note's frontmatter (bodyweight drops metric/unit,
 * interval adds `interval: true`) and retargets the Recent sessions query, so the note, which
 * wins on read, is not downgraded back. The ladder is left to the repair pass.
 */
export function setExerciseNoteType(
  source: string,
  type: ExerciseType,
  options: ExerciseNoteQueryOptions,
): ExerciseNoteKindUpdateResult {
  const normalizedSource = normalizeMarkdownSource(source)
  const bounds = findFrontmatterBounds(normalizedSource.markdown)
  if (bounds.status !== 'found') {
    return { markdown: source, changed: false, warnings: [] }
  }

  const kind = kindOfType(type)
  const lines = normalizedSource.markdown.split('\n')
  const frontmatterLines = lines.slice(bounds.start + 1, bounds.end)
  const kindChanged = frontmatterKind(frontmatterLines) !== kind

  const kindLineIndex = findFrontmatterKeyLine(frontmatterLines, 'kind')
  const withKind = !kindChanged
    ? frontmatterLines
    : kindLineIndex < 0
      ? insertLines(frontmatterLines, findFrontmatterKeyLine(frontmatterLines, 'type') + 1, [
          `kind: ${kind}`,
        ])
      : replaceLine(frontmatterLines, kindLineIndex, `kind: ${kind}`)
  const withoutMarker = withKind.filter(
    (line) =>
      !(kind === 'bodyweight' && isStrengthOnlyFrontmatterKey(line)) && !isIntervalMarkerLine(line),
  )
  const nextFrontmatterLines =
    type === 'interval'
      ? insertLines(withoutMarker, findFrontmatterKeyLine(withoutMarker, 'kind') + 1, [
          'interval: true',
        ])
      : withoutMarker

  const withFrontmatter = [
    ...lines.slice(0, bounds.start + 1),
    ...nextFrontmatterLines,
    ...lines.slice(bounds.end),
  ].join('\n')
  const recent = kindChanged
    ? rewriteRecentSessionsForKind(withFrontmatter, options, kind)
    : { markdown: withFrontmatter, warnings: [] }
  const markdown = restoreMarkdownSource(recent.markdown, normalizedSource)

  return { markdown, changed: markdown !== source, warnings: recent.warnings }
}
