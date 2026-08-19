/**
 * Internal model + parser + serializer for FitKit workout notes.
 *
 * A workout note has YAML frontmatter with `type: workout`, a `date`, and a
 * `name`, followed by one or more `## [[Exercise Name]]` (or `## Exercise
 * Name`) sections. Each section has bullet rows that use inline Dataview
 * fields of the form `[key:: value]`.
 *
 * The canonical "truth" field in a bullet is `[exercise:: [[Name]]]`. If the
 * H2 and the inline exercise disagree we trust the inline and emit a warning.
 *
 * Bullet kinds:
 *  - Exercise-level note: has `[exercise::]` and optional `[notes::]` /
 *    `[next::]` only.
 *  - Strength row: has `[set::]`, optional `[weight::]`, optional `[reps::]`, optional `[notes::]`.
 *  - Duration row: has `[duration::]` (seconds), optional `[set::]`, optional `[notes::]`.
 *
 * A round-trip (parse then serialize) is content-preserving for anything the
 * model above does not represent: unrecognised frontmatter keys, fenced code
 * blocks, non-exercise bullets (including task checkboxes), nested bullets,
 * and any other body line (prose, headings other than H2, blockquotes,
 * embeds, tables). All of that is captured verbatim at parse time as a
 * `PreserveBlock`, anchored to the exercise section (and row within it) it
 * appeared under rather than to a raw line number, so it lands back in the
 * same section on serialize even though the regenerated body has a
 * different line count and blank-line convention than the source. See
 * `preserveBlocks` and `frontmatterExtra`. The one deliberate exception is
 * an inline field FitKit does not recognise (for example `[rpe:: 7]`): it is
 * read and then dropped on next save, since a bullet is rebuilt
 * field-by-field from the model. This is documented in README.md.
 */

import { formatNextPlan, parseNextPlan, type NextPlan } from './next-plan'

export type ExerciseKind = 'strength' | 'duration'

export interface StrengthSet {
  set: number
  weight?: number
  reps?: number
  note?: string
}

export interface DurationEntry {
  set?: number
  durationSeconds: number
  note?: string
}

export interface ExerciseEntry {
  exerciseName: string
  kind: ExerciseKind
  note?: string
  next?: NextPlan
  strengthSets?: StrengthSet[]
  durationEntries?: DurationEntry[]
}

export interface PreserveBlock {
  /**
   * 0-based index into `exercises` of the section this block appeared
   * under. -1 means the block appeared before the first exercise section
   * (or the note has no exercise sections at all).
   */
  exerciseIndex: number
  /**
   * Number of rows (the optional note/next row, then each strength or
   * duration row, in emission order) already written for that exercise
   * when this block appeared. The block is re-inserted immediately after
   * that many rows have been (re-)emitted.
   */
  afterRowCount: number
  /** Original parse order, used only to keep blocks sharing an anchor in relative order. */
  originalOrder: number
  text: string
}

export interface WorkoutNoteModel {
  date: string
  name: string
  sourcePath: string
  exercises: ExerciseEntry[]
  preserveBlocks: PreserveBlock[]
  /**
   * Raw frontmatter lines (verbatim, including any indented continuation
   * lines such as YAML list items) for every key other than `type`, `date`,
   * and `name`, in original order. Re-emitted after those three core lines.
   */
  frontmatterExtra: string[]
}

export interface ParseResult {
  model: WorkoutNoteModel | null
  /** True iff the note has frontmatter `type: workout`. */
  isWorkout: boolean
  warnings: string[]
}

