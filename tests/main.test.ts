import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', () => {
  class App {}
  class Plugin {
    app: unknown
    constructor(app: unknown) {
      this.app = app
    }
    registerEvent(): void {}
    registerView(): void {}
    addCommand(): void {}
    addSettingTab(): void {}
    async loadData(): Promise<unknown> {
      return null
    }
    async saveData(): Promise<void> {}
  }

  class ItemView {
    app: unknown
    contentEl: {
      addClass: () => void
      empty: () => void
      createDiv: () => { setText: () => void }
      classList: { toggle: () => void }
      clientWidth: number
    }
    constructor(leaf: unknown) {
      this.app =
        leaf && typeof leaf === 'object' && 'app' in leaf
          ? (leaf as { app?: unknown }).app
          : undefined
      this.contentEl = {
        addClass: () => {},
        empty: () => {},
        createDiv: () => ({ setText: () => {} }),
        classList: { toggle: () => {} },
        clientWidth: 0,
      }
    }
  }

  class MarkdownView {
    file: unknown = null
    leaf: unknown = null
    constructor(opts: { file?: unknown; leaf?: unknown } = {}) {
      Object.assign(this, opts)
    }
  }

  class Modal {
    contentEl = {}
    constructor(_app: unknown) {}
    open(): void {}
    close(): void {}
  }

  class SuggestModal extends Modal {}

  class Menu {
    addItem(): this {
      return this
    }
    addSeparator(): this {
      return this
    }
    showAtPosition(): void {}
    showAtMouseEvent(): void {}
  }

  class Notice {
    constructor(readonly message: string) {}
  }

  class PluginSettingTab {
    constructor(_app: unknown, _plugin: unknown) {}
    display(): void {}
    hide(): void {}
  }

  class Setting {
    constructor(_containerEl: unknown) {}
    setName(): this {
      return this
    }
    setDesc(): this {
      return this
    }
    addText(): this {
      return this
    }
    addToggle(): this {
      return this
    }
    addButton(): this {
      return this
    }
    addDropdown(): this {
      return this
    }
  }

  class TFile {
    path = ''
    extension = ''
    basename = ''
  }

  return {
    App,
    ItemView,
    MarkdownView,
    Menu,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    SuggestModal,
    TFile,
    normalizePath: (path: string) => path.replace(/\/+/g, '/'),
    setIcon: () => {},
  }
})

import { MarkdownView, TFile } from 'obsidian'

import FitKitPlugin from '../src/main'
import { VIEW_TYPE_FITKIT_WORKOUT_EDITOR, WorkoutEditorView } from '../src/ui/workout-editor-view'

interface SetViewStateArg {
  type?: string
  active?: boolean
}

interface MockLeaf {
  view: unknown
  setViewState: (state: SetViewStateArg) => Promise<void>
  detach: () => void
  getRoot: () => unknown
}

interface MockWorkspace {
  rootSplit: unknown
  getActiveViewOfType: (ctor: unknown) => unknown
  getLeavesOfType: (type: string) => MockLeaf[]
  iterateRootLeaves: (cb: (leaf: MockLeaf) => void) => void
  revealLeaf: (leaf: MockLeaf) => Promise<void>
  onLayoutReady: (cb: () => void) => void
  getLeaf: (mode?: string) => MockLeaf
  on: (event: string, cb: (...args: unknown[]) => void) => unknown
}

interface MockApp {
  workspace: MockWorkspace
  metadataCache: {
    getFileCache: (file: TFile) => { frontmatter?: { type?: unknown } } | null
  }
}

interface TestPlugin {
  app: MockApp
  maybeRouteWorkoutFile(file: TFile): Promise<void>
  sweepLeavesForWorkout(): void
  openWorkoutEditor(file: TFile): Promise<void>
}

const makeEditorView = (
  file: TFile | null,
): WorkoutEditorView & { loadFile: ReturnType<typeof vi.fn> } => {
  const view = Object.create(WorkoutEditorView.prototype) as WorkoutEditorView & {
    loadFile: ReturnType<typeof vi.fn>
    session: { file: TFile } | null
  }
  view.loadFile = vi.fn(async () => undefined)
  view.session = file ? { file } : null
  return view
}

const makeEditorLeaf = (currentFile: TFile | null): MockLeaf => {
  const leaf: MockLeaf = {
    view: makeEditorView(currentFile),
    setViewState: vi.fn(async (state: SetViewStateArg) => {
      if (state.type === VIEW_TYPE_FITKIT_WORKOUT_EDITOR) {
        leaf.view = makeEditorView(currentFile)
      }
    }),
    detach: vi.fn(),
    getRoot: vi.fn(() => null),
  }
  return leaf
}

