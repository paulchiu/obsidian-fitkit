import { Modal, Notice } from 'obsidian'

import { formatErrorMessage } from '../domain/error'
import type {
  ExerciseRenamePlan,
  ExerciseRenameWorkoutNotePlan,
} from '../domain/exercise-rename-planner'
import type FitKitPlugin from '../main'
import {
  applyExerciseRenamePlan,
  buildExerciseRenamePlanFromVault,
  type ExerciseRenameApplyFailure,
  type ExerciseRenameApplyResult,
} from '../vault/exercise-rename-apply'

export interface ExerciseRenameModalOptions {
  oldName: string
  onApplied?: () => void
}

type ModalPhase = 'input' | 'loading' | 'preview'

const FAILURE_STAGE_LABEL: Record<ExerciseRenameApplyFailure['stage'], string> = {
  'note-rename': 'renaming the exercise note file',
  'workout-note-rewrite': 'rewriting the workout note',
  'note-migrate': "refreshing the renamed note's dataview blocks",
  'note-remove': 'removing the merged-away exercise note',
}

export function describeRenameApplyFailure(failure: ExerciseRenameApplyFailure): string {
  return `${FAILURE_STAGE_LABEL[failure.stage]} for '${failure.path}' (${failure.message})`
}

/**
 * The apply step keeps going past a per-file failure (see
 * `applyExerciseRenamePlan`), so this reports what did not complete while
 * making clear that whatever did complete was already saved and that a
 * confirm on the refreshed preview will pick up exactly what is left,
 * because the rescan it re-runs is idempotent.
 */
export function describeRenameApplyFailures(
  failures: readonly ExerciseRenameApplyFailure[],
): string {
  return `Rename only partly completed: could not finish ${failures
    .map(describeRenameApplyFailure)
    .join('; ')}. Changes made so far were saved; confirm again to finish the rest.`
}

export function describeRenameApplySuccess(
  plan: ExerciseRenamePlan,
  result: ExerciseRenameApplyResult,
): string {
  const parts: string[] = []
  if (result.noteRenamed && result.finalNotePath) {
    parts.push(`Renamed the note file to '${result.finalNotePath}'.`)
  }
  const rewritten = result.headingOccurrencesRewritten + result.fieldOccurrencesRewritten
  parts.push(
    rewritten > 0
      ? `Updated ${rewritten} reference(s) across ${result.workoutNotesRewritten} workout note(s).`
      : 'No workout notes needed updating.',
  )
  if (plan.operation === 'merge') {
    parts.push(
      result.loserNoteRemoved
        ? result.proseCarried
          ? `Merged '${plan.oldName}' into '${plan.newName}', carrying its notes over, and removed the old note.`
          : `Merged '${plan.oldName}' into '${plan.newName}' and removed the old note (nothing to carry over).`
        : `Merged '${plan.oldName}' into '${plan.newName}'.`,
    )
  }
  if (result.noteMigrationWarnings.length > 0) {
    parts.push(
      `${result.noteMigrationWarnings.length} note section(s) look customised and were left as-is; review them manually.`,
    )
  }
  return parts.join(' ')
}

/**
 * Renames or merges an exercise, end to end: the user types a new name, a
 * plan is computed from the current vault state (`buildExerciseRenamePlanFromVault`),
 * and every effect is shown before anything is written. Nothing is applied
 * until 'Confirm rename' / 'Confirm merge' is clicked; Cancel and closing the
 * modal at any earlier stage write nothing. A partial apply failure keeps the
 * modal open with a warning banner and a freshly recomputed preview, so
 * confirming again safely finishes the job (see `describeRenameApplyFailures`).
 */
export class ExerciseRenameModal extends Modal {
  private newName: string
  private phase: ModalPhase = 'input'
  private inputError: string | null = null
  private plan: ExerciseRenamePlan | null = null
  private applyWarning: string | null = null
  private applying = false

  constructor(
    private plugin: FitKitPlugin,
    private options: ExerciseRenameModalOptions,
  ) {
    super(plugin.app)
    this.newName = options.oldName
  }

