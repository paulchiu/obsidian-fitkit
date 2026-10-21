import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTestRoot, harnessDocument } from '../../harness/obsidian-dom'
import { findUnstyledClasses } from '../../harness/stylesheet'

vi.mock('obsidian', () => {
  class Modal {
    contentEl = createTestRoot()
    titleEl = createTestRoot()

    setTitle(title: string): this {
      this.titleEl.textContent = title
      return this
    }

    constructor(readonly app: unknown) {}

    open(): void {}

    close(): void {
      const maybeClosable = this as { onClose?: () => void }
      maybeClosable.onClose?.()
    }
  }

  return { Modal }
})

import type {
  SyncRepairOutcome,
  SyncRepairPreview,
  SyncRepairStep,
} from '../../../src/domain/sync-repair'
import { SyncRepairModal, type SyncRepairActions } from '../../../src/ui/obsidian/sync-repair-modal'

const preview: SyncRepairPreview = {
  workoutCount: 142,
  exerciseNoteCount: 38,
  registry: { toAdd: 4, fromNotes: 2, fromHistory: 2 },
  notes: { toUpdate: 7, current: 29, skipped: 2 },
  hiddenSections: 0,
  dashboard: { sectionCount: 24, changed: true },
  diagnostics: { parse: 3, registry: 0 },
}

interface FakeActions extends SyncRepairActions {
  applied: SyncRepairStep[][]
  shown: string[]
}

function fakeActions(
  outcome: SyncRepairOutcome = { results: [], diagnostics: { parse: 0, registry: 0 } },
  scan: () => Promise<SyncRepairPreview> = async () => preview,
): FakeActions {
  const applied: SyncRepairStep[][] = []
  const shown: string[] = []
  return {
    applied,
    shown,
    preview: scan,
    apply: async (steps) => {
      applied.push([...steps])
      return outcome
    },
    showParseDiagnostics: () => shown.push('parse'),
    showRegistryDiagnostics: () => shown.push('registry'),
  }
}

async function openModal(actions: SyncRepairActions): Promise<SyncRepairModal> {
  const modal = new SyncRepairModal({} as never, actions)
  harnessDocument.body.appendChild(modal.contentEl)
  modal.onOpen()
  await vi.waitFor(() => {
    if (!modal.contentEl.querySelector('input[type="checkbox"], .fitkit-warn')) {
      throw new Error('Waiting for the scan to render.')
    }
  })
  return modal
}

function stepRows(modal: SyncRepairModal): Array<{ text: string; checked: boolean }> {
  return [...modal.contentEl.querySelectorAll('label.fitkit-sync-step')].map((label) => ({
    text: label.textContent ?? '',
    checked: label.querySelector('input')?.checked ?? false,
  }))
}

function button(modal: SyncRepairModal, text: string): HTMLButtonElement {
  const match = [...modal.contentEl.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.startsWith(text),
  )
  if (!match) {
    throw new Error(`Expected a "${text}" button.`)
  }
  return match
}

describe('sync and repair modal', () => {
  afterEach(() => {
    harnessDocument.body.replaceChildren()
  })

  it('lists every step in run order, ticking only those with changes', async () => {
    const modal = await openModal(fakeActions())

    expect(modal.titleEl.textContent).toBe('Sync and repair')
    expect(stepRows(modal)).toEqual([
      { text: 'Rebuild registry4 to add (2 from notes, 2 from history)', checked: true },
      { text: 'Sync exercise notes7 to update, 29 already current, 2 skipped', checked: true },
      { text: 'Restore hidden dashboard sectionsUp to date: none hidden', checked: false },
      { text: 'Rebuild dashboard24 sections, content has changed', checked: true },
    ])
    expect(button(modal, 'Apply').textContent).toBe('Apply 3 steps')
    expect(findUnstyledClasses(modal.contentEl)).toEqual([])
  })

  it('applies the steps left ticked and shows each result', async () => {
    const actions = fakeActions({
      results: [
        { step: 'registry', ok: true, summary: 'Rebuilt registry: 4 added.' },
        { step: 'dashboard', ok: false, message: 'disk full' },
      ],
      diagnostics: { parse: 0, registry: 1 },
    })
    const modal = await openModal(actions)
    modal.contentEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!.click()

    button(modal, 'Apply').click()
    await vi.waitFor(() => {
      if (!modal.contentEl.querySelector('.fitkit-sync-result')) {
        throw new Error('Waiting for the results to render.')
      }
    })

    expect(actions.applied).toEqual([['registry', 'dashboard']])
    expect(
      [...modal.contentEl.querySelectorAll('.fitkit-sync-result')].map((row) => row.textContent),
    ).toEqual([
      'Rebuild registry: Rebuilt registry: 4 added.',
      'Rebuild dashboard failed: disk full',
    ])
    expect(findUnstyledClasses(modal.contentEl)).toEqual([])
  })

  it('offers only the diagnostics that exist, and opens them', async () => {
    const actions = fakeActions()
    const modal = await openModal(actions)

    expect(() => button(modal, 'Registry diagnostics')).toThrow()
    button(modal, 'Parse diagnostics (3)').click()

    expect(actions.shown).toEqual(['parse'])
  })

  it('opens the registry diagnostics when the scan found some', async () => {
    const actions = fakeActions(undefined, async () => ({
      ...preview,
      diagnostics: { parse: 0, registry: 2 },
    }))
    const modal = await openModal(actions)

    expect(() => button(modal, 'Parse diagnostics')).toThrow()
    button(modal, 'Registry diagnostics (2)').click()

    expect(actions.shown).toEqual(['registry'])
  })

  it('applies an up-to-date step once it is ticked', async () => {
    const actions = fakeActions()
    const modal = await openModal(actions)
    modal.contentEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[2]!.click()

    button(modal, 'Apply').click()
    await vi.waitFor(() => {
      if (actions.applied.length === 0) {
        throw new Error('Waiting for apply.')
      }
    })

    expect(actions.applied).toEqual([['registry', 'notes', 'hidden-sections', 'dashboard']])
  })

  it('disables apply when nothing is ticked', async () => {
    const modal = await openModal(
      fakeActions(undefined, async () => ({
        ...preview,
        registry: { toAdd: 0, fromNotes: 0, fromHistory: 0 },
        notes: { toUpdate: 0, current: 38, skipped: 0 },
        dashboard: { sectionCount: 24, changed: false },
      })),
    )

    expect(button(modal, 'Apply').disabled).toBe(true)
  })

  it('reports a failed scan', async () => {
    const modal = await openModal(
      fakeActions(undefined, async () => {
        throw new Error('vault locked')
      }),
    )

    expect(modal.contentEl.querySelector('.fitkit-warn')?.textContent).toBe(
      'Could not scan the vault: vault locked.',
    )
  })
})