const createPlugin = (app: MockApp): TestPlugin => {
  const plugin = Object.create(FitKitPlugin.prototype) as TestPlugin
  plugin.app = app
  return plugin
}

const makeWorkoutFile = (path = 'Workouts/2026-04-28.md'): TFile => {
  const file = new TFile()
  file.path = path
  file.extension = 'md'
  file.basename = path.split('/').pop()?.replace(/\.md$/, '') ?? ''
  return file
}

const makeLeafShowingFile = (file: TFile): MockLeaf => {
  const leaf: MockLeaf = {
    view: null,
    setViewState: vi.fn(async (state: SetViewStateArg) => {
      if (state.type === VIEW_TYPE_FITKIT_WORKOUT_EDITOR) {
        const editorView = Object.create(WorkoutEditorView.prototype) as WorkoutEditorView & {
          loadFile: ReturnType<typeof vi.fn>
        }
        editorView.loadFile = vi.fn(async () => undefined)
        leaf.view = editorView
      }
    }),
    detach: vi.fn(),
    getRoot: vi.fn(() => null),
  }
  leaf.view = new MarkdownView({ file, leaf })
  return leaf
}

const makeApp = (overrides: Partial<MockWorkspace> = {}): MockApp => ({
  workspace: {
    rootSplit: {},
    getActiveViewOfType: vi.fn(() => null),
    getLeavesOfType: vi.fn(() => []),
    iterateRootLeaves: vi.fn(),
    revealLeaf: vi.fn(async () => undefined),
    onLayoutReady: vi.fn(),
    getLeaf: vi.fn(() => makeLeafShowingFile(makeWorkoutFile())),
    on: vi.fn(),
    ...overrides,
  },
  metadataCache: {
    getFileCache: vi.fn(() => null),
  },
})

