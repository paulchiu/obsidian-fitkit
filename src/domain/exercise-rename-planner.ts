/**
 * Pure planner for renaming or merging an exercise: note file, `[exercise:: [[Name]]]` and `## [[Name]]` rewrites, alias folding.
 * Only exact bare wikilinks are rewritten; pathed or aliased links need vault resolution, so they are counted as `staleOccurrences`.
 * See `applyExerciseRenamePlan` (src/vault/exercise-rename-apply.ts) for execution.
 */

import { dirnameOf } from '../settings-paths'
import { exerciseTypeOf } from './exercise-type'
import {
  dedupeAliases,
  normalize,
  type ExerciseKind,
  type ExerciseRegistryEntry,
} from './exercise-registry'
import { escapeRegExp } from './regex-utils'
import type { WeightUnit } from './weight-unit'

export interface ExerciseRenameCatalogEntry {
  name: string
  path: string
  kind: ExerciseKind
}

export interface ExerciseRenameWorkoutNoteInput {
  path: string
  text: string
}

export interface ExerciseRenamePlanInput {
  oldName: string
  newName: string
  registry: readonly ExerciseRegistryEntry[]
  catalog: readonly ExerciseRenameCatalogEntry[]
  deletedExercises: readonly string[]
  workoutNotes: readonly ExerciseRenameWorkoutNoteInput[]
  /**
   * Raw text of the note being renamed/merged away, when one exists. Used
   * only to detect user prose in its `## Notes` section for a merge.
   */
  sourceNoteText?: string
  /** True when a matching source file exists but is absent from the readable catalog. */
  sourceNoteUnreadable?: boolean
  /**
   * True when the destination filename for `newName` is already occupied by
   * a file the caller could not match to `newName` in `catalog` (an
   * unrelated file, not this rename's own source or target note).
   */
  targetPathOccupiedByUnrelatedFile?: boolean
}

export type ExerciseRenameOperation = 'rename' | 'merge'

export type ExerciseRenameRefusalReason =
  | 'empty-name'
  | 'name-normalizes-to-nothing'
  | 'invalid-characters'
  | 'unchanged'
  | 'source-note-unreadable'
  | 'target-collision'

export interface ExerciseRenameRefusal {
  reason: ExerciseRenameRefusalReason
  message: string
}

export interface ExerciseRenameWorkoutNotePlan {
  path: string
  headingOccurrences: number
  fieldOccurrences: number
  /** Occurrences referencing the old name that this plan will NOT rewrite; see module doc. */
  staleOccurrences: number
}

export interface ExerciseRenamePlan {
  oldName: string
  newName: string
  /** Null when `refusal` is set: nothing else in the plan is meaningful. */
  operation: ExerciseRenameOperation | null
  refusal: ExerciseRenameRefusal | null
  sourceNotePath: string | null
  targetNotePath: string | null
  targetAlreadyExists: boolean
  /** True only when the target NOTE FILE already exists (a merge with two files to reconcile); false for a plain rename or a merge onto a no-note overlay/history entry, where `sourceNotePath` (if any) simply gets renamed to `targetNotePath`. */
  targetNoteExists: boolean
  sourceTombstoned: boolean
  targetTombstoned: boolean
  losingNoteHasProse: boolean
  aliasesToKeep: string[]
  resultKind: ExerciseKind
  resultUnit?: WeightUnit
  /** Ladder surviving the rename, when either folded-in entry owned one. */
  resultLevels?: string[]
  /** Set when the entry or note that decides `resultKind` is an interval exercise. */
  resultInterval?: true
  workoutNotes: ExerciseRenameWorkoutNotePlan[]
  totalHeadingOccurrences: number
  totalFieldOccurrences: number
  totalStaleOccurrences: number
}

const DEFAULT_RESULT_KIND: ExerciseKind = 'strength'

/**
 * Build a plan for renaming `input.oldName` to `input.newName`. Refuses
 * (via `refusal`) rather than producing a plan that would corrupt a note or
 * collide with an unrelated file; see `ExerciseRenameRefusalReason`.
 */
