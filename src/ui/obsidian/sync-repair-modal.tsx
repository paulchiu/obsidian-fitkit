import { Modal, type App } from 'obsidian'
import { render } from 'preact'

import { formatErrorMessage } from '../../domain/error'
import {
  SYNC_REPAIR_STEPS,
  defaultSyncRepairSelection,
  type SyncRepairOutcome,
  type SyncRepairPreview,
  type SyncRepairStep,
} from '../../domain/sync-repair'
import { SyncRepairBody, type SyncRepairPhase } from '../components/sync-repair-body'

/** What the modal needs from the plugin, so it holds no vault logic itself. */
export interface SyncRepairActions {
  preview: () => Promise<SyncRepairPreview>
  apply: (steps: readonly SyncRepairStep[]) => Promise<SyncRepairOutcome>
  showParseDiagnostics: () => void
  showRegistryDiagnostics: () => void
}

export class SyncRepairModal extends Modal {
  private phase: SyncRepairPhase = { kind: 'scanning' }
  private closed = false

  constructor(
    app: App,
    private readonly actions: SyncRepairActions,
  ) {
    super(app)
  }

  onOpen(): void {
    this.closed = false
    this.contentEl.addClass('fitkit-import-modal')
    this.setTitle('Sync and repair')
    this.draw()
    void this.scan()
  }

  onClose(): void {
    this.closed = true
    render(null, this.contentEl)
  }

  private draw(): void {
    if (this.closed) {
      return
    }
    render(
      <SyncRepairBody
        phase={this.phase}
        onToggle={this.toggle}
        onApply={() => void this.apply()}
        onClose={() => this.close()}
        onShowParseDiagnostics={this.actions.showParseDiagnostics}
        onShowRegistryDiagnostics={this.actions.showRegistryDiagnostics}
      />,
      this.contentEl,
    )
  }

  private async scan(): Promise<void> {
    try {
      const preview = await this.actions.preview()
      this.phase = { kind: 'ready', preview, selected: defaultSyncRepairSelection(preview) }
    } catch (error) {
      this.phase = {
        kind: 'failed',
        message: `Could not scan the vault: ${formatErrorMessage(error)}.`,
      }
    }
    this.draw()
  }

  private toggle = (step: SyncRepairStep, checked: boolean): void => {
    if (this.phase.kind !== 'ready') {
      return
    }
    const { selected } = this.phase
    this.phase = {
      ...this.phase,
      selected: SYNC_REPAIR_STEPS.filter((candidate) =>
        candidate === step ? checked : selected.includes(candidate),
      ),
    }
    this.draw()
  }

  private async apply(): Promise<void> {
    if (this.phase.kind !== 'ready') {
      return
    }
    const { selected } = this.phase
    this.phase = { ...this.phase, kind: 'applying' }
    this.draw()
    this.phase = { kind: 'done', outcome: await this.actions.apply(selected) }
    this.draw()
  }
}
