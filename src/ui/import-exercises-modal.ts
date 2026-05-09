import { Modal, Notice } from 'obsidian'

import { formatErrorMessage } from '../domain/error'
import type FitKitPlugin from '../main'
import {
  ExerciseImportApplyError,
  applyExerciseImportPlan,
  buildExerciseImportPlan,
  type ExerciseImportPlanRow,
} from '../vault/exercise-import-planner'

export interface ImportExercisesModalOptions {
  title?: string
  description?: string
  onApplied?: () => void
}

export class ImportExercisesModal extends Modal {
  private rows: ExerciseImportPlanRow[] = []
  private applyWarning: string | null = null

  constructor(
    private plugin: FitKitPlugin,
    private options: ImportExercisesModalOptions,
  ) {
    super(plugin.app)
  }

  onOpen(): void {
    this.contentEl.empty()
    this.contentEl.addClass('fitkit-import-modal')
    this.contentEl.createEl('h2', { text: this.options.title ?? 'Import exercises' })
    this.contentEl.createEl('p', {
      text:
        this.options.description ??
        'Review exercise names found in workout notes and choose which exercise notes or no-note registry entries to create.',
      cls: 'fitkit-import-muted',
    })
    this.contentEl.createEl('div', {
      text: 'Loading exercises...',
      cls: 'fitkit-import-muted',
    })
    void this.load()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private async load(): Promise<void> {
    try {
      const plan = await buildExerciseImportPlan(this.plugin.app, this.plugin.settings)
      this.rows = plan.rows
      this.applyWarning = null
      this.render()
    } catch (error) {
      this.rows = []
      this.renderError(`Could not load exercises: ${formatErrorMessage(error)}.`)
    }
  }

  private render(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('fitkit-import-modal')
    contentEl.createEl('h2', { text: this.options.title ?? 'Import exercises' })
    contentEl.createEl('p', {
      text:
        this.options.description ??
        'Review exercise names found in workout notes and choose which exercise notes or no-note registry entries to create.',
      cls: 'fitkit-import-muted',
    })
    if (this.applyWarning) {
      contentEl.createEl('div', { text: this.applyWarning, cls: 'fitkit-warn' })
    }

    if (this.rows.length === 0) {
      contentEl.createEl('div', {
        text: 'No exercises found.',
        cls: 'fitkit-import-muted',
      })
    } else {
      const table = contentEl.createEl('table', { cls: 'fitkit-import-table' })
      const thead = table.createEl('thead')
      const header = thead.createEl('tr')
      header.createEl('th', { text: 'Exercise' })
      header.createEl('th', { text: 'Kind' })
      header.createEl('th', { text: 'Registry' })
      header.createEl('th', { text: 'Note file' })
      header.createEl('th', { text: 'Actions' })
      const tbody = table.createEl('tbody')
      for (const row of this.rows) {
        this.renderRow(tbody, row)
      }
    }

    const actions = contentEl.createDiv({ cls: 'fitkit-import-actions' })
    const cancel = actions.createEl('button', { text: 'Cancel', cls: 'fitkit-btn' })
    cancel.addEventListener('click', () => this.close())
    const apply = actions.createEl('button', {
      text: 'Apply',
      cls: 'fitkit-btn fitkit-btn-primary',
    })
    apply.addEventListener('click', () => void this.handleApply())
  }

  private renderRow(table: HTMLElement, row: ExerciseImportPlanRow): void {
    const tr = table.createEl('tr')
    this.createLabeledCell(tr, 'Exercise').createSpan({ text: row.name })
    this.renderKindCell(tr, row)
    this.renderRegistryCell(tr, row)
    this.renderNoteCell(tr, row)
    this.renderActionsCell(tr, row)
  }

  private renderKindCell(tr: HTMLElement, row: ExerciseImportPlanRow): void {
    const kindCell = this.createLabeledCell(tr, 'Kind')
    if (row.status === 'known' && !row.createNoNoteEntry) {
      kindCell.createSpan({ text: row.kind })
      return
    }
    const select = kindCell.createEl('select', { cls: 'fitkit-import-select' })
    select.setAttr('aria-label', `Kind for ${row.name}`)
    select.createEl('option', { value: 'strength', text: 'Strength' })
    select.createEl('option', { value: 'duration', text: 'Duration' })
    select.value = row.kind
    select.addEventListener('change', () => {
      row.kind = select.value === 'duration' ? 'duration' : 'strength'
    })
  }

  private renderRegistryCell(tr: HTMLElement, row: ExerciseImportPlanRow): void {
    const regCell = this.createLabeledCell(tr, 'Registry')
    if (row.status === 'ignored') {
      regCell.createSpan({ text: 'Ignored' })
      regCell.addClass('fitkit-import-status-unknown')
      return
    }
    if (row.registryName) {
      regCell.createSpan({
        text: row.registryName === row.name ? 'Matched' : `Matched ${row.registryName}`,
      })
      regCell.addClass('fitkit-import-status-match')
      return
    }
    regCell.createSpan({ text: 'Missing' })
    regCell.addClass('fitkit-import-status-unknown')
  }

  private renderNoteCell(tr: HTMLElement, row: ExerciseImportPlanRow): void {
    const noteCell = this.createLabeledCell(tr, 'Note file')
    if (row.noteExists) {
      noteCell.createSpan({ text: 'Exists' })
      noteCell.addClass('fitkit-import-status-match')
      return
    }
    noteCell.createSpan({ text: 'Missing' })
    noteCell.addClass('fitkit-import-status-unknown')
  }

  private renderActionsCell(tr: HTMLElement, row: ExerciseImportPlanRow): void {
    const actionCell = this.createLabeledCell(tr, 'Actions')
    this.renderActionsCellContent(actionCell, row)
  }

  private renderActionsCellContent(actionCell: HTMLElement, row: ExerciseImportPlanRow): void {
    const label = actionCell.dataset.label
    actionCell.empty()
    if (label) {
      actionCell.createSpan({ text: label, cls: 'fitkit-import-cell-label' })
    }

    if (row.status === 'known' && row.noteExists) {
      actionCell.createSpan({ text: 'No action' })
      return
    }

    if (row.status === 'ignored') {
      this.renderCheckbox(actionCell, 'Restore', row.restoreIgnored, (checked) => {
        row.restoreIgnored = checked
        if (checked && !row.noteExists && !row.registryName) {
          row.createNote = true
        } else if (!checked) {
          row.createNote = false
          row.createNoNoteEntry = false
        }
        this.renderActionsCellContent(actionCell, row)
      })
      if (!row.restoreIgnored) {
        return
      }
    }

    if (!row.noteExists) {
      this.renderCheckbox(actionCell, 'Create note', row.createNote, (checked) => {
        row.createNote = checked
        if (checked) {
          row.createNoNoteEntry = false
        }
        this.renderActionsCellContent(actionCell, row)
      })
    }

    if (!row.registryName) {
      this.renderCheckbox(actionCell, 'No-note entry', row.createNoNoteEntry, (checked) => {
        row.createNoNoteEntry = checked
        if (checked) {
          row.createNote = false
        }
        this.renderActionsCellContent(actionCell, row)
      })
    }
  }

  private renderCheckbox(
    parent: HTMLElement,
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ): void {
    const wrapper = parent.createEl('label', { cls: 'fitkit-import-checkbox-row' })
    const checkbox = wrapper.createEl('input', { attr: { type: 'checkbox' } })
    checkbox.checked = checked
    checkbox.addEventListener('change', () => onChange(checkbox.checked))
    wrapper.createSpan({ text: label })
  }

  private createLabeledCell(tr: HTMLElement, label: string): HTMLElement {
    const cell = tr.createEl('td')
    cell.setAttr('data-label', label)
    cell.createSpan({ text: label, cls: 'fitkit-import-cell-label' })
    return cell
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
        this.render()
        new Notice(
          `Could not apply exercise import: ${formatErrorMessage(error.originalError)}. Review the warning in the import modal before retrying.`,
        )
        return
      }
      this.applyWarning =
        'Import failed before settings were saved. The modal stayed open so you can review selections before applying again.'
      this.render()
      new Notice(`Could not apply exercise import: ${formatErrorMessage(error)}.`)
    }
  }

  private renderError(message: string): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('fitkit-import-modal')
    contentEl.createEl('h2', { text: this.options.title ?? 'Import exercises' })
    contentEl.createEl('div', { text: message, cls: 'fitkit-warn' })
    const actions = contentEl.createDiv({ cls: 'fitkit-import-actions' })
    const close = actions.createEl('button', { text: 'Close', cls: 'fitkit-btn' })
    close.addEventListener('click', () => this.close())
  }
}
