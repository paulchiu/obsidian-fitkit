import {
  kindForName,
  unitForName,
  type ExerciseKind,
  type ExerciseRegistry,
} from './exercise-registry'
import {
  DEFAULT_EXERCISE_METRIC,
  parseExerciseMetric,
  type ExerciseMetric,
} from './exercise-metric'
import { buildNotesBlock, buildRecentSessionsBlock } from './exercise-note-template'
import { DEFAULT_WEIGHT_UNIT, parseWeightUnit, type WeightUnit } from './weight-unit'

const FENCE_OPEN = /^(`{3,})([^`]*)$/
const LIMIT_MIN = 5
const LIMIT_MAX = 50

export interface ExerciseNoteMigrationOptions {
  name: string
  registry: ExerciseRegistry
  fitnessRoot: string
}

export type ExerciseNoteMigrationStatus =
  | 'already'
  | 'updated'
  | 'unknown'
  | 'skipped-non-exercise-type'
  | 'skipped-malformed-frontmatter'

type SkippedExerciseNoteMigrationStatus = Extract<
  ExerciseNoteMigrationStatus,
  'skipped-non-exercise-type' | 'skipped-malformed-frontmatter'
>

export type ExerciseNoteMigrationWarning =
  | { kind: 'custom-recent-sessions' }
  | { kind: 'custom-notes-section' }
  | {
      kind: 'registry-kind-conflict'
      noteKind: ExerciseKind
      registryKind: ExerciseKind
    }

export interface ExerciseNoteMigrationResult {
  markdown: string
  changed: boolean
  status: ExerciseNoteMigrationStatus
  unknownKind: boolean
  warnings: ExerciseNoteMigrationWarning[]
}

interface FrontmatterRepairResult {
  markdown: string
  kind: ExerciseKind | null
  unknownKind: boolean
  warnings: ExerciseNoteMigrationWarning[]
  skippedStatus: SkippedExerciseNoteMigrationStatus | null
}

interface MarkdownLines {
  lines: string[]
  trailingNewline: boolean
}

interface NormalizedMarkdownSource {
  markdown: string
  lineEnding: '\n' | '\r\n'
  hasBom: boolean
}

interface FencedBlock {
  start: number
  end: number
}

type FrontmatterBoundsResult =
  | { status: 'found'; start: number; end: number }
  | { status: 'missing' }
  | { status: 'malformed' }

interface SectionRepairResult {
  markdown: string
  warnings: ExerciseNoteMigrationWarning[]
}

