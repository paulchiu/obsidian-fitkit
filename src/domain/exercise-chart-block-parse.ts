import { parseExerciseKind } from './exercise-kind'
import {
  DEFAULT_BODYWEIGHT_EXERCISE_METRIC,
  DEFAULT_EXERCISE_METRIC,
  VALID_EXERCISE_METRICS,
  parseExerciseMetric,
  type ExerciseMetric,
} from './exercise-metric'
import type { ExerciseKind } from './exercise-registry'

export interface ParsedExerciseChartBlock {
  exerciseName: string | null
  kind: ExerciseKind | null
  metric: ExerciseMetric | null
  metricSupplied: boolean
  invalidMetricValue: string | null
  window: number | null
  windowFallback: boolean
}

export type ExerciseChartFrontmatter = Record<string, unknown> | undefined

export function parseExerciseChartBlock(source: string): ParsedExerciseChartBlock {
  const result: ParsedExerciseChartBlock = {
    exerciseName: null,
    kind: null,
    metric: null,
    metricSupplied: false,
    invalidMetricValue: null,
    window: null,
    windowFallback: false,
  }
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    const colon = line.indexOf(':')
    if (colon < 0) {
      continue
    }
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (value.length === 0) {
      continue
    }
    if (key === 'exercise' || key === 'name') {
      result.exerciseName = value
    } else if (key === 'kind') {
      result.kind = parseExerciseKind(value) ?? result.kind
    } else if (key === 'metric') {
      const metricValue = normalizeMetricValue(value)
      if (metricValue === null) {
        continue
      }
      result.metricSupplied = true
      result.metric = parseExerciseMetric(metricValue)
      /** The rejection note echoes the supplied value, so it keeps the user's casing. */
      result.invalidMetricValue = metricValue
    } else if (key === 'window') {
      if (!/^\d+$/.test(value)) {
        result.windowFallback = true
        continue
      }
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 365) {
        result.windowFallback = true
      } else {
        result.window = parsed
      }
    }
  }
  return result
}

export function resolveExerciseChartMetric(
  parsed: ParsedExerciseChartBlock,
  frontmatter: ExerciseChartFrontmatter,
  kind: ExerciseKind,
  notes: string[],
): ExerciseMetric {
  switch (kind) {
    case 'duration':
      return DEFAULT_EXERCISE_METRIC
    case 'bodyweight':
      return resolveKindMetric(parsed, frontmatter, kind, DEFAULT_BODYWEIGHT_EXERCISE_METRIC, notes)
    case 'strength': {
      return resolveKindMetric(parsed, frontmatter, kind, DEFAULT_EXERCISE_METRIC, notes)
    }
  }
}

/**
 * Block metric wins when valid for the kind, frontmatter is the fallback, and anything else warns like a bad metric.
 */
function resolveKindMetric(
  parsed: ParsedExerciseChartBlock,
  frontmatter: ExerciseChartFrontmatter,
  kind: ExerciseKind,
  fallback: ExerciseMetric,
  notes: string[],
): ExerciseMetric {
  if (parsed.metricSupplied) {
    if (parsed.metric && VALID_EXERCISE_METRICS[kind].includes(parsed.metric)) {
      return parsed.metric
    }
    notes.push(
      `Ignored invalid metric value '${parsed.invalidMetricValue ?? parsed.metric ?? ''}'; using ${fallback}.`,
    )
    return fallback
  }

  const metric = metricFromFrontmatter(frontmatter)
  if (metric && VALID_EXERCISE_METRICS[kind].includes(metric)) {
    return metric
  }

  /** A frontmatter metric for another kind falls back quietly: only the block warns. */
  return fallback
}

function metricFromFrontmatter(frontmatter: ExerciseChartFrontmatter): ExerciseMetric | null {
  return parseExerciseMetric(readFrontmatterField(frontmatter, 'metric'))
}

function readFrontmatterField(frontmatter: ExerciseChartFrontmatter, key: string): unknown {
  const record: Record<string, unknown> | null = frontmatter ?? null
  return record === null ? undefined : record[key]
}

function normalizeMetricValue(value: string): string | null {
  const stripped = stripSurroundingQuotes(stripInlineComment(value).trim())
  return stripped.length === 0 ? null : stripped
}

function stripInlineComment(value: string): string {
  let quote: '"' | "'" | null = null
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if ((char === '"' || char === "'") && quote === null) {
      quote = char
      continue
    }
    if (char === quote) {
      quote = null
      continue
    }
    if (char === '#' && quote === null) {
      return value.slice(0, index).trimEnd()
    }
  }
  return value
}

/** Quoted metric values mirror YAML-ish code blocks, so surrounding quotes are ignored. */
function stripSurroundingQuotes(value: string): string {
  const first = value[0]
  const last = value[value.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1).trim()
  }
  return value
}
