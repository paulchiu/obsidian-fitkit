import type { JSX } from 'preact'

import type { SyncRepairOutcome, SyncRepairPreview, SyncRepairStep } from '../../domain/sync-repair'
import { SYNC_REPAIR_STEP_NAMES, syncRepairRows } from '../model/sync-repair-rows'
import { ButtonRow } from './action-bar'

export type SyncRepairPhase =
  | { kind: 'scanning' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; preview: SyncRepairPreview; selected: readonly SyncRepairStep[] }
  | { kind: 'applying'; preview: SyncRepairPreview; selected: readonly SyncRepairStep[] }
  | { kind: 'done'; outcome: SyncRepairOutcome }

export interface SyncRepairBodyProps {
  phase: SyncRepairPhase
  onToggle: (step: SyncRepairStep, checked: boolean) => void
  onApply: () => void
  onClose: () => void
  onShowParseDiagnostics: () => void
  onShowRegistryDiagnostics: () => void
}

/** The sync and repair modal's body: the scan, the steps to tick, then each step's result. */
export function SyncRepairBody(props: SyncRepairBodyProps): JSX.Element {
  const { phase, onClose } = props
  switch (phase.kind) {
    case 'scanning':
      return <p class="fitkit-import-muted">Scanning workouts and exercise notes...</p>
    case 'failed':
      return (
        <>
          <div class="fitkit-warn">{phase.message}</div>
          <ButtonRow>
            <button class="fitkit-btn" onClick={onClose}>
              Close
            </button>
          </ButtonRow>
        </>
      )
    case 'ready':
    case 'applying':
      return <StepPicker {...props} phase={phase} />
    case 'done':
      return (
        <>
          <ul class="fitkit-sync-results">
            {phase.outcome.results.map((result) => (
              <li
                key={result.step}
                class={result.ok ? 'fitkit-sync-result' : 'fitkit-sync-result fitkit-warn'}
              >
                {result.ok
                  ? result.summary
                  : `${SYNC_REPAIR_STEP_NAMES[result.step]} failed: ${result.message}`}
              </li>
            ))}
          </ul>
          <DiagnosticsLinks {...props} diagnostics={phase.outcome.diagnostics} />
          <ButtonRow>
            <button class="fitkit-btn fitkit-btn-primary" onClick={onClose}>
              Done
            </button>
          </ButtonRow>
        </>
      )
  }
}

function StepPicker(
  props: SyncRepairBodyProps & { phase: Extract<SyncRepairPhase, { kind: 'ready' | 'applying' }> },
): JSX.Element {
  const { phase, onToggle, onApply, onClose } = props
  const { preview, selected } = phase
  const busy = phase.kind === 'applying'
  return (
    <>
      <p class="fitkit-import-muted">
        Scanned {preview.workoutCount} workouts and {preview.exerciseNoteCount} exercise notes.
        Nothing changes until you apply.
      </p>
      <DiagnosticsLinks {...props} diagnostics={preview.diagnostics} />
      <div class="fitkit-sync-steps">
        {syncRepairRows(preview).map((row) => (
          <label
            key={row.step}
            class={row.hasWork ? 'fitkit-sync-step' : 'fitkit-sync-step fitkit-sync-step-current'}
          >
            <input
              type="checkbox"
              checked={selected.includes(row.step)}
              disabled={busy}
              onChange={(event) => onToggle(row.step, event.currentTarget.checked)}
            />
            <span class="fitkit-sync-step-name">{row.name}</span>
            <span class="fitkit-sync-step-detail">{row.detail}</span>
          </label>
        ))}
      </div>
      <ButtonRow>
        <button class="fitkit-btn" onClick={onClose}>
          Cancel
        </button>
        <button
          class="fitkit-btn fitkit-btn-primary"
          disabled={busy || selected.length === 0}
          onClick={onApply}
        >
          {busy
            ? 'Applying...'
            : `Apply ${selected.length} ${selected.length === 1 ? 'step' : 'steps'}`}
        </button>
      </ButtonRow>
    </>
  )
}

function DiagnosticsLinks({
  diagnostics,
  onShowParseDiagnostics,
  onShowRegistryDiagnostics,
}: SyncRepairBodyProps & { diagnostics: SyncRepairOutcome['diagnostics'] }): JSX.Element | null {
  if (diagnostics.parse === 0 && diagnostics.registry === 0) {
    return null
  }
  return (
    <div class="fitkit-sync-diagnostics">
      {diagnostics.parse > 0 ? (
        <button class="fitkit-btn" onClick={onShowParseDiagnostics}>
          Parse diagnostics ({diagnostics.parse})
        </button>
      ) : null}
      {diagnostics.registry > 0 ? (
        <button class="fitkit-btn" onClick={onShowRegistryDiagnostics}>
          Registry diagnostics ({diagnostics.registry})
        </button>
      ) : null}
    </div>
  )
}