export function migrateExerciseNote(
  source: string,
  options: ExerciseNoteMigrationOptions,
): ExerciseNoteMigrationResult {
  const normalizedSource = normalizeMarkdownSource(source)
  const frontmatter = repairFrontmatter(normalizedSource.markdown, options)
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

function repairFrontmatter(
  source: string,
  options: ExerciseNoteMigrationOptions,
): FrontmatterRepairResult {
  const registryKind = kindForName(options.registry, options.name)
  const registryUnit = unitForName(options.registry, options.name) ?? DEFAULT_WEIGHT_UNIT
  const bounds = findFrontmatterBounds(source)
  if (bounds.status === 'malformed') {
    return {
      markdown: source,
      kind: null,
      unknownKind: false,
      warnings: [],
      skippedStatus: 'skipped-malformed-frontmatter',
    }
  }
  if (bounds.status === 'missing') {
    const fallbackKind = registryKind ?? inferExerciseKindFromContent(source) ?? 'strength'
    return {
      markdown: `${frontmatterBlock(fallbackKind, registryUnit)}${source}`,
      kind: fallbackKind,
      unknownKind: registryKind === null,
      warnings: [],
      skippedStatus: null,
    }
  }

  const lines = source.split('\n')
  const frontmatterLines = lines.slice(bounds.start + 1, bounds.end)
  const typeLineIndex = findFrontmatterKeyLine(frontmatterLines, 'type')
  if (typeLineIndex >= 0 && scalarValue(frontmatterLines[typeLineIndex] ?? '') !== 'exercise') {
    return {
      markdown: source,
      kind: null,
      unknownKind: false,
      warnings: [],
      skippedStatus: 'skipped-non-exercise-type',
    }
  }

  let nextFrontmatterLines = frontmatterLines
  const warnings: ExerciseNoteMigrationWarning[] = []
  if (typeLineIndex < 0) {
    nextFrontmatterLines = ['type: exercise', ...nextFrontmatterLines]
  }

  let kindLineIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'kind')
  let effectiveKind = frontmatterKind(nextFrontmatterLines)
  let unknownKind = false
  if (effectiveKind) {
    if (registryKind && registryKind !== effectiveKind) {
      warnings.push({
        kind: 'registry-kind-conflict',
        noteKind: effectiveKind,
        registryKind,
      })
    }
  } else if (registryKind) {
    if (kindLineIndex < 0) {
      const typeIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'type')
      nextFrontmatterLines = insertLines(nextFrontmatterLines, typeIndex + 1, [
        `kind: ${registryKind}`,
      ])
    } else {
      nextFrontmatterLines = replaceLine(
        nextFrontmatterLines,
        kindLineIndex,
        `kind: ${registryKind}`,
      )
    }
    effectiveKind = registryKind
  } else if (kindLineIndex < 0 || effectiveKind === null) {
    const fallbackKind = inferExerciseKindFromContent(source) ?? 'strength'
    if (kindLineIndex < 0) {
      const typeIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'type')
      nextFrontmatterLines = insertLines(nextFrontmatterLines, typeIndex + 1, [
        `kind: ${fallbackKind}`,
      ])
    } else {
      nextFrontmatterLines = replaceLine(
        nextFrontmatterLines,
        kindLineIndex,
        `kind: ${fallbackKind}`,
      )
    }
    effectiveKind = fallbackKind
    unknownKind = true
  }

  if (effectiveKind === 'strength') {
    const metricLineIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'metric')
    if (metricLineIndex < 0) {
      kindLineIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'kind')
      nextFrontmatterLines = insertLines(nextFrontmatterLines, kindLineIndex + 1, [
        `metric: ${DEFAULT_EXERCISE_METRIC}`,
      ])
    } else if (frontmatterMetric(nextFrontmatterLines[metricLineIndex] ?? '') === null) {
      nextFrontmatterLines = replaceLine(
        nextFrontmatterLines,
        metricLineIndex,
        `metric: ${DEFAULT_EXERCISE_METRIC}`,
      )
    }
    nextFrontmatterLines = repairStrengthUnit(nextFrontmatterLines, registryUnit)
  }

  const markdown = [
    ...lines.slice(0, bounds.start + 1),
    ...nextFrontmatterLines,
    ...lines.slice(bounds.end),
  ].join('\n')

  return {
    markdown,
    kind: effectiveKind,
    unknownKind,
    warnings,
    skippedStatus: null,
  }
}

function frontmatterBlock(
  kind: ExerciseKind | null,
  unit: WeightUnit = DEFAULT_WEIGHT_UNIT,
): string {
  const lines = ['---', 'type: exercise']
  if (kind) {
    lines.push(`kind: ${kind}`)
    if (kind === 'strength') {
      lines.push(`metric: ${DEFAULT_EXERCISE_METRIC}`)
      lines.push(`unit: ${unit}`)
    }
  }
  lines.push('---', '')
  return `${lines.join('\n')}\n`
}

