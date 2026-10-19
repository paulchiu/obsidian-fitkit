import { Modal, Notice, type App } from 'obsidian'
import { render } from 'preact'

import { parseBodyweightLadderText } from '../../domain/bodyweight-levels'
import { TextAreaForm } from '../components/text-area-form'
import { focusTextAreaAtEnd } from './text-area-focus'

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
    this.modalEl.addClass('fitkit-set-note-modal-shell')
    contentEl.addClass('fitkit-set-note-modal')
    this.setTitle(`Edit levels for ${this.options.exerciseName}`)

    render(
      <TextAreaForm
        label="Levels, one per line"
        id="fitkit-edit-levels-textarea"
        rows={6}
        initial={this.options.initial.join('\n')}
        onSave={this.commit}
        onCancel={this.cancel}
        onFilled={focusTextAreaAtEnd}
      />,
      contentEl,
    )
  }

  onClose(): void {
    this.modalEl.removeClass('fitkit-set-note-modal-shell')
    render(null, this.contentEl)
    this.settled = true
  }

  private cancel = (): void => this.close()

  /**
   * An empty ladder names no rung, so the save is refused with the modal left
   * open rather than persisted and repaired later.
   */
  private commit = (raw: string): void => {
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
