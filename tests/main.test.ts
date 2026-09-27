import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const noticeMessages = vi.hoisted(() => [] as string[])
const registeredCommandIds = vi.hoisted(() => [] as string[])

vi.mock('obsidian', async () => {
  const { mixinFileView } = await import('./fixtures/obsidian-file-view')

  class App {}
  class Plugin {
    app: unknown
    constructor(app: unknown) {
      this.app = app
    }
    registerEvent(): void {}
    registerMarkdownCodeBlockProcessor(): void {}
    registerMarkdownPostProcessor(): void {}
    registerView(): void {}
    addCommand(command: { id: string }): void {
      registeredCommandIds.push(command.id)
    }
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
    getState(): Record<string, unknown> {
      return {}
    }
    async setState(): Promise<void> {}
    onPaneMenu(): void {}
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

    setTitle(_title: string): this {
      return this
    }
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
    constructor(readonly message: string) {
      noticeMessages.push(message)
    }
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

  const FileView = mixinFileView(ItemView, (value): value is TFile => value instanceof TFile)

  return {
    App,
    FileView,
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

import { MarkdownView, Modal, TFile, type App, type Menu } from 'obsidian'

import FitKitPlugin from '../src/main'
import { DEFAULT_SETTINGS, type FitKitSettings } from '../src/settings'
import { VIEW_TYPE_FITKIT_WORKOUT_EDITOR, WorkoutEditorView } from '../src/ui/workout-editor-view'
import { rebuildIndex } from '../src/vault/index'
import { buildMockVaultFolderTree, type MockVaultFolder } from './fixtures/mock-vault-folder-tree'

interface SetViewStateArg {
  type?: string
  active?: boolean
  state?: Record<string, unknown>
}

interface MockLeaf {
  view: unknown
  /** Mirrors WorkspaceLeaf.working: true while Obsidian is still opening a view in the leaf. */
  working?: boolean
  setViewState: (state: SetViewStateArg) => Promise<void>
  detach: () => void
  getRoot: () => unknown
}

interface MockWorkspace {
  rootSplit: unknown
  getActiveFile: () => TFile | null
  getActiveViewOfType: (ctor: unknown) => unknown
  getLeavesOfType: (type: string) => MockLeaf[]
  iterateRootLeaves: (cb: (leaf: MockLeaf) => void) => void
  revealLeaf: (leaf: MockLeaf) => Promise<void>
  onLayoutReady: (cb: () => void) => void
  getLeaf: (mode?: string) => MockLeaf
  on: (event: string, cb: (...args: unknown[]) => void) => unknown
}

interface MockVault {
  getFolderByPath: (path: string) => MockVaultFolder | null
  read: (file: TFile) => Promise<string>
  process: (file: TFile, callback: (live: string) => string) => Promise<void>
}

interface MockApp {
  workspace: MockWorkspace
  vault: MockVault
  metadataCache: {
    getFileCache: (file: TFile) => { frontmatter?: { type?: unknown } } | null
  }
}

interface TestPlugin {
  app: MockApp
  settings: FitKitSettings
  loadSettings(): Promise<void>
  maybeRouteWorkoutFile(file: TFile): Promise<void>
  sweepLeavesForWorkout(): void
  openWorkoutEditor(file: TFile): Promise<void>
  showExerciseRegistryDiagnostics(): void
  syncExerciseNotes(): Promise<void>
  rebuildExerciseRegistry(): Promise<void>
}

const makeEditorView = (
  file: TFile | null,
): WorkoutEditorView & {
  loadFile: ReturnType<typeof vi.fn>
} => {
  const view = Object.create(WorkoutEditorView.prototype) as WorkoutEditorView & {
    loadFile: ReturnType<typeof vi.fn>
    session: { file: TFile } | null
  }
  Object.assign(view, {
    app: {
      vault: { getAbstractFileByPath: vaultFileAt },
      workspace: { requestSaveLayout: vi.fn() },
    },
  })
  view.loadFile = vi.fn(async () => undefined)
  view.session = file ? { file } : null
  return view
}

/** Mirrors WorkspaceLeaf.setViewState: ignore the call while the leaf is busy, mount a new view only on a type change, then hand it the state. A markdown state always mounts a fresh MarkdownView of its file. */
const applyViewState = async (
  leaf: MockLeaf,
  state: SetViewStateArg,
  currentFile: TFile | null,
): Promise<void> => {
  if (leaf.working) {
    return
  }
  if (state.type === 'markdown') {
    const path = state.state?.file
    leaf.view = new MarkdownView({
      file: typeof path === 'string' ? vaultFileAt(path) : null,
      leaf,
    })
    return
  }
  if (state.type !== VIEW_TYPE_FITKIT_WORKOUT_EDITOR) {
    return
  }
  if (!(leaf.view instanceof WorkoutEditorView)) {
    leaf.view = makeEditorView(currentFile)
  }
  await (leaf.view as WorkoutEditorView).setState(state.state ?? {}, { history: false })
}

const makeEditorLeaf = (currentFile: TFile | null): MockLeaf => {
  const leaf: MockLeaf = {
    view: makeEditorView(currentFile),
    setViewState: vi.fn((state: SetViewStateArg) => applyViewState(leaf, state, currentFile)),
    detach: vi.fn(),
    getRoot: vi.fn(() => null),
  }
  return leaf
}

const createPlugin = (
  app: MockApp,
  settings: FitKitSettings = { ...DEFAULT_SETTINGS },
): TestPlugin => {
  const plugin = Object.create(FitKitPlugin.prototype) as TestPlugin
  plugin.app = app
  plugin.settings = settings
  return plugin
}

/** Like Obsidian's vault, hands out one TFile per path, so a file keeps its identity across view switches and renames. */
const mockVaultFiles = new Map<string, TFile>()

const makeWorkoutFile = (path = 'Workouts/2026-04-28.md'): TFile => {
  const file = new TFile()
  file.path = path
  file.extension = 'md'
  file.basename = path.split('/').pop()?.replace(/\.md$/, '') ?? ''
  mockVaultFiles.set(path, file)
  return file
}

const vaultFileAt = (path: string): TFile => mockVaultFiles.get(path) ?? makeWorkoutFile(path)

const makeLeafShowingFile = (file: TFile): MockLeaf => {
  const leaf: MockLeaf = {
    view: null,
    setViewState: vi.fn((state: SetViewStateArg) => applyViewState(leaf, state, null)),
    detach: vi.fn(),
    getRoot: vi.fn(() => null),
  }
  leaf.view = new MarkdownView({ file, leaf })
  return leaf
}

const makeApp = (
  overrides: Partial<MockWorkspace> = {},
  vaultOverrides: Partial<MockVault> = {},
): MockApp => ({
  workspace: {
    rootSplit: {},
    getActiveFile: vi.fn(() => null),
    getActiveViewOfType: vi.fn(() => null),
    getLeavesOfType: vi.fn(() => []),
    iterateRootLeaves: vi.fn(),
    revealLeaf: vi.fn(async () => undefined),
    onLayoutReady: vi.fn(),
    getLeaf: vi.fn(() => makeLeafShowingFile(makeWorkoutFile())),
    on: vi.fn(),
    ...overrides,
  },
  vault: {
    getFolderByPath: vi.fn(() => null),
    read: vi.fn(async () => ''),
    process: vi.fn(async () => undefined),
    ...vaultOverrides,
  },
  metadataCache: {
    getFileCache: vi.fn(() => null),
  },
})

beforeEach(() => {
  vi.stubGlobal('window', { setTimeout })
  mockVaultFiles.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FitKitPlugin command registration', () => {
  beforeEach(() => {
    registeredCommandIds.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps daily commands in the palette and prunes settings maintenance actions', async () => {
    const app = makeApp()
    const plugin = new (FitKitPlugin as unknown as { new (app: MockApp): FitKitPlugin })(app)

    await plugin.onload()

    expect(registeredCommandIds).toHaveLength(2)
    expect(registeredCommandIds).toEqual(
      expect.arrayContaining(['open-todays-workout', 'open-workout-editor']),
    )
    expect(registeredCommandIds).not.toContain('rebuild-index')
    expect(registeredCommandIds).not.toContain('rebuild-dashboard')
    expect(registeredCommandIds).not.toContain('restore-hidden-sections')
    expect(registeredCommandIds).not.toContain('show-parse-diagnostics')
    expect(registeredCommandIds).not.toContain('sync-exercise-notes')
  })
})

describe('FitKitPlugin settings loading', () => {
  it('keeps stored settings when schemaVersion is omitted', async () => {
    const app = makeApp()
    const plugin = new (FitKitPlugin as unknown as { new (app: MockApp): FitKitPlugin })(app)
    const stored = {
      fitnessRoot: 'Area/Fitness',
      exerciseRegistry: [
        { name: 'Squat', kind: 'strength' as const, unit: 'kg' as const, aliases: ['back squat'] },
      ],
      hiddenDashboardSectionsByPath: { 'Fitness/Fitness Dashboard.md': ['exercise:Squat'] },
    }
    const loadData = vi.spyOn(plugin, 'loadData').mockResolvedValue(stored)
    const saveData = vi.spyOn(plugin, 'saveData').mockResolvedValue(undefined)

    await plugin.loadSettings()

    expect(loadData).toHaveBeenCalledTimes(1)
    expect(saveData).not.toHaveBeenCalled()
    expect(plugin.settings.fitnessRoot).toBe('Area/Fitness')
    expect(plugin.settings.exerciseRegistry).toEqual([
      { name: 'Squat', kind: 'strength', unit: 'kg', aliases: ['back squat'] },
    ])
    expect(plugin.settings.deletedExercises).toEqual([])
  })
})

describe('FitKitPlugin exercise registry diagnostics', () => {
  beforeEach(() => {
    noticeMessages.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a notice when the exercise registry has no diagnostics', () => {
    const app = makeApp()
    const plugin = createPlugin(app)
    const openSpy = vi.spyOn(Modal.prototype, 'open')

    plugin.showExerciseRegistryDiagnostics()

    expect(openSpy).not.toHaveBeenCalled()
    expect(noticeMessages).toEqual(['No exercise registry diagnostics.'])
  })

  it('opens exercise registry diagnostics when catalog notes need validation', () => {
    const file = makeWorkoutFile('Fitness/Exercises/Mystery.md')
    const app = makeApp(
      {},
      {
        getFolderByPath: buildMockVaultFolderTree([file]).getFolderByPath,
      },
    )
    app.metadataCache.getFileCache = vi.fn((target: TFile) =>
      target.path === file.path ? { frontmatter: { type: 'exercise' } } : null,
    )
    const plugin = createPlugin(app, { ...DEFAULT_SETTINGS, fitnessRoot: 'Fitness' })
    const openedModals: unknown[] = []
    vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: unknown) {
      openedModals.push(this)
    })

    plugin.showExerciseRegistryDiagnostics()

    expect(noticeMessages).toEqual([])
    expect(openedModals).toHaveLength(1)
    const modal = openedModals[0] as {
      title: string
      diagnostics: Array<{ path?: string; warnings: string[] }>
    }
    expect(modal.title).toBe('Exercise registry diagnostics')
    expect(modal.diagnostics).toEqual([
      {
        kind: 'catalog',
        path: 'Fitness/Exercises/Mystery.md',
        warnings: ['Exercise note is missing a valid kind.'],
      },
    ])
  })
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
      state: { file: file.path },
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

  it('leaves workout markdown open when auto-open editor is disabled', async () => {
    const file = makeWorkoutFile()
    const leaf = makeLeafShowingFile(file)
    app.workspace.getActiveViewOfType = vi.fn(() => leaf.view)
    app.metadataCache.getFileCache = vi.fn(() => ({ frontmatter: { type: 'workout' } }))
    plugin.settings = { ...DEFAULT_SETTINGS, autoOpenWorkoutEditor: false }

    await plugin.maybeRouteWorkoutFile(file)

    expect(leaf.setViewState).not.toHaveBeenCalled()
    expect(app.workspace.getActiveViewOfType).not.toHaveBeenCalled()
  })
})

describe('FitKitPlugin syncExerciseNotes', () => {
  beforeEach(() => {
    noticeMessages.length = 0
  })

  it('repairs no-registry missing kind and reports validation guidance', async () => {
    const file = makeWorkoutFile('Fitness/Exercises/Mystery.md')
    const contents = new Map<string, string>([
      [
        file.path,
        `---
type: exercise
---

## Notes
`,
      ],
    ])
    const app = makeApp(
      {},
      {
        getFolderByPath: buildMockVaultFolderTree([file]).getFolderByPath,
        read: vi.fn(async (target: TFile) => contents.get(target.path) ?? ''),
        process: vi.fn(async (target: TFile, callback: (live: string) => string) => {
          contents.set(target.path, callback(contents.get(target.path) ?? ''))
        }),
      },
    )
    const plugin = createPlugin(app, {
      ...DEFAULT_SETTINGS,
      exerciseRegistry: [],
      fitnessRoot: 'Fitness',
    })

    await plugin.syncExerciseNotes()

    expect(contents.get(file.path)).toContain(`type: exercise
kind: strength
metric: e1rm
unit: kg
---`)
    expect(contents.get(file.path)).toContain('## Recent sessions')
    expect(noticeMessages).toHaveLength(1)
    expect(noticeMessages[0]).toContain('1 updated (1 needs validation')
    expect(noticeMessages[0]).toContain('0 already current')
    expect(noticeMessages[0]).toContain('kind inferred/defaulted without registry')
  })

  it('preserves valid note kind when the saved registry kind differs and reports conflict', async () => {
    const file = makeWorkoutFile('Fitness/Exercises/Squat.md')
    const contents = new Map<string, string>([
      [
        file.path,
        `---
type: exercise
kind: duration
---

## Notes
`,
      ],
    ])
    const app = makeApp(
      {},
      {
        getFolderByPath: buildMockVaultFolderTree([file]).getFolderByPath,
        read: vi.fn(async (target: TFile) => contents.get(target.path) ?? ''),
        process: vi.fn(async (target: TFile, callback: (live: string) => string) => {
          contents.set(target.path, callback(contents.get(target.path) ?? ''))
        }),
      },
    )
    app.metadataCache.getFileCache = vi.fn(() => ({
      frontmatter: { type: 'exercise', kind: 'duration' },
    }))
    const plugin = createPlugin(app, {
      ...DEFAULT_SETTINGS,
      exerciseRegistry: [{ name: 'Squat', kind: 'strength', unit: 'kg', aliases: [] }],
      fitnessRoot: 'Fitness',
    })

    await plugin.syncExerciseNotes()

    expect(contents.get(file.path)).toContain(`type: exercise
kind: duration
---`)
    expect(contents.get(file.path)).not.toContain('kind: strength')
    expect(noticeMessages).toHaveLength(1)
    expect(noticeMessages[0]).toContain('1 registry kind conflict preserved')
  })
})

describe('FitKitPlugin rebuildExerciseRegistry', () => {
  beforeEach(() => {
    noticeMessages.length = 0
  })

  it('backfills note-backed and history-only exercises, skips tombstoned, reports counts, and is idempotent', async () => {
    const workoutFile = makeWorkoutFile('Fitness/Workouts/2026-05-08.md')
    const squatFile = makeWorkoutFile('Fitness/Exercises/Squat.md')
    const contents = new Map<string, string>([
      [
        workoutFile.path,
        `---
type: workout
date: 2026-05-08
name: Test
---

## [[Squat]]

- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]

## [[New Plank]]

- [exercise:: [[New Plank]]] [duration:: 60]

## [[Old Lift]]

- [exercise:: [[Old Lift]]] [set:: 1] [weight:: 20] [reps:: 10]
`,
      ],
    ])
    const app = makeApp(
      {},
      {
        getFolderByPath: buildMockVaultFolderTree([workoutFile, squatFile]).getFolderByPath,
        read: vi.fn(async (target: TFile) => contents.get(target.path) ?? ''),
      },
    )
    app.metadataCache.getFileCache = vi.fn((target: TFile) =>
      target.path === squatFile.path
        ? { frontmatter: { type: 'exercise', kind: 'strength' } }
        : null,
    )
    const plugin = createPlugin(app, {
      ...DEFAULT_SETTINGS,
      fitnessRoot: 'Fitness',
      exerciseRegistry: [],
      deletedExercises: ['Old Lift'],
    })

    await plugin.rebuildExerciseRegistry()

    expect(plugin.settings.exerciseRegistry).toEqual([
      { name: 'New Plank', kind: 'duration', aliases: [] },
      { name: 'Squat', kind: 'strength', aliases: [] },
    ])
    expect(plugin.settings.exerciseRegistry.every((entry) => entry.unit === undefined)).toBe(true)
    expect(noticeMessages).toHaveLength(1)
    expect(noticeMessages[0]).toContain('1 added from notes')
    expect(noticeMessages[0]).toContain('1 added from history')
    expect(noticeMessages[0]).toContain('0 already present')
    expect(noticeMessages[0]).toContain('1 skipped')

    await plugin.rebuildExerciseRegistry()

    expect(plugin.settings.exerciseRegistry).toEqual([
      { name: 'New Plank', kind: 'duration', aliases: [] },
      { name: 'Squat', kind: 'strength', aliases: [] },
    ])
    expect(noticeMessages).toHaveLength(2)
    expect(noticeMessages[1]).toContain('0 added from notes')
    expect(noticeMessages[1]).toContain('0 added from history')
    /**
     * 'New Plank' is now an overlay entry, so it's excluded from history-only
     * candidates entirely on the second pass (not merely re-flagged as already
     * present); only 'Squat' still surfaces via the note catalog to be counted.
     */
    expect(noticeMessages[1]).toContain('1 already present')
    expect(noticeMessages[1]).toContain('1 skipped')
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
    expect(editorLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_FITKIT_WORKOUT_EDITOR,
      active: true,
      state: { file: fileB.path },
    })
    const loadFile = (editorLeaf.view as { loadFile: ReturnType<typeof vi.fn> }).loadFile
    expect(loadFile).toHaveBeenCalledWith(fileB)
  })

  it('swaps the editor tab back to the workout editor when Obsidian opened the clicked workout in it', async () => {
    /** Clicking a workout while the editor tab is focused opens it as markdown in that same tab, and file-open fires before Obsidian has finished opening it. */
    const fileB = makeWorkoutFile('Workouts/B.md')
    const editorTab = makeLeafShowingFile(fileB)
    editorTab.working = true
    const app = makeApp({ getActiveViewOfType: vi.fn(() => editorTab.view) })
    app.metadataCache.getFileCache = vi.fn(() => ({ frontmatter: { type: 'workout' } }))
    const plugin = createPlugin(app)

    window.setTimeout(() => {
      editorTab.working = false
    }, 120)
    await plugin.maybeRouteWorkoutFile(fileB)

    expect(editorTab.view).toBeInstanceOf(WorkoutEditorView)
    const loadFile = (editorTab.view as { loadFile: ReturnType<typeof vi.fn> }).loadFile
    expect(loadFile).toHaveBeenCalledWith(fileB)
  })

  it('stops trying to swap a busy tab once the user has opened something else in it', async () => {
    const fileB = makeWorkoutFile('Workouts/B.md')
    const journal = makeWorkoutFile('Journal/today.md')
    const editorTab = makeLeafShowingFile(fileB)
    const workoutView = editorTab.view
    editorTab.working = true
    const app = makeApp({ getActiveViewOfType: vi.fn(() => workoutView) })
    app.metadataCache.getFileCache = vi.fn(() => ({ frontmatter: { type: 'workout' } }))
    const plugin = createPlugin(app)

    window.setTimeout(() => {
      editorTab.view = new MarkdownView({ file: journal, leaf: editorTab })
      editorTab.working = false
    }, 20)
    await plugin.maybeRouteWorkoutFile(fileB)

    expect(editorTab.view).toBeInstanceOf(MarkdownView)
    expect((editorTab.view as MarkdownView).file).toBe(journal)
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
      state: { file: workoutFile.path },
    })
    expect(journalLeaf.setViewState).not.toHaveBeenCalled()
  })

  it('does not sweep workout markdown leaves when auto-open editor is disabled', () => {
    const workoutFile = makeWorkoutFile('Workouts/A.md')
    const workoutLeaf = makeLeafShowingFile(workoutFile)
    const app = makeApp({
      getLeavesOfType: vi.fn((type: string) => (type === 'markdown' ? [workoutLeaf] : [])),
    })
    app.metadataCache.getFileCache = vi.fn(() => ({ frontmatter: { type: 'workout' } }))
    const plugin = createPlugin(app, { ...DEFAULT_SETTINGS, autoOpenWorkoutEditor: false })

    plugin.sweepLeavesForWorkout()

    expect(workoutLeaf.setViewState).not.toHaveBeenCalled()
    expect(app.workspace.getLeavesOfType).not.toHaveBeenCalled()
  })
})

