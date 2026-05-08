import { Modal, Notice } from 'obsidian'

import type FitKitPlugin from '../main'
import {
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

    if (this.rows.length === 0) {
      contentEl.createEl('div', {
        text: 'No exercises found.',
        cls: 'fitkit-import-muted',
      })
    } else {
      const table = contentEl.createEl('table', { cls: 'fitkit-import-table' })
      const header = table.createEl('tr')
      header.createEl('th', { text: 'Exercise' })
      header.createEl('th', { text: 'Kind' })
      header.createEl('th', { text: 'Registry' })
      header.createEl('th', { text: 'Note file' })
      header.createEl('th', { text: 'Actions' })
      for (const row of this.rows) {
        this.renderRow(table, row)
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
    tr.createEl('td', { text: row.name })
    this.renderKindCell(tr, row)
    this.renderRegistryCell(tr, row)
    this.renderNoteCell(tr, row)
    this.renderActionsCell(tr, row)
  }

  private renderKindCell(tr: HTMLElement, row: ExerciseImportPlanRow): void {
    const kindCell = tr.createEl('td')
    if (row.status === 'known' && !row.createNoNoteEntry) {
      kindCell.setText(row.kind)
      return
    }
    const select = kindCell.createEl('select', { cls: 'fitkit-import-select' })
    select.createEl('option', { value: 'strength', text: 'Strength' })
    select.createEl('option', { value: 'duration', text: 'Duration' })
    select.value = row.kind
    select.addEventListener('change', () => {
      row.kind = select.value === 'duration' ? 'duration' : 'strength'
    })
  }

  private renderRegistryCell(tr: HTMLElement, row: ExerciseImportPlanRow): void {
    const regCell = tr.createEl('td')
    if (row.status === 'ignored') {
      regCell.setText('Ignored')
      regCell.addClass('fitkit-import-status-unknown')
      return
    }
    if (row.registryName) {
      regCell.setText(row.registryName === row.name ? 'Matched' : `Matched ${row.registryName}`)
      regCell.addClass('fitkit-import-status-match')
      return
    }
    regCell.setText('Missing')
    regCell.addClass('fitkit-import-status-unknown')
  }

  private renderNoteCell(tr: HTMLElement, row: ExerciseImportPlanRow): void {
    const noteCell = tr.createEl('td')
    if (row.noteExists) {
      noteCell.setText('Exists')
      noteCell.addClass('fitkit-import-status-match')
      return
    }
    noteCell.setText('Missing')
    noteCell.addClass('fitkit-import-status-unknown')
  }

  private renderActionsCell(tr: HTMLElement, row: ExerciseImportPlanRow): void {
    const actionCell = tr.createEl('td')
    this.renderActionsCellContent(actionCell, row)
  }

  private renderActionsCellContent(actionCell: HTMLElement, row: ExerciseImportPlanRow): void {
    actionCell.empty()

    if (row.status === 'known') {
      actionCell.setText('No action')
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

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
