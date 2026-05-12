import { describe, expect, it, vi } from 'vitest'

const noticeMessages = vi.hoisted(() => [] as string[])

import { TFile } from 'obsidian'

import {
  addDeletedExerciseTombstone,
  DEFAULT_SETTINGS,
  FitKitSettingTab,
  removeDeletedExerciseTombstone,
  settingsFromStored,
  type FitKitSettings,
} from '../src/settings'
import { dashboardPath, workoutFilename, workoutsFolder } from '../src/settings-paths'

vi.mock('obsidian', () => ({
  App: class {},
  Modal: class {},
  Notice: class {
    constructor(readonly message: string) {
      noticeMessages.push(message)
    }
  },
  PluginSettingTab: class {},
  Setting: class {},
  TFile: class {},
  normalizePath: (path: string) => path.replace(/^\/+/, '').replace(/\/+$/, ''),
}))

describe('settings paths', () => {
  it('builds the workouts folder from the fitness root', () => {
    expect(workoutsFolder({ fitnessRoot: 'Fitness' })).toBe('Fitness/Workouts')
    expect(workoutsFolder({ fitnessRoot: 'Fitness/' })).toBe('Fitness/Workouts')
    expect(workoutsFolder({ fitnessRoot: '/Fitness' })).toBe('Fitness/Workouts')
    expect(workoutsFolder({ fitnessRoot: '/Fitness/' })).toBe('Fitness/Workouts')
    expect(workoutsFolder({ fitnessRoot: 'Areas/Fitness' })).toBe('Areas/Fitness/Workouts')
  })

  it('builds the dashboard path from the fitness root', () => {
    expect(dashboardPath({ fitnessRoot: 'Fitness' })).toBe('Fitness/Fitness Dashboard.md')
  })

  it('builds workout filenames from dates', () => {
    expect(workoutFilename('2026-04-19')).toBe('2026-04-19.md')
  })
})

describe('settings migration', () => {
  it('defaults deleted exercise tombstones without dropping stored data', () => {
    const migrated = settingsFromStored({
      fitnessRoot: 'Area/Fitness',
      exerciseRegistry: [{ name: 'Squat', kind: 'strength', unit: 'kg', aliases: ['back squat'] }],
      hiddenDashboardSectionsByPath: { 'Fitness/Fitness Dashboard.md': ['exercise:Squat'] },
      schemaVersion: 1,
    })

    expect(migrated.fitnessRoot).toBe('Area/Fitness')
    expect(migrated.exerciseRegistry).toEqual([
      { name: 'Squat', kind: 'strength', unit: 'kg', aliases: ['back squat'] },
    ])
    expect(migrated.hiddenDashboardSectionsByPath).toEqual({
      'Fitness/Fitness Dashboard.md': ['exercise:Squat'],
    })
    expect(migrated.deletedExercises).toEqual([])
  })

  it('defaults legacy registry entries without a unit to kg', () => {
    const migrated = settingsFromStored({
      exerciseRegistry: [{ name: 'Squat', kind: 'strength', aliases: [] }],
      schemaVersion: 1,
    } as unknown as Partial<FitKitSettings>)

    expect(migrated.exerciseRegistry).toEqual([
      { name: 'Squat', kind: 'strength', unit: 'kg', aliases: [] },
    ])
  })

  it('preserves stored deleted exercise tombstones', () => {
    expect(
      settingsFromStored({
        deletedExercises: [' Squat ', 'squat', 'Bench Press'],
        schemaVersion: 1,
      }).deletedExercises,
    ).toEqual(['squat', 'bench press'])
  })
})

describe('deleted exercise tombstones', () => {
  it('normalizes, dedupes, and removes tombstones', () => {
    const added = addDeletedExerciseTombstone([' Squat ', 'bench press'], 'squat')

    expect(added).toEqual(['squat', 'bench press'])
    expect(removeDeletedExerciseTombstone(added, ' BENCH   PRESS ')).toEqual(['squat'])
  })
})

interface DeleteRegistryEntryHarness {
  deleteRegistryEntry(name: string, alsoDeleteFile: boolean, rerender: () => void): Promise<void>
}

