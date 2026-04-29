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
    contentEl.createEl('h2', { text: 'Delete entry?' })
    contentEl.createEl('p', {
      text: `Delete '${this.options.entryName}' from the registry? Existing workouts that reference it will resolve as Unknown until you re-add the entry.`,
    })

    if (this.options.notePath) {
      const row = contentEl.createDiv({ cls: 'fitkit-import-checkbox-row' })
      const checkbox = row.createEl('input', { type: 'checkbox' })
      checkbox.id = 'fitkit-delete-also-file'
      checkbox.checked = this.alsoDeleteFile
      checkbox.addEventListener('change', () => {
        this.alsoDeleteFile = checkbox.checked
      })
      const label = row.createEl('label', {
        text: `Also delete the note file '${this.options.notePath}' (sent to your configured trash).`,
      })
      label.setAttr('for', 'fitkit-delete-also-file')
    } else {
      contentEl.createEl('p', {
        text: 'No matching note file exists in your exercises folder; only the registry entry will be removed.',
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
