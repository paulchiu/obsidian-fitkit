import { Modal, type App } from 'obsidian'

interface DiagnosticsModalItem {
  path?: string
  name?: string
  warnings: readonly string[]
}

export class ParseDiagnosticsModal extends Modal {
  private readonly diagnostics: readonly DiagnosticsModalItem[]

  constructor(
    app: App,
    diagnostics: readonly DiagnosticsModalItem[],
    private title = 'Parse diagnostics',
  ) {
    super(app)
    this.diagnostics = diagnostics
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: this.title })

    for (const diagnostic of this.diagnostics) {
      contentEl.createEl('h3', { text: diagnostic.path ?? diagnostic.name ?? 'Registry' })
      const list = contentEl.createEl('ul')
      for (const warning of diagnostic.warnings) {
        list.createEl('li', { text: warning })
      }
    }
  }
}
