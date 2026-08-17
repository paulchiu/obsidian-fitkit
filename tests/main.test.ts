import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const noticeMessages = vi.hoisted(() => [] as string[])
const registeredCommandIds = vi.hoisted(() => [] as string[])

vi.mock('obsidian', () => {
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

import { MarkdownView, Modal, TFile, type App } from 'obsidian'

import FitKitPlugin from '../src/main'
import { DEFAULT_SETTINGS, type FitKitSettings } from '../src/settings'
import { VIEW_TYPE_FITKIT_WORKOUT_EDITOR, WorkoutEditorView } from '../src/ui/workout-editor-view'
import { rebuildIndex } from '../src/vault/index'

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
  getMarkdownFiles: () => TFile[]
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
  renderSkeleton: ReturnType<typeof vi.fn>
} => {
  const view = Object.create(WorkoutEditorView.prototype) as WorkoutEditorView & {
    loadFile: ReturnType<typeof vi.fn>
    renderSkeleton: ReturnType<typeof vi.fn>
    session: { file: TFile } | null
  }
  view.loadFile = vi.fn(async () => undefined)
  view.renderSkeleton = vi.fn()
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

const createPlugin = (
  app: MockApp,
  settings: FitKitSettings = { ...DEFAULT_SETTINGS },
): TestPlugin => {
  const plugin = Object.create(FitKitPlugin.prototype) as TestPlugin
  plugin.app = app
  plugin.settings = settings
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
        leaf.view = makeEditorView(file)
      }
    }),
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
    getMarkdownFiles: vi.fn(() => []),
    read: vi.fn(async () => ''),
    process: vi.fn(async () => undefined),
    ...vaultOverrides,
  },
  metadataCache: {
    getFileCache: vi.fn(() => null),
  },
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
        getMarkdownFiles: vi.fn(() => [file]),
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
        getMarkdownFiles: vi.fn(() => [file]),
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
        getMarkdownFiles: vi.fn(() => [file]),
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
        getMarkdownFiles: vi.fn(() => [workoutFile, squatFile]),
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
      setViewState: vi.fn(async (state: SetViewStateArg) => {
        if (state.type === VIEW_TYPE_FITKIT_WORKOUT_EDITOR) {
          existingEditorLeaf.view = makeEditorView(file)
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
        getMarkdownFiles: vi.fn(() => files as unknown as TFile[]),
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
