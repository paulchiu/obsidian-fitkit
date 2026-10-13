import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', async () => {
  const { mixinFileView } = await import('../fixtures/obsidian-file-view')

  class ItemView {
    app: unknown
    leaf: unknown
    contentEl: HTMLElement
    constructor(leaf: unknown) {
      this.leaf = leaf
      this.app =
        leaf && typeof leaf === 'object' && 'app' in leaf
          ? (leaf as { app?: unknown }).app
          : undefined
      this.contentEl = harness.createRoot()
    }
    registerDomEvent(): void {}
    registerEvent(): void {}
    getState(): Record<string, unknown> {
      return {}
    }
    async setState(_state: unknown, _result: unknown): Promise<void> {}
  }

  class Plugin {}

  class Menu {
    addItem(): this {
      return this
    }
    addSeparator(): this {
      return this
    }
    showAtPosition(): void {}
  }

  class Modal {}
  class SuggestModal extends Modal {}
  class PluginSettingTab {}
  class Setting {}
  class MarkdownView {}

  class Notice {
    constructor(readonly message: string) {}
  }

  class TFile {
    path = ''
    extension = 'md'
    basename = ''
    stat = { mtime: 1000 }
  }

  const FileView = mixinFileView(ItemView, (value): value is TFile => value instanceof TFile)

  return {
    FileView,
    ItemView,
    MarkdownView,
    Menu,
    Modal,
    Notice,
    Platform: { isMobile: false },
    Plugin,
    PluginSettingTab,
    Setting,
    SuggestModal,
    TFile,
    normalizePath: (path: string) => path.replace(/\/+/g, '/'),
    setIcon: () => {},
  }
})

const harness = vi.hoisted(() => ({ createRoot: (): HTMLElement => undefined as never }))

import { TFile } from 'obsidian'
import type { App, WorkspaceLeaf } from 'obsidian'

import FitKitPlugin from '../../src/main'
import { DEFAULT_SETTINGS } from '../../src/settings'
import { WorkoutEditorView } from '../../src/ui/workout-editor-view'
import { buildMockVaultFolderTree } from '../fixtures/mock-vault-folder-tree'
import { createTestRoot, harnessDocument, harnessWindow } from '../harness/obsidian-dom'

harness.createRoot = createTestRoot

const WORKOUT_PATH = 'Fitness/Workouts/2026-09-30.md'

const workoutSource = (rowingRow: string): string =>
  [
    '---',
    'type: workout',
    'date: 2026-09-30',
    'name: Cardio',
    '---',
    '',
    '## [[Rowing]]',
    '',
    rowingRow,
    '',
  ].join('\n')

/** A real WorkoutEditorView over an in-memory vault holding one workout note. */
const openView = async (
  source: string,
): Promise<{ view: WorkoutEditorView; contents: Map<string, string> }> => {
  const file = Object.assign(new TFile(), { path: WORKOUT_PATH, basename: '2026-09-30' })
  const contents = new Map([[WORKOUT_PATH, source]])
  const vault = {
    getFolderByPath: buildMockVaultFolderTree([file]).getFolderByPath,
    read: async (target: TFile): Promise<string> => contents.get(target.path) ?? '',
    process: async (target: TFile, callback: (text: string) => string): Promise<void> => {
      contents.set(target.path, callback(contents.get(target.path) ?? ''))
    },
    getAbstractFileByPath: (path: string): TFile | null => (path === WORKOUT_PATH ? file : null),
  }
  const app = {
    vault,
    metadataCache: { getFileCache: () => null, on: () => ({}) },
  }
  const plugin = Object.create(FitKitPlugin.prototype) as FitKitPlugin
  plugin.app = app as unknown as App
  plugin.settings = { ...DEFAULT_SETTINGS }
  plugin.refreshIndexEntry = async (): Promise<void> => {}
  const view = new WorkoutEditorView({ app } as unknown as WorkspaceLeaf, plugin)
  await view.onOpen()
  await view.setState({ file: WORKOUT_PATH }, { history: false })
  return { view, contents }
}

