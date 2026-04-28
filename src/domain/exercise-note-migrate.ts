const FENCE_OPEN = /^(`{3,})([^`]*)$/

/**
 * Backfill exercise-note metadata and insert the `## Progress chart` block
 * with an empty `fitkit-chart` fenced block. Idempotent: running twice
 * equals running once.
 */
export function migrateExerciseNote(source: string): string {
  const withMetric = addDefaultMetric(source)
  if (hasFitKitChartBlock(withMetric)) {
    return withMetric
  }
  return insertChartBlock(withMetric)
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

function insertChartBlock(source: string): string {
  const trailingNewline = source.endsWith('\n')
  const body = trailingNewline ? source.slice(0, -1) : source
  const lines = body.split('\n')
  const insertion = ['## Progress chart', '', '```fitkit-chart', '```', '']
  const notesIndex = findTopLevelNotesHeading(lines)

  let next: string[]
  if (notesIndex >= 0) {
    next = [...lines.slice(0, notesIndex), ...insertion, ...lines.slice(notesIndex)]
  } else {
    const needsBlank = lines.length > 0 && lines[lines.length - 1] !== ''
    next = needsBlank ? [...lines, '', ...insertion] : [...lines, ...insertion]
  }

  const joined = next.join('\n')
  return trailingNewline ? `${joined}\n` : joined
}

function addDefaultMetric(source: string): string {
  const bounds = findFrontmatterBounds(source)
  if (!bounds) {
    return source
  }

  const lines = source.split('\n')
  const frontmatterLines = lines.slice(bounds.start + 1, bounds.end)
  const kindLineIndex = findFrontmatterKeyLine(frontmatterLines, 'kind')
  if (kindLineIndex < 0 || scalarValue(frontmatterLines[kindLineIndex] ?? '') !== 'strength') {
    return source
  }
  if (findFrontmatterKeyLine(frontmatterLines, 'metric') >= 0) {
    return source
  }

  const insertionIndex = bounds.start + 1 + kindLineIndex + 1
  const next = [...lines.slice(0, insertionIndex), 'metric: e1rm', ...lines.slice(insertionIndex)]
  return next.join('\n')
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

function findTopLevelNotesHeading(lines: ReadonlyArray<string>): number {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    if (/^##\s+Notes\s*$/.test(line)) {
      return index
    }
  }
  return -1
}
