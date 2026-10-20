const pad = (value: number): string => String(value).padStart(2, '0')

const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/

/** Local calendar date as `yyyy-mm-dd`. */
export function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The leading `yyyy-mm-dd` of `value`, or null when it does not start with one. */
export function isoDatePrefix(value: string): string | null {
  return value.match(ISO_DATE_PREFIX)?.[1] ?? null
}

/** ISO 8601 in the device's local time with its UTC offset, to the second: `2026-09-30T07:15:03+10:00`. */
export function formatLocalTimestamp(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes < 0 ? '-' : '+'
  const absOffset = Math.abs(offsetMinutes)
  return (
    formatIsoDate(date) +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
  )
}
