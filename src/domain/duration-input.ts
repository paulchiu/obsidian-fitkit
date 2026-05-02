export interface ParsedDurationInput {
  seconds: number | undefined
  display: string
}

const SECOND = 1
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const YEAR = 365 * DAY

const DISPLAY_UNITS: ReadonlyArray<{ suffix: string; seconds: number }> = [
  { suffix: 'y', seconds: YEAR },
  { suffix: 'd', seconds: DAY },
  { suffix: 'h', seconds: HOUR },
  { suffix: 'm', seconds: MINUTE },
  { suffix: 's', seconds: SECOND },
]

const UNIT_SECONDS: Record<string, number> = {
  y: YEAR,
  d: DAY,
  h: HOUR,
  m: MINUTE,
  s: SECOND,
}

export function formatDurationInput(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return ''
  }
  let remaining = Math.max(0, Math.round(seconds))
  if (remaining === 0) {
    return '0s'
  }

  const parts: string[] = []
  for (const unit of DISPLAY_UNITS) {
    const amount = Math.floor(remaining / unit.seconds)
    if (amount === 0) {
      continue
    }
    parts.push(`${amount}${unit.suffix}`)
    remaining -= amount * unit.seconds
  }
  return parts.join('')
}

export function parseDurationInput(raw: string): ParsedDurationInput | null {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) {
    return { seconds: undefined, display: '' }
  }

  const compact = trimmed.replace(/\s+/g, '')
  let seconds: number | null = null
  if (compact.includes(':')) {
    seconds = parseClockDuration(compact)
  } else if (/[ydhms]/u.test(compact)) {
    seconds = parseUnitDuration(compact)
  } else if (/^\d+$/u.test(compact)) {
    seconds = Number.parseInt(compact, 10)
  }

  if (seconds === null || !Number.isFinite(seconds)) {
    return null
  }
  return { seconds, display: formatDurationInput(seconds) }
}

function parseClockDuration(value: string): number | null {
  const parts = value.split(':')
  if (parts.length !== 2 && parts.length !== 3) {
    return null
  }
  if (!parts.every((part) => /^\d+$/u.test(part))) {
    return null
  }

  const numbers = parts.map((part) => Number.parseInt(part, 10))
  if (numbers.some((part) => !Number.isFinite(part))) {
    return null
  }

  if (numbers.length === 2) {
    const [minutes, seconds] = numbers
    if (seconds === undefined || seconds >= 60) {
      return null
    }
    return (minutes ?? 0) * 60 + seconds
  }

  const [hours, minutes, seconds] = numbers
  if (minutes === undefined || seconds === undefined || minutes >= 60 || seconds >= 60) {
    return null
  }
  return (hours ?? 0) * 3600 + minutes * 60 + seconds
}

function parseUnitDuration(value: string): number | null {
  const matches = value.matchAll(/(\d+)([ydhms])/gu)
  let consumedUntil = 0
  let seconds = 0
  const seen = new Set<string>()

  for (const match of matches) {
    const token = match[0]
    const amountRaw = match[1]
    const unit = match[2]
    if (match.index !== consumedUntil || amountRaw === undefined || unit === undefined) {
      return null
    }
    if (seen.has(unit)) {
      return null
    }
    seen.add(unit)
    consumedUntil += token.length

    const amount = Number.parseInt(amountRaw, 10)
    if (!Number.isFinite(amount)) {
      return null
    }
    const unitSeconds = UNIT_SECONDS[unit]
    if (unitSeconds === undefined) {
      return null
    }
    seconds += amount * unitSeconds
  }

  if (consumedUntil !== value.length || seen.size === 0) {
    return null
  }
  return seconds
}