describe('FitKitPlugin file-open routing (no editor open)', () => {
  let app: MockApp
  let plugin: TestPlugin

  beforeEach(() => {
    app = makeApp()
    plugin = createPlugin(app)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('swaps the active markdown leaf to the workout editor for a workout file', async () => {
    const file = makeWorkoutFile()
    const leaf = makeLeafShowingFile(file)
    app.workspace.getActiveViewOfType = vi.fn(() => leaf.view)
    app.metadataCache.getFileCache = vi.fn(() => ({ frontmatter: { type: 'workout' } }))

    await plugin.maybeRouteWorkoutFile(file)

    expect(leaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_FITKIT_WORKOUT_EDITOR,
      active: true,
    })
    expect(leaf.view).toBeInstanceOf(WorkoutEditorView)
    const loadFile = (leaf.view as { loadFile: ReturnType<typeof vi.fn> }).loadFile
    expect(loadFile).toHaveBeenCalledWith(file)
  })

  it('opens the editor automatically with no pre-existing workout-editor leaf (no command palette required)', async () => {
    const file = makeWorkoutFile()
    const leaf = makeLeafShowingFile(file)
    app.workspace.getLeavesOfType = vi.fn(() => [])
    app.workspace.iterateRootLeaves = vi.fn()
    app.workspace.getActiveViewOfType = vi.fn(() => leaf.view)
    app.metadataCache.getFileCache = vi.fn(() => ({ frontmatter: { type: 'workout' } }))

    expect(app.workspace.getLeavesOfType(VIEW_TYPE_FITKIT_WORKOUT_EDITOR)).toEqual([])

    await plugin.maybeRouteWorkoutFile(file)

    expect(leaf.setViewState).toHaveBeenCalledTimes(1)
    expect(leaf.view).toBeInstanceOf(WorkoutEditorView)
    const loadFile = (leaf.view as { loadFile: ReturnType<typeof vi.fn> }).loadFile
    expect(loadFile).toHaveBeenCalledWith(file)
  })

  it('leaves a non-workout markdown note alone', async () => {
    const file = makeWorkoutFile('Journal/2026-04-28.md')
    const leaf = makeLeafShowingFile(file)
    app.workspace.getActiveViewOfType = vi.fn(() => leaf.view)
    app.metadataCache.getFileCache = vi.fn(() => ({ frontmatter: { type: 'journal' } }))

    await plugin.maybeRouteWorkoutFile(file)

    expect(leaf.setViewState).not.toHaveBeenCalled()
    expect(leaf.view).toBeInstanceOf(MarkdownView)
  })

  it('ignores non-md files', async () => {
    const file = new TFile()
    file.path = 'Attachments/photo.png'
    file.extension = 'png'

    await plugin.maybeRouteWorkoutFile(file)

    expect(app.workspace.getActiveViewOfType).not.toHaveBeenCalled()
  })

  it('returns early when no editor leaf exists and the active view is not a markdown view', async () => {
    const file = makeWorkoutFile()
    app.workspace.getActiveViewOfType = vi.fn(() => null)
    app.metadataCache.getFileCache = vi.fn(() => ({ frontmatter: { type: 'workout' } }))

    await plugin.maybeRouteWorkoutFile(file)

    expect(app.workspace.getActiveViewOfType).toHaveBeenCalled()
  })
})

describe('FitKitPlugin file-open routing (editor already open)', () => {
  it('retargets the existing editor leaf to the new file and detaches the stray markdown leaf', async () => {
    const fileA = makeWorkoutFile('Workouts/A.md')
    const fileB = makeWorkoutFile('Workouts/B.md')
    const editorLeaf = makeEditorLeaf(fileA)
    const strayMarkdownLeaf = makeLeafShowingFile(fileB)

    const cache = new Map<string, { frontmatter?: { type?: string } }>([
      [fileA.path, { frontmatter: { type: 'workout' } }],
      [fileB.path, { frontmatter: { type: 'workout' } }],
    ])
    const app = makeApp({
      iterateRootLeaves: vi.fn((cb: (leaf: MockLeaf) => void) => cb(editorLeaf)),
      getLeavesOfType: vi.fn((type: string) =>
        type === VIEW_TYPE_FITKIT_WORKOUT_EDITOR ? [editorLeaf] : [],
      ),
      getActiveViewOfType: vi.fn(() => strayMarkdownLeaf.view),
    })
    app.metadataCache.getFileCache = vi.fn((file: TFile) => cache.get(file.path) ?? null)
    const plugin = createPlugin(app)

    await plugin.maybeRouteWorkoutFile(fileB)

    expect(strayMarkdownLeaf.detach).toHaveBeenCalledTimes(1)
    expect(editorLeaf.setViewState).not.toHaveBeenCalled()
    const loadFile = (editorLeaf.view as { loadFile: ReturnType<typeof vi.fn> }).loadFile
    expect(loadFile).toHaveBeenCalledWith(fileB)
  })

  it('is a no-op when the user re-clicks the file the editor is already showing', async () => {
    const fileA = makeWorkoutFile('Workouts/A.md')
    const editorLeaf = makeEditorLeaf(fileA)
    const strayMarkdownLeaf = makeLeafShowingFile(fileA)

    const app = makeApp({
      iterateRootLeaves: vi.fn((cb: (leaf: MockLeaf) => void) => cb(editorLeaf)),
      getLeavesOfType: vi.fn((type: string) =>
        type === VIEW_TYPE_FITKIT_WORKOUT_EDITOR ? [editorLeaf] : [],
      ),
      getActiveViewOfType: vi.fn(() => strayMarkdownLeaf.view),
    })
    app.metadataCache.getFileCache = vi.fn(() => ({ frontmatter: { type: 'workout' } }))
    const plugin = createPlugin(app)

    await plugin.maybeRouteWorkoutFile(fileA)

    expect(editorLeaf.setViewState).not.toHaveBeenCalled()
    expect(strayMarkdownLeaf.detach).not.toHaveBeenCalled()
    const loadFile = (editorLeaf.view as { loadFile: ReturnType<typeof vi.fn> }).loadFile
    expect(loadFile).not.toHaveBeenCalled()
  })

  it('ignores phantom file-open events that do not have a matching active markdown view', async () => {
    const fileA = makeWorkoutFile('Workouts/A.md')
    const fileB = makeWorkoutFile('Workouts/B.md')
    const editorLeaf = makeEditorLeaf(fileB)

    /** No active markdown view for fileA (the editor is the active leaf, not a markdown leaf). file-open for fileA could come from revealLeaf or leaf history; it is not a user click and must not retarget the editor. */
    const app = makeApp({
      iterateRootLeaves: vi.fn((cb: (leaf: MockLeaf) => void) => cb(editorLeaf)),
      getLeavesOfType: vi.fn((type: string) =>
        type === VIEW_TYPE_FITKIT_WORKOUT_EDITOR ? [editorLeaf] : [],
      ),
      getActiveViewOfType: vi.fn(() => null),
    })
    app.metadataCache.getFileCache = vi.fn(() => ({ frontmatter: { type: 'workout' } }))
    const plugin = createPlugin(app)

    await plugin.maybeRouteWorkoutFile(fileA)

    expect(editorLeaf.setViewState).not.toHaveBeenCalled()
    const loadFile = (editorLeaf.view as { loadFile: ReturnType<typeof vi.fn> }).loadFile
    expect(loadFile).not.toHaveBeenCalled()
  })

  it('does not interfere when the editor is open and the user clicks a non-workout markdown note', async () => {
    const fileA = makeWorkoutFile('Workouts/A.md')
    const journal = makeWorkoutFile('Journal/2026-04-28.md')
    const editorLeaf = makeEditorLeaf(fileA)
    const journalLeaf = makeLeafShowingFile(journal)

    const app = makeApp({
      iterateRootLeaves: vi.fn((cb: (leaf: MockLeaf) => void) => cb(editorLeaf)),
      getLeavesOfType: vi.fn((type: string) =>
        type === VIEW_TYPE_FITKIT_WORKOUT_EDITOR ? [editorLeaf] : [],
      ),
      getActiveViewOfType: vi.fn(() => journalLeaf.view),
    })
    app.metadataCache.getFileCache = vi.fn(() => ({ frontmatter: { type: 'journal' } }))
    const plugin = createPlugin(app)

    await plugin.maybeRouteWorkoutFile(journal)

    expect(editorLeaf.setViewState).not.toHaveBeenCalled()
    expect(journalLeaf.detach).not.toHaveBeenCalled()
    const loadFile = (editorLeaf.view as { loadFile: ReturnType<typeof vi.fn> }).loadFile
    expect(loadFile).not.toHaveBeenCalled()
  })
})

describe('FitKitPlugin layout-ready sweep', () => {
  it('swaps every markdown leaf showing a workout file and skips others', () => {
    const workoutFile = makeWorkoutFile('Workouts/A.md')
    const journalFile = makeWorkoutFile('Journal/B.md')
    const workoutLeaf = makeLeafShowingFile(workoutFile)
    const journalLeaf = makeLeafShowingFile(journalFile)
    const cache = new Map<string, { frontmatter?: { type?: string } }>([
      [workoutFile.path, { frontmatter: { type: 'workout' } }],
      [journalFile.path, { frontmatter: { type: 'journal' } }],
    ])
    const app = makeApp({
      getLeavesOfType: vi.fn((type: string) =>
        type === 'markdown' ? [workoutLeaf, journalLeaf] : [],
      ),
    })
    app.metadataCache.getFileCache = vi.fn((file: TFile) => cache.get(file.path) ?? null)
    const plugin = createPlugin(app)

    plugin.sweepLeavesForWorkout()

    expect(workoutLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_FITKIT_WORKOUT_EDITOR,
      active: true,
    })
    expect(journalLeaf.setViewState).not.toHaveBeenCalled()
  })
})

