import { Modal, Notice } from 'obsidian'
import { render } from 'preact'

import { formatErrorMessage } from '../../domain/error'
import type { ExerciseRenamePlan } from '../../domain/exercise-rename-planner'
import type FitKitPlugin from '../../main'
import { RenameBody, type RenamePhase } from '../components/rename-body'
import {
  applyExerciseRenamePlan,
  buildExerciseRenamePlanFromVault,
  type ExerciseRenameApplyFailure,
  type ExerciseRenameApplyResult,
} from '../../vault/exercise-rename-apply'

export interface ExerciseRenameModalOptions {
  oldName: string
  onApplied?: () => void
}

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
  private phase: RenamePhase = 'input'
  private inputError: string | null = null
  private plan: ExerciseRenamePlan | null = null
  private applyWarning: string | null = null
  private applying = false
  private closed = false

  constructor(
    private plugin: FitKitPlugin,
    private options: ExerciseRenameModalOptions,
  ) {
    super(plugin.app)
    this.newName = options.oldName
  }

  onOpen(): void {
    this.contentEl.addClass('fitkit-import-modal')
    this.setTitle('Rename exercise')
    this.draw()
  }

  onClose(): void {
    this.closed = true
    render(null, this.contentEl)
  }

  private draw(): void {
    if (this.closed) {
      return
    }
    render(
      <RenameBody
        oldName={this.options.oldName}
        phase={this.phase}
        newName={this.newName}
        inputError={this.inputError}
        plan={this.plan}
        applyWarning={this.applyWarning}
        applying={this.applying}
        onNameInput={this.setNewName}
        onPreview={this.preview}
        onBack={this.back}
        onCancel={this.cancel}
        onConfirm={this.confirm}
      />,
      this.contentEl,
    )
  }

  private setNewName = (value: string): void => {
    this.newName = value
  }

  private cancel = (): void => this.close()

  private back = (): void => {
    this.phase = 'input'
    this.draw()
  }

  private preview = (): void => void this.computePreview()

  private confirm = (): void => void this.handleConfirm()

  private async computePreview(): Promise<void> {
    this.phase = 'loading'
    this.inputError = null
    this.draw()
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
    this.draw()
  }

  private async handleConfirm(): Promise<void> {
    if (!this.plan || this.plan.refusal) {
      return
    }
    const plan = this.plan
    this.applying = true
    this.draw()
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
      this.draw()
    }
  }
}
