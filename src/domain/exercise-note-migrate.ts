import { kindForName, type ExerciseKind, type ExerciseRegistry } from './exercise-registry'
import { buildRecentSessionsBlock } from './exercise-note-template'

const FENCE_OPEN = /^(`{3,})([^`]*)$/
const LIMIT_MIN = 5
const LIMIT_MAX = 50

export interface ExerciseNoteMigrationOptions {
  name: string
  registry: ExerciseRegistry
  fitnessRoot: string
}

export type ExerciseNoteMigrationStatus = 'already' | 'updated' | 'skipped-non-exercise-type'

export interface ExerciseNoteMigrationWarning {
  kind: 'custom-recent-sessions'
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
  skipped: boolean
}

interface MarkdownLines {
  lines: string[]
  trailingNewline: boolean
}

interface FencedBlock {
  start: number
  end: number
}

interface RecentSessionsRepairResult {
  markdown: string
  warnings: ExerciseNoteMigrationWarning[]
}

export function migrateExerciseNote(
  source: string,
  options: ExerciseNoteMigrationOptions,
): ExerciseNoteMigrationResult {
  const frontmatter = repairFrontmatter(source, options)
  if (frontmatter.skipped) {
    return {
      markdown: source,
      changed: false,
      status: 'skipped-non-exercise-type',
      unknownKind: false,
      warnings: [],
    }
  }

  const recent = frontmatter.kind
    ? repairRecentSessions(frontmatter.markdown, options, frontmatter.kind)
    : { markdown: frontmatter.markdown, warnings: [] }
  const withChart = ensureChartBlock(recent.markdown)
  const markdown = ensureNotesSection(withChart)

  return {
    markdown,
    changed: markdown !== source,
    status: markdown === source ? 'already' : 'updated',
    unknownKind: frontmatter.unknownKind,
    warnings: recent.warnings,
  }
}

function repairFrontmatter(
  source: string,
  options: ExerciseNoteMigrationOptions,
): FrontmatterRepairResult {
  const registryKind = kindForName(options.registry, options.name)
  const bounds = findFrontmatterBounds(source)
  if (!bounds) {
    return {
      markdown: `${frontmatterBlock(registryKind)}${source}`,
      kind: registryKind,
      unknownKind: registryKind === null,
      skipped: false,
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
      skipped: true,
    }
  }

  let nextFrontmatterLines = frontmatterLines
  if (typeLineIndex < 0) {
    nextFrontmatterLines = ['type: exercise', ...nextFrontmatterLines]
  }

  const kindLineIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'kind')
  let unknownKind = false
  if (kindLineIndex < 0) {
    if (registryKind) {
      const typeIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'type')
      nextFrontmatterLines = insertLines(nextFrontmatterLines, typeIndex + 1, [
        `kind: ${registryKind}`,
      ])
    } else {
      unknownKind = true
    }
  }

  const effectiveKind = frontmatterKind(nextFrontmatterLines)
  if (effectiveKind === 'strength' && findFrontmatterKeyLine(nextFrontmatterLines, 'metric') < 0) {
    const updatedKindLineIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'kind')
    nextFrontmatterLines = insertLines(nextFrontmatterLines, updatedKindLineIndex + 1, [
      'metric: e1rm',
    ])
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
    skipped: false,
  }
}

function frontmatterBlock(kind: ExerciseKind | null): string {
  const lines = ['---', 'type: exercise']
  if (kind) {
    lines.push(`kind: ${kind}`)
    if (kind === 'strength') {
      lines.push('metric: e1rm')
    }
  }
  lines.push('---', '')
  return `${lines.join('\n')}\n`
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

function repairRecentSessions(
  source: string,
  options: ExerciseNoteMigrationOptions,
  kind: ExerciseKind,
): RecentSessionsRepairResult {
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
  if (hasFitKitChartBlock(source)) {
    return source
  }

  const document = splitMarkdown(source)
  const notesIndex = findHeadingIndex(document.lines, isNotesHeading)
  const insertionIndex = notesIndex >= 0 ? notesIndex : document.lines.length
  const next = insertSection(document.lines, insertionIndex, [
    '## Progress chart',
    '',
    '```fitkit-chart',
    '```',
    '',
  ])
  return joinMarkdown({ ...document, lines: next })
}

function ensureNotesSection(source: string): string {
  const document = splitMarkdown(source)
  if (findHeadingIndex(document.lines, isNotesHeading) >= 0) {
    return source
  }
  const next = insertSection(document.lines, document.lines.length, ['## Notes', ''])
  return joinMarkdown({ ...document, lines: next })
}

function hasFitKitChartBlock(source: string): boolean {
  const lines = source.split('\n')
  let openFence: string | null = null
  for (const line of lines) {
    if (openFence !== null) {
      if (isClosingFence(line, openFence)) {
        openFence = null
      }
      continue
    }
    const opening = parseOpeningFence(line)
    if (!opening) {
      continue
    }
    if (opening.info.toLowerCase() === 'fitkit-chart') {
      return true
    }
    openFence = opening.fence
  }
  return false
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

function findFrontmatterBounds(source: string): { start: number; end: number } | null {
  const lines = source.split('\n')
  if (lines[0] !== '---') {
    return null
  }
  for (let index = 1; index < lines.length; index++) {
    if (lines[index] === '---') {
      return { start: 0, end: index }
    }
  }
  return null
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
  return stripScalarQuotes(line.slice(colon + 1).trim()).toLowerCase()
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

function insertLines<T>(lines: ReadonlyArray<T>, index: number, insertion: ReadonlyArray<T>): T[] {
  return [...lines.slice(0, index), ...insertion, ...lines.slice(index)]
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