describe('FitKitPlugin openWorkoutEditor command path', () => {
  it('reuses an existing main-area workout-editor leaf instead of opening a new tab', async () => {
    const file = makeWorkoutFile()
    const existingEditorLeaf: MockLeaf = {
      view: {
        getViewType: () => VIEW_TYPE_FITKIT_WORKOUT_EDITOR,
      },
      setViewState: vi.fn(async (state: SetViewStateArg) => {
        if (state.type === VIEW_TYPE_FITKIT_WORKOUT_EDITOR) {
          const editorView = Object.create(WorkoutEditorView.prototype) as WorkoutEditorView & {
            loadFile: ReturnType<typeof vi.fn>
          }
          editorView.loadFile = vi.fn(async () => undefined)
          existingEditorLeaf.view = editorView
        }
      }),
      detach: vi.fn(),
      getRoot: vi.fn(() => null),
    }
    const getLeafSpy = vi.fn(() => makeLeafShowingFile(file))
    const app = makeApp({
      iterateRootLeaves: vi.fn((cb: (leaf: MockLeaf) => void) => {
        cb(existingEditorLeaf)
      }),
      getLeavesOfType: vi.fn((type: string) =>
        type === VIEW_TYPE_FITKIT_WORKOUT_EDITOR ? [existingEditorLeaf] : [],
      ),
      getLeaf: getLeafSpy,
    })
    const plugin = createPlugin(app)

    await plugin.openWorkoutEditor(file)

    expect(getLeafSpy).not.toHaveBeenCalled()
    expect(existingEditorLeaf.setViewState).toHaveBeenCalled()
    expect(existingEditorLeaf.view).toBeInstanceOf(WorkoutEditorView)
    const loadFile = (existingEditorLeaf.view as { loadFile: ReturnType<typeof vi.fn> }).loadFile
    expect(loadFile).toHaveBeenCalledWith(file)
  })
})
