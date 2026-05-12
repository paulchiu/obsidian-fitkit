import { epleyE1rm } from './epley'
import { DEFAULT_EXERCISE_METRIC, type ExerciseMetric } from './exercise-metric'
import {
  normalize,
  resolve,
  unitForName,
  type ExerciseKind,
  type ExerciseRegistry,
} from './exercise-registry'
import type { FitKitIndex } from './types'
import { DEFAULT_WEIGHT_UNIT, type WeightUnit } from './weight-unit'

export type ChartSeriesMetric = ExerciseMetric | 'duration' | 'reps'

export interface ChartPoint {
  date: string
  value: number
  workoutPath: string
}

export interface ChartSeries {
  exerciseName: string
  kind: ExerciseKind
  metric: ChartSeriesMetric
  unit: WeightUnit | 's' | 'reps'
  points: ChartPoint[]
  windowRequested: number
  totalDates: number
}

export function buildExerciseChartSeries(
  index: FitKitIndex,
  registry: ExerciseRegistry,
  exerciseName: string,
  kind: ExerciseKind,
  window: number,
  metric: ExerciseMetric = DEFAULT_EXERCISE_METRIC,
  weightUnit: WeightUnit | null = null,
): ChartSeries {
  const matchKeys = buildMatchKeys(registry, exerciseName)
  const activeWeightUnit = weightUnit ?? unitForName(registry, exerciseName) ?? DEFAULT_WEIGHT_UNIT
  let seriesMetric: ChartSeriesMetric = kind === 'duration' ? 'duration' : metric
  let ordered = collectPoints(index, matchKeys, kind, seriesMetric)

  /** Reps fallback only fires with no weighted points; mixed-history bodyweight days are skipped. */
  if (kind === 'strength' && metric === 'e1rm' && ordered.length === 0) {
    const repsPoints = collectPoints(index, matchKeys, kind, 'reps')
    if (repsPoints.length > 0) {
      seriesMetric = 'reps'
      ordered = repsPoints
    }
  }

  const totalDates = ordered.length
  const safeWindow = Math.max(1, Math.floor(window))
  const sliced = ordered.length > safeWindow ? ordered.slice(ordered.length - safeWindow) : ordered

  return {
    exerciseName,
    kind,
    metric: seriesMetric,
    unit: unitForMetric(seriesMetric, activeWeightUnit),
    points: sliced,
    windowRequested: safeWindow,
    totalDates,
  }
}

function collectPoints(
  index: FitKitIndex,
  matchKeys: ReadonlySet<string>,
  kind: ExerciseKind,
  metric: ChartSeriesMetric,
): ChartPoint[] {
  const buckets = new Map<string, ChartPoint>()
  for (const entry of index.entries) {
    for (const row of entry.exercises) {
      if (row.kind !== kind) {
        continue
      }
      if (!matchKeys.has(normalize(row.exerciseName))) {
        continue
      }
      const value = pickMetric(row, kind, metric)
      if (value === null) {
        continue
      }
      const candidate: ChartPoint = {
        date: entry.date,
        value,
        workoutPath: entry.path,
      }
      const existing = buckets.get(entry.date)
      if (!existing || isBetterCandidate(candidate, existing)) {
        buckets.set(entry.date, candidate)
      }
    }
  }

  return [...buckets.values()].sort((left, right) => compareByDate(left, right))
}

function unitForMetric(metric: ChartSeriesMetric, weightUnit: WeightUnit): ChartSeries['unit'] {
  if (metric === 'duration') {
    return 's'
  }
  if (metric === 'reps') {
    return 'reps'
  }
  return weightUnit
}

function buildMatchKeys(registry: ExerciseRegistry, exerciseName: string): Set<string> {
  const keys = new Set<string>()
  const queryKey = normalize(exerciseName)
  if (queryKey.length > 0) {
    keys.add(queryKey)
  }
  const result = resolve(registry, exerciseName)
  if (result.kind === 'match') {
    const canonicalKey = normalize(result.entry.name)
    if (canonicalKey.length > 0) {
      keys.add(canonicalKey)
    }
    for (const alias of result.entry.aliases) {
      const aliasKey = normalize(alias)
      if (aliasKey.length > 0) {
        keys.add(aliasKey)
      }
    }
  }
  return keys
}

