const pad = (value: number): string => String(value).padStart(2, '0')

/** ISO 8601 in the device's local time with its UTC offset, to the second: `2026-09-30T07:15:03+10:00`. */
export function formatLocalTimestamp(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes < 0 ? '-' : '+'
  const absOffset = Math.abs(offsetMinutes)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
  )
}
