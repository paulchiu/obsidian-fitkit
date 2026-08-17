import { beforeEach, describe, expect, it, vi } from 'vitest'

const noticeMessages = vi.hoisted(() => [] as string[])

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

import type { App, TFile } from 'obsidian'

import type { FitKitIndex } from '../../src/domain/types'
import FitKitPlugin from '../../src/main'
import { DEFAULT_SETTINGS, type FitKitSettings } from '../../src/settings'
import { WorkoutEditorView } from '../../src/ui/workout-editor-view'
import { FileSession } from '../../src/vault/file-session'
import { rebuildIndex } from '../../src/vault/index'

const WORKOUT_PATH = 'Fitness/Workouts/2026-08-15.md'

/** Mirrors the round-trip fixture in tests/domain/workout-note-model.test.ts: a plan-only bullet plus a logged set for the same exercise. */
const initialSource = [
  '---',
  'type: workout',
  'date: 2026-08-15',
  'name: Push day',
  '---',
  '',
  '## [[Squat]]',
  '',
  '- [exercise:: [[Squat]]] [next:: up 2.5]',
  '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
].join('\n')

interface TestFile {
  path: string
  extension: string
  basename: string
  stat: { mtime: number }
}

interface TestVault {
  getMarkdownFiles: () => TestFile[]
  read: (file: TestFile) => Promise<string>
  process: (file: TestFile, callback: (text: string) => string) => Promise<void>
  getAbstractFileByPath: (path: string) => TestFile | null
}

interface TestApp {
  vault: TestVault
}

interface TestPlugin {
  app: TestApp
  settings: FitKitSettings
  cachedIndex: FitKitIndex | null
  lastDiagnostics: FitKitIndex['diagnostics']
}

interface TestExerciseCard {
  name: string
  kind: 'strength' | 'duration'
  next?: { direction: 'up' | 'down' | 'stay'; step?: number }
  strengthSets: Array<{ set?: number; weight?: number; reps?: number; note?: string }>
  durationEntries: Array<{ set?: number; durationSeconds?: number; note?: string }>
}

interface TestEditorModel {
  isFitKitWorkout: boolean
  date: string
  name: string
  sourcePath: string
  exercises: TestExerciseCard[]
  preserveBlocks: unknown[]
}

interface AutosaveIndexView {
  app: TestApp
  plugin: TestPlugin
  session: FileSession | null
  model: TestEditorModel | null
  dirty: boolean
  conflictDetected: boolean
  autoSaveInflight: boolean
  autoSaveRequeued: boolean
  contentEl: { querySelector: () => null }
  flushAutoSave(): Promise<void>
}

interface Harness {
  view: AutosaveIndexView
  plugin: TestPlugin
  contents: Map<string, string>
}

/**
 * Builds a WorkoutEditorView wired to a real FileSession and a real
 * FitKitPlugin instance (via its prototype, matching the harness style in
 * tests/main.test.ts) so plugin.cachedIndex is the genuine
 * FitKitPlugin#cachedIndex field, not a stand-in. plugin.cachedIndex starts
 * seeded by the real rebuildIndex(), matching what the plugin would have
 * cached before the user's edit.
 */
const createHarness = async (): Promise<Harness> => {
  const file: TestFile = {
    path: WORKOUT_PATH,
    extension: 'md',
    basename: '2026-08-15',
    stat: { mtime: 1000 },
  }
  const contents = new Map<string, string>([[WORKOUT_PATH, initialSource]])
  const vault: TestVault = {
    getMarkdownFiles: () => [file],
    read: async (target) => contents.get(target.path) ?? '',
    process: async (target, callback) => {
      contents.set(target.path, callback(contents.get(target.path) ?? ''))
    },
    getAbstractFileByPath: (path) => (contents.has(path) ? file : null),
  }
  const app: TestApp = { vault }
  const settings: FitKitSettings = { ...DEFAULT_SETTINGS }

  const cachedIndex = await rebuildIndex(app as unknown as App, settings)

  const plugin = Object.create(FitKitPlugin.prototype) as TestPlugin
  plugin.app = app
  plugin.settings = settings
  plugin.cachedIndex = cachedIndex
  plugin.lastDiagnostics = cachedIndex.diagnostics

  const session = new FileSession(app as unknown as App, file as unknown as TFile)
  await session.load()

  const model: TestEditorModel = {
    isFitKitWorkout: true,
    date: '2026-08-15',
    name: 'Push day',
    sourcePath: WORKOUT_PATH,
    exercises: [
      {
        name: 'Squat',
        kind: 'strength',
        next: { direction: 'up', step: 2.5 },
        strengthSets: [{ set: 1, weight: 100, reps: 5 }],
        durationEntries: [],
      },
    ],
    preserveBlocks: [],
  }

  const view = Object.create(WorkoutEditorView.prototype) as AutosaveIndexView
  view.app = app
  view.plugin = plugin
  view.session = session
  view.model = model
  view.dirty = true
  view.conflictDetected = false
  view.autoSaveInflight = false
  view.autoSaveRequeued = false
  view.contentEl = { querySelector: () => null }

  return { view, plugin, contents }
}

