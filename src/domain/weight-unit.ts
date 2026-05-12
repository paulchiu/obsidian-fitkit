export type WeightUnit = 'kg' | 'lbs'

export const DEFAULT_WEIGHT_UNIT: WeightUnit = 'kg'

export function parseWeightUnit(value: unknown): WeightUnit | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'kg' || normalized === 'lbs') {
    return normalized
  }
  return null
}
