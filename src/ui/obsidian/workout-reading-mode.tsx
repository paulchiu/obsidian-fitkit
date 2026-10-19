import { TFile, type MarkdownPostProcessorContext } from 'obsidian'
import { render } from 'preact'

import { createRegistry, levelsForName, unitForName } from '../../domain/exercise-registry'
import { parseWorkoutNote } from '../../domain/workout-note-model'
import type { ExerciseEntry } from '../../domain/workout-note-model'
import { DEFAULT_WEIGHT_UNIT } from '../../domain/weight-unit'
import type FitKitPlugin from '../../main'
import { exerciseRegistryWithVaultNotes } from '../../vault/exercise-registry-vault'
import { ReadingPreviewBody } from '../components/reading-preview'
import { buildReadingPreview } from '../model/reading-preview'
import { preactRenderChild } from './preact-render-child'

const WORKOUT_SOURCE_ROW = /^\s*[-*]\s+.*\[exercise::/

export function renderWorkoutReadingModeSection(
  plugin: FitKitPlugin,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): void {
  if (!isWorkoutContext(plugin, ctx) || hasReadingPreview(el)) {
    return
  }

  const section = ctx.getSectionInfo(el)
  if (!section || !section.text.includes('[exercise::')) {
    return
  }

  const sourceRowCount = workoutSourceRowCount(section.text)
  if (sourceRowCount === 0) {
    return
  }

  const parsed = parseWorkoutNote(sectionWorkoutSource(section.text), ctx.sourcePath)
  const exercises = parsed.model?.exercises ?? []
  const exercise = exercises[0]
  if (!parsed.isWorkout || exercises.length !== 1 || !exercise) {
    return
  }

  const hiddenRows = hideRecognisedSourceRows(el, sourceRowCount)
  if (hiddenRows < sourceRowCount) {
    return
  }

  renderExercisePreview(el, exercise, plugin, ctx)
}

function isWorkoutContext(plugin: FitKitPlugin, ctx: MarkdownPostProcessorContext): boolean {
  if (frontmatterIsWorkout(ctx.frontmatter)) {
    return true
  }
  const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath)
  if (!(file instanceof TFile)) {
    return false
  }
  return frontmatterIsWorkout(plugin.app.metadataCache.getFileCache(file)?.frontmatter)
}

function frontmatterIsWorkout(frontmatter: unknown): boolean {
  if (!frontmatter || typeof frontmatter !== 'object' || !('type' in frontmatter)) {
    return false
  }
  const { type } = frontmatter
  return typeof type === 'string' && type.toLowerCase() === 'workout'
}

function hasReadingPreview(el: HTMLElement): boolean {
  return Array.from(el.children).some((child) => child.classList.contains('fitkit-reading-preview'))
}

function sectionWorkoutSource(sectionText: string): string {
  return ['---', 'type: workout', 'date:', 'name:', '---', '', sectionText].join('\n')
}

function workoutSourceRowCount(sectionText: string): number {
  let count = 0
  let inFence = false
  for (const line of sectionText.split(/\r?\n/)) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence
      continue
    }
    if (!inFence && WORKOUT_SOURCE_ROW.test(line)) {
      count += 1
    }
  }
  return count
}

function hideRecognisedSourceRows(el: HTMLElement, sourceRowCount: number): number {
  const listItems = Array.from(el.querySelectorAll('li'))
  if (listItems.length === 0) {
    return 0
  }

  const toHide = new Set<HTMLElement>()
  for (const item of listItems) {
    if ((item.textContent ?? '').includes('[exercise::')) {
      toHide.add(item)
    }
  }

  if (toHide.size < sourceRowCount && listItems.length === sourceRowCount) {
    for (const item of listItems) {
      toHide.add(item)
    }
  }
  if (toHide.size < sourceRowCount) {
    return 0
  }

  for (const item of toHide) {
    item.addClass('fitkit-reading-hidden-source-row')
  }
  return toHide.size
}

function renderExercisePreview(
  el: HTMLElement,
  exercise: ExerciseEntry,
  plugin: FitKitPlugin,
  ctx: MarkdownPostProcessorContext,
): void {
  /** One snapshot per preview: the plan line, the set table and the ladder must all agree. */
  const registry = createRegistry(exerciseRegistryWithVaultNotes(plugin.app, plugin.settings))
  const unit = unitForName(registry, exercise.exerciseName) ?? DEFAULT_WEIGHT_UNIT
  const preview = buildReadingPreview(
    exercise,
    unit,
    levelsForName(registry, exercise.exerciseName),
  )

  /** Preact adopts or removes a container's existing children, so it gets an element of its own. */
  const wrap = el.createDiv({ cls: 'fitkit-reading-preview' })
  const child = preactRenderChild(wrap)
  child.register(() => wrap.remove())
  ctx.addChild(child)
  render(<ReadingPreviewBody preview={preview} />, wrap)
}
