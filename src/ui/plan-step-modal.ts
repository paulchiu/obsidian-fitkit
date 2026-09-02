import { Modal, type App } from 'obsidian'

export interface PlanStepModalOptions {
  title: string
  initial: string
  onSave: (next: number | undefined) => void
}

/**
 * Prompt for the weight change on a `[next:: ...]` plan. A blank or unusable
 * entry clears the step, leaving the direction on its own.
 */
export class PlanStepModal extends Modal {
  private settled = false

  constructor(
    app: App,
    private options: PlanStepModalOptions,
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
      text: 'Weight change',
      attr: { for: 'fitkit-plan-step-input' },
    })
    const input = field.createEl('input', {
      cls: 'fitkit-input',
      attr: {
        id: 'fitkit-plan-step-input',
        type: 'text',
        inputmode: 'decimal',
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- Unit symbols use lowercase labels.
        placeholder: 'kg',
      },
    })
    input.value = this.options.initial

    const actions = contentEl.createDiv({ cls: 'fitkit-confirm-actions fitkit-set-note-actions' })
    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Cancel' })
    cancel.addEventListener('click', () => this.close())
    const save = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-primary',
      text: 'Save',
    })
    save.addEventListener('click', () => this.commit(input.value))
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') {
        evt.preventDefault()
        this.commit(input.value)
      }
    })

    activeWindow.setTimeout(() => {
      input.focus()
      input.select()
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
    const step = Number(raw.trim())
    this.options.onSave(Number.isFinite(step) && step > 0 ? step : undefined)
    this.close()
  }
}
