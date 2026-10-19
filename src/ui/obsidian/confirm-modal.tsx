import { Modal, type App } from 'obsidian'
import { render } from 'preact'

import { ConfirmBody } from '../components/confirm-body'

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
    contentEl.addClass('fitkit-kind-confirm-modal')
    this.setTitle(this.options.title)
    render(
      <ConfirmBody
        message={this.options.message}
        confirmText={this.options.confirmText}
        cancelText={this.options.cancelText}
        onChoose={this.finish}
      />,
      contentEl,
    )
  }

  onClose(): void {
    this.resolve(false)
    render(null, this.contentEl)
  }

  private finish = (confirmed: boolean): void => {
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