const clickButton = (view: WorkoutEditorView, label: string): void => {
  const button = view.contentEl.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) {
    throw new Error(`${label} button not rendered`)
  }
  button.click()
}

/** Interval callbacks the view registered; `tick()` runs them as time passing would. */
const intervals = new Map<number, () => void>()
const tick = (): void => {
  for (const callback of [...intervals.values()]) {
    callback()
  }
}

const text = (view: WorkoutEditorView, cls: string): string | null =>
  view.contentEl.querySelector(`.${cls}`)?.textContent ?? null

/** Waits for autosave to write a line exactly equal to `expected`. */
const savedRowingRow = async (contents: Map<string, string>, expected: string): Promise<void> => {
  await vi.waitFor(() => {
    expect(contents.get(WORKOUT_PATH)?.split('\n')).toContain(expected)
  })
}

describe('WorkoutEditorView duration timer persistence', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Australia/Brisbane')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T07:15:03+10:00'))
    vi.stubGlobal('HTMLElement', harnessWindow.HTMLElement)
    vi.stubGlobal('activeWindow', harnessWindow)
    /** Run the skeleton delay and autosave debounce at once; intervals run only on `tick()`. */
    intervals.clear()
    let nextId = 1
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void): number => {
        callback()
        return 0
      },
      clearTimeout: (): void => {},
      setInterval: (callback: () => void): number => {
        const id = nextId++
        intervals.set(id, callback)
        return id
      },
      clearInterval: (id: number): void => {
        intervals.delete(id)
      },
    })
    vi.stubGlobal('activeDocument', harnessDocument)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('saves the local start time on the timed row when the timer starts', async () => {
    const { view, contents } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )

    clickButton(view, 'Start timer')

    await savedRowingRow(
      contents,
      '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90] [started:: 2026-09-30T07:15:03+10:00]',
    )
  })

  it('adds the elapsed time to the duration and drops the start time when the timer stops', async () => {
    const { view, contents } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )
    clickButton(view, 'Start timer')
    await savedRowingRow(
      contents,
      '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90] [started:: 2026-09-30T07:15:03+10:00]',
    )
    vi.setSystemTime(new Date('2026-09-30T07:16:08+10:00'))

    clickButton(view, 'Stop timer')

    await savedRowingRow(contents, '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 155]')
  })

  it('resumes a timer saved as running, counting from its start time', async () => {
    vi.setSystemTime(new Date('2026-09-30T07:16:08+10:00'))

    const { view } = await openView(
      workoutSource(
        '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90] [started:: 2026-09-30T07:15:03+10:00]',
      ),
    )

    expect(text(view, 'fitkit-runner-clock')).toBe('2:35')
  })

  it('resumes a running timer found when reloading the workout from disk', async () => {
    const { view, contents } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )
    contents.set(
      WORKOUT_PATH,
      workoutSource(
        '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90] [started:: 2026-09-30T07:15:03+10:00]',
      ),
    )
    vi.setSystemTime(new Date('2026-09-30T07:16:08+10:00'))

    await view.reloadFromDisk()

    expect(text(view, 'fitkit-runner-clock')).toBe('2:35')
  })

  it('leaves the timer stopped when the saved start time is not a timestamp', async () => {
    const { view } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90] [started:: soon]'),
    )

    const duration = view.contentEl.querySelector<HTMLInputElement>('input[aria-label="Duration"]')
    expect(duration?.value).toBe('1m30s')
  })

  it('saves the elapsed time without a start time when the tab closes mid-timer', async () => {
    const { view, contents } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )
    clickButton(view, 'Start timer')
    await savedRowingRow(
      contents,
      '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90] [started:: 2026-09-30T07:15:03+10:00]',
    )
    vi.setSystemTime(new Date('2026-09-30T07:16:08+10:00'))

    await view.onClose()

    await savedRowingRow(contents, '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 155]')
  })

  it('saves the full elapsed time when a resumed timer stops', async () => {
    vi.setSystemTime(new Date('2026-09-30T07:16:08+10:00'))
    const { view, contents } = await openView(
      workoutSource(
        '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90] [started:: 2026-09-30T07:15:03+10:00]',
      ),
    )

    clickButton(view, 'Stop timer')

    await savedRowingRow(contents, '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 155]')
  })

  it('opens the timer full-tab, counting the set up from its saved time', async () => {
    const { view } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )

    clickButton(view, 'Start timer')

    expect(view.contentEl.querySelector('.fitkit-exercise-list')).toBeNull()
    expect(text(view, 'fitkit-runner-phase')).toBe('Set 1')
    expect(text(view, 'fitkit-runner-name')).toBe('Rowing')
    expect(text(view, 'fitkit-runner-clock')).toBe('1:30')
    vi.setSystemTime(new Date('2026-09-30T07:15:10+10:00'))
    tick()
    expect(text(view, 'fitkit-runner-clock')).toBe('1:37')
  })

  it('keeps the timer screen open after stopping, ready for the next set', async () => {
    const { view, contents } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )
    clickButton(view, 'Start timer')
    vi.setSystemTime(new Date('2026-09-30T07:16:08+10:00'))

    clickButton(view, 'Stop timer')

    await savedRowingRow(contents, '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 155]')
    expect(text(view, 'fitkit-runner-clock')).toBe('2:35')
    expect(text(view, 'fitkit-runner-note')).toBe('Stopped')
    expect(view.contentEl.querySelector('button[aria-label="Next set"]')).not.toBeNull()
  })

  it('starts timing a new set from the timer screen, showing the last one', async () => {
    const { view, contents } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )
    clickButton(view, 'Start timer')
    vi.setSystemTime(new Date('2026-09-30T07:15:33+10:00'))
    clickButton(view, 'Stop timer')
    vi.setSystemTime(new Date('2026-09-30T07:16:00+10:00'))

    clickButton(view, 'Next set')

    await savedRowingRow(
      contents,
      '- [exercise:: [[Rowing]]] [set:: 2] [duration:: 0] [started:: 2026-09-30T07:16:00+10:00]',
    )
    expect(contents.get(WORKOUT_PATH)?.split('\n')).toContain(
      '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 120]',
    )
    expect(text(view, 'fitkit-runner-phase')).toBe('Set 2')
    expect(text(view, 'fitkit-runner-clock')).toBe('0:00')
    expect(text(view, 'fitkit-runner-stats')).toBe('Last set 2m')
  })

  it('moves straight on to the next set while the timer runs', async () => {
    const { view, contents } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )
    clickButton(view, 'Start timer')
    vi.setSystemTime(new Date('2026-09-30T07:15:33+10:00'))

    clickButton(view, 'Next set')

    await savedRowingRow(
      contents,
      '- [exercise:: [[Rowing]]] [set:: 2] [duration:: 0] [started:: 2026-09-30T07:15:33+10:00]',
    )
    expect(contents.get(WORKOUT_PATH)?.split('\n')).toContain(
      '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 120]',
    )
  })

  it('resets the set to zero and times it again', async () => {
    const { view, contents } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )
    clickButton(view, 'Start timer')
    vi.setSystemTime(new Date('2026-09-30T07:15:20+10:00'))

    clickButton(view, 'Reset set')

    await savedRowingRow(
      contents,
      '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 0] [started:: 2026-09-30T07:15:20+10:00]',
    )
    expect(text(view, 'fitkit-runner-clock')).toBe('0:00')
  })

  it('resumes a stopped set from the timer screen', async () => {
    const { view, contents } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )
    clickButton(view, 'Start timer')
    vi.setSystemTime(new Date('2026-09-30T07:15:13+10:00'))
    clickButton(view, 'Stop timer')
    vi.setSystemTime(new Date('2026-09-30T07:15:30+10:00'))

    clickButton(view, 'Resume timer')

    await savedRowingRow(
      contents,
      '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 100] [started:: 2026-09-30T07:15:30+10:00]',
    )
  })

  it('stops, saves and returns to the workout when done', async () => {
    const { view, contents } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )
    clickButton(view, 'Start timer')
    vi.setSystemTime(new Date('2026-09-30T07:16:08+10:00'))

    clickButton(view, 'Close timer')

    await savedRowingRow(contents, '- [exercise:: [[Rowing]]] [set:: 1] [duration:: 155]')
    expect(view.contentEl.querySelector('.fitkit-runner')).toBeNull()
    const duration = view.contentEl.querySelector<HTMLInputElement>('input[aria-label="Duration"]')
    expect(duration?.value).toBe('2m35s')
  })
})

