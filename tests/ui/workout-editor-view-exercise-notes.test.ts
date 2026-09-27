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

const WORKOUT_NAME = '2026-08-15'

const workoutSource = [
  '---',
  'type: workout',
  'date: 2026-08-15',
  'name: Push day',
  '---',
  '',
  '## [[Push-up]]',
  '',
  '- [exercise:: [[Push-up]]] [set:: 1] [level:: 2] [reps:: 10]',
].join('\n')

const createFile = (path: string): TFile =>
  Object.assign(new TFile(), {
    path,
    basename: path.split('/').pop()?.replace(/\.md$/, '') ?? '',
  })

type ChangedListener = (file: TFile) => void

interface CreateViewOptions {
  levels: string[]
  /** Vault-relative prefix the fixture files sit under; empty for the vault root. */
  folderPrefix?: string
  fitnessRoot?: string
}

/**
 * A real WorkoutEditorView over an in-memory vault holding one workout and
 * one bodyweight exercise note whose cached frontmatter the test can rewrite.
 */
const createView = ({
  levels: initialLevels,
  folderPrefix = 'Fitness/',
  fitnessRoot = DEFAULT_SETTINGS.fitnessRoot,
}: CreateViewOptions): {
  view: WorkoutEditorView
  workout: TFile
  exerciseNote: TFile
  setLevels: (levels: string[]) => void
  fireChanged: (file: TFile) => void
} => {
  const workout = createFile(`${folderPrefix}Workouts/${WORKOUT_NAME}.md`)
  const exerciseNote = createFile(`${folderPrefix}Exercises/Push-up.md`)
  const filesByPath = new Map([workout, exerciseNote].map((file) => [file.path, file]))
  const contents = new Map<string, string>([[workout.path, workoutSource]])
  const frontmatter = new Map<string, Record<string, unknown>>([
    [exerciseNote.path, { type: 'exercise', kind: 'bodyweight', levels: initialLevels }],
  ])
  const listeners: ChangedListener[] = []
  const vault = {
    getFolderByPath: buildMockVaultFolderTree([workout, exerciseNote]).getFolderByPath,
    read: async (target: TFile): Promise<string> => contents.get(target.path) ?? '',
    process: async (target: TFile, callback: (text: string) => string): Promise<void> => {
      contents.set(target.path, callback(contents.get(target.path) ?? ''))
    },
    getAbstractFileByPath: (path: string): TFile | null => filesByPath.get(path) ?? null,
  }
  const app = {
    vault,
    metadataCache: {
      getFileCache: (file: TFile) => {
        const matter = frontmatter.get(file.path)
        return matter ? { frontmatter: matter } : null
      },
      on: (name: string, callback: ChangedListener) => {
        if (name === 'changed') {
          listeners.push(callback)
        }
        return {}
      },
    },
    workspace: { requestSaveLayout: vi.fn() },
  }
  const plugin = Object.create(FitKitPlugin.prototype) as FitKitPlugin
  plugin.app = app as unknown as App
  plugin.settings = { ...DEFAULT_SETTINGS, fitnessRoot }
  const view = new WorkoutEditorView({ app } as unknown as WorkspaceLeaf, plugin)
  return {
    view,
    workout,
    exerciseNote,
    setLevels: (levels) =>
      frontmatter.set(exerciseNote.path, { type: 'exercise', kind: 'bodyweight', levels }),
    fireChanged: (file) => listeners.forEach((listener) => listener(file)),
  }
}

const levelLabelText = (view: WorkoutEditorView): string | null | undefined =>
  view.contentEl.querySelector('.fitkit-bodyweight-level-full')?.textContent

const raiseLevelButton = (view: WorkoutEditorView): HTMLButtonElement | null =>
  view.contentEl.querySelector('button[aria-label="Raise level for set 1"]')

const repsInput = (view: WorkoutEditorView): HTMLInputElement | null =>
  view.contentEl.querySelector('input[aria-label="Reps"]')

