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
} from '../../domain/exercise-chart-block-parse'
import { frontmatterTypeIs, readFrontmatterField } from '../../domain/frontmatter'
import { buildExerciseChartSeries } from '../../domain/exercise-chart'
import {
  EXERCISE_KINDS,
  assertUnreachableKind,
  parseExerciseKind,
} from '../../domain/exercise-kind'
import {
  createRegistry,
  kindForName,
  levelsForName,
  resolve,
  type ExerciseKind,
} from '../../domain/exercise-registry'
import type FitKitPlugin from '../../main'
import { exercisesFolder } from '../../settings-paths'
import { exerciseRegistryWithVaultNotes } from '../../vault/exercise-registry-vault'
import { DEFAULT_WEIGHT_UNIT, parseWeightUnit, type WeightUnit } from '../../domain/weight-unit'
import type { BodyweightLadder } from '../../domain/bodyweight-levels'
import type { ChartSeries } from '../../domain/exercise-chart'
import { renderChartMessage, renderExerciseChart } from '../components/exercise-chart'
import { preactRenderChild } from './preact-render-child'

type KindFrontmatterResult =
  | { kind: ExerciseKind }
  | { kind: null; reason: 'missing' }
  | { kind: null; reason: 'invalid'; raw: string }

/** What a chart block shows: a message, or the exercise's chart. */
type ChartView =
  | { kind: 'message'; text: string }
  | { kind: 'chart'; series: ChartSeries; notes: string[]; ladder: BodyweightLadder | undefined }

export async function renderExerciseChartBlock(
  plugin: FitKitPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): Promise<void> {
  ctx.addChild(preactRenderChild(el))
  try {
    drawChartView(el, await buildChartView(plugin, source, ctx))
  } catch {
    new Notice('Failed to render chart block.')
    renderChartMessage(el, 'fitkit-chart: failed to render.')
  }
}

function drawChartView(el: HTMLElement, view: ChartView): void {
  switch (view.kind) {
    case 'message':
      renderChartMessage(el, view.text)
      break
    case 'chart':
      renderExerciseChart(el, view)
      break
  }
}

async function buildChartView(
  plugin: FitKitPlugin,
  source: string,
  ctx: MarkdownPostProcessorContext,
): Promise<ChartView> {
  const parsed = parseExerciseChartBlock(source)
  const sourceFile = resolveSourceFile(plugin, ctx)
  const sourceIsExerciseNote = isExerciseSourceFile(sourceFile, plugin)
  const registry = createRegistry(exerciseRegistryWithVaultNotes(plugin.app, plugin.settings))
  const notes: string[] = []

  const exerciseName =
    parsed.exerciseName ?? (sourceIsExerciseNote && sourceFile ? sourceFile.basename : null)
  if (!exerciseName) {
    return {
      kind: 'message',
      text: "fitkit-chart: set 'exercise: <name>' or place this block inside an exercise note.",
    }
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
  const registryKind = kindForName(registry, exerciseName)
  if (!kind && frontmatterKind.kind) {
    kind = frontmatterKind.kind
  }
  if (!kind && registryKind) {
    kind = registryKind
  }
  if (!kind) {
    kind = 'strength'
  }
  if (parsed.kind === null && !sourceIsExerciseNote) {
    notes.push(
      `No 'kind:' supplied; defaulting to ${kind}. Add ${formatKindOptions()} to be explicit.`,
    )
  }
  if (parsed.kind === null && sourceIsExerciseNote && frontmatterKind.kind === null) {
    if (frontmatterKind.reason === 'invalid') {
      switch (registryKind) {
        case 'bodyweight':
          notes.push(
            `Exercise note frontmatter has unrecognised 'kind: ${frontmatterKind.raw}'; using bodyweight from the exercise registry. Use ${formatKindOptions()}.`,
          )
          break
        case 'duration':
          notes.push(
            `Exercise note frontmatter has unrecognised 'kind: ${frontmatterKind.raw}'; using duration from the exercise registry. Use ${formatKindOptions()}.`,
          )
          break
        case 'strength':
        case null:
          /** A silent registry joins strength here: neither supplied a kind, so the strength default applies. */
          notes.push(
            `Exercise note frontmatter has unrecognised 'kind: ${frontmatterKind.raw}'; defaulting to strength. Use ${formatKindOptions()}.`,
          )
          break
        default:
          assertUnreachableKind(registryKind)
      }
    } else if (kind === 'strength') {
      /**
       * Strength-only rule: this note describes the strength default, so a kind
       * resolved from the registry stays silent (nothing was defaulted).
       */
      notes.push(
        `Exercise note frontmatter is missing 'kind:'; defaulting to strength. Add ${formatKindOptions()} to be explicit.`,
      )
    }
  }

  const metric = resolveExerciseChartMetric(parsed, exerciseFrontmatter, kind, notes)

  /** Strength-only rule: weight units are a strength concern; other kinds chart without one. */
  const weightUnit =
    kind === 'strength'
      ? resolveExerciseWeightUnit(exerciseFrontmatter, registry, exerciseName)
      : null
  const index = await plugin.getIndex()

  const series = buildExerciseChartSeries(
    index,
    registry,
    exerciseName,
    kind,
    window,
    metric,
    weightUnit,
  )
  return { kind: 'chart', series, notes, ladder: levelsForName(registry, exerciseName) }
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
  return frontmatterTypeIs(frontmatter, 'exercise')
}

/** Advice fragment naming every known kind, so the note text cannot drift from `EXERCISE_KINDS`. */
function formatKindOptions(): string {
  return EXERCISE_KINDS.map((kind) => `'kind: ${kind}'`).join(' or ')
}

function kindFromFrontmatter(
  frontmatter: CachedMetadata['frontmatter'] | undefined,
): KindFrontmatterResult {
  const value = readFrontmatterField(frontmatter, 'kind')
  const kind = parseExerciseKind(value)
  if (kind) {
    return { kind }
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { kind: null, reason: 'missing' }
  }
  return { kind: null, reason: 'invalid', raw: value.trim() }
}

function resolveExerciseWeightUnit(
  frontmatter: CachedMetadata['frontmatter'] | undefined,
  registry: ReturnType<typeof createRegistry>,
  exerciseName: string,
): WeightUnit {
  const frontmatterUnit = parseWeightUnit(readFrontmatterField(frontmatter, 'unit'))
  if (frontmatterUnit) {
    return frontmatterUnit
  }
  const resolved = resolve(registry, exerciseName)
  return resolved.kind === 'match'
    ? (resolved.entry.unit ?? DEFAULT_WEIGHT_UNIT)
    : DEFAULT_WEIGHT_UNIT
}

function uniqueNames(names: string[]): string[] {
  return names.filter((name, index) => names.indexOf(name) === index)
}