describe('FitKitPlugin openWorkoutEditor command path', () => {
  it('reuses an existing main-area workout-editor leaf instead of opening a new tab', async () => {
    const file = makeWorkoutFile()
    const existingEditorLeaf: MockLeaf = {
      view: {
        getViewType: () => VIEW_TYPE_FITKIT_WORKOUT_EDITOR,
      },
      setViewState: vi.fn((state: SetViewStateArg) =>
        applyViewState(existingEditorLeaf, state, null),
      ),
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
    expect(existingEditorLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_FITKIT_WORKOUT_EDITOR,
      active: true,
      state: { file: file.path },
    })
    expect(existingEditorLeaf.view).toBeInstanceOf(WorkoutEditorView)
    const loadFile = (existingEditorLeaf.view as { loadFile: ReturnType<typeof vi.fn> }).loadFile
    expect(loadFile).toHaveBeenCalledWith(file)
  })
})

describe('FitKitPlugin.refreshIndexEntry concurrency', () => {
  interface RefreshTestFile {
    path: string
    extension: string
    basename: string
    stat: { mtime: number }
  }

  const REFRESH_FILE_A = 'Fitness/Workouts/2026-08-15.md'
  const REFRESH_FILE_B = 'Fitness/Workouts/2026-08-16.md'

  const buildRefreshSource = (date: string, direction: 'up' | 'down'): string =>
    [
      '---',
      'type: workout',
      `date: ${date}`,
      'name: Push day',
      '---',
      '',
      '## [[Squat]]',
      '',
      `- [exercise:: [[Squat]]] [next:: ${direction} 2.5]`,
    ].join('\n')

  it('does not lose an update when two refreshes are triggered before either resolves', async () => {
    const fileA: RefreshTestFile = {
      path: REFRESH_FILE_A,
      extension: 'md',
      basename: '2026-08-15',
      stat: { mtime: 1000 },
    }
    const fileB: RefreshTestFile = {
      path: REFRESH_FILE_B,
      extension: 'md',
      basename: '2026-08-16',
      stat: { mtime: 1000 },
    }
    const files = [fileA, fileB]
    const contents = new Map<string, string>([
      [REFRESH_FILE_A, buildRefreshSource('2026-08-15', 'up')],
      [REFRESH_FILE_B, buildRefreshSource('2026-08-16', 'up')],
    ])
    const app: MockApp = makeApp(
      {},
      {
        getFolderByPath: buildMockVaultFolderTree(files).getFolderByPath,
        read: vi.fn(async (target: TFile) => contents.get(target.path) ?? ''),
      },
    )
    ;(
      app.vault as unknown as { getAbstractFileByPath: (path: string) => RefreshTestFile | null }
    ).getAbstractFileByPath = (path: string) =>
      files.find((candidate) => candidate.path === path) ?? null
    const settings: FitKitSettings = { ...DEFAULT_SETTINGS }
    const cachedIndex = await rebuildIndex(app as unknown as App, settings)

    const plugin = createPlugin(app, settings) as TestPlugin & {
      cachedIndex: typeof cachedIndex | null
      refreshIndexEntry(path: string): Promise<void>
    }
    plugin.cachedIndex = cachedIndex

    /** Both files change on disk after the index snapshot was taken, then get refreshed concurrently. */
    contents.set(REFRESH_FILE_A, buildRefreshSource('2026-08-15', 'down'))
    contents.set(REFRESH_FILE_B, buildRefreshSource('2026-08-16', 'down'))

    const refreshA = plugin.refreshIndexEntry(REFRESH_FILE_A)
    const refreshB = plugin.refreshIndexEntry(REFRESH_FILE_B)
    await Promise.all([refreshA, refreshB])

    const entryA = plugin.cachedIndex?.entries.find((entry) => entry.path === REFRESH_FILE_A)
    const entryB = plugin.cachedIndex?.entries.find((entry) => entry.path === REFRESH_FILE_B)
    expect(entryA?.exercises[0]?.next).toEqual({ direction: 'down', step: 2.5 })
    expect(entryB?.exercises[0]?.next).toEqual({ direction: 'down', step: 2.5 })
  })
})