const FRONTMATTER_FENCE = /^---\s*$/
const CODE_FENCE = /^```/
const H2 = /^##\s+(.*)$/
const BULLET = /^[-*]\s+(.*)$/
/**
 * Matches `[key:: value]` where `value` may itself contain `[[wikilinks]]`.
 * The value alternative accepts either a `[[...]]` run or any non-`]` char.
 */
const INLINE_FIELD = /\[([a-zA-Z][\w-]*)::\s*((?:\[\[[^\]]*\]\]|[^\]])*)\]/g
const WIKILINK = /^\[\[([^\]]+)\]\]$/

/**
 * Number of rows a serialized exercise section will have: the optional
 * note/next row, then each strength or duration row. Used on both sides of
 * a `PreserveBlock` anchor, at parse time (to record `afterRowCount`) and
 * at serialize time (to know when to re-insert it and to clamp a stale
 * anchor to a row count the edited exercise still has).
 */
function rowCountOf(
  exercise: Pick<ExerciseEntry, 'note' | 'next' | 'strengthSets' | 'durationEntries'>,
): number {
  return (
    (exercise.note !== undefined || exercise.next !== undefined ? 1 : 0) +
    (exercise.strengthSets?.length ?? 0) +
    (exercise.durationEntries?.length ?? 0)
  )
}

/**
 * Parse a markdown string. Returns a result that flags whether this is a
 * workout note (has `type: workout`) and, if so, the parsed model plus any
 * warnings (for example, H2 vs inline exercise name mismatches).
 */
export function parseWorkoutNote(source: string, sourcePath: string): ParseResult {
  const warnings: string[] = []
  const rawLines = source.split(/\r?\n/)
  const { frontmatter, frontmatterEnd, extraLines } = readFrontmatter(rawLines)
  if (!frontmatter) {
    return { model: null, isWorkout: false, warnings }
  }
  if (frontmatter.get('type') !== 'workout') {
    return { model: null, isWorkout: false, warnings }
  }
  const date = frontmatter.get('date') ?? ''
  const name = frontmatter.get('name') ?? ''

  /**
   * Walk the body. Strip fenced blocks and any other content the model does
   * not represent first, preserving it verbatim (see `extractPreserveBlocks`).
   */
  const bodyLines = rawLines.slice(frontmatterEnd + 1)
  const { cleanedLines, rawBlocks } = extractPreserveBlocks(bodyLines)
  const sortedRawBlocks = [...rawBlocks].sort((a, b) => a.index - b.index)

  const exercises: ExerciseEntry[] = []
  const preserveBlocks: PreserveBlock[] = []
  let currentHeadingName: string | null = null
  let currentHeadingWarned = false
  let current: ExerciseEntry | null = null
  let seenAnyHeading = false
  let rawBlockPointer = 0

  const flush = () => {
    if (current) {
      exercises.push(current)
      current = null
    }
  }

  /**
   * Anchor any raw preserve block starting at original line `i` to the
   * exercise section (and row within it) the parser has reached so far.
   */
  const anchorRawBlocksAt = (i: number) => {
    while (
      rawBlockPointer < sortedRawBlocks.length &&
      sortedRawBlocks[rawBlockPointer]?.index === i
    ) {
      const raw = sortedRawBlocks[rawBlockPointer]
      if (raw) {
        preserveBlocks.push({
          exerciseIndex: seenAnyHeading ? exercises.length : -1,
          afterRowCount: current ? rowCountOf(current) : 0,
          originalOrder: preserveBlocks.length,
          text: raw.text,
        })
      }
      rawBlockPointer++
    }
  }

  for (let i = 0; i < cleanedLines.length; i++) {
    anchorRawBlocksAt(i)
    const line = cleanedLines[i]
    if (line === null || line === undefined) {
      continue
    }
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    const h2 = trimmed.match(H2)
    if (h2 && h2[1] !== undefined) {
      flush()
      seenAnyHeading = true
      currentHeadingName = parseHeadingName(h2[1].trim())
      currentHeadingWarned = false
      current = null
      continue
    }
    const bullet = trimmed.match(BULLET)
    if (!bullet || bullet[1] === undefined) {
      continue
    }
    const fields = collectInlineFields(bullet[1])
    const exerciseField = fields.get('exercise')
    if (!exerciseField) {
      continue
    }
    const inlineName = unwrapWikiLink(exerciseField)
    if (currentHeadingName && inlineName !== currentHeadingName && !currentHeadingWarned) {
      warnings.push(
        `${sourcePath}: H2 "${currentHeadingName}" disagrees with inline exercise "${inlineName}"; trusting inline.`,
      )
      currentHeadingWarned = true
    }

    const hasSet = fields.has('set')
    const hasWeight = fields.has('weight')
    const hasReps = fields.has('reps')
    const hasDuration = fields.has('duration')
    const note = fields.get('notes')
    if (!current || current.exerciseName !== inlineName) {
      flush()
      const kind: ExerciseKind = hasDuration ? 'duration' : 'strength'
      current = {
        exerciseName: inlineName,
        kind,
        strengthSets: kind === 'strength' ? [] : undefined,
        durationEntries: kind === 'duration' ? [] : undefined,
      }
    }

    if (!hasSet && !hasDuration && !hasWeight && !hasReps) {
      /** Exercise-level note row. */
      if (note !== undefined) {
        current.note = note
      }
      const next = parseNextPlan(fields.get('next'))
      if (next) {
        current.next = next
      }
      continue
    }

    if (hasDuration) {
      if (current.kind !== 'duration') {
        current.kind = 'duration'
        current.durationEntries = current.durationEntries ?? []
        if ((current.strengthSets ?? []).length > 0) {
          warnings.push(
            `${sourcePath}: Exercise "${inlineName}" has both strength and duration rows; dropping strength data.`,
          )
        }
        current.strengthSets = undefined
      }
      const durationSeconds = Number(fields.get('duration'))
      const entry: DurationEntry = { durationSeconds }
      if (hasSet) {
        entry.set = Number(fields.get('set'))
      }
      if (note !== undefined) {
        entry.note = note
      }
      current.durationEntries = current.durationEntries ?? []
      current.durationEntries.push(entry)
      continue
    }

    /** Strength row. We tolerate RPE and drop it; keep set/weight/reps/notes. */
    if (current.kind !== 'strength') {
      current.kind = 'strength'
      current.strengthSets = current.strengthSets ?? []
      if ((current.durationEntries ?? []).length > 0) {
        warnings.push(
          `${sourcePath}: Exercise "${inlineName}" has both strength and duration rows; dropping duration data.`,
        )
      }
      current.durationEntries = undefined
    }
    const setNum = Number(fields.get('set') ?? '0')
    const set: StrengthSet = { set: setNum }
    if (hasWeight) {
      set.weight = Number(fields.get('weight'))
    }
    if (hasReps) {
      set.reps = Number(fields.get('reps'))
    }
    if (note !== undefined) {
      set.note = note
    }
    current.strengthSets = current.strengthSets ?? []
    current.strengthSets.push(set)
  }
  /** Any raw block positioned at or past the last body line (trailing content). */
  anchorRawBlocksAt(cleanedLines.length)
  flush()

  for (const exercise of exercises) {
    if (exercise.kind !== 'strength') {
      continue
    }
    const sets = exercise.strengthSets ?? []
    for (let index = 0; index < sets.length; index += 1) {
      const expected = index + 1
      const actual = sets[index]?.set
      if (actual !== expected) {
        warnings.push(
          `${sourcePath}: Strength set numbers for "${exercise.exerciseName}" skip expected set ${expected}.`,
        )
        break
      }
    }
  }

  return {
    model: {
      date,
      name,
      sourcePath,
      exercises,
      preserveBlocks,
      frontmatterExtra: extraLines,
    },
    isWorkout: true,
    warnings,
  }
}

/**
 * Group `preserveBlocks` by where they land in a freshly generated body:
 * `'preamble'` for anything anchored before the first exercise (or when the
 * model has no exercises at all), otherwise `'<exerciseIndex>:<rowCount>'`.
 * An anchor whose `exerciseIndex` or `afterRowCount` no longer exists
 * (an exercise was deleted or reordered, or rows were added/removed since
 * parse) is clamped to the nearest still-valid position on the same or the
 * last exercise, so the block is never dropped, only nudged. Blocks sharing
 * a bucket keep their original relative order.
 */
function bucketPreserveBlocks(
  blocks: PreserveBlock[],
  exercises: ExerciseEntry[],
): Map<string, PreserveBlock[]> {
  const buckets = new Map<string, PreserveBlock[]>()
  const addTo = (key: string, block: PreserveBlock) => {
    const list = buckets.get(key)
    if (list) {
      list.push(block)
    } else {
      buckets.set(key, [block])
    }
  }

  const sorted = [...blocks].sort((a, b) => a.originalOrder - b.originalOrder)
  for (const block of sorted) {
    if (block.exerciseIndex < 0 || exercises.length === 0) {
      addTo('preamble', block)
      continue
    }
    const clampedIndex = Math.min(block.exerciseIndex, exercises.length - 1)
    const exercise = exercises[clampedIndex]
    const maxRow = exercise ? rowCountOf(exercise) : 0
    /** An index clamp means the anchor's original section is gone; push the block to the end of the section it landed on. */
    const row =
      block.exerciseIndex > clampedIndex
        ? maxRow
        : Math.min(Math.max(block.afterRowCount, 0), maxRow)
    addTo(`${clampedIndex}:${row}`, block)
  }
  return buckets
}

/**
 * Serialize a model back into markdown using the canonical format.
 * `frontmatterExtra` lines are re-emitted after the three core frontmatter
 * keys. `preserveBlocks` (fenced code blocks and any other content the
 * model does not represent) are re-inserted at the exercise section (and
 * row within it) they were anchored to at parse time, see
 * `bucketPreserveBlocks`.
 */
export function serializeWorkoutNote(model: WorkoutNoteModel): string {
  const lines: string[] = []
  lines.push('---')
  lines.push('type: workout')
  lines.push(`date: ${model.date}`)
  lines.push(`name: ${model.name}`)
  for (const extra of model.frontmatterExtra) {
    lines.push(extra)
  }
  lines.push('---')
  lines.push('')

  const bodyStart = lines.length
  const bodyLines: string[] = []
  const blockBuckets = bucketPreserveBlocks(model.preserveBlocks, model.exercises)
  const insertBucket = (key: string) => {
    for (const block of blockBuckets.get(key) ?? []) {
      bodyLines.push(...block.text.split(/\r?\n/))
    }
  }

  insertBucket('preamble')

  for (let i = 0; i < model.exercises.length; i++) {
    const exercise = model.exercises[i]
    if (!exercise) {
      continue
    }
    /**
     * Between exercises this is unconditional, matching the pre-fix
     * behaviour exactly regardless of whether the prior exercise had rows.
     * Before the first exercise it only fires if preserved preamble content
     * left the last line non-blank, so a note with no preserved content
     * keeps its original i===0 (no leading blank) output byte-for-byte.
     */
    if (i > 0) {
      bodyLines.push('')
    } else if (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] !== '') {
      bodyLines.push('')
    }
    bodyLines.push(`## [[${exercise.exerciseName}]]`)
    bodyLines.push('')
    let rowCount = 0
    insertBucket(`${i}:${rowCount}`)
    if (exercise.note !== undefined || exercise.next !== undefined) {
      const parts = [`[exercise:: [[${exercise.exerciseName}]]]`]
      if (exercise.note !== undefined) {
        parts.push(`[notes:: ${exercise.note}]`)
      }
      if (exercise.next !== undefined) {
        parts.push(`[next:: ${formatNextPlan(exercise.next)}]`)
      }
      bodyLines.push(`- ${parts.join(' ')}`)
      rowCount += 1
      insertBucket(`${i}:${rowCount}`)
    }
    if (exercise.kind === 'strength') {
      for (const set of exercise.strengthSets ?? []) {
        const parts = [`[exercise:: [[${exercise.exerciseName}]]]`, `[set:: ${set.set}]`]
        if (set.weight !== undefined) {
          parts.push(`[weight:: ${formatNumber(set.weight)}]`)
        }
        if (set.reps !== undefined) {
          parts.push(`[reps:: ${set.reps}]`)
        }
        if (set.note !== undefined) {
          parts.push(`[notes:: ${set.note}]`)
        }
        bodyLines.push(`- ${parts.join(' ')}`)
        rowCount += 1
        insertBucket(`${i}:${rowCount}`)
      }
    } else {
      for (const entry of exercise.durationEntries ?? []) {
        const parts = [`[exercise:: [[${exercise.exerciseName}]]]`]
        if (entry.set !== undefined) {
          parts.push(`[set:: ${entry.set}]`)
        }
        parts.push(`[duration:: ${formatNumber(entry.durationSeconds)}]`)
        if (entry.note !== undefined) {
          parts.push(`[notes:: ${entry.note}]`)
        }
        bodyLines.push(`- ${parts.join(' ')}`)
        rowCount += 1
        insertBucket(`${i}:${rowCount}`)
      }
    }
  }

  for (const line of bodyLines) {
    lines.push(line)
  }
  /** Ensure trailing newline for POSIX-friendly output. */
  void bodyStart
  return lines.join('\n') + '\n'
}

