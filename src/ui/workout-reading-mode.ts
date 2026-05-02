import { TFile, type MarkdownPostProcessorContext } from 'obsidian'

import { parseWorkoutNote } from '../domain/workout-note-model'
import type { DurationEntry, ExerciseEntry, StrengthSet } from '../domain/workout-note-model'
import type FitKitPlugin from '../main'

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

  renderExercisePreview(el, exercise)
}

export function formatWeight(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '-' : `${formatNumber(value)} kg`
}

export function formatReps(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '-' : formatNumber(value)
}

export function formatDurationSeconds(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '-'
  }
  const rounded = Math.max(0, Math.round(value))
  if (rounded < 60) {
    return `${rounded}s`
  }
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const seconds = rounded % 60
  const parts: string[] = []
  if (hours > 0) {
    parts.push(`${hours}h`)
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`)
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`)
  }
  return parts.join(' ')
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
  if (!frontmatter || typeof frontmatter !== 'object') {
    return false
  }
  const type = (frontmatter as Record<string, unknown>).type
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
  const listItems = Array.from(el.querySelectorAll('li')) as HTMLElement[]
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

function renderExercisePreview(el: HTMLElement, exercise: ExerciseEntry): void {
  const wrap = el.createDiv({ cls: 'fitkit-reading-preview' })
  const summary = wrap.createDiv({ cls: 'fitkit-reading-summary' })
  summary.createSpan({
    cls: 'fitkit-reading-kind',
    text: exercise.kind === 'strength' ? 'Strength' : 'Duration',
  })
  summary.createSpan({ cls: 'fitkit-reading-count', text: exerciseCountText(exercise) })

  if (exercise.note) {
    wrap.createDiv({ cls: 'fitkit-reading-note', text: exercise.note })
  }

  if (exercise.kind === 'strength') {
    renderStrengthTable(wrap, exercise.strengthSets ?? [])
  } else {
    renderDurationTable(wrap, exercise.durationEntries ?? [])
  }
}

function exerciseCountText(exercise: ExerciseEntry): string {
  const count =
    exercise.kind === 'strength'
      ? (exercise.strengthSets ?? []).length
      : (exercise.durationEntries ?? []).length
  return count === 1 ? '1 row' : `${count} rows`
}

function renderStrengthTable(container: HTMLElement, sets: StrengthSet[]): void {
  if (sets.length === 0) {
    renderEmpty(container, 'No strength rows recorded.')
    return
  }
  const table = createTable(container, ['Set', 'Weight', 'Reps', 'Notes'])
  const body = table.createEl('tbody')
  for (const set of sets) {
    const row = body.createEl('tr')
    row.createEl('td', { text: formatSet(set.set) })
    row.createEl('td', { text: formatWeight(set.weight) })
    row.createEl('td', { text: formatReps(set.reps) })
    row.createEl('td', { text: set.note ?? '-' })
  }
}

function renderDurationTable(container: HTMLElement, entries: DurationEntry[]): void {
  if (entries.length === 0) {
    renderEmpty(container, 'No duration rows recorded.')
    return
  }
  const table = createTable(container, ['Set', 'Duration', 'Notes'])
  const body = table.createEl('tbody')
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) {
      continue
    }
    const row = body.createEl('tr')
    row.createEl('td', { text: formatSet(entry.set ?? index + 1) })
    row.createEl('td', { text: formatDurationSeconds(entry.durationSeconds) })
    row.createEl('td', { text: entry.note ?? '-' })
  }
}

function createTable(container: HTMLElement, headings: string[]): HTMLElement {
  const table = container.createEl('table', { cls: 'fitkit-reading-table' })
  const head = table.createEl('thead')
  const row = head.createEl('tr')
  for (const heading of headings) {
    row.createEl('th', { text: heading })
  }
  return table
}

function renderEmpty(container: HTMLElement, message: string): void {
  container.createDiv({ cls: 'fitkit-reading-empty', text: message })
}

function formatSet(value: number): string {
  return Number.isFinite(value) && value > 0 ? formatNumber(value) : '-'
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value)
}
