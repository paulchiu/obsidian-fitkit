import { Modal, type App } from 'obsidian'
import { render } from 'preact'

import { DeleteRegistryEntryBody } from '../components/delete-registry-entry'

export interface DeleteRegistryEntryModalOptions {
  entryName: string
  notePath: string | null
}

export interface DeleteRegistryEntryDecision {
  confirmed: boolean
  alsoDeleteFile: boolean
}

export class DeleteRegistryEntryModal extends Modal {
  private settled = false
  private alsoDeleteFile = false

  constructor(
    app: App,
    private options: DeleteRegistryEntryModalOptions,
    private resolveChoice: (decision: DeleteRegistryEntryDecision) => void,
  ) {
    super(app)
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.addClass('fitkit-kind-confirm-modal')
    this.setTitle('Delete exercise?')
    render(
      <DeleteRegistryEntryBody
        entryName={this.options.entryName}
        notePath={this.options.notePath}
        onToggleAlsoDeleteFile={this.setAlsoDeleteFile}
        onChoose={this.finish}
      />,
      contentEl,
    )
  }

  onClose(): void {
    this.resolve(false)
    render(null, this.contentEl)
  }

  private setAlsoDeleteFile = (checked: boolean): void => {
    this.alsoDeleteFile = checked
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
    this.resolveChoice({
      confirmed,
      alsoDeleteFile: confirmed && this.alsoDeleteFile,
    })
  }
}