function createDeleteHarness(
  settings: FitKitSettings,
  file: TFile | null,
  trashFile = vi.fn(async () => undefined),
): {
  harness: DeleteRegistryEntryHarness
  saveSettings: ReturnType<typeof vi.fn>
  getAbstractFileByPath: ReturnType<typeof vi.fn>
  trashFile: ReturnType<typeof vi.fn>
  rerender: ReturnType<typeof vi.fn>
} {
  const getAbstractFileByPath = vi.fn(() => file)
  const saveSettings = vi.fn(async () => undefined)
  const rerender = vi.fn()
  const tab = Object.create(FitKitSettingTab.prototype) as FitKitSettingTab &
    DeleteRegistryEntryHarness
  tab.plugin = {
    settings,
    app: {
      vault: { getAbstractFileByPath },
      fileManager: { trashFile },
    },
    saveSettings,
  }

  return { harness: tab, saveSettings, getAbstractFileByPath, trashFile, rerender }
}

describe('registry deletion tombstones', () => {
  it('records a tombstone when deleting the registry overlay and note file succeeds', async () => {
    noticeMessages.length = 0
    const file = new TFile()
    const settings: FitKitSettings = {
      ...DEFAULT_SETTINGS,
      exerciseRegistry: [{ name: 'Squat', kind: 'strength', unit: 'kg', aliases: [] }],
      deletedExercises: [],
    }
    const { harness, saveSettings, trashFile, rerender } = createDeleteHarness(settings, file)

    await harness.deleteRegistryEntry('Squat', true, rerender)

    expect(trashFile).toHaveBeenCalledWith(file)
    expect(settings.exerciseRegistry).toEqual([])
    expect(settings.deletedExercises).toEqual(['squat'])
    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(rerender).toHaveBeenCalledTimes(1)
    expect(noticeMessages).not.toHaveLength(0)
    expect(noticeMessages[0]).toContain('recorded it as ignored')
  })

  it('records a tombstone when deleting the note and it is already missing', async () => {
    const settings: FitKitSettings = {
      ...DEFAULT_SETTINGS,
      exerciseRegistry: [{ name: 'Squat', kind: 'strength', unit: 'kg', aliases: [] }],
      deletedExercises: [],
    }
    const { harness, trashFile, rerender } = createDeleteHarness(settings, null)

    await harness.deleteRegistryEntry('Squat', true, rerender)

    expect(trashFile).not.toHaveBeenCalled()
    expect(settings.exerciseRegistry).toEqual([])
    expect(settings.deletedExercises).toEqual(['squat'])
    expect(rerender).toHaveBeenCalledTimes(1)
  })

  it('does not tombstone when only removing the registry overlay', async () => {
    const settings: FitKitSettings = {
      ...DEFAULT_SETTINGS,
      exerciseRegistry: [{ name: 'Squat', kind: 'strength', unit: 'kg', aliases: [] }],
      deletedExercises: [],
    }
    const { harness, getAbstractFileByPath, trashFile, rerender } = createDeleteHarness(
      settings,
      new TFile(),
    )

    await harness.deleteRegistryEntry('Squat', false, rerender)

    expect(getAbstractFileByPath).not.toHaveBeenCalled()
    expect(trashFile).not.toHaveBeenCalled()
    expect(settings.exerciseRegistry).toEqual([])
    expect(settings.deletedExercises).toEqual([])
  })

  it('keeps the overlay and tombstones unchanged when trashing the note fails', async () => {
    const settings: FitKitSettings = {
      ...DEFAULT_SETTINGS,
      exerciseRegistry: [{ name: 'Squat', kind: 'strength', unit: 'kg', aliases: [] }],
      deletedExercises: [],
    }
    const trashFile = vi.fn(async () => {
      throw new Error('trash failed')
    })
    const { harness, saveSettings, rerender } = createDeleteHarness(
      settings,
      new TFile(),
      trashFile,
    )

    await harness.deleteRegistryEntry('Squat', true, rerender)

    expect(settings.exerciseRegistry).toEqual([
      { name: 'Squat', kind: 'strength', unit: 'kg', aliases: [] },
    ])
    expect(settings.deletedExercises).toEqual([])
    expect(saveSettings).not.toHaveBeenCalled()
    expect(rerender).toHaveBeenCalledTimes(1)
  })
})
