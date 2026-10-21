import {
  SYNC_REPAIR_STEPS,
  stepHasWork,
  type SyncRepairPreview,
  type SyncRepairStep,
} from '../../domain/sync-repair'

export interface SyncRepairRow {
  step: SyncRepairStep
  name: string
  detail: string
  hasWork: boolean
}

export const SYNC_REPAIR_STEP_NAMES: Record<SyncRepairStep, string> = {
  registry: 'Rebuild registry',
  notes: 'Sync exercise notes',
  'hidden-sections': 'Restore hidden dashboard sections',
  dashboard: 'Rebuild dashboard',
}

const sections = (count: number): string => `${count} section${count === 1 ? '' : 's'}`

function stepDetail(preview: SyncRepairPreview, step: SyncRepairStep): string {
  switch (step) {
    case 'registry': {
      const { toAdd, fromNotes, fromHistory } = preview.registry
      return toAdd > 0
        ? `${toAdd} to add (${fromNotes} from notes, ${fromHistory} from history)`
        : 'Up to date: nothing to add'
    }
    case 'notes': {
      const { toUpdate, current, skipped } = preview.notes
      if (toUpdate === 0) {
        return `Up to date: ${current} already current`
      }
      return `${toUpdate} to update, ${current} already current, ${skipped} skipped`
    }
    case 'hidden-sections':
      return preview.hiddenSections > 0
        ? `${sections(preview.hiddenSections)} hidden to restore`
        : 'Up to date: none hidden'
    case 'dashboard':
      return preview.dashboard.changed
        ? `${sections(preview.dashboard.sectionCount)}, content has changed`
        : `Up to date: ${sections(preview.dashboard.sectionCount)}`
  }
}

/** One row per step in run order, saying what the scan found it would change. */
export function syncRepairRows(preview: SyncRepairPreview): SyncRepairRow[] {
  return SYNC_REPAIR_STEPS.map((step) => ({
    step,
    name: SYNC_REPAIR_STEP_NAMES[step],
    detail: stepDetail(preview, step),
    hasWork: stepHasWork(preview, step),
  }))
}
