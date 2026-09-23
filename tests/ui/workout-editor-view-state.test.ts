import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', () => {
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

  return {
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

const WORKOUT_PATH = 'Fitness/Workouts/2026-08-15.md'

const workoutSource = [
  '---',
  'type: workout',
  'date: 2026-08-15',
  'name: Push day',
  '---',
  '',
  '## [[Squat]]',
  '',
  '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
].join('\n')

const createWorkoutFile = (path: string): TFile =>
  Object.assign(new TFile(), {
    path,
    basename: path.split('/').pop()?.replace(/\.md$/, '') ?? '',
  })

/** A real WorkoutEditorView over an in-memory vault holding one workout note. */
const createView = (): { view: WorkoutEditorView; contents: Map<string, string> } => {
  const file = createWorkoutFile(WORKOUT_PATH)
  const contents = new Map<string, string>([[WORKOUT_PATH, workoutSource]])
  const vault = {
    getFolderByPath: buildMockVaultFolderTree([file]).getFolderByPath,
    read: async (target: TFile): Promise<string> => contents.get(target.path) ?? '',
    process: async (target: TFile, callback: (text: string) => string): Promise<void> => {
      contents.set(target.path, callback(contents.get(target.path) ?? ''))
    },
    getAbstractFileByPath: (path: string): TFile | null => (contents.has(path) ? file : null),
  }
  const app = { vault, metadataCache: { getFileCache: () => null } }
  const plugin = Object.create(FitKitPlugin.prototype) as FitKitPlugin
  plugin.app = app as unknown as App
  plugin.settings = { ...DEFAULT_SETTINGS }
  const view = new WorkoutEditorView({ app } as unknown as WorkspaceLeaf, plugin)
  return { view, contents }
}

describe('WorkoutEditorView workspace state', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', harnessWindow.HTMLElement)
    vi.stubGlobal('activeWindow', harnessWindow)
    /** Resolve the minimum-skeleton delay at once so a load does not wait on the clock. */
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void): number => {
        callback()
        return 0
      },
      clearTimeout: (): void => {},
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
    vi.unstubAllGlobals()
  })

  it('renders the workout named in restored state instead of the empty hint', async () => {
    const { view } = createView()
    await view.onOpen()

    await view.setState({ file: WORKOUT_PATH }, { history: false })

    expect(view.contentEl.querySelector('.fitkit-empty')).toBeNull()
    expect(view.contentEl.textContent).toContain('Squat')
  })

  it('reports the loaded workout path in its saved state', async () => {
    const { view } = createView()
    await view.onOpen()

    await view.loadFile(createWorkoutFile(WORKOUT_PATH))

    expect(view.getState()).toEqual({ file: WORKOUT_PATH })
  })

  it('keeps the empty hint when the restored workout no longer exists', async () => {
    const { view } = createView()
    await view.onOpen()

    await view.setState({ file: 'Fitness/Workouts/2026-01-01.md' }, { history: false })

    expect(view.contentEl.querySelector('.fitkit-empty')?.textContent).toBe(
      'Open a workout note to edit.',
    )
  })

  it('keeps the on-screen workout when state names the workout already loaded', async () => {
    const { view, contents } = createView()
    await view.onOpen()
    await view.setState({ file: WORKOUT_PATH }, { history: false })
    contents.set(WORKOUT_PATH, workoutSource.replaceAll('Squat', 'Deadlift'))

    await view.setState({ file: WORKOUT_PATH }, { history: false })

    expect(view.contentEl.textContent).toContain('Squat')
    expect(view.contentEl.textContent).not.toContain('Deadlift')
  })
})
