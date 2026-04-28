import type { App, CachedMetadata, TAbstractFile, TFile } from 'obsidian'

import {
  DEFAULT_EXERCISE_METRIC,
  parseExerciseMetric,
  type ExerciseMetric,
} from '../domain/exercise-metric'
import {
  createRegistry,
  normalize,
  resolve,
  type ExerciseRegistry,
} from '../domain/exercise-registry'
import type { BestSet, ExerciseIndexRow, FitKitIndex, WeightSet } from '../domain/types'
import type { FitKitSettings } from '../settings'
import { dashboardPath, exercisesFolder, normalizeFolder, workoutsFolder } from '../settings-paths'
import { exerciseRegistryWithVaultNotes } from './exercise-registry-vault'

interface ExerciseAggregate {
  exerciseName: string
  kind: 'strength' | 'duration'
  metric: ExerciseMetric
  pbSet?: StrengthPbSet
  totalSets: number
  totalDurationSeconds: number
  sessionCount: number
}

type StrengthPbSet = WeightSet & { e1rm?: number }

/**
 * Pure: build full dashboard markdown from index.
 * @param index - The FitKit index.
 * @param workoutsFolderPath - Resolved folder path for Dataview queries.
 * @param exercisesFolderPath - Resolved folder path for path-qualified exercise wikilinks.
 * @param hiddenKeys - Set of keys like 'exercise:Squat' to exclude.
 */
