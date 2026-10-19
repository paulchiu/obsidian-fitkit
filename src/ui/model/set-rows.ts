import type { IntensityKind } from '../../domain/interval-plan'
import type { IntervalProgram } from '../../domain/interval-program'
import type { RunRow } from '../../domain/interval-run'

export interface EditableStrengthSet {
  set?: number
  weight?: number
  reps?: number
  note?: string
}

export type EditableDurationEntry = RunRow

export interface EditableBodyweightSet {
  set?: number
  level?: number
  reps?: number
  load?: number
  note?: string
}

export const INTENSITY_LABELS: Record<IntensityKind, string> = {
  watts: 'Watts',
  load: 'Load',
  level: 'Level',
}

export interface IntervalColumns {
  plan: IntervalProgram | null
  intensity: IntensityKind | null
  rest: boolean
}

export function durationRowClasses(columns: IntervalColumns, base: string): string {
  return [base, columns.intensity ? 'has-intensity' : '', columns.rest ? 'has-rest' : '']
    .filter(Boolean)
    .join(' ')
}

/** The number typed in a field, or undefined when it is empty or not a number. */
export function parseNumberInput(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return undefined
  }
  const n = Number(trimmed)
  if (Number.isNaN(n)) {
    return undefined
  }
  return n
}