describe('WorkoutEditorView autosave keeps the cached index in sync', () => {
  /** flushAutoSave's success path does `instanceof HTMLElement`; the vitest node environment has no such global, so stub it as in tests/ui/workout-editor-view.test.ts. */
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', class {})
  })

  it('updates plugin.cachedIndex with the freshly saved next-time plan after a successful autosave', async () => {
    const { view, plugin, contents } = await createHarness()
    const exercise = view.model?.exercises[0]
    if (!exercise) {
      throw new Error('test setup: exercise not present on model')
    }
    exercise.next = { direction: 'down' }

    await view.flushAutoSave()

    /** Sanity check: the write to disk happened, so a stale cached index is the only remaining suspect. */
    expect(view.dirty).toBe(false)
    expect(contents.get(WORKOUT_PATH)).toContain('[next:: down]')

    const entry = plugin.cachedIndex?.entries.find((candidate) => candidate.path === WORKOUT_PATH)
    expect(entry?.exercises[0]?.next).toEqual({ direction: 'down' })
  })

  it('removes a cleared next-time plan from plugin.cachedIndex after autosave (B4 fallback case)', async () => {
    const { view, plugin, contents } = await createHarness()
    const exercise = view.model?.exercises[0]
    if (!exercise) {
      throw new Error('test setup: exercise not present on model')
    }
    exercise.next = undefined

    await view.flushAutoSave()

    expect(view.dirty).toBe(false)
    expect(contents.get(WORKOUT_PATH)).not.toContain('[next::')

    const entry = plugin.cachedIndex?.entries.find((candidate) => candidate.path === WORKOUT_PATH)
    expect(entry?.exercises[0]?.next).toBeUndefined()
  })

  it('leaves a null cachedIndex null after a successful autosave (no eager full rebuild on the hot save path)', async () => {
    const { view, plugin } = await createHarness()
    plugin.cachedIndex = null
    const exercise = view.model?.exercises[0]
    if (!exercise) {
      throw new Error('test setup: exercise not present on model')
    }
    exercise.next = { direction: 'down' }

    await view.flushAutoSave()

    expect(view.dirty).toBe(false)
    expect(plugin.cachedIndex).toBeNull()
  })
})

const FILE_A_PATH = 'Fitness/Workouts/2026-08-15.md'
const FILE_B_PATH = 'Fitness/Workouts/2026-08-16.md'

const buildTeardownSource = (date: string, direction: 'up' | 'down'): string =>
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
    '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
  ].join('\n')

interface TeardownHarness {
  view: AutosaveIndexView
  plugin: TestPlugin
  fileA: TestFile
  fileB: TestFile
  /** Unblocks the gated `vault.process` so a paused flushAutoSave can resume. */
  releaseSave: () => void
}

/**
 * Same shape as createHarness, but vault.process blocks on a gate until
 * releaseSave() is called, so a test can pause flushAutoSave mid-write and
 * mutate view.session (nulling or reassigning it) before letting it resume,
 * mirroring what onClose/loadFile do to a concurrently in-flight autosave.
 */
