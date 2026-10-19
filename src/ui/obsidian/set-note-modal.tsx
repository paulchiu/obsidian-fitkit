import { Modal, type App } from 'obsidian'
import { render } from 'preact'

import { TextAreaForm } from '../components/text-area-form'
import { focusTextAreaAtEnd } from './text-area-focus'

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
    this.modalEl.addClass('fitkit-set-note-modal-shell')
    contentEl.addClass('fitkit-set-note-modal')
    this.setTitle(this.options.title)

    render(
      <TextAreaForm
        label="Note"
        id="fitkit-set-note-textarea"
        rows={4}
        initial={this.options.initial}
        onSave={this.commit}
        onCancel={this.cancel}
      />,
      contentEl,
    )
    focusTextAreaAtEnd(contentEl)
  }

  onClose(): void {
    this.modalEl.removeClass('fitkit-set-note-modal-shell')
    render(null, this.contentEl)
    this.settled = true
  }

  private cancel = (): void => this.close()

  private commit = (raw: string): void => {
    if (this.settled) {
      return
    }
    this.settled = true
    const trimmed = raw.trim()
    this.options.onSave(trimmed.length > 0 ? raw : undefined)
    this.close()
  }
}
