import { describe, expect, it } from 'vitest'

import { defaultSyncRepairSelection, type SyncRepairPreview } from '../../src/domain/sync-repair'

const upToDate: SyncRepairPreview = {
  workoutCount: 12,
  exerciseNoteCount: 4,
  registry: { toAdd: 0, fromNotes: 0, fromHistory: 0 },
  notes: { toUpdate: 0, current: 4, skipped: 0 },
  hiddenSections: 0,
  dashboard: { sectionCount: 4, changed: false },
  diagnostics: { parse: 0, registry: 0 },
}

describe('defaultSyncRepairSelection', () => {
  it('ticks nothing when every step is up to date', () => {
    expect(defaultSyncRepairSelection(upToDate)).toEqual([])
  })

  it('ticks only the steps with changes, in run order', () => {
    expect(
      defaultSyncRepairSelection({
        ...upToDate,
        dashboard: { sectionCount: 4, changed: true },
        registry: { toAdd: 2, fromNotes: 1, fromHistory: 1 },
      }),
    ).toEqual(['registry', 'dashboard'])
  })

  it('ticks notes to update and hidden sections to restore', () => {
    expect(
      defaultSyncRepairSelection({
        ...upToDate,
        notes: { toUpdate: 3, current: 1, skipped: 0 },
        hiddenSections: 2,
      }),
    ).toEqual(['notes', 'hidden-sections'])
  })
})
