import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestRoot, installObsidianDomExtensions } from './harness/obsidian-dom'

vi.mock('obsidian', () => ({
  App: class {},
  Modal: class {
    contentEl = createTestRoot()
    constructor(readonly app: unknown) {}
    open(): void {}
    close(): void {}
  },
  Notice: class {
    constructor(readonly message: string) {}
  },
  PluginSettingTab: class {},
  Setting: class {},
  TFile: class {},
  normalizePath: (path: string) => path.replace(/^\/+/, '').replace(/\/+$/, ''),
}))

import { FitKitSettingTab } from '../src/settings'
import type { RegistryTableRow } from '../src/vault/exercise-registry-table'

function findButtons(root: Element, text: string): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')].filter((button) => button.textContent === text)
}

function baseRow(overrides: Partial<RegistryTableRow>): RegistryTableRow {
  return {
    name: 'Squat',
    kind: 'strength',
    unit: undefined,
    aliases: [],
    provenance: 'overlay',
    notePath: null,
    sourcePaths: [],
    ...overrides,
  }
}

function renderRow(row: RegistryTableRow): HTMLElement {
  const tab = Object.create(FitKitSettingTab.prototype) as FitKitSettingTab
  Object.assign(tab, {
    plugin: {
      settings: { exerciseRegistry: [], deletedExercises: [] },
      app: { vault: { getAbstractFileByPath: () => null } },
    },
  })
  const table = createTestRoot().createEl('table')
  const renderRegistryRow = (
    tab as unknown as {
      renderRegistryRow: (table: HTMLElement, row: RegistryTableRow, rerender: () => void) => void
    }
  ).renderRegistryRow.bind(tab)
  renderRegistryRow(table, row, vi.fn())
  return table
}

describe('FitKitSettingTab registry row provenance', () => {
  beforeEach(() => {
    installObsidianDomExtensions()
  })

  it('offers an enabled Rename action for a note-backed row instead of a disabled Edit', () => {
    const table = renderRow(
      baseRow({ provenance: 'note', notePath: 'Fitness/Exercises/Squat.md', kind: 'strength' }),
    )

    expect(findButtons(table, 'Edit')).toHaveLength(0)
    const renameButtons = findButtons(table, 'Rename')
    expect(renameButtons).toHaveLength(1)
    expect(renameButtons[0]?.disabled).toBe(false)
    expect(renameButtons[0]?.getAttribute('title')).toBeTruthy()
    expect(findButtons(table, 'Delete')).toHaveLength(1)
  })

  it('keeps editing enabled for an overlay-only row', () => {
    const table = renderRow(baseRow({ provenance: 'overlay' }))

    const editButtons = findButtons(table, 'Edit')
    expect(editButtons).toHaveLength(1)
    expect(editButtons[0]?.disabled).toBe(false)
  })

  it('offers "Add to registry" instead of a misleading Edit for a history-only row', () => {
    const table = renderRow(
      baseRow({
        provenance: 'history',
        kind: 'duration',
        sourcePaths: ['Fitness/Workouts/2026-05-08.md'],
      }),
    )

    expect(findButtons(table, 'Edit')).toHaveLength(0)
    expect(findButtons(table, 'Add to registry')).toHaveLength(1)
    expect(findButtons(table, 'Delete')).toHaveLength(1)
  })
})
