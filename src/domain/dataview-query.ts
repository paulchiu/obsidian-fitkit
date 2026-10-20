import { sameStrings } from './array-utils'

const LIMIT_MIN = 5
const LIMIT_MAX = 50

/**
 * True when two Dataview blocks differ in which exercise they target: the `from` path,
 * the `link(...)` call or the inline `[exercise:: [[...]]]` field, the forms the templates use.
 */
export function hasStaleDataviewTarget(currentBlock: string, canonicalBlock: string): boolean {
  return (
    firstFromPath(currentBlock) !== firstFromPath(canonicalBlock) ||
    firstLinkTarget(currentBlock) !== firstLinkTarget(canonicalBlock) ||
    firstInlineExerciseTarget(currentBlock) !== firstInlineExerciseTarget(canonicalBlock)
  )
}

/** True when `currentBlock` is a hand-edited query rather than `canonicalBlock` with another name or limit. */
export function isCustomDataviewBlock(currentBlock: string, canonicalBlock: string): boolean {
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

/** True when the query reads any of `fields`, ignoring quoted text, link targets and aliases. */
export function hasDataviewFields(source: string, fields: ReadonlyArray<string>): boolean {
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
