export type SyncRepairStep = 'registry' | 'notes' | 'hidden-sections' | 'dashboard'

/** Sync reads the registry and the dashboard reads everything, so this order is load-bearing. */
export const SYNC_REPAIR_STEPS: readonly SyncRepairStep[] = [
  'registry',
  'notes',
  'hidden-sections',
  'dashboard',
]

/** What a read-only scan found each step would change. */
export interface SyncRepairPreview {
  workoutCount: number
  exerciseNoteCount: number
  registry: { toAdd: number; fromNotes: number; fromHistory: number }
  notes: { toUpdate: number; current: number; skipped: number }
  hiddenSections: number
  dashboard: { sectionCount: number; changed: boolean }
  diagnostics: { parse: number; registry: number }
}

export function stepHasWork(preview: SyncRepairPreview, step: SyncRepairStep): boolean {
  switch (step) {
    case 'registry':
      return preview.registry.toAdd > 0
    case 'notes':
      return preview.notes.toUpdate > 0
    case 'hidden-sections':
      return preview.hiddenSections > 0
    case 'dashboard':
      return preview.dashboard.changed
  }
}

/** Ticks only the steps the scan found work for, so the preview decides rather than habit. */
export function defaultSyncRepairSelection(preview: SyncRepairPreview): SyncRepairStep[] {
  return SYNC_REPAIR_STEPS.filter((step) => stepHasWork(preview, step))
}

export type SyncRepairResult =
  | { step: SyncRepairStep; ok: true; summary: string }
  | { step: SyncRepairStep; ok: false; message: string }

export interface SyncRepairOutcome {
  results: SyncRepairResult[]
  diagnostics: SyncRepairPreview['diagnostics']
}