/** Longer than one busy-leaf retry, so a swap back to the editor would have landed. */
const BUSY_LEAF_SETTLE_MS = 80

const delayFor = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms))

interface RecordedMenuItem {
  title: string
  onClick: () => unknown
}

/** Stands in for the Menu Obsidian passes to file-menu, recording each item's title and click handler. */
const makeRecordingMenu = (): {
  menu: unknown
  titles: () => string[]
  click: (title: string) => Promise<void>
} => {
  const items: RecordedMenuItem[] = []
  const menu = {
    addItem(build: (item: unknown) => void) {
      const record: RecordedMenuItem = { title: '', onClick: () => undefined }
      const item = {
        setTitle(title: string) {
          record.title = title
          return item
        },
        setIcon: () => item,
        setSection: () => item,
        onClick(handler: () => unknown) {
          record.onClick = handler
          return item
        },
      }
      build(item)
      items.push(record)
      return menu
    },
  }
  return {
    menu,
    titles: () => items.map((item) => item.title),
    click: async (title) => {
      await items.find((item) => item.title === title)?.onClick()
    },
  }
}

/** Loads the plugin and opens a tab's menu the way Obsidian does: markdown tabs build it through file-menu, the workout editor builds its own. */
const loadPluginCapturingEvents = async (
  app: MockApp,
): Promise<{
  handlers: Map<string, (...args: unknown[]) => unknown>
  showMenu: (leaf: MockLeaf, menu: unknown, source?: string) => void
}> => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  app.workspace.on = vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(event, handler)
    return {}
  })
  const plugin = new (FitKitPlugin as unknown as { new (app: MockApp): FitKitPlugin })(app)
  await plugin.onload()
  const showMenu = (leaf: MockLeaf, menu: unknown, source = 'more-options'): void => {
    if (leaf.view instanceof WorkoutEditorView) {
      Object.assign(leaf.view, { plugin, leaf })
      leaf.view.onPaneMenu(menu as Menu, source)
      return
    }
    handlers.get('file-menu')?.(menu, (leaf.view as MarkdownView).file, source, leaf)
  }
  return { handlers, showMenu }
}

