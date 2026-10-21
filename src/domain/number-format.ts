/** Prints integers as-is and other values rounded to `decimals` places without trailing zeros. */
export function formatNumber(value: number, decimals = 1): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(decimals)))
}

/** Formats a rep count with a singular or plural label. */
export function formatReps(reps: number): string {
  return `${formatNumber(reps)} rep${formatNumber(reps) === '1' ? '' : 's'}`
}
