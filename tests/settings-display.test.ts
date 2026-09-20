import { describe, expect, it, vi } from 'vitest'

import { createTestRoot } from './harness/obsidian-dom'

/**
 * Obsidian below 1.13 renders the tab through display() rather than the
 * definitions, so these cover the fallback walking the same sections.
 */

const rendered = vi.hoisted(
  () => [] as { name: string; desc: string; heading: boolean; buttonText?: string }[],
)

vi.mock('obsidian', () => {
  class Setting {
    private readonly record = { name: '', desc: '', heading: false } as (typeof rendered)[number]

    constructor(_containerEl: unknown) {
      rendered.push(this.record)
    }
    setName(name: string): this {
      this.record.name = name
      return this
    }
    setDesc(desc: string): this {
      this.record.desc = desc
      return this
    }
    setHeading(): this {
      this.record.heading = true
      return this
    }
    addButton(cb: (button: unknown) => void): this {
      const button = {
        setButtonText: (text: string) => {
          this.record.buttonText = text
          return button
        },
        onClick: () => button,
      }
      cb(button)
      return this
    }
    addToggle(cb: (toggle: unknown) => void): this {
      const toggle = { setValue: () => toggle, onChange: () => toggle }
      cb(toggle)
      return this
    }
    addText(cb: (text: unknown) => void): this {
      const text = {
        inputEl: createTestRoot().createEl('input'),
        setValue: () => text,
        onChange: () => text,
      }
      cb(text)
      return this
    }
  }

  return {
    App: class {},
    Modal: class {},
    Notice: class {},
    PluginSettingTab: class {},
    Setting,
    TFile: class {},
    normalizePath: (path: string) => path.replace(/^\/+/, '').replace(/\/+$/, ''),
  }
})

vi.mock('../src/vault/exercise-registry-table', () => ({
  buildRegistryTableRows: async () => [],
  filterRegistryTableRows: (rows: unknown[]) => rows,
}))

import { DEFAULT_SETTINGS, FitKitSettingTab, type FitKitSettings } from '../src/settings'

interface DefinitionRow {
  name: string
  desc?: unknown
  searchable?: unknown
}

function displayTab(): {
  tab: FitKitSettingTab
  containerEl: HTMLElement
  settings: FitKitSettings
} {
  rendered.length = 0
  const settings: FitKitSettings = { ...DEFAULT_SETTINGS }
  const containerEl = createTestRoot()
  const tab = Object.create(FitKitSettingTab.prototype) as FitKitSettingTab
  tab.plugin = { settings, saveSettings: async () => undefined } as never
  /** Cast off the deprecated signature; calling display() is the point here. */
  const fallback = tab as unknown as { containerEl: HTMLElement; display: () => void }
  fallback.containerEl = containerEl
  fallback.display()
  return { tab, containerEl, settings }
}

describe('display fallback', () => {
  it('renders a heading for every group and a row for every non-block definition', () => {
    const { tab } = displayTab()
    const definitions = tab.getSettingDefinitions() as unknown as {
      heading: string
      items: DefinitionRow[]
    }[]

    const expectedHeadings = definitions.map((group) => group.heading)
    const expectedRows = definitions.flatMap((group) =>
      group.items.filter((row) => row.searchable !== false).map((row) => row.name),
    )

    expect(rendered.filter((entry) => entry.heading).map((entry) => entry.name)).toEqual(
      expectedHeadings,
    )
    expect(rendered.filter((entry) => !entry.heading).map((entry) => entry.name)).toEqual(
      expectedRows,
    )
  })

  it('carries the same descriptions the definitions expose to settings search', () => {
    const { tab } = displayTab()
    const definitions = tab.getSettingDefinitions() as unknown as { items: DefinitionRow[] }[]
    const expected = definitions
      .flatMap((group) => group.items)
      .filter((row) => row.searchable !== false)
      .map((row) => row.desc)

    expect(rendered.filter((entry) => !entry.heading).map((entry) => entry.desc)).toEqual(expected)
  })

  it('renders block rows straight into the container', () => {
    const { containerEl } = displayTab()

    expect([...containerEl.children].some((child) => child.textContent === 'Derived paths:')).toBe(
      true,
    )
    expect(
      [...containerEl.children].some((child) =>
        child.classList.contains('fitkit-registry-section'),
      ),
    ).toBe(true)
  })

  it('labels each maintenance action button', () => {
    displayTab()

    const buttons = rendered
      .filter((entry) => entry.buttonText !== undefined)
      .map((entry) => entry.buttonText)

    expect(buttons).toEqual(['Rebuild', 'Rebuild', 'Restore', 'Show', 'Show', 'Sync', 'Rebuild'])
  })
})