export function buildExerciseRenamePlan(input: ExerciseRenamePlanInput): ExerciseRenamePlan {
  const { oldName } = input
  const trimmedNewName = input.newName.trim()
  const oldKey = normalize(oldName)

  const refuse = (reason: ExerciseRenameRefusalReason, message: string): ExerciseRenamePlan => ({
    oldName,
    newName: trimmedNewName,
    operation: null,
    refusal: { reason, message },
    sourceNotePath: null,
    targetNotePath: null,
    targetAlreadyExists: false,
    targetNoteExists: false,
    sourceTombstoned: false,
    targetTombstoned: false,
    losingNoteHasProse: false,
    aliasesToKeep: [],
    resultKind: DEFAULT_RESULT_KIND,
    resultUnit: undefined,
    resultLevels: undefined,
    workoutNotes: [],
    totalHeadingOccurrences: 0,
    totalFieldOccurrences: 0,
    totalStaleOccurrences: 0,
  })

  if (trimmedNewName.length === 0) {
    return refuse('empty-name', 'Name cannot be empty.')
  }
  const newKey = normalize(trimmedNewName)
  if (newKey.length === 0) {
    return refuse('name-normalizes-to-nothing', 'Name must contain a letter or number.')
  }
  if (trimmedNewName.includes(']]') || trimmedNewName.includes('|')) {
    return refuse(
      'invalid-characters',
      "Name cannot contain ']]' or '|': these break wikilink substitution.",
    )
  }
  if (trimmedNewName === oldName) {
    return refuse('unchanged', 'New name is identical to the current name.')
  }
  if (input.sourceNoteUnreadable) {
    return refuse(
      'source-note-unreadable',
      `The exercise note for '${oldName}' could not be read. Its frontmatter must be valid before it can be renamed.`,
    )
  }
  if (input.targetPathOccupiedByUnrelatedFile) {
    return refuse(
      'target-collision',
      `A file already exists at the destination for '${trimmedNewName}' that is not this exercise.`,
    )
  }

  const deletedKeys = new Set(input.deletedExercises.map((name) => normalize(name)))
  const sourceTombstoned = deletedKeys.has(oldKey)
  const targetTombstoned = deletedKeys.has(newKey)

  const sourceEntry = findOwnerEntry(input.registry, oldKey)
  const targetOwner = findOwnerEntry(input.registry, newKey)
  /** Guards against `newKey` merely being an alias already recorded on the source's own entry. */
  const distinctTargetEntry =
    targetOwner && normalize(targetOwner.name) !== oldKey ? targetOwner : null

  const sameKey = newKey === oldKey
  const sourceNote = input.catalog.find((entry) => normalize(entry.name) === oldKey) ?? null
  /**
   * A name typed as an alias resolves to the entry's canonical name, since the note file and workout links use that title.
   */
  const resultName = distinctTargetEntry ? distinctTargetEntry.name : trimmedNewName
  const resultKey = normalize(resultName)
  /** A case-only rename shares its key with the source note itself; that is never a merge target. */
  const targetNote = sameKey
    ? null
    : (input.catalog.find((entry) => normalize(entry.name) === resultKey) ?? null)

  const isMerge = distinctTargetEntry !== null || targetNote !== null
  const operation: ExerciseRenameOperation = isMerge ? 'merge' : 'rename'

  const sourceDir = sourceNote ? dirnameOf(sourceNote.path) : null
  const renamedSourcePath =
    sourceNote && sourceDir !== null ? joinNotePath(sourceDir, resultName) : null
  const sourceNotePath = sourceNote?.path ?? null
  const targetNotePath = isMerge ? (targetNote?.path ?? renamedSourcePath) : renamedSourcePath

  const losingNoteHasProse =
    isMerge && sourceNote !== null ? notesSectionHasProse(input.sourceNoteText ?? '') : false

  const aliasesToKeep = foldAliases(sourceEntry, distinctTargetEntry, oldName, resultName)
  const kindSource = distinctTargetEntry ?? sourceEntry ?? targetNote ?? sourceNote
  const resultKind = kindSource?.kind ?? DEFAULT_RESULT_KIND
  /** The surviving note wins on read, so its marker beats a saved entry an older FitKit may have stripped. */
  const markerSource = targetNote ?? sourceNote ?? kindSource
  const resultInterval =
    resultKind === 'duration' &&
    markerSource !== null &&
    exerciseTypeOf(markerSource) === 'interval'
  const resultUnit = distinctTargetEntry?.unit ?? sourceEntry?.unit
  const survivingLevels = distinctTargetEntry?.levels ?? sourceEntry?.levels
  const resultLevels = survivingLevels ? [...survivingLevels] : undefined

  const workoutNotes: ExerciseRenameWorkoutNotePlan[] = []
  let totalHeadingOccurrences = 0
  let totalFieldOccurrences = 0
  let totalStaleOccurrences = 0
  for (const note of input.workoutNotes) {
    const occurrences = scanWorkoutNoteOccurrences(note.text, oldName)
    if (
      occurrences.headingOccurrences === 0 &&
      occurrences.fieldOccurrences === 0 &&
      occurrences.staleOccurrences === 0
    ) {
      continue
    }
    workoutNotes.push({ path: note.path, ...occurrences })
    totalHeadingOccurrences += occurrences.headingOccurrences
    totalFieldOccurrences += occurrences.fieldOccurrences
    totalStaleOccurrences += occurrences.staleOccurrences
  }
  workoutNotes.sort((left, right) => left.path.localeCompare(right.path))

  return {
    oldName,
    newName: resultName,
    operation,
    refusal: null,
    sourceNotePath,
    targetNotePath,
    targetAlreadyExists: isMerge,
    targetNoteExists: targetNote !== null,
    sourceTombstoned,
    targetTombstoned,
    losingNoteHasProse,
    aliasesToKeep,
    resultKind,
    resultUnit,
    resultLevels,
    ...(resultInterval ? { resultInterval: true as const } : {}),
    workoutNotes,
    totalHeadingOccurrences,
    totalFieldOccurrences,
    totalStaleOccurrences,
  }
}