describe('WorkoutEditorView rest timer screen', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Australia/Brisbane')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T07:15:03+10:00'))
    vi.stubGlobal('HTMLElement', harnessWindow.HTMLElement)
    vi.stubGlobal('activeWindow', harnessWindow)
    intervals.clear()
    let nextId = 1
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void): number => {
        callback()
        return 0
      },
      clearTimeout: (): void => {},
      setInterval: (callback: () => void): number => {
        const id = nextId++
        intervals.set(id, callback)
        return id
      },
      clearInterval: (id: number): void => {
        intervals.delete(id)
      },
    })
    vi.stubGlobal('activeDocument', harnessDocument)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('counts the rest up full-tab and returns to the workout with the last rest', async () => {
    const { view, contents } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )
    const before = contents.get(WORKOUT_PATH)

    clickButton(view, 'Start rest timer')

    expect(view.contentEl.querySelector('.fitkit-exercise-list')).toBeNull()
    expect(view.contentEl.querySelector('.fitkit-runner.is-rest')).not.toBeNull()
    expect(text(view, 'fitkit-runner-phase')).toBe('Rest')
    expect(text(view, 'fitkit-runner-clock')).toBe('0:00')
    vi.setSystemTime(new Date('2026-09-30T07:16:15+10:00'))
    tick()
    expect(text(view, 'fitkit-runner-clock')).toBe('1:12')

    clickButton(view, 'Stop rest timer')

    expect(view.contentEl.querySelector('.fitkit-runner')).toBeNull()
    expect(text(view, 'fitkit-rest-timer-last')).toBe('Last rest 1m12s')
    expect(contents.get(WORKOUT_PATH)).toBe(before)
  })
})

