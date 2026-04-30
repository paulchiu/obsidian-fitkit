const UNIT_SECONDS: Record<string, number> = {
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
}

const UNIT_PATTERN = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi

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
    return `${hours}:${pad2(minutesPart)}:${pad2(secondsPart)}`
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}:${pad2(secondsPart)}`
  }
  return `${wholeSeconds}s`
}

export function parseDurationInput(raw: string): number | null {
  const value = raw.trim().toLowerCase()
  if (value.length === 0) {
    return null
  }

  const plainSeconds = parsePlainSeconds(value)
  if (plainSeconds !== null) {
    return plainSeconds
  }

  const clockSeconds = parseClockDuration(value)
  if (clockSeconds !== null) {
    return clockSeconds
  }

  return parseUnitDuration(value)
}

function parsePlainSeconds(value: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    return null
  }
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.round(seconds) : null
}

function parseClockDuration(value: string): number | null {
  if (!/^\d+(?::\d{1,2}){1,2}$/.test(value)) {
    return null
  }
  const parts = value.split(':').map((part) => Number.parseInt(part, 10))
  if (parts.some((part) => !Number.isFinite(part))) {
    return null
  }
  if (parts.length === 2) {
    const [minutes, seconds] = parts
    if (minutes === undefined || seconds === undefined || seconds > 59) {
      return null
    }
    return minutes * 60 + seconds
  }
  const [hours, minutes, seconds] = parts
  if (
    hours === undefined ||
    minutes === undefined ||
    seconds === undefined ||
    minutes > 59 ||
    seconds > 59
  ) {
    return null
  }
  return hours * 3600 + minutes * 60 + seconds
}

function parseUnitDuration(value: string): number | null {
  const normalized = value.replace(/,/g, ' ').replace(/\band\b/gi, ' ')
  UNIT_PATTERN.lastIndex = 0
  let cursor = 0
  let totalSeconds = 0
  let matched = false
  let match: RegExpExecArray | null
  while ((match = UNIT_PATTERN.exec(normalized)) !== null) {
    if (normalized.slice(cursor, match.index).trim().length > 0) {
      return null
    }
    const amount = Number(match[1])
    const unit = match[2]?.toLowerCase()
    const multiplier = unit ? UNIT_SECONDS[unit] : undefined
    if (!Number.isFinite(amount) || multiplier === undefined) {
      return null
    }
    totalSeconds += amount * multiplier
    cursor = match.index + match[0].length
    matched = true
  }
  if (!matched || normalized.slice(cursor).trim().length > 0) {
    return null
  }
  return Math.round(totalSeconds)
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}
