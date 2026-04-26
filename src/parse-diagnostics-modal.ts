import { Modal, type App } from 'obsidian'

import type { IndexDiagnostic } from './domain/types'

export class ParseDiagnosticsModal extends Modal {
  private readonly diagnostics: IndexDiagnostic[]

  constructor(app: App, diagnostics: IndexDiagnostic[]) {
    super(app)
    this.diagnostics = diagnostics
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: 'Parse diagnostics' })

    for (const diagnostic of this.diagnostics) {
      contentEl.createEl('h3', { text: diagnostic.path })
      const list = contentEl.createEl('ul')
      for (const warning of diagnostic.warnings) {
        list.createEl('li', { text: warning })
      }
    }
  }
}