const createTeardownHarness = async (): Promise<TeardownHarness> => {
  const fileA: TestFile = {
    path: FILE_A_PATH,
    extension: 'md',
    basename: '2026-08-15',
    stat: { mtime: 1000 },
  }
  const fileB: TestFile = {
    path: FILE_B_PATH,
    extension: 'md',
    basename: '2026-08-16',
    stat: { mtime: 1000 },
  }
  const contents = new Map<string, string>([
    [FILE_A_PATH, buildTeardownSource('2026-08-15', 'up')],
    [FILE_B_PATH, buildTeardownSource('2026-08-16', 'up')],
  ])

  let releaseSave: () => void = () => {}
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve
  })

  const vault: TestVault = {
    getMarkdownFiles: () => [fileA, fileB],
    read: async (target) => contents.get(target.path) ?? '',
    process: async (target, callback) => {
      await saveGate
      contents.set(target.path, callback(contents.get(target.path) ?? ''))
    },
    getAbstractFileByPath: (path) =>
      path === fileA.path ? fileA : path === fileB.path ? fileB : null,
  }
  const app: TestApp = { vault }
  const settings: FitKitSettings = { ...DEFAULT_SETTINGS }

  const cachedIndex = await rebuildIndex(app as unknown as App, settings)

  const plugin = Object.create(FitKitPlugin.prototype) as TestPlugin
  plugin.app = app
  plugin.settings = settings
  plugin.cachedIndex = cachedIndex
  plugin.lastDiagnostics = cachedIndex.diagnostics

  const sessionA = new FileSession(app as unknown as App, fileA as unknown as TFile)
  await sessionA.load()

  const model: TestEditorModel = {
    isFitKitWorkout: true,
    date: '2026-08-15',
    name: 'Push day',
    sourcePath: FILE_A_PATH,
    exercises: [
      {
        name: 'Squat',
        kind: 'strength',
        next: { direction: 'up', step: 2.5 },
        strengthSets: [{ set: 1, weight: 100, reps: 5 }],
        durationEntries: [],
      },
    ],
    preserveBlocks: [],
  }

  const view = Object.create(WorkoutEditorView.prototype) as AutosaveIndexView
  view.app = app
  view.plugin = plugin
  view.session = sessionA
  view.model = model
  view.dirty = true
  view.conflictDetected = false
  view.autoSaveInflight = false
  view.autoSaveRequeued = false
  view.contentEl = { querySelector: () => null }

  return { view, plugin, fileA, fileB, releaseSave }
}

describe('WorkoutEditorView autosave survives teardown races on the shared view', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', class {})
    /** flushAutoSave's finally block may call scheduleAutoSave, which reaches for the Obsidian `activeWindow` global; alias it to the real Node timers. */
    // eslint-disable-next-line obsidianmd/no-global-this -- The test realm's global object is the only handle available for stubbing.
    vi.stubGlobal('activeWindow', globalThis)
  })

  it('does not throw or reject when the view is torn down while an autosave is in flight', async () => {
    const { view, releaseSave } = await createTeardownHarness()
    const exercise = view.model?.exercises[0]
    if (!exercise) {
      throw new Error('test setup: exercise not present on model')
    }
    exercise.next = { direction: 'down', step: 2.5 }

    const flushA = view.flushAutoSave()
    /** Mirrors onClose's own flushAutoSave() call hitting the in-flight fast path. */
    await view.flushAutoSave()
    expect(view.autoSaveRequeued).toBe(true)

    /** Mirrors onClose nulling the session right after its own flush call returns. */
    view.session = null
    view.model = null

    releaseSave()

    await expect(flushA).resolves.toBeUndefined()
  })

  it('refreshes the file that was actually saved, not a file loaded into the view afterward', async () => {
    const { view, plugin, fileA, fileB, releaseSave } = await createTeardownHarness()
    const exercise = view.model?.exercises[0]
    if (!exercise) {
      throw new Error('test setup: exercise not present on model')
    }
    exercise.next = { direction: 'down', step: 2.5 }

    const flushA = view.flushAutoSave()
    /** Mirrors loadFile's own flushAutoSave() call hitting the in-flight fast path. */
    await view.flushAutoSave()
    expect(view.autoSaveRequeued).toBe(true)

    /** Mirrors loadFile reassigning the view to a newly opened, unrelated file. */
    const sessionB = new FileSession(view.app as unknown as App, fileB as unknown as TFile)
    await sessionB.load()
    view.session = sessionB
    view.dirty = false

    releaseSave()
    await flushA

    const entryA = plugin.cachedIndex?.entries.find((candidate) => candidate.path === fileA.path)
    const entryB = plugin.cachedIndex?.entries.find((candidate) => candidate.path === fileB.path)
    expect(entryA?.exercises[0]?.next).toEqual({ direction: 'down', step: 2.5 })
    expect(entryB?.exercises[0]?.next).toEqual({ direction: 'up', step: 2.5 })
  })
})