function inferExerciseKindFromContent(source: string): ExerciseKind | null {
  const document = splitMarkdown(source)
  const headingIndex = findHeadingIndex(document.lines, isRecentSessionsHeading)
  if (headingIndex < 0) {
    return null
  }

  const sectionEnd = findNextH2HeadingIndex(document.lines, headingIndex + 1)
  const block = findDataviewBlockInRange(
    document.lines,
    headingIndex + 1,
    sectionEnd >= 0 ? sectionEnd : document.lines.length,
  )
  if (!block) {
    return null
  }

  const body = document.lines.slice(block.start, block.end + 1).join('\n')
  const hasDurationFields = hasDataviewFields(body, ['duration'])
  const hasStrengthFields = hasDataviewFields(body, ['set', 'weight', 'reps'])
  if (hasDurationFields && !hasStrengthFields) {
    return 'duration'
  }
  if (hasStrengthFields && !hasDurationFields) {
    return 'strength'
  }
  return null
}

function hasDataviewFields(source: string, fields: ReadonlyArray<string>): boolean {
  const searchable = source
    .split('\n')
    .map(stripDataviewQuotedText)
    .map(stripDataviewLinkText)
    .map(stripDataviewAliases)
    .join('\n')
  return fields.some((field) => {
    const pattern = new RegExp(`\\b(?:[A-Za-z]+\\.)?${field}\\b`, 'i')
    return pattern.test(searchable)
  })
}

function stripDataviewQuotedText(line: string): string {
  let quote: '"' | "'" | null = null
  let result = ''
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? ''
    if (quote !== null) {
      if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      result += ' '
      continue
    }
    result += char
  }
  return result
}

function stripDataviewAliases(line: string): string {
  return line.replace(/\bas\s+[^,]+(?=,|$)/gi, '')
}

function stripDataviewLinkText(line: string): string {
  return line.replace(/\[\[[^\]]+\]\]/g, ' ')
}

function frontmatterKind(lines: ReadonlyArray<string>): ExerciseKind | null {
  const kindLineIndex = findFrontmatterKeyLine(lines, 'kind')
  if (kindLineIndex < 0) {
    return null
  }
  const value = scalarValue(lines[kindLineIndex] ?? '')
  if (value === 'strength' || value === 'duration') {
    return value
  }
  return null
}

function frontmatterMetric(line: string): ExerciseMetric | null {
  return parseExerciseMetric(scalarValue(line))
}

function frontmatterUnit(line: string): WeightUnit | null {
  return parseWeightUnit(scalarValue(line))
}

function repairStrengthUnit(lines: ReadonlyArray<string>, missingUnit: WeightUnit): string[] {
  const unitLineIndex = findFrontmatterKeyLine(lines, 'unit')
  if (unitLineIndex < 0) {
    const metricLineIndex = findFrontmatterKeyLine(lines, 'metric')
    const kindLineIndex = findFrontmatterKeyLine(lines, 'kind')
    const insertionIndex = metricLineIndex >= 0 ? metricLineIndex + 1 : kindLineIndex + 1
    return insertLines(lines, insertionIndex, [`unit: ${missingUnit}`])
  }

  if (frontmatterUnit(lines[unitLineIndex] ?? '') === null) {
    return replaceLine(lines, unitLineIndex, `unit: ${missingUnit}`)
  }

  return [...lines]
}