describe('WorkoutEditorView timer screens keep the screen awake', () => {
  let locks: string[]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T07:15:03+10:00'))
    vi.stubGlobal('HTMLElement', harnessWindow.HTMLElement)
    vi.stubGlobal('activeWindow', harnessWindow)
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void): number => {
        callback()
        return 0
      },
      clearTimeout: (): void => {},
      setInterval: (): number => 1,
      clearInterval: (): void => {},
    })
    vi.stubGlobal('activeDocument', harnessDocument)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    )
    locks = []
    Object.defineProperty(harnessWindow.navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async (type: string): Promise<unknown> => {
          locks.push(`acquire ${type}`)
          return { release: async () => void locks.push('release') }
        },
      },
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(harnessWindow.navigator as object, 'wakeLock')
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('holds the screen on while timing sets, until Done', async () => {
    const { view } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )
    clickButton(view, 'Start timer')
    await vi.waitFor(() => expect(locks).toEqual(['acquire screen']))

    clickButton(view, 'Close timer')

    await vi.waitFor(() => expect(locks).toEqual(['acquire screen', 'release']))
  })

  it('holds the screen on while resting, until the rest stops', async () => {
    const { view } = await openView(
      workoutSource('- [exercise:: [[Rowing]]] [set:: 1] [duration:: 90]'),
    )
    clickButton(view, 'Start rest timer')
    await vi.waitFor(() => expect(locks).toEqual(['acquire screen']))

    clickButton(view, 'Stop rest timer')

    await vi.waitFor(() => expect(locks).toEqual(['acquire screen', 'release']))
  })
})