export interface RewriteWorkoutNoteOccurrencesResult {
  text: string
  headingRewrites: number
  fieldRewrites: number
}

/**
 * Rewrites `[exercise:: [[oldName]]]` fields and `## [[oldName]]` headings to `newName`, skipping fenced code blocks.
 * Idempotent, so the vault apply step can safely re-run it; pathed and aliased links are covered in the module doc.
 */
export function rewriteWorkoutNoteOccurrences(
  text: string,
  oldName: string,
  newName: string,
): RewriteWorkoutNoteOccurrencesResult {
  const escaped = escapeRegExp(oldName)
  const fenced = fencedCodeBlockRanges(text)
  let headingRewrites = 0
  const afterHeadings = text.replace(
    headingLinePattern(escaped),
    (match: string, prefix: string, suffix: string, offset: number) => {
      if (isWithinRanges(offset, fenced)) {
        return match
      }
      headingRewrites += 1
      return `${prefix}[[${newName}]]${suffix}`
    },
  )
  let fieldRewrites = 0
  const afterFields = afterHeadings.replace(
    fieldPattern(escaped),
    (match: string, whitespace: string, offset: number) => {
      if (isWithinRanges(offset, fenced)) {
        return match
      }
      fieldRewrites += 1
      return `[exercise::${whitespace}[[${newName}]]]`
    },
  )
  return { text: afterFields, headingRewrites, fieldRewrites }
}

function scanWorkoutNoteOccurrences(
  text: string,
  oldName: string,
): { headingOccurrences: number; fieldOccurrences: number; staleOccurrences: number } {
  const escaped = escapeRegExp(oldName)
  const fenced = fencedCodeBlockRanges(text)
  const rewrittenSpans: Array<[number, number]> = []
  let headingOccurrences = 0
  for (const match of text.matchAll(headingLinePattern(escaped))) {
    const start = match.index ?? 0
    if (isWithinRanges(start, fenced)) {
      continue
    }
    rewrittenSpans.push([start, start + match[0].length])
    headingOccurrences += 1
  }
  let fieldOccurrences = 0
  for (const match of text.matchAll(fieldPattern(escaped))) {
    const start = match.index ?? 0
    if (isWithinRanges(start, fenced)) {
      continue
    }
    rewrittenSpans.push([start, start + match[0].length])
    fieldOccurrences += 1
  }
  const oldKey = normalize(oldName)
  let staleOccurrences = 0
  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (isWithinRanges(start, fenced)) {
      continue
    }
    if (rewrittenSpans.some(([spanStart, spanEnd]) => start >= spanStart && end <= spanEnd)) {
      continue
    }
    const inner = match[1] ?? ''
    const target = (inner.split('|')[0] ?? '').trim()
    /** Case/whitespace variants resolve the same way registry lookups do, via `normalize()`. */
    const lastSegment = target.split('/').pop() ?? target
    if (normalize(lastSegment) === oldKey) {
      staleOccurrences += 1
    }
  }
  return { headingOccurrences, fieldOccurrences, staleOccurrences }
}