function repairRecentSessions(
  source: string,
  options: ExerciseNoteMigrationOptions,
  kind: ExerciseKind,
): SectionRepairResult {
  const canonicalBlock = buildRecentSessionsBlock(options.name, kind, options.fitnessRoot)
  const canonicalLines = canonicalBlock.split('\n')
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

  const sectionEnd = findNextH2HeadingIndex(document.lines, headingIndex + 1)
  const block = findDataviewBlockInRange(
    document.lines,
    headingIndex + 1,
    sectionEnd >= 0 ? sectionEnd : document.lines.length,
  )
  if (!block) {
    const next = insertBlockAfterHeading(document.lines, headingIndex, canonicalLines)
    return { markdown: joinMarkdown({ ...document, lines: next }), warnings: [] }
  }

  const currentBlock = document.lines.slice(block.start, block.end + 1).join('\n')
  if (currentBlock === canonicalBlock) {
    return { markdown: source, warnings: [] }
  }
  const alternateCanonicalBlock = buildRecentSessionsBlock(
    options.name,
    alternateExerciseKind(kind),
    options.fitnessRoot,
  )
  if (!isCustomRecentSessionsBlock(currentBlock, alternateCanonicalBlock)) {
    const next = [
      ...document.lines.slice(0, block.start),
      ...canonicalLines,
      ...document.lines.slice(block.end + 1),
    ]
    return { markdown: joinMarkdown({ ...document, lines: next }), warnings: [] }
  }
  if (isCustomRecentSessionsBlock(currentBlock, canonicalBlock)) {
    return {
      markdown: source,
      warnings: [{ kind: 'custom-recent-sessions' }],
    }
  }
  if (!hasStaleRecentSessionsTarget(currentBlock, canonicalBlock)) {
    return { markdown: source, warnings: [] }
  }

  const next = [
    ...document.lines.slice(0, block.start),
    ...canonicalLines,
    ...document.lines.slice(block.end + 1),
  ]
  return { markdown: joinMarkdown({ ...document, lines: next }), warnings: [] }
}

function alternateExerciseKind(kind: ExerciseKind): ExerciseKind {
  return kind === 'strength' ? 'duration' : 'strength'
}

function repairNotesSection(
  source: string,
  options: ExerciseNoteMigrationOptions,
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

  const block = findDataviewBlockInRange(document.lines, headingIndex + 1, end)
  if (block) {
    const currentBlock = document.lines.slice(block.start, block.end + 1).join('\n')
    if (
      currentBlock === canonicalBlock &&
      isRangeEmptyExcept(document.lines, headingIndex + 1, end, block.start, block.end + 1)
    ) {
      return { markdown: source, warnings: [] }
    }
  }

  return {
    markdown: source,
    warnings: [{ kind: 'custom-notes-section' }],
  }
}

function hasStaleRecentSessionsTarget(currentBlock: string, canonicalBlock: string): boolean {
  return (
    firstFromPath(currentBlock) !== firstFromPath(canonicalBlock) ||
    firstLinkTarget(currentBlock) !== firstLinkTarget(canonicalBlock) ||
    firstInlineExerciseTarget(currentBlock) !== firstInlineExerciseTarget(canonicalBlock)
  )
}

function isCustomRecentSessionsBlock(currentBlock: string, canonicalBlock: string): boolean {
  const current = dataviewBodyLines(currentBlock)
  const canonical = dataviewBodyLines(canonicalBlock)
  const currentFromIndex = findQueryLine(current, 'from')
  const canonicalFromIndex = findQueryLine(canonical, 'from')
  const currentSortIndex = findQueryLine(current, 'sort')
  const canonicalSortIndex = findQueryLine(canonical, 'sort')

  if (
    currentFromIndex < 0 ||
    canonicalFromIndex < 0 ||
    currentSortIndex < 0 ||
    canonicalSortIndex < 0
  ) {
    return true
  }

  const currentSelect = current.slice(0, currentFromIndex).map(normalizeQueryLine)
  const canonicalSelect = canonical.slice(0, canonicalFromIndex).map(normalizeQueryLine)
  if (!sameStrings(currentSelect, canonicalSelect)) {
    return true
  }

  if (
    normalizeQueryLine(current[currentSortIndex] ?? '') !==
    normalizeQueryLine(canonical[canonicalSortIndex] ?? '')
  ) {
    return true
  }

  const limit = queryLimit(current)
  if (limit === null || limit < LIMIT_MIN || limit > LIMIT_MAX) {
    return true
  }

  return !sameStrings(queryShape(current), queryShape(canonical))
}

function dataviewBodyLines(block: string): string[] {
  const lines = block.split('\n')
  return lines.slice(1, -1)
}