const makeWorkoutApp = (overrides: Partial<MockWorkspace> = {}): MockApp => {
  const app = makeApp(overrides)
  app.metadataCache.getFileCache = vi.fn((file: TFile) =>
    file.path.startsWith('Workouts/') ? { frontmatter: { type: 'workout' } } : null,
  )
  return app
}

describe('FitKitPlugin tab menu view switch', () => {
  it('offers "Open as Markdown" in the more-options menu of a workout editor tab', async () => {
    const file = makeWorkoutFile('Workouts/A.md')
    const editorLeaf = makeEditorLeaf(file)
    const events = await loadPluginCapturingEvents(makeWorkoutApp())
    const menu = makeRecordingMenu()

    events.showMenu(editorLeaf, menu.menu)

    expect(menu.titles()).toContain('Open as Markdown')
  })

  it('shows the workout as markdown in the same tab when "Open as Markdown" is chosen', async () => {
    const file = makeWorkoutFile('Workouts/2026-09-18.md')
    const editorLeaf = makeEditorLeaf(file)
    const events = await loadPluginCapturingEvents(makeWorkoutApp())
    const menu = makeRecordingMenu()
    events.showMenu(editorLeaf, menu.menu)

    await menu.click('Open as Markdown')

    expect(editorLeaf.view).toBeInstanceOf(MarkdownView)
    expect((editorLeaf.view as MarkdownView).file?.path).toBe('Workouts/2026-09-18.md')
  })

  it('keeps a workout switched to markdown as markdown when Obsidian reports it opened', async () => {
    const file = makeWorkoutFile('Workouts/A.md')
    const editorLeaf = makeEditorLeaf(file)
    const events = await loadPluginCapturingEvents(
      makeWorkoutApp({ getActiveViewOfType: vi.fn(() => editorLeaf.view) }),
    )
    const menu = makeRecordingMenu()
    events.showMenu(editorLeaf, menu.menu)
    await menu.click('Open as Markdown')

    events.handlers.get('file-open')?.((editorLeaf.view as MarkdownView).file)
    await delayFor(BUSY_LEAF_SETTLE_MS)

    expect(editorLeaf.view).toBeInstanceOf(MarkdownView)
  })

  it('shows a markdown workout in the workout editor when "Open in workout editor" is chosen', async () => {
    const file = makeWorkoutFile('Workouts/A.md')
    const markdownLeaf = makeLeafShowingFile(file)
    const events = await loadPluginCapturingEvents(makeWorkoutApp())
    const menu = makeRecordingMenu()
    events.showMenu(markdownLeaf, menu.menu)

    await menu.click('Open in workout editor')

    expect(markdownLeaf.view).toBeInstanceOf(WorkoutEditorView)
    const loadFile = (markdownLeaf.view as { loadFile: ReturnType<typeof vi.fn> }).loadFile
    expect(loadFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'Workouts/A.md' }))
  })

  it('does not offer the workout editor for a markdown note that is not a workout', async () => {
    const file = makeWorkoutFile('Journal/today.md')
    const markdownLeaf = makeLeafShowingFile(file)
    const events = await loadPluginCapturingEvents(makeWorkoutApp())
    const menu = makeRecordingMenu()

    events.showMenu(markdownLeaf, menu.menu)

    expect(menu.titles()).toEqual([])
  })

  it('opens a workout clicked later in the editor again once the tab is switched back from markdown', async () => {
    const file = makeWorkoutFile('Workouts/A.md')
    const leaf = makeEditorLeaf(file)
    const events = await loadPluginCapturingEvents(
      makeWorkoutApp({ getActiveViewOfType: vi.fn(() => leaf.view) }),
    )
    const toMarkdown = makeRecordingMenu()
    events.showMenu(leaf, toMarkdown.menu)
    await toMarkdown.click('Open as Markdown')
    const toEditor = makeRecordingMenu()
    events.showMenu(leaf, toEditor.menu)
    await toEditor.click('Open in workout editor')

    /** Obsidian opens a clicked workout as markdown in the focused tab. */
    leaf.view = new MarkdownView({ file, leaf })
    events.handlers.get('file-open')?.(file)
    await delayFor(BUSY_LEAF_SETTLE_MS)

    expect(leaf.view).toBeInstanceOf(WorkoutEditorView)
  })
  it('keeps a workout switched to markdown as markdown after it is renamed', async () => {
    const file = makeWorkoutFile('Workouts/A.md')
    const leaf = makeEditorLeaf(file)
    const events = await loadPluginCapturingEvents(
      makeWorkoutApp({ getActiveViewOfType: vi.fn(() => leaf.view) }),
    )
    const menu = makeRecordingMenu()
    events.showMenu(leaf, menu.menu)
    await menu.click('Open as Markdown')

    file.path = 'Workouts/Renamed.md'
    events.handlers.get('file-open')?.(file)
    await delayFor(BUSY_LEAF_SETTLE_MS)

    expect(leaf.view).toBeInstanceOf(MarkdownView)
  })

  it('still opens a different workout in the editor when it is clicked in a tab switched to markdown', async () => {
    const fileA = makeWorkoutFile('Workouts/A.md')
    const fileB = makeWorkoutFile('Workouts/B.md')
    const leaf = makeEditorLeaf(fileA)
    const events = await loadPluginCapturingEvents(
      makeWorkoutApp({ getActiveViewOfType: vi.fn(() => leaf.view) }),
    )
    const menu = makeRecordingMenu()
    events.showMenu(leaf, menu.menu)
    await menu.click('Open as Markdown')

    leaf.view = new MarkdownView({ file: fileB, leaf })
    events.handlers.get('file-open')?.(fileB)
    await delayFor(BUSY_LEAF_SETTLE_MS)

    expect(leaf.view).toBeInstanceOf(WorkoutEditorView)
  })

  it('offers neither switch outside the tab more-options menu', async () => {
    const file = makeWorkoutFile('Workouts/A.md')
    const events = await loadPluginCapturingEvents(makeWorkoutApp())
    const editorMenu = makeRecordingMenu()
    const markdownMenu = makeRecordingMenu()

    events.showMenu(makeEditorLeaf(file), editorMenu.menu, 'tab-header')
    events.showMenu(makeLeafShowingFile(file), markdownMenu.menu, 'file-explorer-context-menu')

    expect(editorMenu.titles()).toEqual([])
    expect(markdownMenu.titles()).toEqual([])
  })

  it('does not offer "Open in workout editor" to a tab already in the workout editor', async () => {
    const file = makeWorkoutFile('Workouts/A.md')
    const events = await loadPluginCapturingEvents(makeWorkoutApp())
    const menu = makeRecordingMenu()

    events.handlers.get('file-menu')?.(menu.menu, file, 'more-options', makeEditorLeaf(file))

    expect(menu.titles()).not.toContain('Open in workout editor')
  })
})