/** Character ranges `[start, end)` covered by fenced code blocks (``` or ~~~), fence lines included. */
function fencedCodeBlockRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const lines = text.split('\n')
  let offset = 0
  let fenceToken: string | null = null
  let fenceStart = 0
  for (const line of lines) {
    const lineEnd = offset + line.length
    if (fenceToken === null) {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})/)
      if (match?.[1]) {
        fenceToken = match[1]
        fenceStart = offset
      }
    } else if (line.trimStart().startsWith(fenceToken)) {
      ranges.push([fenceStart, lineEnd])
      fenceToken = null
    }
    offset = lineEnd + 1
  }
  if (fenceToken !== null) {
    ranges.push([fenceStart, text.length])
  }
  return ranges
}

function isWithinRanges(position: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([start, end]) => position >= start && position < end)
}

/**
 * Case-insensitive, matching how `normalize()` treats `[[row]]` and `[[Row]]` as one exercise.
 */
function headingLinePattern(escapedName: string): RegExp {
  return new RegExp(`^(##[ \\t]+)\\[\\[${escapedName}\\]\\]([ \\t]*)$`, 'gmi')
}

function fieldPattern(escapedName: string): RegExp {
  return new RegExp(`\\[exercise::(\\s*)\\[\\[${escapedName}\\]\\]\\]`, 'gi')
}

function findOwnerEntry(
  registry: readonly ExerciseRegistryEntry[],
  key: string,
): ExerciseRegistryEntry | null {
  for (const entry of registry) {
    if (normalize(entry.name) === key) {
      return entry
    }
  }
  for (const entry of registry) {
    if (entry.aliases.some((alias) => normalize(alias) === key)) {
      return entry
    }
  }
  return null
}

/**
 * Folds `oldName` and both entries' aliases into one deduped list for the survivor, dropping the new canonical name.
 * `targetEntry` is null for a plain rename and the merge target otherwise.
 */
function foldAliases(
  sourceEntry: ExerciseRegistryEntry | null,
  targetEntry: ExerciseRegistryEntry | null,
  oldName: string,
  newName: string,
): string[] {
  const newKey = normalize(newName)
  const candidates = [oldName, ...(sourceEntry?.aliases ?? []), ...(targetEntry?.aliases ?? [])]
  return dedupeAliases(candidates, newKey)
}

function notesSectionHasProse(noteText: string): boolean {
  const lines = noteText.split(/\r?\n/)
  const headingIndex = lines.findIndex((line) => /^##\s+Notes\s*$/i.test(line.trim()))
  if (headingIndex < 0) {
    return false
  }
  let end = lines.length
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+\S/.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  const stripped = stripFencedBlocks(lines.slice(headingIndex + 1, end))
  return stripped.some((line) => line.trim() !== '')
}

function stripFencedBlocks(lines: readonly string[]): string[] {
  const result: string[] = []
  let fenceToken: string | null = null
  for (const line of lines) {
    if (fenceToken === null) {
      const match = line.match(/^(`{3,})/)
      if (match) {
        fenceToken = match[1] ?? '```'
        continue
      }
      result.push(line)
      continue
    }
    if (line.startsWith(fenceToken)) {
      fenceToken = null
    }
  }
  return result
}

function joinNotePath(dir: string, name: string): string {
  return dir.length > 0 ? `${dir}/${name}.md` : `${name}.md`
}
