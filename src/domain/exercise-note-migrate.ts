const FENCE_OPEN = /^(`{3,})([^`]*)$/

/**
 * Insert the `## Progress chart` block (with an empty `fitkit-chart`
 * fenced block) into an exercise note's source if it is not already
 * present. Idempotent: running twice equals running once.
 */
export function migrateExerciseNote(source: string): string {
  if (hasFitKitChartBlock(source)) {
    return source
  }
  return insertChartBlock(source)
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

function findTopLevelNotesHeading(lines: ReadonlyArray<string>): number {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    if (/^##\s+Notes\s*$/.test(line)) {
      return index
    }
  }
  return -1
}