  onOpen(): void {
    this.render()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private render(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('fitkit-import-modal')
    this.setTitle('Rename exercise')

    if (this.applyWarning) {
      contentEl.createDiv({ text: this.applyWarning, cls: 'fitkit-warn' })
    }

    if (this.phase === 'input') {
      this.renderInputStage(contentEl)
      return
    }
    if (this.phase === 'loading') {
      contentEl.createDiv({ text: 'Checking workout notes...', cls: 'fitkit-import-muted' })
      return
    }
    if (this.plan) {
      this.renderPreviewStage(contentEl, this.plan)
    }
  }

  private renderInputStage(contentEl: HTMLElement): void {
    contentEl.createEl('p', {
      cls: 'fitkit-import-muted',
      text: `Renaming '${this.options.oldName}' updates its exercise note file, rewrites '[exercise:: [[${this.options.oldName}]]]' references in workout notes, and keeps '${this.options.oldName}' as an alias. Renaming onto a name already in use merges the two.`,
    })

    const field = contentEl.createDiv({ cls: 'fitkit-registry-field' })
    field.createEl('label', { text: 'New name', cls: 'fitkit-registry-field-label' })
    const input = field.createEl('input', { type: 'text', cls: 'fitkit-registry-input' })
    input.value = this.newName
    input.addEventListener('input', () => {
      this.newName = input.value
    })

    if (this.inputError) {
      contentEl.createDiv({ text: this.inputError, cls: 'fitkit-warn' })
    }

    const actions = contentEl.createDiv({ cls: 'fitkit-import-actions' })
    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Cancel' })
    cancel.addEventListener('click', () => this.close())
    const preview = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-primary',
      text: 'Preview changes',
    })
    preview.addEventListener('click', () => void this.computePreview())

