import { describe, expect, it, vi } from 'vitest'

import {
  coerceAutosaveDebounceMs,
  coerceChartSessionsWindow,
  DEFAULT_SETTINGS,
  FitKitSettingTab,
  type FitKitSettings,
} from '../src/settings'

vi.mock('obsidian', () => ({
  App: class {},
  Modal: class {},
  Notice: class {},
  PluginSettingTab: class {},
  Setting: class {},
  TFile: class {},
  normalizePath: (path: string) => path.replace(/^\/+/, '').replace(/\/+$/, ''),
}))

interface DefinitionRow {
  name: string
  desc?: unknown
  searchable?: unknown
  control?: {
    type: string
    key: string
    min?: number
    max?: number
    defaultValue?: unknown
    validate?: (value: number) => string | void
  }
  render?: unknown
}

interface DefinitionGroup {
  type: string
  heading: string
  items: DefinitionRow[]
}

function createTab(settings: FitKitSettings = { ...DEFAULT_SETTINGS }): {
  tab: FitKitSettingTab
  settings: FitKitSettings
  saveSettings: ReturnType<typeof vi.fn>
  refreshWorkoutEditorViews: ReturnType<typeof vi.fn>
} {
  const saveSettings = vi.fn(async () => undefined)
  const refreshWorkoutEditorViews = vi.fn()
  const tab = Object.create(FitKitSettingTab.prototype) as FitKitSettingTab
  tab.plugin = { settings, saveSettings, refreshWorkoutEditorViews } as never
  return { tab, settings, saveSettings, refreshWorkoutEditorViews }
}

function groups(tab: FitKitSettingTab): DefinitionGroup[] {
  return tab.getSettingDefinitions() as unknown as DefinitionGroup[]
}

function allRows(tab: FitKitSettingTab): DefinitionRow[] {
  return groups(tab).flatMap((group) => group.items)
}

describe('setting definitions', () => {
  it('exposes every section as a group in display order', () => {
    const { tab } = createTab()

    expect(groups(tab).map((group) => group.heading)).toEqual([
      'Paths',
      'Behavior',
      'Charts',
      'Setup and maintenance',
      'Registry',
    ])
    expect(groups(tab).every((group) => group.type === 'group')).toBe(true)
  })

  it('binds every control to a real settings key with a matching control type', () => {
    const controls = allRows(createTab().tab)
      .map((row) => row.control)
      .filter((control): control is NonNullable<DefinitionRow['control']> => control !== undefined)

    expect(controls.map((control) => [control.type, control.key])).toEqual([
      ['folder', 'fitnessRoot'],
      ['toggle', 'autoOpenWorkoutEditor'],
      ['toggle', 'strengthRestTimerEnabled'],
      ['number', 'autosaveDebounceMs'],
      ['number', 'chartSessionsWindow'],
    ])

    for (const control of controls) {
      expect(DEFAULT_SETTINGS).toHaveProperty(control.key)
      const expected =
        control.type === 'toggle' ? 'boolean' : control.type === 'number' ? 'number' : 'string'
      expect(typeof DEFAULT_SETTINGS[control.key as keyof FitKitSettings]).toBe(expected)
    }
  })

  it('validates number bounds rather than declaring them as input constraints', () => {
    const numbers = new Map(
      allRows(createTab().tab)
        .map((row) => row.control)
        .filter((control) => control?.type === 'number')
        .map((control) => [control!.key, control!]),
    )

    for (const control of numbers.values()) {
      expect(control.min).toBeUndefined()
      expect(control.max).toBeUndefined()
      expect(typeof control.validate).toBe('function')
    }

    expect(numbers.get('autosaveDebounceMs')?.defaultValue).toBe(
      DEFAULT_SETTINGS.autosaveDebounceMs,
    )
    expect(numbers.get('chartSessionsWindow')?.defaultValue).toBe(
      DEFAULT_SETTINGS.chartSessionsWindow,
    )

    for (const control of numbers.values()) {
      expect(control.validate?.(control.defaultValue as number)).toBeUndefined()
    }

    const autosave = numbers.get('autosaveDebounceMs')?.validate
    expect(autosave?.(0)).toBeUndefined()
    expect(autosave?.(5000)).toBeUndefined()
    expect(autosave?.(-1)).toBe('Enter 0 or more.')
    expect(autosave?.(Number.NaN)).toBe('Enter a number.')

    const chart = numbers.get('chartSessionsWindow')?.validate
    expect(chart?.(30)).toBeUndefined()
    expect(chart?.(4)).toBe('Enter a number between 5 and 365.')
    expect(chart?.(366)).toBe('Enter a number between 5 and 365.')
    expect(chart?.(Number.NaN)).toBe('Enter a number.')
  })

  it('gives every searchable row a description so settings search can match it', () => {
    const searchable = allRows(createTab().tab).filter((row) => row.searchable !== false)

    expect(searchable).toHaveLength(12)
    for (const row of searchable) {
      expect(row.name.length).toBeGreaterThan(0)
      expect(typeof row.desc).toBe('string')
      expect(row.desc).not.toBe('')
    }
  })

  it('keeps the seven maintenance actions as searchable rows', () => {
    const maintenance = groups(createTab().tab).find(
      (group) => group.heading === 'Setup and maintenance',
    )

    expect(
      maintenance?.items.filter((row) => row.searchable !== false).map((row) => row.name),
    ).toEqual([
      'Rebuild index',
      'Rebuild dashboard',
      'Restore hidden dashboard sections',
      'Show parse diagnostics',
      'Show exercise registry diagnostics',
      'Sync and repair exercise notes',
      'Rebuild registry',
    ])
  })

  it('excludes rows that own their markup from search', () => {
    const excluded = allRows(createTab().tab).filter((row) => row.searchable === false)

    expect(excluded.map((row) => row.name)).toEqual([
      'Derived paths',
      'About these actions',
      'About the registry',
      'Exercises',
    ])
    expect(excluded.every((row) => typeof row.render === 'function')).toBe(true)
  })
})

