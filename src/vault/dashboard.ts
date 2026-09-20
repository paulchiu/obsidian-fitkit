import type { App, CachedMetadata, TAbstractFile, TFile } from 'obsidian'

import {
  bodyweightLevelName,
  compareBodyweightSets,
  type BodyweightLadder,
} from '../domain/bodyweight-levels'
import { type ExerciseKind } from '../domain/exercise-kind'
import {
  DEFAULT_EXERCISE_METRIC,
  VALID_EXERCISE_METRICS,
  parseExerciseMetric,
  type ExerciseMetric,
} from '../domain/exercise-metric'
import {
  createRegistry,
  levelsForName,
  normalize,
  resolve,
  type ExerciseRegistry,
} from '../domain/exercise-registry'
import { formatNextPlanLabel, planStepUnit, type NextPlan } from '../domain/next-plan'
import { DEFAULT_WEIGHT_UNIT, parseWeightUnit, type WeightUnit } from '../domain/weight-unit'
import type {
  BestSet,
  BodyweightBestSet,
  ExerciseIndexRow,
  FitKitIndex,
  IndexEntry,
  WeightSet,
} from '../domain/types'
import type { FitKitSettings } from '../settings'
import { dashboardPath, exercisesFolder, normalizeFolder, workoutsFolder } from '../settings-paths'
import { exerciseRegistryWithVaultNotes } from './exercise-registry-vault'
import { markdownFilesInFolder } from './folder-scan'

interface ExerciseAggregate {
  exerciseName: string
  kind: ExerciseKind
  metric: ExerciseMetric
  unit: WeightUnit
  pbSet?: StrengthPbSet
  pbBodyweightSet?: BodyweightBestSet
  ladder?: BodyweightLadder
  totalSets: number
  totalDurationSeconds: number
  sessionCount: number
  nextPlan?: PlannedSession
}

interface PlannedSession {
  value: NextPlan
  date: string
  mtime: number
  path: string
}

type StrengthPbSet = WeightSet & { e1rm?: number }

/** Per-exercise dashboard lookups: chart metric, weight unit and rung ladder. */
export interface ExerciseDashboardMaps {
  metrics?: ReadonlyMap<string, ExerciseMetric>
  units?: ReadonlyMap<string, WeightUnit>
  ladders?: ReadonlyMap<string, BodyweightLadder>
}

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
  maps: ExerciseDashboardMaps = {},
): string {
  const exercises = visibleExerciseAggregates(index, hiddenKeys, maps)
  return composeDashboardFromAggregates(index, workoutsFolderPath, exercisesFolderPath, exercises)
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
  const maps = buildExerciseDashboardMaps(app, settings, index)
  const exercises = visibleExerciseAggregates(index, hiddenKeys, maps)
  const markdown = composeDashboardFromAggregates(index, folder, exercisesPath, exercises)
  const existing = app.vault.getAbstractFileByPath(path)

  if (isMarkdownFile(existing)) {
    await app.vault.process(existing, () => markdown)
  } else {
    await app.vault.create(path, markdown)
  }

  return {
    path,
    sectionCount: exercises.length,
  }
}

