import { defaultBodyweightLevels } from './bodyweight-levels'
import { hasDataviewFields } from './dataview-query'
import { parseExerciseKind } from './exercise-kind'
import {
  DEFAULT_EXERCISE_METRIC,
  VALID_EXERCISE_METRICS,
  parseExerciseMetric,
  type ExerciseMetric,
} from './exercise-metric'
import { findRecentSessionsBlock, isRecentSessionsHeading } from './exercise-note-sections'
import {
  kindForName,
  typeForName,
  unitForName,
  type ExerciseKind,
  type ExerciseRegistry,
} from './exercise-registry'
import { kindOfType, type ExerciseType } from './exercise-type'
import {
  findFrontmatterBounds,
  findFrontmatterKeyLine,
  findHeadingIndex,
  insertLines,
  replaceLine,
  scalarValue,
  splitMarkdown,
} from './markdown-lines'
import { DEFAULT_WEIGHT_UNIT, parseWeightUnit, type WeightUnit } from './weight-unit'

export type SkippedExerciseNoteMigrationStatus =
  'skipped-non-exercise-type' | 'skipped-malformed-frontmatter'

export interface ExerciseNoteFrontmatterWarning {
  kind: 'registry-kind-conflict'
  noteKind: ExerciseKind
  registryKind: ExerciseKind
}

export interface FrontmatterRepairResult {
  markdown: string
  kind: ExerciseKind | null
  unknownKind: boolean
  warnings: ExerciseNoteFrontmatterWarning[]
  skippedStatus: SkippedExerciseNoteMigrationStatus | null
}

/**
 * Brings an exercise note's frontmatter up to the current shape, taking the kind from the
 * note, then the registry, then the Recent sessions query. Non-exercise notes are skipped.
 */
