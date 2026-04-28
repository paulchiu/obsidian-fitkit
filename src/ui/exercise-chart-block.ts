import {
  Notice,
  TFile,
  normalizePath,
  type CachedMetadata,
  type MarkdownPostProcessorContext,
} from 'obsidian'

import {
  parseExerciseChartBlock,
  resolveExerciseChartMetric,
} from '../domain/exercise-chart-block-parse'
import { buildExerciseChartSeries } from '../domain/exercise-chart'
import {
  createRegistry,
  kindForName,
  resolve,
  type ExerciseKind,
} from '../domain/exercise-registry'
import type FitKitPlugin from '../main'
import { exercisesFolder } from '../settings-paths'
import { rebuildIndex } from '../vault/index'
import { exerciseRegistryWithVaultNotes } from '../vault/exercise-registry-vault'
import { renderExerciseChartSvg } from './exercise-chart-svg'

type KindFrontmatterResult =
  | { kind: ExerciseKind }
  | { kind: null; reason: 'missing' }
  | { kind: null; reason: 'invalid'; raw: string }

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
  const parsed = parseExerciseChartBlock(source)
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
  const exerciseFile = resolveExerciseFile(plugin, exerciseName, registry)
  const exerciseFrontmatter = exerciseFile
    ? plugin.app.metadataCache.getFileCache(exerciseFile)?.frontmatter
    : undefined

  let kind = parsed.kind
  const frontmatterKind = kindFromFrontmatter(exerciseFrontmatter)
  if (!kind && frontmatterKind.kind) {
    kind = frontmatterKind.kind
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
  /**
   * Registry-resolved duration means the chart did not fall back to the strength default.
   * Only show the exercise-note frontmatter nudge when the resolved kind remains strength.
   */
  if (
    parsed.kind === null &&
    sourceIsExerciseNote &&
    frontmatterKind.kind === null &&
    kind === 'strength'
  ) {
    if (frontmatterKind.reason === 'invalid') {
      notes.push(
        `Exercise note frontmatter has unrecognised 'kind: ${frontmatterKind.raw}'; defaulting to strength. Use 'kind: strength' or 'kind: duration'.`,
      )
    } else {
      notes.push(
        "Exercise note frontmatter is missing 'kind:'; defaulting to strength. Add 'kind: strength' or 'kind: duration' to be explicit.",
      )
    }
  }

  const metric = resolveExerciseChartMetric(parsed, exerciseFrontmatter, kind, notes)

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

function resolveSourceFile(plugin: FitKitPlugin, ctx: MarkdownPostProcessorContext): TFile | null {
  const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath)
  return file instanceof TFile ? file : null
}

function resolveExerciseFile(
  plugin: FitKitPlugin,
  exerciseName: string,
  registry: ReturnType<typeof createRegistry>,
): TFile | null {
  const folder = exercisesFolder(plugin.settings)
  const resolved = resolve(registry, exerciseName)
  const names =
    resolved.kind === 'match' ? uniqueNames([resolved.entry.name, exerciseName]) : [exerciseName]
  for (const name of names) {
    const path = normalizePath(`${folder}/${name}.md`)
    const file = plugin.app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) {
      return file
    }
  }
  return null
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
): KindFrontmatterResult {
  const value = readFrontmatterField(frontmatter, 'kind')
  if (value === undefined || value === null) {
    return { kind: null, reason: 'missing' }
  }
  if (typeof value !== 'string') {
    return { kind: null, reason: 'missing' }
  }
  const raw = value.trim()
  if (raw.length === 0) {
    return { kind: null, reason: 'missing' }
  }
  const lowered = raw.toLowerCase()
  if (lowered === 'strength' || lowered === 'duration') {
    return { kind: lowered }
  }
  return { kind: null, reason: 'invalid', raw }
}

function readFrontmatterField(
  frontmatter: CachedMetadata['frontmatter'] | undefined,
  key: string,
): unknown {
  const record: Record<string, unknown> | null = frontmatter ?? null
  return record === null ? undefined : record[key]
}

function uniqueNames(names: string[]): string[] {
  return names.filter((name, index) => names.indexOf(name) === index)
}
