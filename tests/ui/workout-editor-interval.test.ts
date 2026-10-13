import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface MockMenuItem {
  title?: string
  disabled?: boolean
  onClick?: () => void
}

const obsidian = vi.hoisted(() => ({
  createRoot: (): HTMLElement => undefined as never,
  menus: [] as Array<{ items: MockMenuItem[] }>,
  modals: [] as Array<{ contentEl: HTMLElement; titleEl: HTMLElement; close: () => void }>,
  notices: [] as string[],
}))

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
      this.contentEl = obsidian.createRoot()
    }
    registerDomEvent(): void {}
    registerEvent(): void {}
    getState(): Record<string, unknown> {
      return {}
    }
    async setState(_state: unknown, _result: unknown): Promise<void> {}
  }

  class Plugin {}

  class MenuItem {
    constructor(private state: MockMenuItem) {}
    setTitle(title: string): this {
      this.state.title = title
      return this
    }
    setIcon(): this {
      return this
    }
    setWarning(): this {
      return this
    }
    setChecked(): this {
      return this
    }
    setSection(): this {
      return this
    }
    setDisabled(disabled: boolean): this {
      this.state.disabled = disabled
      return this
    }
    onClick(callback: () => void): this {
      this.state.onClick = callback
      return this
    }
  }

  class Menu {
    items: MockMenuItem[] = []
    constructor() {
      obsidian.menus.push(this)
    }
    addItem(callback: (item: MenuItem) => void): this {
      const state: MockMenuItem = {}
      callback(new MenuItem(state))
      this.items.push(state)
      return this
    }
    addSeparator(): this {
      return this
    }
    showAtPosition(): void {}
    showAtMouseEvent(): void {}
  }

  class Modal {
    contentEl = obsidian.createRoot()
    modalEl = obsidian.createRoot()
    titleEl = obsidian.createRoot()
    constructor(readonly app: unknown) {}
    setTitle(title: string): this {
      this.titleEl.textContent = title
      return this
    }
    open(): void {
      obsidian.modals.push(this)
      ;(this as { onOpen?: () => void }).onOpen?.()
    }
    close(): void {
      ;(this as { onClose?: () => void }).onClose?.()
    }
  }
  class SuggestModal extends Modal {}
  class PluginSettingTab {}
  class Setting {}
  class MarkdownView {}

  class Notice {
    constructor(readonly message: string) {
      obsidian.notices.push(message)
    }
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

import { TFile } from 'obsidian'
import type { App, WorkspaceLeaf } from 'obsidian'

import FitKitPlugin from '../../src/main'
import { DEFAULT_SETTINGS } from '../../src/settings'
import { WorkoutEditorView } from '../../src/ui/workout-editor-view'
import { buildMockVaultFolderTree } from '../fixtures/mock-vault-folder-tree'
import { createTestRoot, harnessDocument, harnessWindow } from '../harness/obsidian-dom'

obsidian.createRoot = createTestRoot

const WORKOUT_PATH = 'Fitness/Workouts/2026-10-12.md'

const workoutSource = (...body: string[]): string =>
  ['---', 'type: workout', 'date: 2026-10-12', 'name: Intervals', '---', '', ...body, ''].join('\n')

/** Interval callbacks the view registered, keyed by id. */
let intervals = new Map<number, () => void>()

/** A real WorkoutEditorView over an in-memory vault holding one workout note. */
const openView = async (
  source: string,
): Promise<{ view: WorkoutEditorView; contents: Map<string, string> }> => {
  const file = Object.assign(new TFile(), { path: WORKOUT_PATH, basename: '2026-10-12' })
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

/** Waits for autosave to leave the note's body lines (after the frontmatter) equal to `expected`. */
const savedBody = async (contents: Map<string, string>, expected: string[]): Promise<void> => {
  await vi.waitFor(() => {
    const lines = (contents.get(WORKOUT_PATH) ?? '').split('\n')
    expect(lines.slice(6, -1)).toEqual(expected)
  })
}

describe('WorkoutEditorView interval plans', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Australia/Brisbane')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-12T07:15:00+10:00'))
    intervals = new Map()
    obsidian.menus.length = 0
    obsidian.modals.length = 0
    obsidian.notices.length = 0
    vi.stubGlobal('HTMLElement', harnessWindow.HTMLElement)
    vi.stubGlobal('activeWindow', harnessWindow)
    let nextId = 1
    /** Run the skeleton delay and autosave debounce at once; intervals run only on `tick()`. */
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

  it('keeps the plan and interval fields when an edit saves the note', async () => {
    const body = [
      '## [[Exercise Bike]]',
      '',
      '- [exercise:: [[Exercise Bike]]] [plan:: 8 x 30s @ 300W, 90s rest]',
      '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 305] [rest:: 90]',
      '- [exercise:: [[Exercise Bike]]] [set:: 2] [duration:: 30] [load:: 20] [level:: 4] [rest:: 41] [paused:: true]',
    ]
    const { view, contents } = await openView(workoutSource(...body))

    const name = view.contentEl.querySelector<HTMLInputElement>('input[aria-label="Workout name"]')
    if (!name) {
      throw new Error('name input not rendered')
    }
    name.value = 'Bike intervals'
    name.dispatchEvent(new harnessWindow.Event('input'))

    await vi.waitFor(() => {
      expect(contents.get(WORKOUT_PATH)).toContain('name: Bike intervals')
    })
    await savedBody(contents, body)
  })
})
