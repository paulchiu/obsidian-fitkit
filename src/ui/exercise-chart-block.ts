import {
  Notice,
  TFile,
  normalizePath,
  type CachedMetadata,
  type MarkdownPostProcessorContext,
} from 'obsidian'

import { buildExerciseChartSeries } from '../domain/exercise-chart'
import {
  DEFAULT_EXERCISE_METRIC,
  parseExerciseMetric,
  type ExerciseMetric,
} from '../domain/exercise-metric'
import { createRegistry, kindForName, type ExerciseKind } from '../domain/exercise-registry'
import type FitKitPlugin from '../main'
import { exercisesFolder } from '../settings-paths'
import { rebuildIndex } from '../vault/index'
import { exerciseRegistryWithVaultNotes } from '../vault/exercise-registry-vault'
import { renderExerciseChartSvg } from './exercise-chart-svg'

interface ParsedBlock {
  exerciseName: string | null
  kind: ExerciseKind | null
  metric: ExerciseMetric | null
  metricSupplied: boolean
  invalidMetricValue: string | null
  window: number | null
  windowFallback: boolean
}

export async function renderExerciseChartBlock(
  plugin: FitKitPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): Promise<void> {
  try {
    await renderInternal(plugin, source, el, ctx)
  } catch {
    new Notice('Failed to render chart block.')
    el.empty()
    el.addClass('fitkit-chart')
    el.createDiv({
      cls: 'fitkit-chart-empty',
      text: 'fitkit-chart: failed to render.',
    })
  }
}

async function renderInternal(
  plugin: FitKitPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): Promise<void> {
  const parsed = parseBlock(source)
  const sourceFile = resolveSourceFile(plugin, ctx)
  const sourceIsExerciseNote = isExerciseSourceFile(sourceFile, plugin)
  const registry = createRegistry(exerciseRegistryWithVaultNotes(plugin.app, plugin.settings))
  const notes: string[] = []

  const exerciseName =
    parsed.exerciseName ?? (sourceIsExerciseNote && sourceFile ? sourceFile.basename : null)
  if (!exerciseName) {
    el.empty()
    el.addClass('fitkit-chart')
    el.createDiv({
      cls: 'fitkit-chart-empty',
      text: "fitkit-chart: set 'exercise: <name>' or place this block inside an exercise note.",
    })
    return
  }

  if (parsed.windowFallback) {
    notes.push(`Ignored invalid window value; using ${plugin.settings.chartSessionsWindow}.`)
  }

  const window = parsed.window ?? plugin.settings.chartSessionsWindow
  const exerciseFile = resolveExerciseFile(plugin, exerciseName)
  const exerciseFrontmatter = exerciseFile
    ? plugin.app.metadataCache.getFileCache(exerciseFile)?.frontmatter
    : undefined

  let kind = parsed.kind
  if (!kind) {
    kind = kindFromFrontmatter(exerciseFrontmatter)
  }
  if (!kind) {
    kind = kindForName(registry, exerciseName)
  }
  if (!kind) {
    kind = 'strength'
  }
  if (parsed.kind === null && !sourceIsExerciseNote) {
    notes.push(
      `No 'kind:' supplied; defaulting to ${kind}. Add 'kind: strength' or 'kind: duration' to be explicit.`,
    )
  }

  const metric = resolveMetric(parsed, exerciseFrontmatter, kind, notes)

  if (!plugin.cachedIndex) {
    plugin.cachedIndex = await rebuildIndex(plugin.app, plugin.settings)
    plugin.lastDiagnostics = plugin.cachedIndex.diagnostics
  }

  const series = buildExerciseChartSeries(
    plugin.cachedIndex,
    registry,
    exerciseName,
    kind,
    window,
    metric,
  )
  renderExerciseChartSvg(el, series, { notes })
}

function parseBlock(source: string): ParsedBlock {
  const result: ParsedBlock = {
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
      if (key === 'metric') {
        result.metricSupplied = true
        result.metric = null
        result.invalidMetricValue = ''
      }
      continue
    }
    if (key === 'exercise' || key === 'name') {
      result.exerciseName = value
    } else if (key === 'kind') {
      const lowered = value.toLowerCase()
      if (lowered === 'strength' || lowered === 'duration') {
        result.kind = lowered
      }
    } else if (key === 'metric') {
      result.metricSupplied = true
      result.metric = parseExerciseMetric(value)
      result.invalidMetricValue = result.metric ? null : value.trim()
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

function resolveMetric(
  parsed: ParsedBlock,
  frontmatter: CachedMetadata['frontmatter'] | undefined,
  kind: ExerciseKind,
  notes: string[],
): ExerciseMetric {
  if (kind === 'duration') {
    return DEFAULT_EXERCISE_METRIC
  }
  if (parsed.metricSupplied) {
    if (parsed.metric) {
      return parsed.metric
    }
    notes.push(`Ignored invalid metric value '${parsed.invalidMetricValue ?? ''}'; using e1rm.`)
    return DEFAULT_EXERCISE_METRIC
  }

  const metric = metricFromFrontmatter(frontmatter)
  if (metric) {
    return metric
  }

  const raw = readFrontmatterField(frontmatter, 'metric')
  if (raw !== undefined) {
    notes.push(`Ignored invalid metric value '${formatFrontmatterValue(raw)}'; using e1rm.`)
  }
  return DEFAULT_EXERCISE_METRIC
}

function resolveSourceFile(plugin: FitKitPlugin, ctx: MarkdownPostProcessorContext): TFile | null {
  const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath)
  return file instanceof TFile ? file : null
}

function resolveExerciseFile(plugin: FitKitPlugin, exerciseName: string): TFile | null {
  const folder = exercisesFolder(plugin.settings)
  const path = normalizePath(`${folder}/${exerciseName}.md`)
  const file = plugin.app.vault.getAbstractFileByPath(path)
  return file instanceof TFile ? file : null
}

function isExerciseSourceFile(file: TFile | null, plugin: FitKitPlugin): boolean {
  if (!file) {
    return false
  }
  const folder = exercisesFolder(plugin.settings)
  if (!file.path.startsWith(`${folder}/`)) {
    return false
  }
  const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter
  const typeValue = readFrontmatterField(frontmatter, 'type')
  return typeof typeValue === 'string' && typeValue.toLowerCase() === 'exercise'
}

function kindFromFrontmatter(
  frontmatter: CachedMetadata['frontmatter'] | undefined,
): ExerciseKind | null {
  const value = readFrontmatterField(frontmatter, 'kind')
  if (typeof value !== 'string') {
    return null
  }
  const lowered = value.toLowerCase().trim()
  if (lowered === 'strength' || lowered === 'duration') {
    return lowered
  }
  return null
}

function metricFromFrontmatter(
  frontmatter: CachedMetadata['frontmatter'] | undefined,
): ExerciseMetric | null {
  return parseExerciseMetric(readFrontmatterField(frontmatter, 'metric'))
}

function formatFrontmatterValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value)
}

function readFrontmatterField(
  frontmatter: CachedMetadata['frontmatter'] | undefined,
  key: string,
): unknown {
  const record: Record<string, unknown> | null = frontmatter ?? null
  return record === null ? undefined : record[key]
}