function composeDashboardFromAggregates(
  index: FitKitIndex,
  workoutsFolderPath: string,
  exercisesFolderPath: string,
  exercises: ReadonlyArray<ExerciseAggregate>,
): string {
  const lines: string[] = []

  lines.push('# FitKit Dashboard')
  lines.push('')
  lines.push(
    `_Generated ${new Date(index.builtAt).toISOString()}; ${index.entries.length} sessions, ${exercises.length} exercises._`,
  )
  lines.push('')
  lines.push('## Recent workouts')
  lines.push('')

  const recent = recentWorkouts(index)
  if (recent.length === 0) {
    lines.push('_No workouts yet._')
  } else {
    for (const entry of recent) {
      lines.push(formatRecentWorkout(entry, workoutsFolderPath))
    }
  }

  lines.push('')
  lines.push('## PBs')
  lines.push('')

  for (const exercise of exercises) {
    lines.push(formatPb(exercise))
  }

  const planned = exercises.filter((exercise) => exercise.nextPlan !== undefined)
  if (planned.length > 0) {
    lines.push('')
    lines.push('## Next session plans')
    lines.push('')
    for (const exercise of planned) {
      lines.push(formatNextPlanLine(exercise))
    }
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

function visibleExerciseAggregates(
  index: FitKitIndex,
  hiddenKeys: ReadonlySet<string>,
  maps: ExerciseDashboardMaps,
): ExerciseAggregate[] {
  return aggregateExercises(index, maps)
    .filter((exercise) => !hiddenKeys.has(`exercise:${exercise.exerciseName}`))
    .sort((left, right) => left.exerciseName.localeCompare(right.exerciseName))
}

function aggregateExercises(index: FitKitIndex, maps: ExerciseDashboardMaps): ExerciseAggregate[] {
  const exercises = new Map<string, ExerciseAggregate>()

  for (const entry of index.entries) {
    const sessionExercises = new Set<string>()
    for (const row of entry.exercises) {
      const aggregate = getAggregate(exercises, row, maps)
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
      const bodyweightCandidate = pickBodyweightDashboardSet(row)
      if (
        bodyweightCandidate &&
        isBetterBodyweightDashboardSet(bodyweightCandidate, aggregate.pbBodyweightSet)
      ) {
        aggregate.pbBodyweightSet = bodyweightCandidate
      }
      if (row.next) {
        const planned: PlannedSession = {
          value: row.next,
          date: entry.date,
          mtime: entry.mtime,
          path: entry.path,
        }
        if (!aggregate.nextPlan || isMoreRecentPlan(planned, aggregate.nextPlan)) {
          aggregate.nextPlan = planned
        }
      }
    }
  }

  return [...exercises.values()]
}

function getAggregate(
  exercises: Map<string, ExerciseAggregate>,
  row: ExerciseIndexRow,
  maps: ExerciseDashboardMaps,
): ExerciseAggregate {
  const existing = exercises.get(row.exerciseName)
  if (existing) {
    return existing
  }

  const created: ExerciseAggregate = {
    exerciseName: row.exerciseName,
    kind: row.kind,
    metric: maps.metrics?.get(row.exerciseName) ?? DEFAULT_EXERCISE_METRIC,
    unit: maps.units?.get(row.exerciseName) ?? DEFAULT_WEIGHT_UNIT,
    ladder: maps.ladders?.get(row.exerciseName),
    totalSets: 0,
    totalDurationSeconds: 0,
    sessionCount: 0,
  }
  exercises.set(row.exerciseName, created)
  return created
}

function formatPb(exercise: ExerciseAggregate): string {
  const link = `[[#${exercise.exerciseName}|${exercise.exerciseName}]]`

  switch (exercise.kind) {
    case 'bodyweight': {
      if (!exercise.pbBodyweightSet) {
        return `- **${link}:** no completed sets`
      }
      return `- **${link}:** ${formatBodyweightDashboardSet(exercise.pbBodyweightSet, exercise.ladder)}`
    }
    case 'duration': {
      const sessionLabel = exercise.sessionCount === 1 ? 'session' : 'sessions'
      return `- **${link}:** total ${exercise.totalDurationSeconds}s across ${exercise.sessionCount} ${sessionLabel}`
    }
    case 'strength': {
      if (!exercise.pbSet) {
        return `- **${link}:** no completed sets`
      }

      return `- **${link}:** ${formatDashboardSet(exercise.pbSet, exercise.metric, exercise.unit)}`
    }
  }
}

function formatNextPlanLine(exercise: ExerciseAggregate): string {
  const link = `[[#${exercise.exerciseName}|${exercise.exerciseName}]]`
  const plan = exercise.nextPlan
  if (!plan) {
    return `- **${link}:** no plan`
  }
  const label = formatNextPlanLabel(plan.value, exercise.kind).toLowerCase()
  const change =
    plan.value.step === undefined
      ? label
      : `${label} ${planStepUnit(exercise.kind, plan.value.step, exercise.unit)}`
  return `- **${link}:** ${change} (planned ${plan.date})`
}

function isMoreRecentPlan(candidate: PlannedSession, current: PlannedSession): boolean {
  if (candidate.date !== current.date) {
    return candidate.date > current.date
  }
  if (candidate.mtime !== current.mtime) {
    return candidate.mtime > current.mtime
  }
  return candidate.path > current.path
}

function dataviewQuery(exercise: ExerciseAggregate, workoutsFolderPath: string): string[] {
  switch (exercise.kind) {
    case 'bodyweight':
      return [
        'TABLE WITHOUT ID',
        '  file.link AS Workout,',
        '  L.level AS Level,',
        '  L.reps AS Reps,',
        '  L.load AS Load',
        `FROM "${workoutsFolderPath}"`,
        'FLATTEN file.lists AS L',
        `WHERE L.exercise = link("${exercise.exerciseName}") AND L.level`,
        'SORT file.name DESC, L.set ASC',
        'LIMIT 10',
      ]
    case 'duration':
      return [
        'table without id file.link as Session, duration + "s" as Duration',
        `from "${workoutsFolderPath}"`,
        'flatten file.lists as item',
        `where contains(item.text, "[exercise:: [[${exercise.exerciseName}]]]") and item.duration`,
        'sort file.name desc',
        'limit 12',
      ]
    case 'strength':
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
}

function isMarkdownFile(file: TAbstractFile | null): file is TFile {
  return file !== null && (file as { extension?: unknown }).extension === 'md'
}

function pickDashboardSet(row: ExerciseIndexRow, metric: ExerciseMetric): StrengthPbSet | null {
  /** Strength-only statistic: other kinds contribute nothing until they define their own. */
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

/** Bodyweight best of a session row; other kinds contribute nothing here. */
function pickBodyweightDashboardSet(row: ExerciseIndexRow): BodyweightBestSet | null {
  if (row.kind !== 'bodyweight') {
    return null
  }
  return row.maxBodyweightSet ?? null
}

/** Better bodyweight set under the shared best-set ordering; exact ties keep the current. */
function isBetterBodyweightDashboardSet(
  candidate: BodyweightBestSet,
  current: BodyweightBestSet | undefined,
): boolean {
  if (!current) {
    return true
  }
  return compareBodyweightSets(candidate, current) > 0
}

function validWeightSet(set: WeightSet | undefined): set is WeightSet {
  return (
    set !== undefined &&
    Number.isFinite(set.weight) &&
    Number.isFinite(set.reps) &&
    set.weight >= 0 &&
    set.reps > 0
  )
}

function validBestSet(set: BestSet | undefined): set is BestSet {
  return validWeightSet(set) && Number.isFinite(set.e1rm) && set.e1rm > 0
}

/** Sibling of the strength line: rung name where strength names weight, then reps. */
function formatBodyweightDashboardSet(
  set: BodyweightBestSet,
  ladder: BodyweightLadder | undefined,
): string {
  const name = bodyweightLevelName(ladder, set.level)
  return set.reps > 0 ? `${name} x ${set.reps}` : name
}

function formatDashboardSet(set: StrengthPbSet, metric: ExerciseMetric, unit: WeightUnit): string {
  const topSet = formatStrengthSet(set, unit)
  if (metric === 'weight') {
    return topSet
  }
  return `${topSet} (e1rm ${(set.e1rm ?? 0).toFixed(1)}${unit})`
}

function formatStrengthSet(set: StrengthPbSet, unit: WeightUnit): string {
  if (set.weight === 0) {
    return formatReps(set.reps)
  }
  return `${set.weight}${unit} x ${set.reps}`
}

function formatReps(reps: number): string {
  return `${reps} rep${reps === 1 ? '' : 's'}`
}

/**
 * Per-exercise dashboard lookups from one index walk over one registry, so a
 * regenerate pays the vault-backed registry build once. Ladders let the
 * dashboard name rungs the same way the chart does.
 */
function buildExerciseDashboardMaps(
  app: App,
  settings: FitKitSettings,
  index: FitKitIndex,
): ExerciseDashboardMaps {
  const registry = createRegistry(exerciseRegistryWithVaultNotes(app, settings))
  const noteMetrics = readExerciseNoteMetrics(app, settings)
  const noteUnits = readExerciseNoteUnits(app, settings)
  const metrics = new Map<string, ExerciseMetric>()
  const units = new Map<string, WeightUnit>()
  const ladders = new Map<string, BodyweightLadder>()

  for (const entry of index.entries) {
    for (const row of entry.exercises) {
      if (row.kind === 'strength') {
        /** Strength-only statistics: other kinds contribute nothing until they define their own. */
        if (!metrics.has(row.exerciseName)) {
          metrics.set(row.exerciseName, getExerciseMetric(row.exerciseName, noteMetrics, registry))
        }
        if (!units.has(row.exerciseName)) {
          units.set(row.exerciseName, getExerciseUnit(row.exerciseName, noteUnits, registry))
        }
      } else if (row.kind === 'bodyweight') {
        if (!ladders.has(row.exerciseName)) {
          const ladder = levelsForName(registry, row.exerciseName)
          if (ladder) {
            ladders.set(row.exerciseName, ladder)
          }
        }
      }
    }
  }

  return { metrics, units, ladders }
}

function readExerciseNoteMetrics(app: App, settings: FitKitSettings): Map<string, ExerciseMetric> {
  const metrics = new Map<string, ExerciseMetric>()

  for (const file of markdownFilesInFolder(app, exercisesFolder(settings))) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
    const type = readFrontmatterField(frontmatter, 'type')
    const kind = readFrontmatterField(frontmatter, 'kind')
    /** Strength-only statistic read from frontmatter; other kinds contribute nothing. */
    if (
      typeof type !== 'string' ||
      type.toLowerCase().trim() !== 'exercise' ||
      typeof kind !== 'string' ||
      kind.toLowerCase().trim() !== 'strength'
    ) {
      continue
    }

    /**
     * Strength-only statistic read from frontmatter; a metric naming another
     * kind reads as the default rather than changing the ranking.
     */
    const parsed = parseExerciseMetric(readFrontmatterField(frontmatter, 'metric'))
    const metric =
      parsed && VALID_EXERCISE_METRICS.strength.includes(parsed) ? parsed : DEFAULT_EXERCISE_METRIC
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

function readExerciseNoteUnits(app: App, settings: FitKitSettings): Map<string, WeightUnit> {
  const units = new Map<string, WeightUnit>()

  for (const file of markdownFilesInFolder(app, exercisesFolder(settings))) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
    const type = readFrontmatterField(frontmatter, 'type')
    const kind = readFrontmatterField(frontmatter, 'kind')
    /** Strength-only statistic read from frontmatter; other kinds contribute nothing. */
    if (
      typeof type !== 'string' ||
      type.toLowerCase().trim() !== 'exercise' ||
      typeof kind !== 'string' ||
      kind.toLowerCase().trim() !== 'strength'
    ) {
      continue
    }

    const unit = parseWeightUnit(readFrontmatterField(frontmatter, 'unit'))
    if (unit) {
      units.set(normalize(file.basename), unit)
    }
  }

  return units
}

function getExerciseUnit(
  exerciseName: string,
  noteUnits: ReadonlyMap<string, WeightUnit>,
  registry: ExerciseRegistry,
): WeightUnit {
  const direct = noteUnits.get(normalize(exerciseName))
  if (direct) {
    return direct
  }

  const resolved = resolve(registry, exerciseName)
  if (resolved.kind !== 'match') {
    return DEFAULT_WEIGHT_UNIT
  }

  return noteUnits.get(normalize(resolved.entry.name)) ?? resolved.entry.unit ?? DEFAULT_WEIGHT_UNIT
}

function readFrontmatterField(
  frontmatter: CachedMetadata['frontmatter'] | undefined,
  key: string,
): unknown {
  const record: Record<string, unknown> | null = frontmatter ?? null
  return record === null ? undefined : record[key]
}

function recentWorkouts(index: FitKitIndex): IndexEntry[] {
  return [...index.entries]
    .sort((left, right) => {
      if (left.date !== right.date) {
        return right.date.localeCompare(left.date)
      }
      if (left.mtime !== right.mtime) {
        return right.mtime - left.mtime
      }
      return right.path.localeCompare(left.path)
    })
    .slice(0, 10)
}

function formatRecentWorkout(entry: IndexEntry, workoutsFolderPath: string): string {
  const basename = entry.path.slice(entry.path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  const label = entry.name.trim() || basename
  return `- ${entry.date}: [[${workoutsFolderPath}/${basename}|${label}]]`
}
