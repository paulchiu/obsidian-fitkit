import { Modal, type App } from 'obsidian'

export interface SetNoteModalOptions {
  title: string
  initial: string
  onSave: (next: string | undefined) => void
}

export class SetNoteModal extends Modal {
  private settled = false

  constructor(
    app: App,
    private options: SetNoteModalOptions,
  ) {
    super(app)
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    this.modalEl.addClass('fitkit-set-note-modal-shell')
    contentEl.addClass('fitkit-set-note-modal')
    this.setTitle(this.options.title)

    const field = contentEl.createDiv({ cls: 'fitkit-set-note-field' })
    field.createEl('label', {
      cls: 'fitkit-label',
      text: 'Note',
      attr: { for: 'fitkit-set-note-textarea' },
    })
    const textarea = field.createEl('textarea', {
      cls: 'fitkit-textarea fitkit-set-note-textarea',
      attr: { id: 'fitkit-set-note-textarea', rows: '4' },
    })
    textarea.value = this.options.initial

    const actions = contentEl.createDiv({ cls: 'fitkit-confirm-actions fitkit-set-note-actions' })
    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Cancel' })
    cancel.addEventListener('click', () => this.close())
    const save = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-primary',
      text: 'Save',
    })
    save.addEventListener('click', () => this.commit(textarea.value))

    activeWindow.setTimeout(() => {
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

  private commit(raw: string): void {
    if (this.settled) {
      return
    }
    this.settled = true
    const trimmed = raw.trim()
    this.options.onSave(trimmed.length > 0 ? raw : undefined)
    this.close()
  }
}