export function composeDashboard(
  index: FitKitIndex,
  workoutsFolderPath: string,
  exercisesFolderPath: string,
  hiddenKeys: ReadonlySet<string>,
  exerciseMetrics: ReadonlyMap<string, ExerciseMetric> = new Map(),
): string {
  const exercises = aggregateExercises(index, exerciseMetrics)
    .filter((exercise) => !hiddenKeys.has(`exercise:${exercise.exerciseName}`))
    .sort((left, right) => left.exerciseName.localeCompare(right.exerciseName))
  const lines: string[] = []

  lines.push('# FitKit Dashboard')
  lines.push('')
  lines.push(
    `_Generated ${new Date(index.builtAt).toISOString()}; ${index.entries.length} sessions, ${exercises.length} exercises._`,
  )
  lines.push('')
  lines.push('## PBs')
  lines.push('')

  for (const exercise of exercises) {
    lines.push(formatPb(exercise))
  }

  for (const exercise of exercises) {
    lines.push('')
    lines.push(`## ${exercise.exerciseName}`)
    lines.push('')
    lines.push(`[[${exercisesFolderPath}/${exercise.exerciseName}|${exercise.exerciseName}]]`)
    lines.push('')
    lines.push('```dataview')
    lines.push(...dataviewQuery(exercise, workoutsFolderPath))
    lines.push('```')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

export async function regenerateDashboard(
  app: App,
  settings: FitKitSettings,
  index: FitKitIndex,
): Promise<{ path: string; sectionCount: number }> {
  const path = normalizeFolder(dashboardPath(settings))
  const hiddenKeys = new Set(settings.hiddenDashboardSectionsByPath[path] ?? [])
  const folder = workoutsFolder(settings)
  const exercisesPath = exercisesFolder(settings)
  const exerciseMetrics = buildExerciseMetricMap(app, settings, index)
  const markdown = composeDashboard(index, folder, exercisesPath, hiddenKeys, exerciseMetrics)
  const existing = app.vault.getAbstractFileByPath(path)

  if (isMarkdownFile(existing)) {
    await app.vault.process(existing, () => markdown)
  } else {
    await app.vault.create(path, markdown)
  }

  return {
    path,
    sectionCount: aggregateExercises(index, exerciseMetrics).filter(
      (exercise) => !hiddenKeys.has(`exercise:${exercise.exerciseName}`),
    ).length,
  }
}

function aggregateExercises(
  index: FitKitIndex,
  exerciseMetrics: ReadonlyMap<string, ExerciseMetric>,
): ExerciseAggregate[] {
  const exercises = new Map<string, ExerciseAggregate>()

  for (const entry of index.entries) {
    const sessionExercises = new Set<string>()
    for (const row of entry.exercises) {
      const aggregate = getAggregate(exercises, row, exerciseMetrics)
      aggregate.totalSets += row.totalSets ?? 0
      aggregate.totalDurationSeconds += row.totalDurationSeconds ?? 0
      if (!sessionExercises.has(row.exerciseName)) {
        aggregate.sessionCount += 1
        sessionExercises.add(row.exerciseName)
      }
      const candidate = pickDashboardSet(row, aggregate.metric)
      if (candidate && isBetterDashboardSet(candidate, aggregate.pbSet, aggregate.metric)) {
        aggregate.pbSet = candidate
      }
    }
  }

  return [...exercises.values()]
}

function getAggregate(
  exercises: Map<string, ExerciseAggregate>,
  row: ExerciseIndexRow,
  exerciseMetrics: ReadonlyMap<string, ExerciseMetric>,
): ExerciseAggregate {
  const existing = exercises.get(row.exerciseName)
  if (existing) {
    return existing
  }

  const created: ExerciseAggregate = {
    exerciseName: row.exerciseName,
    kind: row.kind,
    metric: exerciseMetrics.get(row.exerciseName) ?? DEFAULT_EXERCISE_METRIC,
    totalSets: 0,
    totalDurationSeconds: 0,
    sessionCount: 0,
  }
  exercises.set(row.exerciseName, created)
  return created
}

function formatPb(exercise: ExerciseAggregate): string {
  const link = `[[#${exercise.exerciseName}|${exercise.exerciseName}]]`

  if (exercise.kind === 'duration') {
    const sessionLabel = exercise.sessionCount === 1 ? 'session' : 'sessions'
    return `- **${link}:** total ${exercise.totalDurationSeconds}s across ${exercise.sessionCount} ${sessionLabel}`
  }

  if (!exercise.pbSet) {
    return `- **${link}:** no completed sets`
  }

  return `- **${link}:** ${formatDashboardSet(exercise.pbSet, exercise.metric)}`
}

function dataviewQuery(exercise: ExerciseAggregate, workoutsFolderPath: string): string[] {
  if (exercise.kind === 'duration') {
    return [
      'table without id file.link as Session, duration + "s" as Duration',
      `from "${workoutsFolderPath}"`,
      'flatten file.lists as item',
      `where contains(item.text, "[exercise:: [[${exercise.exerciseName}]]]") and item.duration`,
      'sort file.name desc',
      'limit 12',
    ]
  }

  return [
    'TABLE WITHOUT ID',
    '  file.link AS Workout,',
    '  L.set AS Set,',
    '  L.weight AS Weight,',
    '  L.reps AS Reps',
    `FROM "${workoutsFolderPath}"`,
    'FLATTEN file.lists AS L',
    `WHERE L.exercise = link("${exercise.exerciseName}") AND L.set`,
    'SORT file.name DESC, L.set ASC',
    'LIMIT 10',
  ]
}

function isMarkdownFile(file: TAbstractFile | null): file is TFile {
  return file !== null && (file as { extension?: unknown }).extension === 'md'
}

function pickDashboardSet(row: ExerciseIndexRow, metric: ExerciseMetric): StrengthPbSet | null {
  if (row.kind !== 'strength') {
    return null
  }
  if (metric === 'weight') {
    return validWeightSet(row.maxWeightSet) ? row.maxWeightSet : null
  }
  return validBestSet(row.bestSet) ? row.bestSet : null
}

function isBetterDashboardSet(
  candidate: StrengthPbSet,
  current: StrengthPbSet | undefined,
  metric: ExerciseMetric,
): boolean {
  if (!current) {
    return true
  }
  if (metric === 'weight') {
    if (candidate.weight !== current.weight) {
      return candidate.weight > current.weight
    }
    return candidate.reps > current.reps
  }
  return (candidate.e1rm ?? 0) > (current.e1rm ?? 0)
}

function validWeightSet(set: WeightSet | undefined): set is WeightSet {
  return (
    set !== undefined &&
    Number.isFinite(set.weight) &&
    Number.isFinite(set.reps) &&
    set.weight > 0 &&
    set.reps > 0
  )
}

function validBestSet(set: BestSet | undefined): set is BestSet {
  return validWeightSet(set) && Number.isFinite(set.e1rm) && set.e1rm > 0
}

function formatDashboardSet(set: StrengthPbSet, metric: ExerciseMetric): string {
  const topSet = `${set.weight} kg x ${set.reps}`
  if (metric === 'weight') {
    return topSet
  }
  return `${topSet} (e1rm ${(set.e1rm ?? 0).toFixed(1)})`
}

function buildExerciseMetricMap(
  app: App,
  settings: FitKitSettings,
  index: FitKitIndex,
): Map<string, ExerciseMetric> {
  const noteMetrics = readExerciseNoteMetrics(app, settings)
  const registry = createRegistry(exerciseRegistryWithVaultNotes(app, settings))
  const metrics = new Map<string, ExerciseMetric>()

  for (const entry of index.entries) {
    for (const row of entry.exercises) {
      if (row.kind !== 'strength' || metrics.has(row.exerciseName)) {
        continue
      }
      metrics.set(row.exerciseName, getExerciseMetric(row.exerciseName, noteMetrics, registry))
    }
  }

  return metrics
}

function readExerciseNoteMetrics(app: App, settings: FitKitSettings): Map<string, ExerciseMetric> {
  const folder = exercisesFolder(settings)
  const metrics = new Map<string, ExerciseMetric>()

  for (const file of app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(`${folder}/`)) {
      continue
    }

    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
    const type = readFrontmatterField(frontmatter, 'type')
    const kind = readFrontmatterField(frontmatter, 'kind')
    if (
      typeof type !== 'string' ||
      type.toLowerCase().trim() !== 'exercise' ||
      typeof kind !== 'string' ||
      kind.toLowerCase().trim() !== 'strength'
    ) {
      continue
    }

    const metric =
      parseExerciseMetric(readFrontmatterField(frontmatter, 'metric')) ?? DEFAULT_EXERCISE_METRIC
    metrics.set(normalize(file.basename), metric)
  }

  return metrics
}

function getExerciseMetric(
  exerciseName: string,
  noteMetrics: ReadonlyMap<string, ExerciseMetric>,
  registry: ExerciseRegistry,
): ExerciseMetric {
  const direct = noteMetrics.get(normalize(exerciseName))
  if (direct) {
    return direct
  }

  const resolved = resolve(registry, exerciseName)
  if (resolved.kind !== 'match') {
    return DEFAULT_EXERCISE_METRIC
  }

  return noteMetrics.get(normalize(resolved.entry.name)) ?? DEFAULT_EXERCISE_METRIC
}

function readFrontmatterField(
  frontmatter: CachedMetadata['frontmatter'] | undefined,
  key: string,
): unknown {
  const record: Record<string, unknown> | null = frontmatter ?? null
  return record === null ? undefined : record[key]
}