/**
 * Canonicalize a model for equality comparison. Strips `sourcePath` and
 * `preserveBlocks` (those are positional, not semantic), keeps
 * `frontmatterExtra` since it is user content, and trims/normalizes notes.
 * Used by `semanticEqual`.
 */
export function canonicalizeForEquality(model: WorkoutNoteModel): unknown {
  return {
    date: model.date,
    name: model.name,
    frontmatterExtra: model.frontmatterExtra,
    exercises: model.exercises.map((ex) => ({
      exerciseName: ex.exerciseName,
      kind: ex.kind,
      note: ex.note,
      next: ex.next,
      strengthSets: ex.strengthSets?.map((set) => ({
        set: set.set,
        weight: set.weight,
        reps: set.reps,
        note: set.note,
      })),
      durationEntries: ex.durationEntries?.map((entry) => ({
        set: entry.set,
        durationSeconds: entry.durationSeconds,
        note: entry.note,
      })),
    })),
  }
}

export function semanticEqual(a: WorkoutNoteModel, b: WorkoutNoteModel): boolean {
  return JSON.stringify(canonicalizeForEquality(a)) === JSON.stringify(canonicalizeForEquality(b))
}

const CORE_FRONTMATTER_KEYS = new Set(['type', 'date', 'name'])

/**
 * Read the leading frontmatter block. Returns a map of key -> string value,
 * the index of the closing `---`, and the raw lines for every key other than
 * `type` / `date` / `name` (including that key's own indented continuation
 * lines, e.g. YAML list items), so callers can carry unrecognised
 * frontmatter through a round-trip.
 */