/** Lets any async work the change started finish before asserting. */
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    ;(harnessWindow as unknown as Window).setTimeout(resolve, 0)
  })

/** Timers fire at once during load; afterwards they hold, so an edit stays unsaved. */
const timers = { fireImmediately: true }

describe('WorkoutEditorView exercise note changes', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', harnessWindow.HTMLElement)
    vi.stubGlobal('activeWindow', harnessWindow)
    /** Resolve the minimum-skeleton delay at once so a load does not wait on the clock. */
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void): number => {
        if (timers.fireImmediately) {
          callback()
        }
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
    timers.fireImmediately = true
  })

  it('shows renamed rungs once the exercise note levels change', async () => {
    const { view, workout, exerciseNote, setLevels, fireChanged } = createView({
      levels: ['Wall', 'Incline'],
    })
    await view.onOpen()
    await view.loadFile(workout)
    expect(levelLabelText(view)).toBe('2 · Incline')

    setLevels(['Wall', 'Knee'])
    fireChanged(exerciseNote)
    await settle()

    expect(levelLabelText(view)).toBe('2 · Knee')
  })

  it('enables raising a set once a rung is added above its level', async () => {
    const { view, workout, exerciseNote, setLevels, fireChanged } = createView({
      levels: ['Wall', 'Incline'],
    })
    await view.onOpen()
    await view.loadFile(workout)
    expect(raiseLevelButton(view)?.disabled).toBe(true)

    setLevels(['Wall', 'Incline', 'Knee'])
    fireChanged(exerciseNote)
    await settle()

    expect(raiseLevelButton(view)?.disabled).toBe(false)
  })

  it('keeps unsaved edits when an exercise note changes', async () => {
    const { view, workout, exerciseNote, setLevels, fireChanged } = createView({
      levels: ['Wall', 'Incline'],
    })
    await view.onOpen()
    await view.loadFile(workout)
    timers.fireImmediately = false
    const reps = repsInput(view)
    if (!reps) {
      throw new Error('reps input not rendered')
    }
    reps.value = '14'
    reps.dispatchEvent(new harnessWindow.Event('input'))

    setLevels(['Wall', 'Knee'])
    fireChanged(exerciseNote)
    await settle()

    expect(levelLabelText(view)).toBe('2 · Knee')
    expect(repsInput(view)?.value).toBe('14')
  })
  it('picks up level changes when the fitness root is the vault root', async () => {
    const { view, workout, exerciseNote, setLevels, fireChanged } = createView({
      levels: ['Wall', 'Incline'],
      folderPrefix: '',
      fitnessRoot: '/',
    })
    await view.onOpen()
    await view.loadFile(workout)
    expect(levelLabelText(view)).toBe('2 · Incline')

    setLevels(['Wall', 'Knee'])
    fireChanged(exerciseNote)
    await settle()

    expect(levelLabelText(view)).toBe('2 · Knee')
  })

  it.each([
    ['a workout note', 'Fitness/Workouts/2026-08-14.md'],
    ['a folder sharing the exercises prefix', 'Fitness/Exercises-old/Push-up.md'],
  ])('leaves the editor in place when %s changes', async (_label, path) => {
    const { view, workout, fireChanged } = createView({ levels: ['Wall', 'Incline'] })
    await view.onOpen()
    await view.loadFile(workout)
    const reps = repsInput(view)

    fireChanged(createFile(path))
    await settle()

    expect(reps).not.toBeNull()
    expect(repsInput(view)).toBe(reps)
  })

  it('keeps the empty hint when an exercise note changes before a workout loads', async () => {
    const { view, exerciseNote, fireChanged } = createView({ levels: ['Wall', 'Incline'] })
    await view.onOpen()

    fireChanged(exerciseNote)
    await settle()

    expect(view.contentEl.querySelector('.fitkit-empty')?.textContent).toBe(
      'Open a workout note to edit.',
    )
  })
})
