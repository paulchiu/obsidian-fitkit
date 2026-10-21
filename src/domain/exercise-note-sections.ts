import { hasStaleDataviewTarget, isCustomDataviewBlock } from './dataview-query'
import { EXERCISE_KINDS } from './exercise-kind'
import { buildNotesBlock, buildRecentSessionsBlock } from './exercise-note-template'
import type { ExerciseKind } from './exercise-registry'
import {
  findFencedBlockInRange,
  findHeadingIndex,
  findNextH2HeadingIndex,
  firstExistingSectionIndex,
  firstSectionIndexAfterFrontmatter,
  hasNonEmptyContentInRange,
  insertBlockAfterHeading,
  insertSection,
  isRangeEmptyExcept,
  joinMarkdown,
  splitMarkdown,
  type FencedBlock,
  type MarkdownLines,
} from './markdown-lines'

export interface ExerciseNoteQueryOptions {
  name: string
  fitnessRoot: string
}

export type ExerciseNoteSectionWarning =
  { kind: 'custom-recent-sessions' } | { kind: 'custom-notes-section' }

export interface SectionRepairResult {
  markdown: string
  warnings: ExerciseNoteSectionWarning[]
}

export function isRecentSessionsHeading(line: string): boolean {
  return /^##\s+Recent sessions\s*$/i.test(line)
}

function isProgressChartHeading(line: string): boolean {
  return /^##\s+Progress chart\s*$/i.test(line)
}

function isNotesHeading(line: string): boolean {
  return /^##\s+Notes\s*$/i.test(line)
}

/** The first Dataview block in the Recent sessions section that starts at `headingIndex`. */
export function findRecentSessionsBlock(
  document: MarkdownLines,
  headingIndex: number,
): FencedBlock | null {
  const sectionEnd = findNextH2HeadingIndex(document.lines, headingIndex + 1)
  return findFencedBlockInRange(
    document.lines,
    headingIndex + 1,
    sectionEnd >= 0 ? sectionEnd : document.lines.length,
    'dataview',
  )
}

/** Adds a missing Recent sessions section or query, then reconciles the existing one for `kind`. */
export function repairRecentSessions(
  source: string,
  options: ExerciseNoteQueryOptions,
  kind: ExerciseKind,
): SectionRepairResult {
  const canonicalLines = buildRecentSessionsBlock(options.name, kind, options.fitnessRoot).split(
    '\n',
  )
  const document = splitMarkdown(source)
  const headingIndex = findHeadingIndex(document.lines, isRecentSessionsHeading)
  if (headingIndex < 0) {
    const insertionIndex = firstExistingSectionIndex(document.lines, [
      isProgressChartHeading,
      isNotesHeading,
    ])
    const next = insertSection(document.lines, insertionIndex, [
      '## Recent sessions',
      '',
      ...canonicalLines,
      '',
    ])
    return { markdown: joinMarkdown({ ...document, lines: next }), warnings: [] }
  }

  const block = findRecentSessionsBlock(document, headingIndex)
  if (!block) {
    const next = insertBlockAfterHeading(document.lines, headingIndex, canonicalLines)
    return { markdown: joinMarkdown({ ...document, lines: next }), warnings: [] }
  }

  return repairRecentSessionsBlock(document, block, options, kind)
}

/**
 * Retargets an existing Recent sessions block at `kind`, leaving a note without one alone:
 * a kind switch reconciles what the note already says, it does not build out missing sections.
 */
export function rewriteRecentSessionsForKind(
  source: string,
  options: ExerciseNoteQueryOptions,
  kind: ExerciseKind,
): SectionRepairResult {
  const document = splitMarkdown(source)
  const headingIndex = findHeadingIndex(document.lines, isRecentSessionsHeading)
  if (headingIndex < 0) {
    return { markdown: source, warnings: [] }
  }
  const block = findRecentSessionsBlock(document, headingIndex)
  if (!block) {
    return { markdown: source, warnings: [] }
  }
  return repairRecentSessionsBlock(document, block, options, kind)
}

/**
 * Rewrites a Recent sessions block that is verbatim another kind's query or only targets
 * another exercise; a hand-edited one is left alone and reported so the user decides.
 */
function repairRecentSessionsBlock(
  document: MarkdownLines,
  block: FencedBlock,
  options: ExerciseNoteQueryOptions,
  kind: ExerciseKind,
): SectionRepairResult {
  const canonicalBlock = buildRecentSessionsBlock(options.name, kind, options.fitnessRoot)
  const currentBlock = document.lines.slice(block.start, block.end + 1).join('\n')
  if (currentBlock === canonicalBlock) {
    return { markdown: joinMarkdown(document), warnings: [] }
  }

  const rewritten: SectionRepairResult = {
    markdown: joinMarkdown({
      ...document,
      lines: [
        ...document.lines.slice(0, block.start),
        ...canonicalBlock.split('\n'),
        ...document.lines.slice(block.end + 1),
      ],
    }),
    warnings: [],
  }

  const matchesAnotherKind = EXERCISE_KINDS.some(
    (otherKind) =>
      otherKind !== kind &&
      !isCustomDataviewBlock(
        currentBlock,
        buildRecentSessionsBlock(options.name, otherKind, options.fitnessRoot),
      ),
  )
  if (matchesAnotherKind) {
    return rewritten
  }
  if (isCustomDataviewBlock(currentBlock, canonicalBlock)) {
    return { markdown: joinMarkdown(document), warnings: [{ kind: 'custom-recent-sessions' }] }
  }
  if (!hasStaleDataviewTarget(currentBlock, canonicalBlock)) {
    return { markdown: joinMarkdown(document), warnings: [] }
  }
  return rewritten
}

