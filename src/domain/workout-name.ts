import { formatIsoDate } from './dates'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Morning from 5:00, afternoon from 12:00, evening from 17:00 and night from 21:00. */
function timeOfDay(now: Date): string {
  const hour = now.getHours()
  if (hour >= 5 && hour < 12) return 'Morning'
  if (hour >= 12 && hour < 17) return 'Afternoon'
  if (hour >= 17 && hour < 21) return 'Evening'
  return 'Night'
}

/** The name a new workout takes from the default workout name template, given when it is created. */
export function defaultWorkoutName(template: string, now: Date): string {
  return template
    .replaceAll('{{weekday}}', WEEKDAYS[now.getDay()] ?? '')
    .replaceAll('{{date}}', formatIsoDate(now))
    .replaceAll('{{time-of-day}}', timeOfDay(now))
    .trim()
}
