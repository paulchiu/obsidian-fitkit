import { Modal, Notice } from 'obsidian'
import { render } from 'preact'

import { formatErrorMessage } from '../../domain/error'
import type FitKitPlugin from '../../main'
import {
  ExerciseImportApplyError,
  applyExerciseImportPlan,
  buildExerciseImportPlan,
  type ExerciseImportPlanRow,
} from '../../vault/exercise-import-planner'
import { ImportExercisesBody, type ImportPhase } from '../components/import-exercises-body'
import type { ImportRow } from '../model/import-rows'

export interface ImportExercisesModalOptions {
  title?: string
  description?: string
  onApplied?: () => void
}

const DEFAULT_DESCRIPTION =
  'Review exercise names found in workout notes and choose which exercise notes or no-note registry entries to create.'

export class ImportExercisesModal extends Modal {
  private rows: ExerciseImportPlanRow[] = []
  private phase: ImportPhase = 'loading'
  private errorMessage = ''
  private applyWarning: string | null = null
  private closed = false

  constructor(
    private plugin: FitKitPlugin,
    private options: ImportExercisesModalOptions,
  ) {
    super(plugin.app)
  }

  onOpen(): void {
    this.contentEl.addClass('fitkit-import-modal')
    this.setTitle(this.options.title ?? 'Import exercises')
    this.draw()
    void this.load()
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
      <ImportExercisesBody
        phase={this.phase}
        description={this.options.description ?? DEFAULT_DESCRIPTION}
        errorMessage={this.errorMessage}
        warning={this.applyWarning}
        rows={this.rows}
        onRowChange={this.changeRow}
        onApply={this.apply}
        onCancel={this.cancel}
      />,
      this.contentEl,
    )
  }

  private async load(): Promise<void> {
    try {
      const plan = await buildExerciseImportPlan(this.plugin.app, this.plugin.settings)
      this.rows = plan.rows
      this.applyWarning = null
      this.phase = 'ready'
    } catch (error) {
      this.rows = []
      this.errorMessage = `Could not load exercises: ${formatErrorMessage(error)}.`
      this.phase = 'error'
    }
    this.draw()
  }

  private cancel = (): void => this.close()

  private apply = (): void => void this.handleApply()

  /** Swaps in the edited row, keeping the planner's other fields it carries. */
  private changeRow = (index: number, next: ImportRow): void => {
    this.rows = this.rows.map((row, at) => (at === index ? { ...row, ...next } : row))
    this.draw()
  }

  private async handleApply(): Promise<void> {
    try {
      const result = await applyExerciseImportPlan(this.plugin.app, this.plugin.settings, this.rows)
      if (result.settingsChanged) {
        await this.plugin.saveSettings()
      }
      new Notice(
        `Created ${result.notesCreated} note file(s), ${result.registryEntriesCreated} no-note registry entry(ies), restored ${result.tombstonesRemoved} ignored exercise(s).`,
      )
      this.options.onApplied?.()
      this.close()
    } catch (error) {
      if (
        error instanceof ExerciseImportApplyError &&
        error.partialResult.notePathsCreated.length
      ) {
        this.applyWarning = `Import stopped before settings were saved. Created note file(s): ${error.partialResult.notePathsCreated.join(', ')}. The modal stayed open so you can review selections before applying again. Existing note files will not be recreated.`
        this.draw()
        new Notice(
          `Could not apply exercise import: ${formatErrorMessage(error.originalError)}. Review the warning in the import modal before retrying.`,
        )
        return
      }
      this.applyWarning =
        'Import failed before settings were saved. The modal stayed open so you can review selections before applying again.'
      this.draw()
      new Notice(`Could not apply exercise import: ${formatErrorMessage(error)}.`)
    }
  }
}
