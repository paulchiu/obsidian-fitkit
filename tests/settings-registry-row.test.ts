import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', () => ({
  App: class {},
  Modal: class {
    contentEl = new TestElement('div')
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

interface TestElementOptions {
  cls?: string
  text?: string
}

class TestElement {
  readonly children: TestElement[] = []
  readonly classes = new Set<string>()
  readonly attributes = new Map<string, string>()
  disabled = false
  textContent = ''

  constructor(readonly tagName: string) {}

  createEl(tagName: string, options: TestElementOptions = {}): TestElement {
    const child = new TestElement(tagName)
    this.children.push(child)
    return this.applyOptions(child, options)
  }

  createSpan(options: TestElementOptions = {}): TestElement {
    const child = new TestElement('span')
    this.children.push(child)
    return this.applyOptions(child, options)
  }

  createDiv(options: TestElementOptions = {}): TestElement {
    const child = new TestElement('div')
    this.children.push(child)
    return this.applyOptions(child, options)
  }

  private applyOptions(child: TestElement, options: TestElementOptions): TestElement {
    if (options.cls) {
      for (const cls of options.cls.split(' ')) {
        if (cls) child.classes.add(cls)
      }
    }
    if (options.text !== undefined) {
      child.textContent = options.text
    }
    return child
  }

  addClass(name: string): void {
    this.classes.add(name)
  }

  setText(text: string): void {
    this.textContent = text
  }

  setAttr(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  addEventListener(): void {}

  empty(): void {
    this.children.length = 0
    this.textContent = ''
  }
}

function findAll(root: TestElement, predicate: (el: TestElement) => boolean): TestElement[] {
  const matches: TestElement[] = []
  if (predicate(root)) {
    matches.push(root)
  }
  for (const child of root.children) {
    matches.push(...findAll(child, predicate))
  }
  return matches
}

function findButtons(root: TestElement, text: string): TestElement[] {
  return findAll(root, (el) => el.tagName === 'button' && el.textContent === text)
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

function renderRow(row: RegistryTableRow): TestElement {
  const tab = Object.create(FitKitSettingTab.prototype) as FitKitSettingTab
  Object.assign(tab, {
    plugin: {
      settings: { exerciseRegistry: [], deletedExercises: [] },
      app: { vault: { getAbstractFileByPath: () => null } },
    },
  })
  const table = new TestElement('table')
  const renderRegistryRow = (
    tab as unknown as {
      renderRegistryRow: (table: HTMLElement, row: RegistryTableRow, rerender: () => void) => void
    }
  ).renderRegistryRow.bind(tab)
  renderRegistryRow(table as unknown as HTMLElement, row, vi.fn())
  return table
}

describe('FitKitSettingTab registry row provenance', () => {
  it('disables editing a note-backed row instead of offering a control that does nothing', () => {
    const table = renderRow(
      baseRow({ provenance: 'note', notePath: 'Fitness/Exercises/Squat.md', kind: 'strength' }),
    )

    const editButtons = findButtons(table, 'Edit')
    expect(editButtons).toHaveLength(1)
    expect(editButtons[0]?.disabled).toBe(true)
    expect(editButtons[0]?.attributes.get('title')).toBeTruthy()
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
