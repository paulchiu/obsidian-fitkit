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

const savedRowingRow = async (contents: Map<string, string>, expected: string): Promise<void> => {
  await vi.waitFor(() => {
    expect(contents.get(WORKOUT_PATH)).toContain(expected)
  })
}

describe('WorkoutEditorView duration timer persistence', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Australia/Brisbane')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T07:15:03+10:00'))
    vi.stubGlobal('HTMLElement', harnessWindow.HTMLElement)
    vi.stubGlobal('activeWindow', harnessWindow)
    /** Run the skeleton delay and autosave debounce at once; leave the tick interval idle. */
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
})
