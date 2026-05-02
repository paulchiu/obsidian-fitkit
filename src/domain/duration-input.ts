export interface ParsedDurationInput {
  seconds: number | undefined
  display: string
}

export function formatDurationInput(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return ''
  }
  const wholeSeconds = Math.max(0, Math.round(seconds))
  const secondsPart = wholeSeconds % 60
  const totalMinutes = Math.floor(wholeSeconds / 60)
  const minutesPart = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  if (hours > 0) {
    return `${hours}h${minutesPart}m${secondsPart}s`
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}m${secondsPart}s`
  }
  return `${wholeSeconds}s`
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
  } else if (/[hms]/u.test(compact)) {
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
  const matches = value.matchAll(/(\d+)([hms])/gu)
  let consumedUntil = 0
  let hours = 0
  let minutes = 0
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
    if (unit === 'h') {
      hours = amount
    } else if (unit === 'm') {
      minutes = amount
    } else {
      seconds = amount
    }
  }

  if (consumedUntil !== value.length || seen.size === 0) {
    return null
  }
  return hours * 3600 + minutes * 60 + seconds
}