function findQueryLine(lines: ReadonlyArray<string>, keyword: string): number {
  const expected = keyword.toLowerCase()
  for (let index = 0; index < lines.length; index++) {
    const firstWord = (lines[index] ?? '').trim().split(/\s+/, 1)[0]?.toLowerCase()
    if (firstWord === expected) {
      return index
    }
  }
  return -1
}

function queryLimit(lines: ReadonlyArray<string>): number | null {
  const index = findQueryLine(lines, 'limit')
  if (index < 0) {
    return null
  }
  const match = (lines[index] ?? '').trim().match(/^limit\s+(\d+)\s*$/i)
  if (!match) {
    return null
  }
  const rawLimit = match[1]
  if (!rawLimit) {
    return null
  }
  return Number.parseInt(rawLimit, 10)
}

function normalizeQueryLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ').toLowerCase()
}

function queryShape(lines: ReadonlyArray<string>): string[] {
  return lines.map((line) =>
    normalizeQueryLine(line)
      .replace(/^from "[^"]+"$/, 'from "<path>"')
      .replace(/link\("[^"]+"\)/g, 'link("<name>")')
      .replace(/\[exercise:: \[\[[^\]]+\]\]\]/g, '[exercise:: [[<name>]]]')
      .replace(/^limit \d+$/, 'limit <n>'),
  )
}

function sameStrings(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) {
    return false
  }
  return left.every((value, index) => value === right[index])
}

function firstFromPath(block: string): string | null {
  for (const line of dataviewBodyLines(block)) {
    const match = line.trim().match(/^from\s+"([^"]+)"\s*$/i)
    if (match?.[1]) {
      return match[1]
    }
  }
  return null
}

function firstLinkTarget(block: string): string | null {
  const match = block.match(/link\("([^"]+)"\)/i)
  return match?.[1] ?? null
}

function firstInlineExerciseTarget(block: string): string | null {
  const match = block.match(/\[exercise:: \[\[([^\]]+)\]\]\]/i)
  return match?.[1] ?? null
}

function ensureChartBlock(source: string): string {
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
  const block = findFitKitChartBlockInRange(lines, start + 1, end)
  return block ? { start, end } : null
}

function firstSectionIndexAfterFrontmatter(lines: ReadonlyArray<string>): number {
  if (frontmatterProbeLine(lines[0] ?? '', 0) !== '---') {
    return 0
  }
  for (let index = 1; index < lines.length; index++) {
    if (frontmatterProbeLine(lines[index] ?? '', index) !== '---') {
      continue
    }
    let insertionIndex = index + 1
    while (lines[insertionIndex] === '') {
      insertionIndex += 1
    }
    return insertionIndex
  }
  return 0
}

function hasFitKitChartBlock(source: string): boolean {
  const lines = source.split('\n')
  return findFitKitChartBlockInRange(lines, 0, lines.length) !== null
}

function findFitKitChartBlockInRange(
  lines: ReadonlyArray<string>,
  start: number,
  end: number,
): FencedBlock | null {
  let openFence: string | null = null
  let openStart = -1
  for (let index = start; index < end; index++) {
    const line = lines[index] ?? ''
    if (openFence !== null) {
      if (isClosingFence(line, openFence)) {
        return { start: openStart, end: index }
      }
      continue
    }
    const opening = parseOpeningFence(line)
    if (!opening) {
      continue
    }
    if (opening.info.toLowerCase() === 'fitkit-chart') {
      openFence = opening.fence
      openStart = index
      continue
    }
    openFence = opening.fence
    while (index + 1 < end) {
      index += 1
      if (isClosingFence(lines[index] ?? '', openFence)) {
        openFence = null
        break
      }
    }
  }
  return null
}

function parseOpeningFence(line: string): { fence: string; info: string } | null {
  const match = line.match(FENCE_OPEN)
  if (!match) {
    return null
  }
  const fence = match[1] ?? ''
  const info = (match[2] ?? '').trim()
  return { fence, info }
}

