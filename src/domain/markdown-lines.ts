const FENCE_OPEN = /^(`{3,})([^`]*)$/

export interface MarkdownLines {
  lines: string[]
  trailingNewline: boolean
}

export interface NormalizedMarkdownSource {
  markdown: string
  lineEnding: '\n' | '\r\n'
  hasBom: boolean
}

export interface FencedBlock {
  start: number
  end: number
}

type FrontmatterBoundsResult =
  { status: 'found'; start: number; end: number } | { status: 'missing' } | { status: 'malformed' }

export function splitMarkdown(source: string): MarkdownLines {
  const trailingNewline = source.endsWith('\n')
  const body = trailingNewline ? source.slice(0, -1) : source
  return {
    lines: body.length > 0 ? body.split('\n') : [],
    trailingNewline,
  }
}

export function joinMarkdown(document: MarkdownLines): string {
  const joined = document.lines.join('\n')
  return document.trailingNewline ? `${joined}\n` : joined
}

/** Strips a BOM and CRLF line endings so edits work on `\n`; `restoreMarkdownSource` puts both back. */
export function normalizeMarkdownSource(source: string): NormalizedMarkdownSource {
  const hasBom = source.startsWith('\uFEFF')
  const withoutBom = hasBom ? source.slice(1) : source
  return {
    markdown: withoutBom.replace(/\r\n/g, '\n'),
    lineEnding: withoutBom.includes('\r\n') ? '\r\n' : '\n',
    hasBom,
  }
}

export function restoreMarkdownSource(markdown: string, source: NormalizedMarkdownSource): string {
  const withLineEnding = source.lineEnding === '\r\n' ? markdown.replace(/\n/g, '\r\n') : markdown
  return source.hasBom ? `\uFEFF${withLineEnding}` : withLineEnding
}

export function insertLines<T>(
  lines: ReadonlyArray<T>,
  index: number,
  insertion: ReadonlyArray<T>,
): T[] {
  return [...lines.slice(0, index), ...insertion, ...lines.slice(index)]
}

export function replaceLine<T>(lines: ReadonlyArray<T>, index: number, line: T): T[] {
  return [...lines.slice(0, index), line, ...lines.slice(index + 1)]
}

/** Inserts `sectionLines` at `index`, padding with a blank line on either side where one is missing. */
export function insertSection(
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

export function insertBlockAfterHeading(
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

export function hasNonEmptyContentInRange(
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

export function isRangeEmptyExcept(
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

/** Index of the earliest heading matching any predicate, or the end of the document. */
export function firstExistingSectionIndex(
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

/** First line from `start` matching `predicate`, ignoring lines inside fenced blocks. */
export function findHeadingIndex(
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

export function findNextH2HeadingIndex(lines: ReadonlyArray<string>, start: number): number {
  return findHeadingIndex(lines, (line) => /^##\s+\S/.test(line), start)
}

/**
 * First fenced block in `[start, end)` whose info string is `info` (case-insensitive), skipping
 * other fences. Null when none closes, so a note with several matches only offers the first.
 */
export function findFencedBlockInRange(
  lines: ReadonlyArray<string>,
  start: number,
  end: number,
  info: string,
): FencedBlock | null {
  const expected = info.toLowerCase()
  let open: { fence: string; info: string; start: number } | null = null
  for (let index = start; index < end; index++) {
    const line = lines[index] ?? ''
    if (open === null) {
      const opening = parseOpeningFence(line)
      if (opening) {
        open = { ...opening, start: index }
      }
      continue
    }
    if (!isClosingFence(line, open.fence)) {
      continue
    }
    if (open.info.toLowerCase() === expected) {
      return { start: open.start, end: index }
    }
    open = null
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

export function findFrontmatterBounds(source: string): FrontmatterBoundsResult {
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

/** First line after the frontmatter and its trailing blank lines, or 0 when there is none. */
export function firstSectionIndexAfterFrontmatter(lines: ReadonlyArray<string>): number {
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

/** Frontmatter probing strips BOM and CR while writes preserve the original file shape. */
function frontmatterProbeLine(line: string, index: number): string {
  const withoutBom = index === 0 ? line.replace(/^\uFEFF/, '') : line
  return withoutBom.replace(/\r$/, '')
}

export function findFrontmatterKeyLine(lines: ReadonlyArray<string>, key: string): number {
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

/** A `key: value` line's value, lower-cased, without its inline comment or surrounding quotes. */
export function scalarValue(line: string): string {
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