describe('setControlValue', () => {
  it('normalises the fitness root before persisting it', async () => {
    const { tab, settings, saveSettings } = createTab()

    await tab.setControlValue('fitnessRoot', '/Areas/Fitness/')

    expect(settings.fitnessRoot).toBe('Areas/Fitness')
    expect(saveSettings).toHaveBeenCalledTimes(1)
  })

  it('coerces the autosave debounce from the raw input value', async () => {
    const { tab, settings } = createTab()

    await tab.setControlValue('autosaveDebounceMs', '250')
    expect(settings.autosaveDebounceMs).toBe(250)

    await tab.setControlValue('autosaveDebounceMs', '-5')
    expect(settings.autosaveDebounceMs).toBe(DEFAULT_SETTINGS.autosaveDebounceMs)
  })

  it('clamps the chart window to the supported range', async () => {
    const { tab, settings } = createTab()

    await tab.setControlValue('chartSessionsWindow', '1')
    expect(settings.chartSessionsWindow).toBe(5)

    await tab.setControlValue('chartSessionsWindow', '9000')
    expect(settings.chartSessionsWindow).toBe(365)
  })

  it('refreshes open editors only when the rest timer changes', async () => {
    const { tab, settings, refreshWorkoutEditorViews } = createTab()

    await tab.setControlValue('autoOpenWorkoutEditor', false)
    expect(settings.autoOpenWorkoutEditor).toBe(false)
    expect(refreshWorkoutEditorViews).not.toHaveBeenCalled()

    await tab.setControlValue('strengthRestTimerEnabled', false)
    expect(settings.strengthRestTimerEnabled).toBe(false)
    expect(refreshWorkoutEditorViews).toHaveBeenCalledTimes(1)
  })

  it('ignores a key the tab does not own', async () => {
    const { tab, settings, saveSettings } = createTab()
    const before = { ...settings }

    await tab.setControlValue('schemaVersion', 99)

    expect(settings).toEqual(before)
    expect(saveSettings).not.toHaveBeenCalled()
  })
})

describe('control value coercion', () => {
  it('falls back to the default autosave debounce for values it cannot use', () => {
    expect(coerceAutosaveDebounceMs(0)).toBe(0)
    expect(coerceAutosaveDebounceMs('600')).toBe(600)
    expect(coerceAutosaveDebounceMs('750.9')).toBe(750)
    expect(coerceAutosaveDebounceMs('')).toBe(DEFAULT_SETTINGS.autosaveDebounceMs)
    expect(coerceAutosaveDebounceMs('abc')).toBe(DEFAULT_SETTINGS.autosaveDebounceMs)
    expect(coerceAutosaveDebounceMs(-1)).toBe(DEFAULT_SETTINGS.autosaveDebounceMs)
  })

  it('clamps the chart window and falls back when it cannot parse one', () => {
    expect(coerceChartSessionsWindow(30)).toBe(30)
    expect(coerceChartSessionsWindow('4')).toBe(5)
    expect(coerceChartSessionsWindow('366')).toBe(365)
    expect(coerceChartSessionsWindow('abc')).toBe(DEFAULT_SETTINGS.chartSessionsWindow)
  })
})
