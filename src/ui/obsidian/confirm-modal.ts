import { Modal, type App } from 'obsidian'

export interface ConfirmModalOptions {
  title: string
  message: string
  confirmText: string
  cancelText: string
}

export class ConfirmModal extends Modal {
  private settled = false

  constructor(
    app: App,
    private options: ConfirmModalOptions,
    private resolveChoice: (confirmed: boolean) => void,
  ) {
    super(app)
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('fitkit-kind-confirm-modal')
    this.setTitle(this.options.title)
    contentEl.createEl('p', { text: this.options.message })

    const actions = contentEl.createDiv({ cls: 'fitkit-confirm-actions' })
    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: this.options.cancelText })
    cancel.addEventListener('click', () => this.finish(false))
    const confirm = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-destructive-button',
      text: this.options.confirmText,
    })
    confirm.addEventListener('click', () => this.finish(true))
  }

  onClose(): void {
    this.resolve(false)
    this.contentEl.empty()
  }

  private finish(confirmed: boolean): void {
    this.resolve(confirmed)
    this.close()
  }

  private resolve(confirmed: boolean): void {
    if (this.settled) {
      return
    }
    this.settled = true
    this.resolveChoice(confirmed)
  }
}