function readFrontmatter(lines: string[]): {
  frontmatter: Map<string, string> | null
  frontmatterEnd: number
  extraLines: string[]
} {
  if (lines.length === 0 || !FRONTMATTER_FENCE.test(lines[0] ?? '')) {
    return { frontmatter: null, frontmatterEnd: -1, extraLines: [] }
  }
  const map = new Map<string, string>()
  const extraLines: string[] = []
  let currentKeyIsCore = false
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) {
      break
    }
    if (FRONTMATTER_FENCE.test(line)) {
      return { frontmatter: map, frontmatterEnd: i, extraLines }
    }
    const match = line.match(/^([a-zA-Z][\w-]*)\s*:\s*(.*)$/)
    if (match && match[1] !== undefined && match[2] !== undefined) {
      const key = match[1].trim()
      map.set(key, match[2].trim())
      currentKeyIsCore = CORE_FRONTMATTER_KEYS.has(key)
    }
    if (!currentKeyIsCore) {
      extraLines.push(line)
    }
  }
  return { frontmatter: null, frontmatterEnd: -1, extraLines: [] }
}

/**
 * A block of preserved text keyed by its 0-based start line in the
 * *original* body. This is an intermediate representation only: the parser
 * converts each one into a `PreserveBlock` anchored to an exercise section
 * (see `anchorRawBlocksAt` in `parseWorkoutNote`) before it reaches the
 * model, since the original line index has no meaning once the body is
 * regenerated at serialize time.
 */
