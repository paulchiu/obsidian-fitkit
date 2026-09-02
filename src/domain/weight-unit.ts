export type WeightUnit = 'kg' | 'lbs'

/** Every selectable weight unit, in the order the UI offers them. */
export const WEIGHT_UNITS: readonly WeightUnit[] = ['kg', 'lbs']

export const DEFAULT_WEIGHT_UNIT: WeightUnit = 'kg'

export function parseWeightUnit(value: unknown): WeightUnit | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  const match = WEIGHT_UNITS.find((unit) => unit === normalized)
  return match ?? null
}