function pickMetric(
  row: FitKitIndex['entries'][number]['exercises'][number],
  kind: ExerciseKind,
  metric: ChartSeriesMetric,
): number | null {
  if (kind === 'duration') {
    const value = row.totalDurationSeconds
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
      return null
    }
    return value
  }
  if (metric === 'reps') {
    const set = row.bestSet ?? row.maxWeightSet
    if (
      !set ||
      !Number.isFinite(set.weight) ||
      !Number.isFinite(set.reps) ||
      set.weight !== 0 ||
      set.reps <= 0
    ) {
      return null
    }
    return set.reps
  }
  if (metric === 'weight') {
    const set = row.maxWeightSet
    if (
      !set ||
      !Number.isFinite(set.weight) ||
      !Number.isFinite(set.reps) ||
      set.weight < 0 ||
      set.reps <= 0
    ) {
      return null
    }
    return set.weight
  }

  const bestSet = row.bestSet
  if (!bestSet) {
    return null
  }
  if (
    !Number.isFinite(bestSet.weight) ||
    !Number.isFinite(bestSet.reps) ||
    bestSet.weight <= 0 ||
    bestSet.reps <= 0
  ) {
    return null
  }
  const value = epleyE1rm(bestSet.weight, bestSet.reps)
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  return value
}

function isBetterCandidate(candidate: ChartPoint, existing: ChartPoint): boolean {
  if (candidate.value !== existing.value) {
    return candidate.value > existing.value
  }
  return candidate.workoutPath < existing.workoutPath
}

function compareByDate(left: ChartPoint, right: ChartPoint): number {
  if (left.date !== right.date) {
    return left.date < right.date ? -1 : 1
  }
  return left.workoutPath < right.workoutPath ? -1 : 1
}

export interface NiceRange {
  min: number
  max: number
}

/**
 * Expand a value range to "nice" round bounds suitable for axis labels.
 * Ensures min < max so charts never collapse to a zero-height band.
 */
export function niceRange(values: ReadonlyArray<number>): NiceRange {
  if (values.length === 0) {
    return { min: 0, max: 1 }
  }
  let min = values[0] as number
  let max = values[0] as number
  for (const value of values) {
    if (value < min) {
      min = value
    }
    if (value > max) {
      max = value
    }
  }
  if (min === max) {
    if (min === 0) {
      return { min: 0, max: 1 }
    }
    const pad = Math.max(1, Math.abs(min) * 0.1)
    return { min: min - pad, max: max + pad }
  }
  const span = max - min
  const step = niceStep(span / 4)
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  return { min: niceMin, max: niceMax }
}

function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) {
    return 1
  }
  const exponent = Math.floor(Math.log10(rawStep))
  const magnitude = Math.pow(10, exponent)
  const fraction = rawStep / magnitude
  let nice: number
  if (fraction <= 1) {
    nice = 1
  } else if (fraction <= 2) {
    nice = 2
  } else if (fraction <= 5) {
    nice = 5
  } else {
    nice = 10
  }
  return nice * magnitude
}

/**
 * Pick a small set of indices to label on the x axis so dense series stay
 * readable. Always includes the first and last index when count > 1.
 */
export function pickXTickIndices(count: number): number[] {
  if (count <= 0) {
    return []
  }
  if (count === 1) {
    return [0]
  }
  if (count <= 5) {
    return Array.from({ length: count }, (_unused, index) => index)
  }
  const targets = 5
  const indices = new Set<number>()
  for (let step = 0; step < targets; step++) {
    const ratio = step / (targets - 1)
    indices.add(Math.round(ratio * (count - 1)))
  }
  return [...indices].sort((left, right) => left - right)
}