function isClosingFence(line: string, openFence: string): boolean {
  const trimmedRight = line.replace(/\s+$/, '')
  if (!/^`{3,}$/.test(trimmedRight)) {
    return false
  }
  return trimmedRight.length >= openFence.length
}

function findFrontmatterBounds(source: string): FrontmatterBoundsResult {
  /** Frontmatter probing strips BOM and CR while writes preserve the original file shape. */
  const lines = source.split('\n').map((line, index) => frontmatterProbeLine(line, index))
  if (lines[0] !== '---') {
    return { status: 'missing' }
  }
  for (let index = 1; index < lines.length; index++) {
    if (lines[index] === '---') {
      return { status: 'found', start: 0, end: index }
    }
  }
  return { status: 'malformed' }
}

function frontmatterProbeLine(line: string, index: number): string {
  const withoutBom = index === 0 ? line.replace(/^\uFEFF/, '') : line
  return withoutBom.replace(/\r$/, '')
}

function findFrontmatterKeyLine(lines: ReadonlyArray<string>, key: string): number {
  const expected = key.toLowerCase()
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    const colon = line.indexOf(':')
    if (colon < 0) {
      continue
    }
    if (line.slice(0, colon).trim().toLowerCase() === expected) {
      return index
    }
  }
  return -1
}

function scalarValue(line: string): string {
  const colon = line.indexOf(':')
  if (colon < 0) {
    return ''
  }
  return stripScalarQuotes(stripInlineComment(line.slice(colon + 1)).trim()).toLowerCase()
}

function stripInlineComment(value: string): string {
  let quote: '"' | "'" | null = null
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if ((char === '"' || char === "'") && quote === null) {
      quote = char
      continue
    }
    if (char === quote) {
      quote = null
      continue
    }
    if (char === '#' && quote === null) {
      return value.slice(0, index).trimEnd()
    }
  }
  return value
}

function stripScalarQuotes(value: string): string {
  if (value.length < 2) {
    return value
  }
  const first = value[0]
  const last = value[value.length - 1]
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
    return value.slice(1, -1)
  }
  return value
}

function splitMarkdown(source: string): MarkdownLines {
  const trailingNewline = source.endsWith('\n')
  const body = trailingNewline ? source.slice(0, -1) : source
  return {
    lines: body.length > 0 ? body.split('\n') : [],
    trailingNewline,
  }
}

function joinMarkdown(document: MarkdownLines): string {
  const joined = document.lines.join('\n')
  return document.trailingNewline ? `${joined}\n` : joined
}

function normalizeMarkdownSource(source: string): NormalizedMarkdownSource {
  const hasBom = source.startsWith('\uFEFF')
  const withoutBom = hasBom ? source.slice(1) : source
  return {
    markdown: withoutBom.replace(/\r\n/g, '\n'),
    lineEnding: withoutBom.includes('\r\n') ? '\r\n' : '\n',
    hasBom,
  }
}

function restoreMarkdownSource(markdown: string, source: NormalizedMarkdownSource): string {
  const withLineEnding = source.lineEnding === '\r\n' ? markdown.replace(/\n/g, '\r\n') : markdown
  return source.hasBom ? `\uFEFF${withLineEnding}` : withLineEnding
}

function insertLines<T>(lines: ReadonlyArray<T>, index: number, insertion: ReadonlyArray<T>): T[] {
  return [...lines.slice(0, index), ...insertion, ...lines.slice(index)]
}

function replaceLine<T>(lines: ReadonlyArray<T>, index: number, line: T): T[] {
  return [...lines.slice(0, index), line, ...lines.slice(index + 1)]
}

function insertSection(
  lines: ReadonlyArray<string>,
  index: number,
  sectionLines: ReadonlyArray<string>,
): string[] {
  const prefix = lines.slice(0, index)
  const suffix = lines.slice(index)
  const needsBlankBefore = prefix.length > 0 && prefix[prefix.length - 1] !== ''
  const hasTrailingBlank = sectionLines[sectionLines.length - 1] === ''
  const needsBlankAfter = suffix.length > 0 && suffix[0] !== '' && !hasTrailingBlank
  return [
    ...prefix,
    ...(needsBlankBefore ? [''] : []),
    ...sectionLines,
    ...(needsBlankAfter ? [''] : []),
    ...suffix,
  ]
}

function insertBlockAfterHeading(
  lines: ReadonlyArray<string>,
  headingIndex: number,
  blockLines: ReadonlyArray<string>,
): string[] {
  const afterHeading = headingIndex + 1
  const insertAt = lines[afterHeading] === '' ? afterHeading + 1 : afterHeading
  const suffix = lines.slice(insertAt)
  return [
    ...lines.slice(0, insertAt),
    ...(lines[afterHeading] === '' ? [] : ['']),
    ...blockLines,
    ...(suffix.length > 0 && suffix[0] !== '' ? [''] : []),
    ...suffix,
  ]
}

function hasNonEmptyContentInRange(
  lines: ReadonlyArray<string>,
  start: number,
  end: number,
): boolean {
  for (let index = start; index < end; index++) {
    if ((lines[index] ?? '').trim() !== '') {
      return true
    }
  }
  return false
}

function isRangeEmptyExcept(
  lines: ReadonlyArray<string>,
  start: number,
  end: number,
  exceptStart: number,
  exceptEnd: number,
): boolean {
  for (let index = start; index < end; index++) {
    if (index >= exceptStart && index < exceptEnd) {
      continue
    }
    if ((lines[index] ?? '').trim() !== '') {
      return false
    }
  }
  return true
}

function firstExistingSectionIndex(
  lines: ReadonlyArray<string>,
  predicates: ReadonlyArray<(line: string) => boolean>,
): number {
  let best = -1
  for (const predicate of predicates) {
    const index = findHeadingIndex(lines, predicate)
    if (index >= 0 && (best < 0 || index < best)) {
      best = index
    }
  }
  return best >= 0 ? best : lines.length
}

function findHeadingIndex(
  lines: ReadonlyArray<string>,
  predicate: (line: string) => boolean,
  start = 0,
): number {
  let openFence: string | null = null
  for (let index = start; index < lines.length; index++) {
    const line = lines[index] ?? ''
    if (openFence !== null) {
      if (isClosingFence(line, openFence)) {
        openFence = null
      }
      continue
    }
    const opening = parseOpeningFence(line)
    if (opening) {
      openFence = opening.fence
      continue
    }
    if (predicate(line)) {
      return index
    }
  }
  return -1
}

function findNextH2HeadingIndex(lines: ReadonlyArray<string>, start: number): number {
  return findHeadingIndex(lines, (line) => /^##\s+\S/.test(line), start)
}

function findDataviewBlockInRange(
  lines: ReadonlyArray<string>,
  start: number,
  end: number,
): FencedBlock | null {
  let openFence: string | null = null
  let openInfo = ''
  let openStart = -1
  for (let index = start; index < end; index++) {
    const line = lines[index] ?? ''
    if (openFence !== null) {
      if (isClosingFence(line, openFence)) {
        if (openInfo.toLowerCase() === 'dataview') {
          /** Multiple Dataview blocks are conservative, only the first can be canonical. */
          return { start: openStart, end: index }
        }
        openFence = null
      }
      continue
    }
    const opening = parseOpeningFence(line)
    if (opening) {
      openFence = opening.fence
      openInfo = opening.info
      openStart = index
    }
  }
  return null
}

function isRecentSessionsHeading(line: string): boolean {
  return /^##\s+Recent sessions\s*$/i.test(line)
}

function isProgressChartHeading(line: string): boolean {
  return /^##\s+Progress chart\s*$/i.test(line)
}

function isNotesHeading(line: string): boolean {
  return /^##\s+Notes\s*$/i.test(line)
}