export function repairFrontmatter(
  source: string,
  name: string,
  registry: ExerciseRegistry,
): FrontmatterRepairResult {
  const registryKind = kindForName(registry, name)
  const registryInterval = typeForName(registry, name) === 'interval'
  const registryUnit = strengthUnitForName(registry, name)
  const bounds = findFrontmatterBounds(source)
  if (bounds.status === 'malformed') {
    return {
      markdown: source,
      kind: null,
      unknownKind: false,
      warnings: [],
      skippedStatus: 'skipped-malformed-frontmatter',
    }
  }
  if (bounds.status === 'missing') {
    const fallbackKind = registryKind ?? inferExerciseKindFromContent(source) ?? 'strength'
    return {
      markdown: `${frontmatterBlock(registryInterval ? 'interval' : fallbackKind, name, registryUnit ?? DEFAULT_WEIGHT_UNIT)}${source}`,
      kind: fallbackKind,
      unknownKind: registryKind === null,
      warnings: [],
      skippedStatus: null,
    }
  }

  const lines = source.split('\n')
  const frontmatterLines = lines.slice(bounds.start + 1, bounds.end)
  const typeLineIndex = findFrontmatterKeyLine(frontmatterLines, 'type')
  if (typeLineIndex >= 0 && scalarValue(frontmatterLines[typeLineIndex] ?? '') !== 'exercise') {
    return {
      markdown: source,
      kind: null,
      unknownKind: false,
      warnings: [],
      skippedStatus: 'skipped-non-exercise-type',
    }
  }

  let nextFrontmatterLines = frontmatterLines
  const warnings: ExerciseNoteFrontmatterWarning[] = []
  if (typeLineIndex < 0) {
    nextFrontmatterLines = ['type: exercise', ...nextFrontmatterLines]
  }

  let kindLineIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'kind')
  let effectiveKind = frontmatterKind(nextFrontmatterLines)
  let unknownKind = false
  if (effectiveKind) {
    if (registryKind && registryKind !== effectiveKind) {
      warnings.push({
        kind: 'registry-kind-conflict',
        noteKind: effectiveKind,
        registryKind,
      })
    }
  } else if (registryKind) {
    if (kindLineIndex < 0) {
      const typeIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'type')
      nextFrontmatterLines = insertLines(nextFrontmatterLines, typeIndex + 1, [
        `kind: ${registryKind}`,
      ])
    } else {
      nextFrontmatterLines = replaceLine(
        nextFrontmatterLines,
        kindLineIndex,
        `kind: ${registryKind}`,
      )
    }
    if (registryInterval && findFrontmatterKeyLine(nextFrontmatterLines, 'interval') < 0) {
      nextFrontmatterLines = insertLines(
        nextFrontmatterLines,
        findFrontmatterKeyLine(nextFrontmatterLines, 'kind') + 1,
        ['interval: true'],
      )
    }
    effectiveKind = registryKind
  } else if (kindLineIndex < 0 || effectiveKind === null) {
    const fallbackKind = inferExerciseKindFromContent(source) ?? 'strength'
    if (kindLineIndex < 0) {
      const typeIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'type')
      nextFrontmatterLines = insertLines(nextFrontmatterLines, typeIndex + 1, [
        `kind: ${fallbackKind}`,
      ])
    } else {
      nextFrontmatterLines = replaceLine(
        nextFrontmatterLines,
        kindLineIndex,
        `kind: ${fallbackKind}`,
      )
    }
    effectiveKind = fallbackKind
    unknownKind = true
  }

  if (effectiveKind === 'strength') {
    const metricLineIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'metric')
    if (metricLineIndex < 0) {
      kindLineIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'kind')
      nextFrontmatterLines = insertLines(nextFrontmatterLines, kindLineIndex + 1, [
        `metric: ${DEFAULT_EXERCISE_METRIC}`,
      ])
    } else if (frontmatterStrengthMetric(nextFrontmatterLines[metricLineIndex] ?? '') === null) {
      nextFrontmatterLines = replaceLine(
        nextFrontmatterLines,
        metricLineIndex,
        `metric: ${DEFAULT_EXERCISE_METRIC}`,
      )
    }
    nextFrontmatterLines = setStrengthUnitFromRegistry(nextFrontmatterLines, registryUnit)
  }

  if (effectiveKind === 'bodyweight') {
    nextFrontmatterLines = nextFrontmatterLines.filter(
      (line) => !isStrengthOnlyFrontmatterKey(line),
    )
    if (findFrontmatterKeyLine(nextFrontmatterLines, 'levels') < 0) {
      kindLineIndex = findFrontmatterKeyLine(nextFrontmatterLines, 'kind')
      nextFrontmatterLines = insertLines(nextFrontmatterLines, kindLineIndex + 1, [
        'levels:',
        ...defaultBodyweightLevels(name).map((rung) => `  - ${rung}`),
      ])
    }
  }

  const markdown = [
    ...lines.slice(0, bounds.start + 1),
    ...nextFrontmatterLines,
    ...lines.slice(bounds.end),
  ].join('\n')

  return {
    markdown,
    kind: effectiveKind,
    unknownKind,
    warnings,
    skippedStatus: null,
  }
}

export function frontmatterKind(lines: ReadonlyArray<string>): ExerciseKind | null {
  const kindLineIndex = findFrontmatterKeyLine(lines, 'kind')
  if (kindLineIndex < 0) {
    return null
  }
  return parseExerciseKind(scalarValue(lines[kindLineIndex] ?? ''))
}

/** Strength-only keys mean nothing on a bodyweight note, so one that becomes bodyweight sheds them. */
export function isStrengthOnlyFrontmatterKey(line: string): boolean {
  const colon = line.indexOf(':')
  if (colon < 0) {
    return false
  }
  const key = line.slice(0, colon).trim().toLowerCase()
  return key === 'metric' || key === 'unit'
}

export function isIntervalMarkerLine(line: string): boolean {
  const colon = line.indexOf(':')
  return colon >= 0 && line.slice(0, colon).trim().toLowerCase() === 'interval'
}

