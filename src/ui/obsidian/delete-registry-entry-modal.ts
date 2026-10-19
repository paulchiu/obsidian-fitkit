import { Modal, type App } from 'obsidian'

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
    contentEl.empty()
    contentEl.addClass('fitkit-kind-confirm-modal')
    this.setTitle('Delete exercise?')
    contentEl.createEl('p', {
      text: `Remove the registry overlay for '${this.options.entryName}'? Existing workout history is not rewritten.`,
    })

    if (this.options.notePath) {
      contentEl.createEl('p', {
        text: 'The exercise note will stay in your vault unless you choose to delete it too.',
        cls: 'fitkit-import-muted',
      })
      const row = contentEl.createDiv({ cls: 'fitkit-import-checkbox-row' })
      const checkbox = row.createEl('input', { type: 'checkbox' })
      checkbox.id = 'fitkit-delete-also-file'
      checkbox.checked = this.alsoDeleteFile
      checkbox.addEventListener('change', () => {
        this.alsoDeleteFile = checkbox.checked
      })
      const label = row.createEl('label', {
        text: `Also delete the exercise note '${this.options.notePath}' and ignore this exercise until restored.`,
      })
      label.setAttr('for', 'fitkit-delete-also-file')
    } else {
      contentEl.createEl('p', {
        text: 'No matching exercise note exists in your exercises folder. This exercise will be removed from the registry.',
        cls: 'fitkit-import-muted',
      })
    }

    const actions = contentEl.createDiv({ cls: 'fitkit-confirm-actions' })
    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Cancel' })
    cancel.addEventListener('click', () => this.finish(false))
    const confirm = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-destructive-button',
      text: 'Delete',
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
    this.resolveChoice({
      confirmed,
      alsoDeleteFile: confirmed && this.alsoDeleteFile,
    })
  }
}
