import { Modal, type App } from 'obsidian'
import { render } from 'preact'

import { ParseDiagnosticsBody, type DiagnosticsItem } from '../components/parse-diagnostics-body'

export class ParseDiagnosticsModal extends Modal {
  private readonly diagnostics: readonly DiagnosticsItem[]

  constructor(
    app: App,
    diagnostics: readonly DiagnosticsItem[],
    private title = 'Parse diagnostics',
  ) {
    super(app)
    this.diagnostics = diagnostics
  }

  onOpen(): void {
    this.setTitle(this.title)
    render(<ParseDiagnosticsBody diagnostics={this.diagnostics} />, this.contentEl)
  }

  onClose(): void {
    render(null, this.contentEl)
  }
}