    input.focus()
  }

  private async computePreview(): Promise<void> {
    this.phase = 'loading'
    this.inputError = null
    this.render()
    try {
      const plan = await buildExerciseRenamePlanFromVault(
        this.plugin.app,
        this.plugin.settings,
        this.options.oldName,
        this.newName,
      )
      this.plan = plan
      this.phase = 'preview'
    } catch (error) {
      this.plan = null
      this.phase = 'input'
      this.inputError = `Could not check the vault: ${formatErrorMessage(error)}.`
    }
    this.render()
  }

  private renderPreviewStage(contentEl: HTMLElement, plan: ExerciseRenamePlan): void {
    if (plan.refusal) {
      contentEl.createEl('h3', { text: "Can't rename this exercise" })
      contentEl.createEl('p', { text: plan.refusal.message })
      const actions = contentEl.createDiv({ cls: 'fitkit-import-actions' })
      const back = actions.createEl('button', { cls: 'fitkit-btn', text: 'Back' })
      back.addEventListener('click', () => {
        this.phase = 'input'
        this.render()
      })
      const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Cancel' })
      cancel.addEventListener('click', () => this.close())
      return
    }

    contentEl.createEl('p', {
      text:
        plan.operation === 'merge'
          ? `Merging '${plan.oldName}' into '${plan.newName}'.`
          : `Renaming '${plan.oldName}' to '${plan.newName}'.`,
    })

    this.renderNoteFileSummary(contentEl, plan)
    this.renderWorkoutNotesSummary(contentEl, plan)
    this.renderAliasSummary(contentEl, plan)
    this.renderStaleSummary(contentEl, plan)
    if (plan.operation === 'merge') {
      this.renderMergeWarning(contentEl, plan)
    }

    const actions = contentEl.createDiv({ cls: 'fitkit-import-actions' })
    const back = actions.createEl('button', { cls: 'fitkit-btn', text: 'Back' })
    back.disabled = this.applying
    back.addEventListener('click', () => {
      this.phase = 'input'
      this.render()
    })
    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Cancel' })
    cancel.disabled = this.applying
    cancel.addEventListener('click', () => this.close())
    const confirm = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-primary',
      text: this.applying
        ? 'Applying...'
        : plan.operation === 'merge'
          ? 'Confirm merge'
          : 'Confirm rename',
    })
    confirm.disabled = this.applying
    confirm.addEventListener('click', () => void this.handleConfirm())
  }

  private renderNoteFileSummary(contentEl: HTMLElement, plan: ExerciseRenamePlan): void {
    contentEl.createEl('h3', { text: 'Exercise note file' })
    if (!plan.sourceNotePath) {
      contentEl.createEl('p', {
        text: `No exercise note file exists for '${plan.oldName}'; only the registry entry and workout note references will change.`,
      })
      return
    }
    if (plan.operation === 'merge' && plan.targetNoteExists && plan.targetNotePath) {
      contentEl.createEl('p', {
        text: `'${plan.sourceNotePath}' will be removed after merging into '${plan.targetNotePath}'.`,
      })
      return
    }
    contentEl.createEl('p', {
      text: `Rename: '${plan.sourceNotePath}' → '${plan.targetNotePath}'.`,
    })
  }

  private renderWorkoutNotesSummary(contentEl: HTMLElement, plan: ExerciseRenamePlan): void {
    contentEl.createEl('h3', { text: `Workout notes (${plan.workoutNotes.length})` })
    if (plan.workoutNotes.length === 0) {
      contentEl.createEl('p', { text: `No workout notes reference '${plan.oldName}'.` })
      return
    }
    const table = contentEl.createEl('table', { cls: 'fitkit-import-table' })
    const head = table.createEl('tr')
    head.createEl('th', { text: 'Workout note' })
    head.createEl('th', { text: 'Rows changed' })
    head.createEl('th', { text: 'Left stale' })
    for (const note of plan.workoutNotes) {
      this.renderWorkoutNoteRow(table, note)
    }
    contentEl.createEl('p', {
      cls: 'fitkit-import-muted',
      text: `${plan.totalHeadingOccurrences + plan.totalFieldOccurrences} row(s) across ${
        plan.workoutNotes.length
      } workout note(s) will be updated.`,
    })
  }

  private renderWorkoutNoteRow(table: HTMLElement, note: ExerciseRenameWorkoutNotePlan): void {
    const tr = table.createEl('tr')
    tr.createEl('td', { text: note.path })
    tr.createEl('td', { text: String(note.headingOccurrences + note.fieldOccurrences) })
    tr.createEl('td', { text: note.staleOccurrences > 0 ? String(note.staleOccurrences) : '' })
  }

  private renderAliasSummary(contentEl: HTMLElement, plan: ExerciseRenamePlan): void {
    contentEl.createEl('h3', { text: 'Alias' })
    if (plan.aliasesToKeep.includes(plan.oldName)) {
      contentEl.createEl('p', {
        text: `'${plan.oldName}' will be kept as an alias of '${plan.newName}', so existing references still resolve.`,
      })
    } else {
      contentEl.createEl('p', {
        text: `'${plan.newName}' and '${plan.oldName}' differ only by case, so no separate alias is needed.`,
      })
    }
    const others = plan.aliasesToKeep.filter((alias) => alias !== plan.oldName)
    if (others.length > 0) {
      contentEl.createEl('p', {
        cls: 'fitkit-import-muted',
        text: `Other aliases carried over: ${others.join(', ')}.`,
      })
    }
  }

  private renderStaleSummary(contentEl: HTMLElement, plan: ExerciseRenamePlan): void {
    contentEl.createEl('h3', { text: 'Left stale' })
    if (plan.totalStaleOccurrences === 0) {
      contentEl.createEl('p', { text: 'No references will be left stale.' })
      return
    }
    contentEl.createEl('p', {
      cls: 'fitkit-warn',
      text: `${plan.totalStaleOccurrences} reference(s) use a pathed or aliased wikilink (for example '[[Folder/${plan.oldName}]]' or '[[${plan.oldName}|Display]]') and will not be rewritten here. Obsidian's own link updater may fix these when the note file is renamed; check them if not.`,
    })
  }

  private renderMergeWarning(contentEl: HTMLElement, plan: ExerciseRenamePlan): void {
    contentEl.createEl('h3', { text: 'Merge' })
    if (!plan.sourceNotePath || !plan.targetNoteExists) {
      contentEl.createEl('p', {
        cls: 'fitkit-warn',
        text: `'${plan.newName}' has no exercise note yet, so this merge only combines registry entries; no note file is removed.`,
      })
      return
    }
    contentEl.createEl('p', {
      cls: 'fitkit-warn',
      text: plan.losingNoteHasProse
        ? `'${plan.sourceNotePath}' will be removed. Its Notes section has text, which will be copied into '${plan.targetNotePath}' under a 'Merged from ${plan.oldName}' heading first.`
        : `'${plan.sourceNotePath}' will be removed. Its Notes section has no text to carry over.`,
    })
  }

  private async handleConfirm(): Promise<void> {
    if (!this.plan || this.plan.refusal) {
      return
    }
    const plan = this.plan
    this.applying = true
    this.render()
    try {
      const result = await applyExerciseRenamePlan(this.plugin.app, this.plugin.settings, plan)
      await this.plugin.saveSettings()
      /**
       * Routed through the plugin's own queue (not a raw `cachedIndex`
       * assignment) so this can't clobber a concurrent `refreshIndexEntry`
       * call for an unrelated workout note; see `touchedWorkoutPaths` doc
       * on `ExerciseRenameApplyResult`.
       */
      for (const path of result.touchedWorkoutPaths) {
        await this.plugin.refreshIndexEntry(path)
      }
      this.applying = false
      if (result.failures.length > 0) {
        this.applyWarning = describeRenameApplyFailures(result.failures)
        await this.computePreview()
        return
      }
      new Notice(describeRenameApplySuccess(plan, result))
      this.options.onApplied?.()
      this.close()
    } catch (error) {
      this.applying = false
      this.applyWarning = `Could not apply the rename: ${formatErrorMessage(error)}. The modal stayed open so you can retry.`
      this.render()
    }
  }
}