interface RawBlock {
  index: number
  text: string
}

interface ExtractResult {
  /** Same length as input body lines. Lines captured into a raw block are replaced with `null`. */
  cleanedLines: Array<string | null>
  rawBlocks: RawBlock[]
}

/**
 * Locate triple-backtick fenced code blocks in the body. Replace their lines
 * with `null` (so the parser skips them) and record the original text and
 * start index so the serializer can re-insert them.
 */
function extractFencedBlocks(bodyLines: string[]): ExtractResult {
  const cleaned: Array<string | null> = bodyLines.map((l) => l)
  const blocks: RawBlock[] = []
  let i = 0
  while (i < cleaned.length) {
    const line = cleaned[i]
    if (typeof line === 'string' && CODE_FENCE.test(line)) {
      const start = i
      const fenceTokenMatch = line.match(/^(`{3,})/)
      const fenceToken = fenceTokenMatch?.[1] ?? '```'
      i++
      while (i < cleaned.length) {
        const inner = cleaned[i]
        if (typeof inner === 'string' && inner.startsWith(fenceToken)) {
          i++
          break
        }
        i++
      }
      const end = i
      const blockText = bodyLines.slice(start, end).join('\n')
      for (let k = start; k < end; k++) {
        cleaned[k] = null
      }
      blocks.push({ index: start, text: blockText })
      continue
    }
    i++
  }
  return { cleanedLines: cleaned, rawBlocks: blocks }
}

/**
 * True for a bullet line the parser will model as an exercise row: no
 * leading indentation (a nested bullet is always preserved verbatim, see
 * item 5 in the round-trip fidelity design notes) and an `[exercise::]`
 * inline field.
 */
function isModeledBulletLine(line: string): boolean {
  if (/^\s/.test(line)) {
    return false
  }
  const bullet = line.trim().match(BULLET)
  if (!bullet || bullet[1] === undefined) {
    return false
  }
  return collectInlineFields(bullet[1]).has('exercise')
}

/**
 * Extend `extractFencedBlocks` to also preserve any other body content the
 * model does not represent: non-exercise bullets (including task
 * checkboxes), nested bullets, and any line that is not an H2 heading or a
 * top-level exercise bullet (prose, other heading levels, blockquotes,
 * embeds, tables, HTML). Adjacent non-modeled lines are grouped into a
 * single block so interior blank lines (paragraph breaks) survive, while a
 * blank line that is purely a separator between modeled elements is left
 * alone so a note with no foreign content serializes byte-identical to
 * before. Blocks share the same raw (original-line-index) coordinate system
 * as the fenced-block blocks above; `parseWorkoutNote` converts all of them
 * into section-anchored `PreserveBlock`s in a single pass afterward.
 */
function extractPreserveBlocks(bodyLines: string[]): ExtractResult {
  const { cleanedLines: cleaned, rawBlocks: fencedBlocks } = extractFencedBlocks(bodyLines)
  const blocks: RawBlock[] = [...fencedBlocks]

  /** `null` covers both an already-preserved fenced line and past-the-end. */
  const at = (idx: number): string | null => (idx < cleaned.length ? (cleaned[idx] ?? null) : null)
  const isBlank = (idx: number): boolean => (at(idx) ?? '').trim() === ''
  const isBoundary = (idx: number): boolean => {
    const line = at(idx)
    if (line === null) {
      return true
    }
    return H2.test(line.trim()) || isModeledBulletLine(line)
  }

  let i = 0
  while (i < cleaned.length) {
    if (isBlank(i) || isBoundary(i)) {
      i++
      continue
    }

    const start = i
    let end = i + 1
    while (end < cleaned.length && !isBoundary(end)) {
      end++
    }
    /** Trim a trailing blank-only tail: it is just spacing before the next boundary. */
    let realEnd = end
    while (realEnd > start && isBlank(realEnd - 1)) {
      realEnd--
    }

    blocks.push({ index: start, text: bodyLines.slice(start, realEnd).join('\n') })
    for (let k = start; k < realEnd; k++) {
      cleaned[k] = null
    }
    i = end
  }

  return { cleanedLines: cleaned, rawBlocks: blocks }
}

function parseHeadingName(raw: string): string {
  const wiki = raw.match(WIKILINK)
  if (wiki && wiki[1] !== undefined) {
    return wiki[1].trim()
  }
  return raw.trim()
}

function unwrapWikiLink(raw: string): string {
  const trimmed = raw.trim()
  const wiki = trimmed.match(WIKILINK)
  if (wiki && wiki[1] !== undefined) {
    return wiki[1].trim()
  }
  return trimmed
}

function collectInlineFields(bullet: string): Map<string, string> {
  const map = new Map<string, string>()
  INLINE_FIELD.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INLINE_FIELD.exec(bullet)) !== null) {
    const key = (match[1] ?? '').toLowerCase()
    const value = (match[2] ?? '').trim()
    map.set(key, value)
  }
  return map
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) {
    return String(n)
  }
  /** Render integers without decimal, floats with their natural representation. */
  return Number.isInteger(n) ? String(n) : String(n)
}