function strengthUnitForName(registry: ExerciseRegistry, name: string): WeightUnit | null {
  if (kindForName(registry, name) !== 'strength') {
    return null
  }
  return unitForName(registry, name)
}

function frontmatterBlock(
  type: ExerciseType | null,
  exerciseName: string,
  unit: WeightUnit,
): string {
  const lines = ['---', 'type: exercise']
  const kind = type === null ? null : kindOfType(type)
  if (kind) {
    lines.push(`kind: ${kind}`)
    if (type === 'interval') {
      lines.push('interval: true')
    }
    if (kind === 'strength') {
      lines.push(`metric: ${DEFAULT_EXERCISE_METRIC}`)
      lines.push(`unit: ${unit}`)
    }
    if (kind === 'bodyweight') {
      lines.push('levels:')
      for (const rung of defaultBodyweightLevels(exerciseName)) {
        lines.push(`  - ${rung}`)
      }
    }
  }
  lines.push('---', '')
  return `${lines.join('\n')}\n`
}

function inferExerciseKindFromContent(source: string): ExerciseKind | null {
  const document = splitMarkdown(source)
  const headingIndex = findHeadingIndex(document.lines, isRecentSessionsHeading)
  if (headingIndex < 0) {
    return null
  }
  const block = findRecentSessionsBlock(document, headingIndex)
  if (!block) {
    return null
  }

  /** Sort lines select nothing, so a bodyweight query's `sort ... L.set` is no strength field. */
  const body = document.lines
    .slice(block.start, block.end + 1)
    .filter((line) => !/^\s*sort\b/i.test(line))
    .join('\n')
  const hasDurationFields = hasDataviewFields(body, ['duration'])
  const hasStrengthFields = hasDataviewFields(body, ['set', 'weight', 'reps'])
  const hasLevelFields = hasDataviewFields(body, ['level'])
  const hasSetOrWeightFields = hasDataviewFields(body, ['set', 'weight'])
  /** A bodyweight query also selects reps, so level only wins without set, weight or duration. */
  if (hasLevelFields && !hasDurationFields && !hasSetOrWeightFields) {
    return 'bodyweight'
  }
  if (hasDurationFields && !hasStrengthFields) {
    return 'duration'
  }
  if (hasStrengthFields && !hasDurationFields) {
    return 'strength'
  }
  return null
}

/** A metric line trusted on a strength note: unknown text and other kinds' metrics read as null. */
function frontmatterStrengthMetric(line: string): ExerciseMetric | null {
  const metric = parseExerciseMetric(scalarValue(line))
  return metric && VALID_EXERCISE_METRICS.strength.includes(metric) ? metric : null
}

/**
 * Fills in a missing or invalid strength unit, preferring the registry's over the default.
 * A valid recorded unit always stands, even against the registry: frontmatter is what the user edits.
 */
function setStrengthUnitFromRegistry(
  lines: ReadonlyArray<string>,
  registryUnit: WeightUnit | null,
): string[] {
  const unitLineIndex = findFrontmatterKeyLine(lines, 'unit')
  if (unitLineIndex < 0) {
    const metricLineIndex = findFrontmatterKeyLine(lines, 'metric')
    const kindLineIndex = findFrontmatterKeyLine(lines, 'kind')
    const insertionIndex = metricLineIndex >= 0 ? metricLineIndex + 1 : kindLineIndex + 1
    return insertLines(lines, insertionIndex, [`unit: ${registryUnit ?? DEFAULT_WEIGHT_UNIT}`])
  }

  const existingUnit = parseWeightUnit(scalarValue(lines[unitLineIndex] ?? ''))
  if (existingUnit) {
    return [...lines]
  }

  return replaceLine(lines, unitLineIndex, `unit: ${registryUnit ?? DEFAULT_WEIGHT_UNIT}`)
}
