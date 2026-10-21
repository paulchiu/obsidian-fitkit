import { describe, expect, it } from 'vitest'

import type { SyncRepairPreview } from '../../../src/domain/sync-repair'
import { syncRepairRows } from '../../../src/ui/model/sync-repair-rows'

const preview: SyncRepairPreview = {
  workoutCount: 142,
  exerciseNoteCount: 38,
  registry: { toAdd: 4, fromNotes: 2, fromHistory: 2 },
  notes: { toUpdate: 7, current: 29, skipped: 2 },
  hiddenSections: 0,
  dashboard: { sectionCount: 24, changed: true },
  diagnostics: { parse: 3, registry: 1 },
}

describe('syncRepairRows', () => {
  it('describes each step in run order with what it would change', () => {
    expect(syncRepairRows(preview)).toEqual([
      {
        step: 'registry',
        name: 'Rebuild registry',
        detail: '4 to add (2 from notes, 2 from history)',
        hasWork: true,
      },
      {
        step: 'notes',
        name: 'Sync exercise notes',
        detail: '7 to update, 29 already current, 2 skipped',
        hasWork: true,
      },
      {
        step: 'hidden-sections',
        name: 'Restore hidden dashboard sections',
        detail: 'Up to date: none hidden',
        hasWork: false,
      },
      {
        step: 'dashboard',
        name: 'Rebuild dashboard',
        detail: '24 sections, content has changed',
        hasWork: true,
      },
    ])
  })

  it('marks steps with nothing to change as up to date', () => {
    const rows = syncRepairRows({
      ...preview,
      registry: { toAdd: 0, fromNotes: 0, fromHistory: 0 },
      notes: { toUpdate: 0, current: 38, skipped: 0 },
      hiddenSections: 3,
      dashboard: { sectionCount: 1, changed: false },
    })
    expect(rows.map((row) => row.detail)).toEqual([
      'Up to date: nothing to add',
      'Up to date: 38 already current',
      '3 sections hidden to restore',
      'Up to date: 1 section',
    ])
  })
})
