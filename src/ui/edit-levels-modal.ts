import { Modal, Notice, type App } from 'obsidian'

import { parseBodyweightLadderText } from '../domain/bodyweight-levels'

export interface EditLevelsModalOptions {
  exerciseName: string
  initial: string[]
  onSave: (levels: string[]) => void
}

export class EditLevelsModal extends Modal {
  private settled = false

  constructor(
    app: App,
    private options: EditLevelsModalOptions,
  ) {
    super(app)
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    this.modalEl.addClass('fitkit-set-note-modal-shell')
    contentEl.addClass('fitkit-set-note-modal')
    this.setTitle(`Edit levels for ${this.options.exerciseName}`)

    const field = contentEl.createDiv({ cls: 'fitkit-set-note-field' })
    field.createEl('label', {
      cls: 'fitkit-label',
      text: 'Levels, one per line',
      attr: { for: 'fitkit-edit-levels-textarea' },
    })
    const textarea = field.createEl('textarea', {
      cls: 'fitkit-textarea fitkit-set-note-textarea',
      attr: { id: 'fitkit-edit-levels-textarea', rows: '6' },
    })
    textarea.value = this.options.initial.join('\n')

    const actions = contentEl.createDiv({ cls: 'fitkit-confirm-actions fitkit-set-note-actions' })
    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Cancel' })
    cancel.addEventListener('click', () => this.close())
    const save = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-primary',
      text: 'Save',
    })
    save.addEventListener('click', () => this.commit(textarea.value))

    window.setTimeout(() => {
      textarea.focus()
      const length = textarea.value.length
      textarea.setSelectionRange(length, length)
    }, 0)
  }

  onClose(): void {
    this.modalEl.removeClass('fitkit-set-note-modal-shell')
    this.contentEl.empty()
    this.settled = true
  }

  /**
   * An empty ladder names no rung, so the save is refused with the modal left
   * open rather than persisted and repaired later.
   */
  private commit(raw: string): void {
    const levels = parseBodyweightLadderText(raw)
    if (levels.length === 0) {
      new Notice('Enter at least one level.')
      return
    }
    if (this.settled) {
      return
    }
    this.settled = true
    this.options.onSave(levels)
    this.close()
  }
}
