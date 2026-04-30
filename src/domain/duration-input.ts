export interface DurationParts {
  hours: number
  minutes: number
  seconds: number
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
    return `${hours}:${pad2(minutesPart)}:${pad2(secondsPart)}`
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}:${pad2(secondsPart)}`
  }
  return `${wholeSeconds}s`
}

export function durationPartsFromSeconds(seconds: number | undefined): DurationParts {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return { hours: 0, minutes: 0, seconds: 0 }
  }
  const wholeSeconds = Math.max(0, Math.round(seconds))
  return {
    hours: Math.floor(wholeSeconds / 3600),
    minutes: Math.floor((wholeSeconds % 3600) / 60),
    seconds: wholeSeconds % 60,
  }
}

export function secondsFromDurationParts(parts: DurationParts): number {
  return (
    Math.max(0, parts.hours) * 3600 + Math.max(0, parts.minutes) * 60 + Math.max(0, parts.seconds)
  )
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}