/**
 * Mirrors `repairRecentSessions` for the Notes query: a block that only targets another
 * exercise name is stale, not customised, so it is rewritten and a rename follows through.
 */
export function repairNotesSection(
  source: string,
  options: ExerciseNoteQueryOptions,
): SectionRepairResult {
  const canonicalBlock = buildNotesBlock(options.name, options.fitnessRoot)
  const canonicalLines = canonicalBlock.split('\n')
  const document = splitMarkdown(source)
  const headingIndex = findHeadingIndex(document.lines, isNotesHeading)
  if (headingIndex < 0) {
    const next = insertSection(document.lines, document.lines.length, [
      '## Notes',
      '',
      ...canonicalLines,
    ])
    return { markdown: joinMarkdown({ ...document, lines: next }), warnings: [] }
  }

  const sectionEnd = findNextH2HeadingIndex(document.lines, headingIndex + 1)
  const end = sectionEnd >= 0 ? sectionEnd : document.lines.length
  if (!hasNonEmptyContentInRange(document.lines, headingIndex + 1, end)) {
    const next = insertBlockAfterHeading(document.lines, headingIndex, canonicalLines)
    return { markdown: joinMarkdown({ ...document, lines: next }), warnings: [] }
  }

  const block = findFencedBlockInRange(document.lines, headingIndex + 1, end, 'dataview')
  const blockIsSoleContent =
    block !== null &&
    isRangeEmptyExcept(document.lines, headingIndex + 1, end, block.start, block.end + 1)
  if (!block || !blockIsSoleContent) {
    return {
      markdown: source,
      warnings: [{ kind: 'custom-notes-section' }],
    }
  }

  const currentBlock = document.lines.slice(block.start, block.end + 1).join('\n')
  if (currentBlock === canonicalBlock) {
    return { markdown: source, warnings: [] }
  }
  if (isCustomDataviewBlock(currentBlock, canonicalBlock)) {
    return {
      markdown: source,
      warnings: [{ kind: 'custom-notes-section' }],
    }
  }
  if (!hasStaleDataviewTarget(currentBlock, canonicalBlock)) {
    return { markdown: source, warnings: [] }
  }

  const next = [
    ...document.lines.slice(0, block.start),
    ...canonicalLines,
    ...document.lines.slice(block.end + 1),
  ]
  return { markdown: joinMarkdown({ ...document, lines: next }), warnings: [] }
}

/** Puts the Progress chart section first after the frontmatter, adding one when the note has no chart. */
export function ensureChartBlock(source: string): string {
  const document = splitMarkdown(source)
  const insertionIndex = firstSectionIndexAfterFrontmatter(document.lines)
  const existingSection = findProgressChartSection(document.lines)
  if (existingSection) {
    if (existingSection.start === insertionIndex) {
      return source
    }
    const sectionLines = document.lines.slice(existingSection.start, existingSection.end)
    const withoutSection = [
      ...document.lines.slice(0, existingSection.start),
      ...document.lines.slice(existingSection.end),
    ]
    const nextInsertionIndex =
      existingSection.start < insertionIndex ? insertionIndex - sectionLines.length : insertionIndex
    const next = insertSection(withoutSection, nextInsertionIndex, sectionLines)
    return joinMarkdown({ ...document, lines: next })
  }
  if (hasFitKitChartBlock(source)) {
    return source
  }

  const next = insertSection(document.lines, insertionIndex, [
    '## Progress chart',
    '',
    '```fitkit-chart',
    '```',
    '',
  ])
  return joinMarkdown({ ...document, lines: next })
}

function findProgressChartSection(
  lines: ReadonlyArray<string>,
): { start: number; end: number } | null {
  const start = findHeadingIndex(lines, isProgressChartHeading)
  if (start < 0) {
    return null
  }
  const nextHeading = findNextH2HeadingIndex(lines, start + 1)
  const end = nextHeading >= 0 ? nextHeading : lines.length
  const block = findFencedBlockInRange(lines, start + 1, end, 'fitkit-chart')
  return block ? { start, end } : null
}

function hasFitKitChartBlock(source: string): boolean {
  const lines = source.split('\n')
  return findFencedBlockInRange(lines, 0, lines.length, 'fitkit-chart') !== null
}
