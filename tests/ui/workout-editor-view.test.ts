import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXERCISE_KINDS } from '../../src/domain/exercise-kind'
import {
  createRegistry,
  type ExerciseKind,
  type ExerciseRegistryEntry,
} from '../../src/domain/exercise-registry'
import type { FitKitSettings } from '../../src/settings'
import type {
  DurationExerciseEntry,
  ExerciseEntry,
  StrengthExerciseEntry,
} from '../../src/domain/workout-note-model'
import { createTestRoot } from '../harness/obsidian-dom'
import { findUnstyledClasses } from '../harness/stylesheet'

interface MockMenuItemState {
  title?: string
  icon?: string
  disabled?: boolean
  warning?: boolean
  checked?: boolean
  onClick?: () => void
}

interface MockMenuPosition {
  x: number
  y: number
  width?: number
  overlap?: boolean
  left?: boolean
}

interface MockMenuState {
  items: MockMenuItemState[]
  position?: MockMenuPosition
}

const obsidianMock = vi.hoisted(
  (): { menus: MockMenuState[]; notices: string[]; platform: { isMobile: boolean } } => ({
    menus: [],
    notices: [],
    platform: { isMobile: false },
  }),
)

const vaultUtilsMock = vi.hoisted(() => ({
  ensureParentFolder: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}))

const registryVaultMock = vi.hoisted(() => ({
  exerciseRegistryWithVaultNotes: vi.fn<() => ExerciseRegistryEntry[]>(() => []),
}))

vi.mock('obsidian', async () => {
  const { mixinFileView } = await import('../fixtures/obsidian-file-view')

  class Modal {
    contentEl = new TestElement('div')

    titleEl = new TestElement('div')

    setTitle(title: string): this {
      this.titleEl.textContent = title
      return this
    }

    constructor(readonly app: unknown) {}

    open(): void {}

    close(): void {}
  }

  class SuggestModal<T> extends Modal {
    emptyStateText = ''
    inputEl = new TestElement('input')
    limit = 0
    suggestions: T[] = []

    setPlaceholder(_placeholder: string): void {}

    async onOpen(): Promise<void> {}

    onClose(): void {}
  }

  class ItemView {
    app: unknown
    contentEl = new TestElement('div')

    constructor(leaf: unknown) {
      this.app =
        leaf && typeof leaf === 'object' && 'app' in leaf
          ? (leaf as { app?: unknown }).app
          : undefined
    }
  }

  class MenuItem {
    constructor(private state: MockMenuItemState) {}

    setTitle(title: string): this {
      this.state.title = title
      return this
    }

    setIcon(icon: string): this {
      this.state.icon = icon
      return this
    }

    setWarning(warning: boolean): this {
      this.state.warning = warning
      return this
    }

    setDisabled(_disabled: boolean): this {
      this.state.disabled = _disabled
      return this
    }

    setChecked(checked: boolean): this {
      this.state.checked = checked
      return this
    }

    onClick(callback: () => void): this {
      this.state.onClick = callback
      return this
    }
  }

  class Menu implements MockMenuState {
    items: MockMenuItemState[] = []
    position?: { x: number; y: number }

    constructor() {
      obsidianMock.menus.push(this)
    }

    addItem(callback: (item: MenuItem) => void): this {
      const state: MockMenuItemState = {}
      callback(new MenuItem(state))
      this.items.push(state)
      return this
    }

    addSeparator(): this {
      return this
    }

    showAtPosition(position: MockMenuPosition): void {
      this.position = position
    }

    showAtMouseEvent(_event: unknown): void {}
  }

  class Notice {
    constructor(readonly message: string) {
      obsidianMock.notices.push(message)
    }
  }

  class TFile {}

  const FileView = mixinFileView(ItemView, (value): value is TFile => value instanceof TFile)

  return {
    FileView,
    ItemView,
    Menu,
    Modal,
    Notice,
    Platform: obsidianMock.platform,
    SuggestModal,
    TFile,
    normalizePath: (path: string) => path.replace(/\/+/g, '/'),
    setIcon: vi.fn((element: { setAttr?: (name: string, value: string) => void }, icon: string) => {
      element.setAttr?.('data-icon', icon)
    }),
  }
})

vi.mock('../../src/vault/vault-utils', () => ({
  ensureParentFolder: vaultUtilsMock.ensureParentFolder,
}))

vi.mock('../../src/vault/exercise-registry-vault', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/vault/exercise-registry-vault')>()
  const registry = await import('../../src/domain/exercise-registry')
  return {
    ...actual,
    exerciseRegistryWithVaultNotes: registryVaultMock.exerciseRegistryWithVaultNotes,
    /** Same composition as the real helper, but reading the mocked snapshot. */
    bodyweightLevelsFor: (app: App, settings: FitKitSettings, name: string) =>
      registry.levelsForName(
        registry.createRegistry(registryVaultMock.exerciseRegistryWithVaultNotes(app, settings)),
        name,
      ),
  }
})

import { TFile, type App } from 'obsidian'
import {
  ensureKnownNotice,
  formatLadderChangesWarning,
  ladderRecordNotice,
  shouldShortenLevelLabel,
  toEditorExercise,
  toWorkoutExercise,
  typeRecordNotices,
  WorkoutEditorView,
} from '../../src/ui/workout-editor-view'
import { buildMockVaultFolderTree, type MockVaultFolder } from '../fixtures/mock-vault-folder-tree'

interface TestElementOptions {
  cls?: string
  text?: string
  attr?: Record<string, string>
}

interface TestEvent {
  stopPropagation?: () => void
}

type TestListener = (event: TestEvent) => void

/** A rect built from the three edges menu placement reads. */
function testRect(box: { left: number; bottom: number; width: number }): DOMRect {
  return {
    bottom: box.bottom,
    height: 10,
    left: box.left,
    right: box.left + box.width,
    top: box.bottom - 10,
    width: box.width,
    x: box.left,
    y: box.bottom - 10,
    toJSON: () => ({}),
  }
}

class TestElement {
  readonly attributes = new Map<string, string>()
  readonly children: TestElement[] = []
  readonly classes = new Set<string>()
  readonly dataset: Record<string, string> = {}
  readonly listeners = new Map<string, TestListener[]>()
  parent: TestElement | null = null
  textContent = ''
  clientWidth = 0
  scrollWidth = 0
  scrollHeight = 0
  hidden = false
  readonly win = { innerHeight: 768 }
  readonly ownerDocument = { activeElement: null }
  rect: DOMRect = testRect({ left: 10, bottom: 20, width: 10 })

  constructor(readonly tagName: string) {}

  createDiv(options: TestElementOptions = {}): TestElement {
    return this.createEl('div', options)
  }

  createEl(tagName: string, options: TestElementOptions = {}): TestElement {
    const child = new TestElement(tagName)
    child.parent = this
    if (options.cls) {
      child.addClasses(options.cls)
    }
    if (options.text) {
      child.textContent = options.text
    }
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      child.setAttr(name, value)
    }
    this.children.push(child)
    return child
  }

  createSpan(options: TestElementOptions = {}): TestElement {
    return this.createEl('span', options)
  }

  addEventListener(type: string, listener: TestListener): void {
    const current = this.listeners.get(type) ?? []
    this.listeners.set(type, [...current, listener])
  }

  setAttr(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  addClass(cls: string): void {
    this.classes.add(cls)
  }

  hasClass(cls: string): boolean {
    return this.classes.has(cls)
  }

  instanceOf(type: new (...args: never[]) => unknown): boolean {
    return this instanceof type
  }

  querySelector(selector: string): TestElement | null {
    return selector.startsWith('.') ? this.findByClass(selector.slice(1)) : null
  }

  querySelectorAll(selector: string): TestElement[] {
    return selector.startsWith('.') ? this.findAllByClass(selector.slice(1)) : []
  }

  removeClass(cls: string): void {
    this.classes.delete(cls)
  }

  contains(_other: unknown): boolean {
    return false
  }

  setCssProps(_props: Record<string, string>): void {}

  setText(text: string): void {
    this.textContent = text
  }

  toggleAttribute(name: string, force?: boolean): boolean {
    const next = force ?? !this.attributes.has(name)
    if (next) {
      this.attributes.set(name, '')
    } else {
      this.attributes.delete(name)
    }
    return next
  }

  empty(): void {
    this.children.splice(0, this.children.length)
    this.textContent = ''
  }

  getBoundingClientRect(): DOMRect {
    return this.rect
  }

  findByClass(cls: string): TestElement | null {
    if (this.classes.has(cls)) {
      return this
    }
    for (const child of this.children) {
      const found = child.findByClass(cls)
      if (found) {
        return found
      }
    }
    return null
  }

  findAllByClass(cls: string): TestElement[] {
    const own = this.classes.has(cls) ? [this] : []
    return [...own, ...this.children.flatMap((child) => child.findAllByClass(cls))]
  }

  findByTag(tagName: string): TestElement | null {
    if (this.tagName === tagName) {
      return this
    }
    for (const child of this.children) {
      const found = child.findByTag(tagName)
      if (found) {
        return found
      }
    }
    return null
  }

  listenersFor(type: string): TestListener[] {
    return this.listeners.get(type) ?? []
  }

  private addClasses(cls: string): void {
    for (const entry of cls.split(/\s+/)) {
      if (entry.length > 0) {
        this.classes.add(entry)
      }
    }
  }
}

interface RowActionView {
  renderRowActions(
    container: HTMLElement,
    body: HTMLElement,
    opts: {
      label: string
      currentNote: string | undefined
      onDelete: () => void
      onNoteSave: (next: string | undefined) => void
    },
  ): void
}

const createRowActionView = (): RowActionView =>
  Object.create(WorkoutEditorView.prototype) as RowActionView

interface CardMenuView {
  model: unknown
  openOrCreateExerciseFile?: ReturnType<typeof vi.fn>
  openRenameExerciseModal?: ReturnType<typeof vi.fn>
  openCardMenu(evt: MouseEvent, index: number): void
}

interface ExerciseCardRenderView {
  app?: {
    vault: {
      getAbstractFileByPath: ReturnType<typeof vi.fn>
      create: ReturnType<typeof vi.fn>
    }
    workspace: {
      setActiveLeaf: ReturnType<typeof vi.fn>
      openLinkText: ReturnType<typeof vi.fn>
    }
  }
  leaf?: unknown
  plugin: {
    settings: {
      fitnessRoot: string
      strengthRestTimerEnabled: boolean
      exerciseRegistry: ExerciseRegistryEntry[]
      deletedExercises?: string[]
    }
    saveSettings: ReturnType<typeof vi.fn>
  }
  model: unknown
  exerciseHistory: unknown
  openRenameExerciseModal?: ReturnType<typeof vi.fn>
  renderExerciseCard(list: HTMLElement, index: number): void
}

const createCardMenuView = (): CardMenuView =>
  Object.create(WorkoutEditorView.prototype) as CardMenuView

const createExerciseCardRenderView = (): ExerciseCardRenderView => {
  const view = Object.create(WorkoutEditorView.prototype) as ExerciseCardRenderView
  view.plugin = {
    settings: {
      fitnessRoot: 'Fitness',
      strengthRestTimerEnabled: true,
      exerciseRegistry: [],
      deletedExercises: [],
    },
    saveSettings: vi.fn(() => Promise.resolve()),
  }
  return view
}

interface ExerciseCardFixtureOptions {
  exerciseNotes?: string
  reps?: number
  load?: number
}

const createExerciseCardFixture = (
  name: string,
  kind: ExerciseKind,
  options: ExerciseCardFixtureOptions = {},
) => ({
  name,
  kind,
  exerciseNotes: options.exerciseNotes,
  strengthSets: [],
  durationEntries: [],
  bodyweightSets:
    kind === 'bodyweight' ? [{ set: 1, level: 1, reps: options.reps, load: options.load }] : [],
})

const flushPromises = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  obsidianMock.notices = []
  vaultUtilsMock.ensureParentFolder.mockClear()
  vaultUtilsMock.ensureParentFolder.mockResolvedValue(undefined)
  registryVaultMock.exerciseRegistryWithVaultNotes.mockReset()
  registryVaultMock.exerciseRegistryWithVaultNotes.mockReturnValue([])
})

interface LabelFitView {
  contentEl: TestElement
  fitLevelLabel(label: HTMLElement, full: HTMLElement): void
  refreshLevelLabels(): void
  updateNarrowState(): void
}

const createLabelFitView = (): LabelFitView => {
  const view = Object.create(WorkoutEditorView.prototype) as LabelFitView
  view.contentEl = new TestElement('div')
  return view
}

/** A label whose button is wide but whose text slot overruns its content. */
const overflowingLabel = (): { label: TestElement; full: TestElement } => {
  const label = new TestElement('button')
  label.addClass('fitkit-bodyweight-level-label')
  label.clientWidth = 500
  const full = label.createSpan({
    cls: 'fitkit-bodyweight-level-full',
    text: 'Elevated one-arm incline push-up off the kitchen bench',
  })
  full.clientWidth = 50
  full.scrollWidth = 120
  return { label, full }
}

describe('WorkoutEditorView row actions', () => {
  afterEach(() => {
    obsidianMock.menus = []
    obsidianMock.platform.isMobile = false
    vi.unstubAllGlobals()
  })

  it('shortens a rung name only when its own width overruns the cell', () => {
    expect(shouldShortenLevelLabel(120, 100)).toBe(true)
    expect(shouldShortenLevelLabel(100, 100)).toBe(false)
    expect(shouldShortenLevelLabel(120, 200)).toBe(false)
  })

})

interface PersistUnknownExerciseView {
  app: {
    vault: {
      getAbstractFileByPath: ReturnType<typeof vi.fn>
      create: ReturnType<typeof vi.fn>
    }
  }
  plugin: {
    settings: {
      fitnessRoot: string
      exerciseRegistry: ExerciseRegistryEntry[]
      deletedExercises: string[]
    }
    saveSettings: ReturnType<typeof vi.fn>
  }
  persistUnknownExercise(name: string, kind: ExerciseKind, createNote: boolean): Promise<void>
}

describe('WorkoutEditorView unknown exercise persistence', () => {
  beforeEach(() => {
    obsidianMock.notices = []
    vaultUtilsMock.ensureParentFolder.mockClear()
  })

  it('creates the note through the store and notices it', async () => {
    const view = Object.create(WorkoutEditorView.prototype) as PersistUnknownExerciseView
    view.app = {
      vault: {
        getAbstractFileByPath: vi.fn(() => null),
        create: vi.fn((path: string) => Promise.resolve({ path })),
      },
    }
    view.plugin = {
      settings: { fitnessRoot: 'Fitness', exerciseRegistry: [], deletedExercises: ['squat'] },
      saveSettings: vi.fn(() => Promise.resolve()),
    }

    await view.persistUnknownExercise('Squat', 'strength', true)

    expect(view.app.vault.create).toHaveBeenCalledTimes(1)
    expect(view.plugin.settings.exerciseRegistry).toEqual([
      { name: 'Squat', kind: 'strength', aliases: [] },
    ])
    expect(view.plugin.settings.deletedExercises).toEqual([])
    expect(view.plugin.saveSettings).toHaveBeenCalledTimes(1)
    expect(obsidianMock.notices).toEqual(["Created exercise note for 'Squat'."])
  })
})

describe('WorkoutEditorView exercise store notices', () => {
  it.each([
    {
      result: { name: 'Squat', wrote: 'note', customRecentSessions: false },
      notices: [
        'Exercise note now records Squat as strength.',
        'Registry now records Squat as strength.',
      ],
    },
    {
      result: { name: 'Squat', wrote: 'registry', customRecentSessions: false },
      notices: ['Registry now records Squat as strength.'],
    },
    {
      result: { name: 'Squat', wrote: 'note-unchanged', customRecentSessions: false },
      notices: [
        'Could not update the exercise note for Squat; its frontmatter was left unchanged.',
      ],
    },
    {
      result: { name: 'Squat', wrote: 'note', customRecentSessions: true },
      notices: [
        "The Recent sessions query in the note for Squat looks customised, so it was left as it is and still reads the old kind's fields.",
        'Exercise note now records Squat as strength.',
        'Registry now records Squat as strength.',
      ],
    },
  ] as const)('words a type record that wrote $result.wrote', ({ result, notices }) => {
    expect(typeRecordNotices(result, 'strength')).toEqual(notices)
  })

  it.each([
    { wrote: 'note', notice: 'Exercise note now records levels for Push-up.' },
    { wrote: 'registry', notice: 'Registry now records levels for Push-up.' },
    { wrote: 'note-unchanged', notice: null },
  ] as const)('words a ladder record that wrote $wrote', ({ wrote, notice }) => {
    expect(ladderRecordNotice({ name: 'Push-up', wrote })).toBe(notice)
  })

  it.each([
    { result: { outcome: 'note-created' }, notice: "Created exercise note for 'Squat'." },
    {
      result: { outcome: 'note-reused', restored: false },
      notice: "Using existing exercise note for 'Squat'.",
    },
    {
      result: { outcome: 'note-reused', restored: true },
      notice: "Restored 'Squat' using the existing exercise note.",
    },
    { result: { outcome: 'registry-added' }, notice: "Added 'Squat' as a no-note registry entry." },
    { result: { outcome: 'already-known' }, notice: null },
    {
      result: { outcome: 'note-failed', message: 'read only' },
      notice: "Could not create exercise note for 'Squat': read only.",
    },
  ] as const)('words an unknown exercise outcome of $result.outcome', ({ result, notice }) => {
    expect(ensureKnownNotice('Squat', result)).toBe(notice)
  })
})

interface PersistKindChangeMarkdownFile {
  path: string
  basename: string
  frontmatter?: Record<string, unknown>
}

interface PersistKindChangeView {
  app: {
    vault: {
      getFolderByPath: (path: string) => MockVaultFolder | null
      getAbstractFileByPath: ReturnType<typeof vi.fn>
      process: ReturnType<typeof vi.fn>
    }
    metadataCache: {
      getFileCache: (file: PersistKindChangeMarkdownFile) => {
        frontmatter?: Record<string, unknown>
      }
    }
  }
  plugin: {
    settings: {
      fitnessRoot: string
      exerciseRegistry: ExerciseRegistryEntry[]
    }
    saveSettings: ReturnType<typeof vi.fn>
  }
  persistTypeChange(name: string, nextKind: ExerciseKind): Promise<void>
}

describe('WorkoutEditorView kind switch persistence', () => {
  const createPersistKindChangeView = (
    markdownFiles: PersistKindChangeMarkdownFile[],
    exerciseRegistry: ExerciseRegistryEntry[] = [],
  ): { view: PersistKindChangeView; contents: Map<string, string> } => {
    const contents = new Map(
      markdownFiles.map((file) => {
        const kind = typeof file.frontmatter?.kind === 'string' ? file.frontmatter.kind : 'strength'
        return [file.path, `---\ntype: exercise\nkind: ${kind}\n---\n`] as const
      }),
    )
    const filesByPath = new Map(markdownFiles.map((file) => [file.path, new TFile()]))
    for (const [path, file] of filesByPath) {
      Object.assign(file, { path, basename: markdownFiles.find((f) => f.path === path)?.basename })
    }
    const view = Object.create(WorkoutEditorView.prototype) as PersistKindChangeView
    view.app = {
      vault: {
        getFolderByPath: buildMockVaultFolderTree(markdownFiles).getFolderByPath,
        getAbstractFileByPath: vi.fn((path: string) => filesByPath.get(path) ?? null),
        process: vi.fn(async (file: { path: string }, callback: (text: string) => string) => {
          const next = callback(contents.get(file.path) ?? '')
          contents.set(file.path, next)
          return next
        }),
      },
      metadataCache: {
        getFileCache: (file: PersistKindChangeMarkdownFile) => ({
          frontmatter: markdownFiles.find((entry) => entry.path === file.path)?.frontmatter,
        }),
      },
    }
    view.plugin = {
      settings: { fitnessRoot: 'Fitness', exerciseRegistry },
      saveSettings: vi.fn(() => Promise.resolve()),
    }
    return { view, contents }
  }

  beforeEach(() => {
    obsidianMock.notices = []
  })

  it('writes the switched kind into the exercise note and records it in the registry', async () => {
    const { view, contents } = createPersistKindChangeView([
      {
        path: 'Fitness/Exercises/Squat.md',
        basename: 'Squat',
        frontmatter: { type: 'exercise', kind: 'duration' },
      },
    ])

    await view.persistTypeChange('Squat', 'strength')

    expect(view.app.vault.process).toHaveBeenCalledTimes(1)
    expect(contents.get('Fitness/Exercises/Squat.md')).toContain('kind: strength')
    expect(view.plugin.settings.exerciseRegistry).toMatchObject([
      { name: 'Squat', kind: 'strength', aliases: [] },
    ])
    expect(view.plugin.saveSettings).toHaveBeenCalledTimes(1)
    expect(obsidianMock.notices).toEqual([
      'Exercise note now records Squat as strength.',
      'Registry now records Squat as strength.',
    ])
  })

  interface PersistLadderView extends PersistKindChangeView {
    render: ReturnType<typeof vi.fn>
    persistLadder(name: string, levels: string[]): Promise<void>
  }

  interface LadderGateCard {
    name: string
    kind: 'bodyweight'
    strengthSets: unknown[]
    durationEntries: unknown[]
    bodyweightSets: { level?: number }[]
  }

  interface LadderGateView extends PersistLadderView {
    confirmLadderChanges: (name: string, changes: unknown[]) => Promise<boolean>
    confirmLadderEdit(ex: LadderGateCard, levels: string[]): Promise<void>
  }

  describe('WorkoutEditorView ladder history warning', () => {
    const ladderEntry = (levels: string[]): ExerciseRegistryEntry => ({
      name: 'Push-up',
      kind: 'bodyweight',
      levels: [...levels],
      aliases: [],
    })
    const cardWithLevels = (levels: (number | undefined)[]): LadderGateCard => ({
      name: 'Push-up',
      kind: 'bodyweight',
      strengthSets: [],
      durationEntries: [],
      bodyweightSets: levels.map((level) => ({ level })),
    })
    const createGateView = (
      markdownFiles: PersistKindChangeMarkdownFile[],
      registryLevels: string[],
      confirmed: boolean,
    ): { view: LadderGateView; confirm: ReturnType<typeof vi.fn> } => {
      const { view } = createPersistKindChangeView(
        markdownFiles,
        registryLevels.length > 0 ? [ladderEntry(registryLevels)] : [],
      )
      const gateView = view as unknown as LadderGateView
      gateView.render = vi.fn()
      const confirm = vi.fn(async () => confirmed)
      gateView.confirmLadderChanges = confirm
      registryVaultMock.exerciseRegistryWithVaultNotes.mockReturnValue(
        registryLevels.length > 0 ? [ladderEntry(registryLevels)] : [],
      )
      return { view: gateView, confirm }
    }

    beforeEach(() => {
      obsidianMock.notices = []
    })

    afterEach(() => {
      obsidianMock.menus = []
      vi.unstubAllGlobals()
    })

    it('names each affected level with its old and new meaning', () => {
      expect(
        formatLadderChangesWarning('Push-up', [
          { level: 2, from: 'Knee push-up', to: 'Full push-up' },
          { level: 3, from: 'Incline push-up', to: 'Knee push-up' },
        ]),
      ).toEqual({
        title: 'Change what logged levels mean for Push-up?',
        message:
          'This edit changes what some already-logged levels mean. ' +
          "Level 2 currently means 'Knee push-up' and would come to mean 'Full push-up'. " +
          "Level 3 currently means 'Incline push-up' and would come to mean 'Knee push-up'. " +
          'Logged sets keep their numbers.',
      })
    })

  })

  interface RelabelView extends PersistLadderView {
    model: { exercises: LadderGateCard[] }
    markDirty: ReturnType<typeof vi.fn>
    confirmFirstLevelRelabel: (message: string) => Promise<boolean>
    seedBodyweightLadder(ex: LadderGateCard): Promise<void>
    offerFirstLevelRelabel(index: number, previous: ExerciseEntry): Promise<void>
  }

  describe('WorkoutEditorView rename onto a registry type', () => {
    interface RenameCard {
      name: string
      kind: 'strength' | 'duration'
      plan?: string
      strengthSets: { set?: number; weight?: number; reps?: number }[]
      durationEntries: { set?: number; durationSeconds?: number }[]
      bodyweightSets: never[]
    }
    interface RenameView extends PersistKindChangeView {
      model: { exercises: RenameCard[] }
      render: ReturnType<typeof vi.fn>
      markDirty: ReturnType<typeof vi.fn>
      openIntervalPlanModal: ReturnType<typeof vi.fn>
      confirmKindSwitch: () => Promise<boolean>
      applyRename: (index: number, name: string, registry: unknown) => Promise<void>
    }
    const createRenameView = (card: RenameCard): RenameView => {
      const { view } = createPersistKindChangeView([], [])
      const renameView = view as unknown as RenameView
      renameView.render = vi.fn()
      renameView.markDirty = vi.fn()
      renameView.openIntervalPlanModal = vi.fn()
      renameView.confirmKindSwitch = async () => true
      renameView.model = { exercises: [card] }
      return renameView
    }
    const card = (overrides: Partial<RenameCard>): RenameCard => ({
      name: 'Squat',
      kind: 'strength',
      strengthSets: [],
      durationEntries: [],
      bodyweightSets: [],
      ...overrides,
    })

    beforeEach(() => {
      obsidianMock.notices = []
    })

    it('switches a strength card renamed onto an interval name and opens the plan form', async () => {
      const view = createRenameView(card({ strengthSets: [{ set: 1, weight: 10, reps: 8 }] }))
      const registry = createRegistry([
        { name: 'Rower', kind: 'duration', interval: true, aliases: [] },
      ])

      await view.applyRename(0, 'Rower', registry)

      const renamed = view.model.exercises[0]
      expect(renamed).toMatchObject({ name: 'Rower', kind: 'duration', strengthSets: [] })
      expect(view.openIntervalPlanModal).toHaveBeenCalledWith(renamed)
      expect(view.plugin.saveSettings).not.toHaveBeenCalled()
      expect(obsidianMock.notices).toEqual([
        'Switched to interval. Previous strength rows were cleared.',
      ])
    })

    it('drops the plan when an interval card takes a plain duration name', async () => {
      const view = createRenameView(
        card({ name: 'Bike', kind: 'duration', plan: '8 x 30s, 90s rest' }),
      )
      const registry = createRegistry([{ name: 'Rower', kind: 'duration', aliases: [] }])

      await view.applyRename(0, 'Rower', registry)

      const renamed = view.model.exercises[0]
      expect(renamed).toMatchObject({ name: 'Rower', kind: 'duration' })
      expect(renamed?.plan).toBeUndefined()
      expect(view.openIntervalPlanModal).not.toHaveBeenCalled()
    })

    it('opens the plan form on a plain duration card that takes an interval name', async () => {
      const view = createRenameView(
        card({ name: 'Bike', kind: 'duration', durationEntries: [{ durationSeconds: 60 }] }),
      )
      const registry = createRegistry([
        { name: 'Rower', kind: 'duration', interval: true, aliases: [] },
      ])

      await view.applyRename(0, 'Rower', registry)

      const renamed = view.model.exercises[0]
      expect(renamed).toMatchObject({ name: 'Rower', durationEntries: [{ durationSeconds: 60 }] })
      expect(view.openIntervalPlanModal).toHaveBeenCalledWith(renamed)
      expect(view.markDirty).toHaveBeenCalled()
      expect(obsidianMock.notices).toEqual([])
    })
  })
})

interface TimerExerciseCard {
  name: string
  kind: 'duration'
  strengthSets: unknown[]
  durationEntries: { durationSeconds?: number; set?: number; note?: string }[]
  bodyweightSets: unknown[]
}

interface RestTimerExerciseCard {
  name: string
  kind: 'strength' | 'duration'
  strengthSets: { set?: number; weight?: number; reps?: number; note?: string }[]
  durationEntries: { durationSeconds?: number; set?: number; note?: string }[]
  bodyweightSets: unknown[]
}

interface RestTimerWorkoutModel {
  isFitKitWorkout: boolean
  date: string
  name: string
  sourcePath: string
  exercises: RestTimerExerciseCard[]
  preserveBlocks: unknown[]
  frontmatterExtra: string[]
}

interface TimerView {
  file: unknown
  model: { exercises: TimerExerciseCard[] }
  exerciseHistory: unknown
  contentEl: TestElement
  render: ReturnType<typeof vi.fn>
  markDirty: ReturnType<typeof vi.fn>
  focusRowCell: ReturnType<typeof vi.fn>
  runningSetTimer(): RunningSetTimer | null
  renderDurationTable(card: HTMLElement, ex: TimerExerciseCard, index: number): void
  renderDurationRow(
    wrap: HTMLElement,
    ex: TimerExerciseCard,
    i: number,
    exerciseIndex: number,
  ): void
  openSetTimer(card: TimerExerciseCard): void
  stopTimer(opts: { write: boolean; render?: boolean }): void
  abortTimer(): void
  liveSeconds(stopwatch: { accumulator: number; startedAtMs: number }): number
}

/** The set timer screen as the view holds it while its set is timed. */
interface RunningSetTimer {
  card: unknown
  entry: unknown
  stopwatch: { accumulator: number; startedAtMs: number }
}

interface RestTimerView {
  plugin: { settings: { strengthRestTimerEnabled: boolean } }
  file: unknown
  session: unknown
  model: RestTimerWorkoutModel
  exerciseHistory: unknown
  lastRestSeconds: number | null
  contentEl: TestElement
  render: ReturnType<typeof vi.fn>
  markDirty: ReturnType<typeof vi.fn>
  focusRowCell: ReturnType<typeof vi.fn>
  screens: { current(): unknown }
  runningSetTimer(): RunningSetTimer | null
  openSetTimer(card: RestTimerExerciseCard): void
  startRestTimer: (() => void) | ReturnType<typeof vi.fn>
  refreshSettingsDrivenUi(): void
  renderFooterRestTimer(footer: HTMLElement): void
  renderStrengthTable(card: HTMLElement, ex: RestTimerExerciseCard, exerciseIndex: number): void
  stopRestTimer(): void
  tickRestTimer(): void
  loadFile(file: unknown): Promise<void>
  reloadFromDisk(): Promise<void>
  onClose(): Promise<void>
}

interface RestTimerRenderView {
  plugin: { settings: { strengthRestTimerEnabled: boolean } }
  session: { file: { basename: string; path: string } }
  model: RestTimerWorkoutModel
  exerciseHistory: unknown
  lastRestSeconds: number | null
  contentEl: TestElement
  render(): void
}

describe('WorkoutEditorView rest timer', () => {
  const createRestTimerModel = (exercises: RestTimerExerciseCard[]): RestTimerWorkoutModel => ({
    isFitKitWorkout: true,
    date: '2026-05-03',
    name: 'Leg day',
    sourcePath: 'Workouts/A.md',
    exercises,
    preserveBlocks: [],
    frontmatterExtra: [],
  })

  const createRestTimerView = (ex: RestTimerExerciseCard): RestTimerView => {
    const view = Object.create(WorkoutEditorView.prototype) as RestTimerView
    view.plugin = { settings: { strengthRestTimerEnabled: true } }
    view.file = { path: 'Workouts/A.md' }
    view.model = createRestTimerModel([ex])
    view.exerciseHistory = null
    view.lastRestSeconds = null
    view.contentEl = new TestElement('div')
    view.render = vi.fn()
    view.markDirty = vi.fn()
    view.focusRowCell = vi.fn()
    return view
  }

  const createRestTimerRenderView = (
    exercises: RestTimerExerciseCard[],
    strengthRestTimerEnabled = true,
  ): RestTimerRenderView => {
    const view = Object.create(WorkoutEditorView.prototype) as RestTimerRenderView
    view.plugin = { settings: { strengthRestTimerEnabled } }
    view.session = { file: { basename: 'A', path: 'Workouts/A.md' } }
    view.model = createRestTimerModel(exercises)
    view.exerciseHistory = null
    view.lastRestSeconds = null
    view.contentEl = new TestElement('div')
    return view
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T00:00:00Z'))
    /**
     * The node test environment has no `window`, so point the `window` global
     * the source schedules timers on at the test realm's global.
     */
    // eslint-disable-next-line obsidianmd/no-global-this -- The test realm's global object is the only handle available for stubbing.
    vi.stubGlobal('window', globalThis)

    vi.stubGlobal('activeWindow', { navigator: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    obsidianMock.menus = []
  })

  it('keeps strength rows to Set, Weight, and Reps without per-row rest controls', () => {
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [{ set: 1, weight: 80, reps: 5 }],
      durationEntries: [],
      bodyweightSets: [],
    }
    const view = createRestTimerView(ex)
    const card = new TestElement('div')

    view.renderStrengthTable(card as unknown as HTMLElement, ex, 0)

    expect(card.findByClass('fitkit-set-head')?.children.map((child) => child.textContent)).toEqual(
      ['', 'Weight', 'Reps'],
    )
    expect(card.findByClass('fitkit-rest-timer-button')).toBeNull()
    expect(
      card
        .findAllByClass('fitkit-set-row')
        .some((row) => row.classes.has('fitkit-set-row-with-rest')),
    ).toBe(false)
  })

  it('inherits the previous weight when a set is added, and offers no duplicate button', () => {
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [{ set: 1, weight: 80, reps: 5 }],
      durationEntries: [],
      bodyweightSets: [],
    }
    const view = createRestTimerView(ex)
    const card = new TestElement('div')

    view.renderStrengthTable(card as unknown as HTMLElement, ex, 0)
    const actions = card.findByClass('fitkit-row-actions')
    expect(actions?.children.map((child) => child.textContent)).not.toContain('Duplicate last set')

    const addBtn = actions?.children.find(
      (child) => child.tagName === 'button' && child.textContent === 'Add set',
    )
    addBtn?.listenersFor('click')[0]?.({ stopPropagation: vi.fn() })

    expect(ex.strengthSets).toHaveLength(2)
    expect(ex.strengthSets[1]).toEqual({ set: 2, weight: 80 })
    expect(view.focusRowCell).toHaveBeenCalledWith(0, 1, 'Weight')
  })

  it('never starts the rest timer from reps entry, since rest is started by hand', () => {
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [{ set: 1, weight: 80 }],
      durationEntries: [],
      bodyweightSets: [],
    }
    const view = createRestTimerView(ex)
    view.startRestTimer = vi.fn()
    const card = new TestElement('div')

    view.renderStrengthTable(card as unknown as HTMLElement, ex, 0)
    const reps = card.findAllByClass('fitkit-cell').find((cell) => cell.dataset.label === 'Reps')
      ?.children[0] as unknown as (TestElement & { value: string }) | undefined
    reps!.value = '5'
    reps!.listenersFor('blur').forEach((listener) => listener({}))

    expect(view.startRestTimer).not.toHaveBeenCalled()
    expect(view.screens.current()).toBeNull()
  })

  it('marks only the last strength row as the live row', () => {
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [
        { set: 1, weight: 80, reps: 5 },
        { set: 2, weight: 85, reps: 5 },
        { set: 3, weight: 90 },
      ],
      durationEntries: [],
      bodyweightSets: [],
    }
    const view = createRestTimerView(ex)
    const card = new TestElement('div')

    view.renderStrengthTable(card as unknown as HTMLElement, ex, 0)

    const rows = card.findAllByClass('fitkit-row')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.classes.has('fitkit-row--live'))).toEqual([false, false, true])
  })

  it('renders the footer rest button only when enabled', () => {
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [{ set: 1, weight: 80, reps: 5 }],
      durationEntries: [],
      bodyweightSets: [],
    }
    const enabledView = createRestTimerRenderView([ex])

    enabledView.render()

    const footer = enabledView.contentEl.findByClass('fitkit-footer')
    const buttons = footer?.children.filter((child) => child.tagName === 'button') ?? []
    const restButton = footer?.findByClass('fitkit-rest-timer-button')
    expect(buttons.map((button) => button.textContent)).toEqual(['Add exercise'])
    expect(restButton?.attributes.get('aria-label')).toBe('Start rest timer')
    expect(restButton?.attributes.get('data-icon')).toBe('timer')
    expect(restButton?.findByClass('fitkit-rest-timer-label')?.textContent).toBe('Start rest')

    const disabledView = createRestTimerRenderView([ex], false)
    disabledView.render()

    const disabledFooter = disabledView.contentEl.findByClass('fitkit-footer')
    expect(disabledFooter?.findByClass('fitkit-rest-timer-button')).toBeNull()
  })

  it('does not start the rest timer when the setting is disabled', () => {
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [{ set: 1, weight: 80, reps: 5 }],
      durationEntries: [],
      bodyweightSets: [],
    }
    const view = createRestTimerView(ex)
    view.plugin.settings.strengthRestTimerEnabled = false

    view.startRestTimer()

    expect(view.screens.current()).toBeNull()
    expect(view.render).not.toHaveBeenCalled()
  })

  it('starts without dirtying or mutating the workout model', () => {
    const set = { set: 1, weight: 80, reps: 5 }
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [set],
      durationEntries: [],
      bodyweightSets: [],
    }
    const view = createRestTimerView(ex)

    view.startRestTimer()

    expect(view.screens.current()).toMatchObject({ kind: 'rest', startedAtMs: Date.now() })
    expect(set).toEqual({ set: 1, weight: 80, reps: 5 })
    expect(view.lastRestSeconds).toBeNull()
    expect(view.markDirty).not.toHaveBeenCalled()
    expect(view.render).toHaveBeenCalled()
  })

  it('stopping captures the elapsed rest duration for the footer readout', () => {
    const set = { set: 1, weight: 80, reps: 5 }
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [set],
      durationEntries: [],
      bodyweightSets: [],
    }
    const view = createRestTimerView(ex)

    view.startRestTimer()
    vi.setSystemTime(new Date('2026-05-03T00:00:12Z'))
    view.stopRestTimer()
    const footer = new TestElement('div')
    view.renderFooterRestTimer(footer as unknown as HTMLElement)

    expect(view.screens.current()).toBeNull()
    expect(view.lastRestSeconds).toBe(12)
    expect(footer.findByClass('fitkit-rest-timer-label')?.textContent).toBe('Start rest')
    expect(footer.findByClass('fitkit-rest-timer-last')?.textContent).toBe('Last rest 12s')
    expect(set).toEqual({ set: 1, weight: 80, reps: 5 })
    expect(view.markDirty).not.toHaveBeenCalled()
  })

  it('clears the last-rest readout when starting again', () => {
    const set = { set: 1, weight: 80, reps: 5 }
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [set],
      durationEntries: [],
      bodyweightSets: [],
    }
    const view = createRestTimerView(ex)

    view.startRestTimer()
    vi.setSystemTime(new Date('2026-05-03T00:00:09Z'))
    view.stopRestTimer()
    view.startRestTimer()
    const footer = new TestElement('div')
    view.renderFooterRestTimer(footer as unknown as HTMLElement)

    expect(view.lastRestSeconds).toBeNull()
    expect(footer.findByClass('fitkit-rest-timer-last')).toBeNull()
  })

  it('clears active and last rest state when the setting is disabled', () => {
    const set = { set: 1, weight: 80, reps: 5 }
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [set],
      durationEntries: [],
      bodyweightSets: [],
    }
    const view = createRestTimerView(ex)
    view.session = { file: { path: 'Workouts/A.md' } }

    view.startRestTimer()
    vi.setSystemTime(new Date('2026-05-03T00:00:05Z'))
    view.stopRestTimer()
    expect(view.lastRestSeconds).toBe(5)

    view.plugin.settings.strengthRestTimerEnabled = false
    view.refreshSettingsDrivenUi()

    expect(view.screens.current()).toBeNull()
    expect(view.lastRestSeconds).toBeNull()
    expect(view.render).toHaveBeenCalled()

    view.plugin.settings.strengthRestTimerEnabled = true
    view.startRestTimer()
    view.plugin.settings.strengthRestTimerEnabled = false
    view.refreshSettingsDrivenUi()

    expect(view.screens.current()).toBeNull()
    expect(view.lastRestSeconds).toBeNull()
  })

  it('clears active and last rest state on file load and close', async () => {
    const set = { set: 1, weight: 80, reps: 5 }
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [set],
      durationEntries: [],
      bodyweightSets: [],
    }
    const view = createRestTimerView(ex)

    view.startRestTimer()
    vi.setSystemTime(new Date('2026-05-03T00:00:04Z'))
    view.stopRestTimer()
    await view
      .loadFile({ path: 'Workouts/B.md', extension: 'md', basename: 'B', stat: { mtime: 0 } })
      .catch(() => undefined)

    expect(view.screens.current()).toBeNull()
    expect(view.lastRestSeconds).toBeNull()
    expect(set).toEqual({ set: 1, weight: 80, reps: 5 })

    view.startRestTimer()
    await view.onClose().catch(() => undefined)

    expect(view.screens.current()).toBeNull()
    expect(view.lastRestSeconds).toBeNull()
    expect(set).toEqual({ set: 1, weight: 80, reps: 5 })
  })

  it('preserves the last-rest readout while aborting active rest on reload', async () => {
    const set = { set: 1, weight: 80, reps: 5 }
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [set],
      durationEntries: [],
      bodyweightSets: [],
    }
    const view = createRestTimerView(ex)
    view.session = {
      file: { path: 'Workouts/A.md' },
      load: vi.fn().mockResolvedValue({
        model: {
          date: '2026-05-03',
          name: 'Leg day',
          sourcePath: 'Workouts/A.md',
          exercises: [
            {
              exerciseName: 'Squat',
              kind: 'strength',
              strengthSets: [{ set: 1, weight: 90, reps: 3 }],
              durationEntries: [],
              bodyweightSets: [],
            },
          ],
          preserveBlocks: [],
          frontmatterExtra: [],
        },
        isWorkout: true,
      }),
    }
    view.startRestTimer()
    view.lastRestSeconds = 12

    await view.reloadFromDisk()

    expect(view.screens.current()).toBeNull()
    expect(view.lastRestSeconds).toBe(12)
    expect(view.model.exercises[0]?.strengthSets[0]?.weight).toBe(90)
  })

  it('starting rest writes and clears an active duration timer', () => {
    const durationEntry = { durationSeconds: 30 }
    const ex: RestTimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [durationEntry],
      bodyweightSets: [],
    }
    const view = createRestTimerView(ex)
    view.openSetTimer(ex)
    view.render.mockClear()
    view.markDirty.mockClear()

    vi.setSystemTime(new Date('2026-05-03T00:00:08Z'))
    view.startRestTimer()

    expect(durationEntry.durationSeconds).toBe(38)
    expect(view.runningSetTimer()).toBeNull()
    expect(view.screens.current()).toMatchObject({ kind: 'rest', startedAtMs: Date.now() })
    expect(view.markDirty).toHaveBeenCalled()
    expect(view.render).toHaveBeenCalledTimes(1)
  })
})

describe('WorkoutEditorView duration timer', () => {
  const createTimerView = (ex: TimerExerciseCard): TimerView => {
    const view = Object.create(WorkoutEditorView.prototype) as TimerView
    view.file = { path: 'Workouts/A.md' }
    view.model = { exercises: [ex] }
    view.exerciseHistory = null
    view.contentEl = new TestElement('div')
    view.render = vi.fn()
    view.markDirty = vi.fn()
    view.focusRowCell = vi.fn()
    return view
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-28T00:00:00Z'))
    /**
     * The node test environment has no `window`, so point the `window` global
     * the source schedules timers on at the test realm's global.
     */
    // eslint-disable-next-line obsidianmd/no-global-this -- The test realm's global object is the only handle available for stubbing.
    vi.stubGlobal('window', globalThis)

    vi.stubGlobal('activeWindow', { navigator: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    obsidianMock.menus = []
  })

  it('renders Start timer next to Add set when no timer is active', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{}],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)
    const card = new TestElement('div')

    view.renderDurationTable(card as unknown as HTMLElement, ex, 0)

    const actions = card.findByClass('fitkit-row-actions')
    const buttons = actions?.children.filter((c) => c.tagName === 'button') ?? []
    expect(buttons.map((b) => b.textContent)).toEqual(['Add set', 'Repeat', 'Start timer'])
    expect(buttons[2]?.attributes.get('data-icon')).toBe('play')
  })

  it('shows the duration set number as a figure rather than an editable field', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 60 }, { set: 7, durationSeconds: 30 }],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)
    const card = new TestElement('div')

    view.renderDurationTable(card as unknown as HTMLElement, ex, 0)

    expect(card.findByClass('fitkit-set-head')?.children.map((child) => child.textContent)).toEqual(
      ['', 'Duration'],
    )
    const setCells = card
      .findAllByClass('fitkit-cell')
      .filter((cell) => cell.dataset.label === 'Set')
    expect(setCells.map((cell) => cell.textContent)).toEqual(['1', '7'])
    expect(setCells.flatMap((cell) => cell.children)).toEqual([])
  })

  it('renumbers duration rows from the row menu', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [
        { set: 4, durationSeconds: 60 },
        { set: 9, durationSeconds: 30 },
      ],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)
    const card = new TestElement('div')

    view.renderDurationTable(card as unknown as HTMLElement, ex, 0)
    const kebab = card.findByClass('fitkit-row-kebab')
    kebab?.listenersFor('click')[0]?.({ stopPropagation: vi.fn() })
    const renumber = obsidianMock.menus[0]?.items.find((item) => item.title === 'Renumber sets')
    renumber?.onClick?.()

    expect(ex.durationEntries.map((entry) => entry.set)).toEqual([1, 2])
    expect(view.markDirty).toHaveBeenCalled()
  })

  it('openSetTimer auto-creates a row when none exist and sets the active timer', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)

    view.openSetTimer(ex)

    expect(ex.durationEntries).toHaveLength(1)
    const timer = view.runningSetTimer()
    expect(timer?.card).toBe(ex)
    expect(timer?.entry).toBe(ex.durationEntries[0])
    expect(timer?.stopwatch.accumulator).toBe(0)
    expect(view.markDirty).toHaveBeenCalled()
    expect(view.render).toHaveBeenCalled()
  })

  it('openSetTimer accumulates from the existing duration value', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 30 }],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)

    view.openSetTimer(ex)

    expect(view.runningSetTimer()?.stopwatch.accumulator).toBe(30)
  })

  it('liveSeconds returns accumulator plus elapsed wall-clock seconds', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 30 }],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)

    view.openSetTimer(ex)
    vi.setSystemTime(new Date('2026-04-28T00:00:05Z'))
    const timer = view.runningSetTimer()
    expect(timer && view.liveSeconds(timer.stopwatch)).toBe(35)
  })

  it('stopTimer writes accumulator + elapsed back into the row and clears the timer', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 30 }],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)

    view.openSetTimer(ex)
    vi.setSystemTime(new Date('2026-04-28T00:00:12Z'))
    view.stopTimer({ write: true })

    expect(ex.durationEntries[0]?.durationSeconds).toBe(42)
    expect(view.runningSetTimer()).toBeNull()
  })

  it('abortTimer clears the timer without writing back', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 10 }],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)

    view.openSetTimer(ex)
    view.render.mockClear()
    vi.setSystemTime(new Date('2026-04-28T00:00:05Z'))
    view.abortTimer()

    expect(ex.durationEntries[0]?.durationSeconds).toBe(10)
    expect(view.runningSetTimer()).toBeNull()
    expect(view.render).toHaveBeenCalledTimes(1)
  })

  it('leaves focus alone when a duration set is added, since the timer fills it', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 60 }],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)
    const card = new TestElement('div')

    view.renderDurationTable(card as unknown as HTMLElement, ex, 0)
    const addBtn = card
      .findByClass('fitkit-row-actions')
      ?.children.find((c) => c.tagName === 'button' && c.textContent === 'Add set')
    addBtn?.listenersFor('click')[0]?.({ stopPropagation: vi.fn() })

    expect(ex.durationEntries).toHaveLength(2)
    expect(view.focusRowCell).not.toHaveBeenCalled()
  })

  it('clicking Add set while a timer is running writes back and appends', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{}],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)

    view.openSetTimer(ex)
    vi.setSystemTime(new Date('2026-04-28T00:00:08Z'))

    const card = new TestElement('div')
    view.renderDurationTable(card as unknown as HTMLElement, ex, 0)
    const actions = card.findByClass('fitkit-row-actions')
    const addBtn = actions?.children.find(
      (c) => c.tagName === 'button' && c.textContent === 'Add set',
    )
    addBtn?.listenersFor('click')[0]?.({ stopPropagation: vi.fn() })

    expect(ex.durationEntries[0]?.durationSeconds).toBe(8)
    expect(ex.durationEntries).toHaveLength(2)
    expect(view.runningSetTimer()).toBeNull()
  })

  it('clicking Repeat while a timer is running writes back, then copies the timed duration', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{}],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)

    view.openSetTimer(ex)
    vi.setSystemTime(new Date('2026-04-28T00:00:08Z'))

    const card = new TestElement('div')
    view.renderDurationTable(card as unknown as HTMLElement, ex, 0)
    card
      .findByClass('fitkit-row-actions')
      ?.children.find((c) => c.tagName === 'button' && c.textContent === 'Repeat')
      ?.listenersFor('click')[0]?.({ stopPropagation: vi.fn() })

    expect(ex.durationEntries).toEqual([{ durationSeconds: 8 }, { set: 2, durationSeconds: 8 }])
    expect(view.runningSetTimer()).toBeNull()
  })

  it('deleting the active row aborts the timer without writing back', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 30 }],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)
    ;(
      view as unknown as {
        confirmAndDeleteRow: (label: string, onDelete: () => void) => Promise<void>
      }
    ).confirmAndDeleteRow = (_label: string, onDelete: () => void) => {
      onDelete()
      return Promise.resolve()
    }
    const originalEntry = ex.durationEntries[0]

    view.openSetTimer(ex)
    vi.setSystemTime(new Date('2026-04-28T00:00:05Z'))

    const wrap = new TestElement('div')
    view.renderDurationRow(wrap as unknown as HTMLElement, ex, 0, 0)

    const kebab = wrap.findByClass('fitkit-row-kebab')
    kebab?.listenersFor('click')[0]?.({ stopPropagation: vi.fn() })
    const menu = obsidianMock.menus[obsidianMock.menus.length - 1]
    const deleteItem = menu?.items.find((i) => i.title === 'Delete row')
    deleteItem?.onClick?.()

    expect(originalEntry?.durationSeconds).toBe(30)
    expect(ex.durationEntries).toHaveLength(0)
    expect(view.runningSetTimer()).toBeNull()
  })

  it('loadFile flushes a running timer (writes elapsed seconds) before swapping to a new file', async () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 30 }],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)
    view.openSetTimer(ex)
    vi.setSystemTime(new Date('2026-04-28T00:00:12Z'))

    /** loadFile reaches FileSession.load after the timer flush; allow the unmocked vault call to throw and assert the flush effect. */
    await (view as unknown as { loadFile: (f: unknown) => Promise<void> })
      .loadFile({ path: 'Workouts/B.md', extension: 'md', basename: 'B', stat: { mtime: 0 } })
      .catch(() => undefined)

    expect(ex.durationEntries[0]?.durationSeconds).toBe(42)
    expect(view.runningSetTimer()).toBeNull()
  })

  it('onClose flushes a running timer (writes elapsed seconds) before tearing down', async () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 30 }],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)
    view.openSetTimer(ex)
    vi.setSystemTime(new Date('2026-04-28T00:00:12Z'))

    /** onClose calls contentEl.empty() after the timer flush; TestElement does not implement empty so absorb the throw and assert the flush effect. */
    await (view as unknown as { onClose: () => Promise<void> }).onClose().catch(() => undefined)

    expect(ex.durationEntries[0]?.durationSeconds).toBe(42)
    expect(view.runningSetTimer()).toBeNull()
  })

  it('renderDurationRow displays stored seconds in one formatted duration text input', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 90 }],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)

    const wrap = new TestElement('div')
    view.renderDurationRow(wrap as unknown as HTMLElement, ex, 0, 0)

    const durationCell = wrap
      .findAllByClass('fitkit-cell')
      .find((c) => c.dataset.label === 'Duration')
    const input = durationCell?.findByClass('fitkit-duration-input')
    expect(input?.attributes.get('aria-label')).toBe('Duration')
    expect(input?.attributes.get('type')).toBe('text')
    expect(input?.attributes.get('placeholder')).toBe('0s')
    expect(input?.attributes.get('data-fitkit-default-focus')).toBe('true')
    expect((input as unknown as { value?: string } | undefined)?.value).toBe('1m30s')
  })

  it('renderDurationRow parses duration text into seconds and normalizes on blur', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{}],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)
    const wrap = new TestElement('div')
    view.renderDurationRow(wrap as unknown as HTMLElement, ex, 0, 0)
    const durationCell = wrap
      .findAllByClass('fitkit-cell')
      .find((c) => c.dataset.label === 'Duration')
    const input = durationCell?.findByClass('fitkit-duration-input')

    ;(input as unknown as { value: string }).value = '5:30'
    input?.listenersFor('input')[0]?.({})

    expect(ex.durationEntries[0]?.durationSeconds).toBe(330)
    expect(input?.attributes.has('aria-invalid')).toBe(false)
    expect(view.markDirty).toHaveBeenCalled()

    input?.listenersFor('blur')[0]?.({})

    expect((input as unknown as { value?: string } | undefined)?.value).toBe('5m30s')
  })

  it('renderDurationRow accepts unit text and normalizes missing seconds on blur', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{}],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)
    const wrap = new TestElement('div')
    view.renderDurationRow(wrap as unknown as HTMLElement, ex, 0, 0)
    const durationCell = wrap
      .findAllByClass('fitkit-cell')
      .find((c) => c.dataset.label === 'Duration')
    const input = durationCell?.findByClass('fitkit-duration-input')

    ;(input as unknown as { value: string }).value = '5m'
    input?.listenersFor('input')[0]?.({})
    input?.listenersFor('blur')[0]?.({})

    expect(ex.durationEntries[0]?.durationSeconds).toBe(300)
    expect((input as unknown as { value?: string } | undefined)?.value).toBe('5m')
  })

  it('renderDurationRow preserves stored seconds while duration text is invalid', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 90 }],
      bodyweightSets: [],
    }
    const view = createTimerView(ex)
    const wrap = new TestElement('div')
    view.renderDurationRow(wrap as unknown as HTMLElement, ex, 0, 0)
    const durationCell = wrap
      .findAllByClass('fitkit-cell')
      .find((c) => c.dataset.label === 'Duration')
    const input = durationCell?.findByClass('fitkit-duration-input')
    view.markDirty.mockClear()
    ;(input as unknown as { value: string }).value = 'soon'
    input?.listenersFor('input')[0]?.({})

    expect(ex.durationEntries[0]?.durationSeconds).toBe(90)
    expect(input?.attributes.get('aria-invalid')).toBe('true')
    expect(view.markDirty).not.toHaveBeenCalled()

    input?.listenersFor('blur')[0]?.({})

    expect(input?.attributes.has('aria-invalid')).toBe(false)
    expect((input as unknown as { value?: string } | undefined)?.value).toBe('1m30s')
  })
})

interface NextPlanExerciseCard {
  name: string
  kind: 'strength' | 'duration'
  plan?: string
  next?: { direction: 'up' | 'down' | 'stay'; step?: number }
  strengthSets: Array<{ set?: number; weight?: number; reps?: number }>
  durationEntries: Array<{ durationSeconds?: number }>
  bodyweightSets: unknown[]
}

interface NextPlanView {
  plugin: { settings: { fitnessRoot: string; strengthRestTimerEnabled: boolean } }
  model: { exercises: NextPlanExerciseCard[] }
  exerciseHistory: unknown
  render: ReturnType<typeof vi.fn>
  markDirty: ReturnType<typeof vi.fn>
  focusRowCell: ReturnType<typeof vi.fn>
  renderExerciseCard(list: HTMLElement, index: number): void
  openCardMenu(evt: MouseEvent, index: number): void
}

interface SeedView {
  model: { exercises: RestTimerExerciseCard[] }
  exerciseHistory: unknown
  markDirty: ReturnType<typeof vi.fn>
  render: ReturnType<typeof vi.fn>
  applyKindSwitch(index: number, nextKind: 'strength' | 'duration', clearedRows: boolean): void
  renderStrengthTable(card: HTMLElement, ex: RestTimerExerciseCard, exerciseIndex: number): void
}

describe('WorkoutEditorView set seeding', () => {
  const seedStrength = (history: unknown): SeedView => {
    const view = Object.create(WorkoutEditorView.prototype) as SeedView
    view.model = {
      exercises: [
        {
          name: 'Squat',
          kind: 'duration',
          strengthSets: [],
          durationEntries: [{}],
          bodyweightSets: [],
        },
      ],
    }
    view.exerciseHistory = history
    view.markDirty = vi.fn()
    view.render = vi.fn()
    view.applyKindSwitch(0, 'strength', false)
    return view
  }

  const historyFor = (summary: unknown): Map<string, unknown> => new Map([['Squat', summary]])

  it('seeds the plan target as the first set weight, and never seeds reps', () => {
    const view = seedStrength(
      historyFor({
        strength: { lastSessionMax: { value: { weight: 100, reps: 5 }, date: '2026-08-10' } },
        nextPlan: { value: { direction: 'up', step: 2.5 }, date: '2026-08-10' },
      }),
    )

    expect(view.model.exercises[0]?.strengthSets).toEqual([{ set: 1, weight: 102.5 }])
  })

  it('seeds nothing when the plan has no prior session to apply to', () => {
    const view = seedStrength(
      historyFor({ nextPlan: { value: { direction: 'up', step: 2.5 }, date: '2026-08-10' } }),
    )

    expect(view.model.exercises[0]?.strengthSets).toEqual([{ set: 1 }])
  })

  it('seeds nothing when there is history but no plan', () => {
    const view = seedStrength(
      historyFor({
        strength: { lastSessionMax: { value: { weight: 100, reps: 5 }, date: '2026-08-10' } },
      }),
    )

    expect(view.model.exercises[0]?.strengthSets).toEqual([{ set: 1 }])
  })

  it('seeds nothing when the plan carries no step', () => {
    const view = seedStrength(
      historyFor({
        strength: { lastSessionMax: { value: { weight: 100, reps: 5 }, date: '2026-08-10' } },
        nextPlan: { value: { direction: 'up' }, date: '2026-08-10' },
      }),
    )

    expect(view.model.exercises[0]?.strengthSets).toEqual([{ set: 1 }])
  })

  it('marks a seeded weight unconfirmed until it is typed over', () => {
    const view = seedStrength(
      historyFor({
        strength: { lastSessionMax: { value: { weight: 100, reps: 5 }, date: '2026-08-10' } },
        nextPlan: { value: { direction: 'up', step: 2.5 }, date: '2026-08-10' },
      }),
    )
    const card = new TestElement('div')
    const ex = view.model.exercises[0] as RestTimerExerciseCard

    view.renderStrengthTable(card as unknown as HTMLElement, ex, 0)
    const weight = card
      .findAllByClass('fitkit-cell')
      .find((cell) => cell.dataset.label === 'Weight')?.children[0] as unknown as
      (TestElement & { value: string }) | undefined
    expect(weight?.classes.has('fitkit-input--unconfirmed')).toBe(true)

    weight!.value = '105'
    weight!.listenersFor('input').forEach((listener) => listener({}))
    expect(weight?.classes.has('fitkit-input--unconfirmed')).toBe(false)

    const reRendered = new TestElement('div')
    view.renderStrengthTable(reRendered as unknown as HTMLElement, ex, 0)
    const again = reRendered
      .findAllByClass('fitkit-cell')
      .find((cell) => cell.dataset.label === 'Weight')?.children[0]
    expect(again?.classes.has('fitkit-input--unconfirmed')).toBe(false)
  })

  it('seeds a bodyweight row shaped like the rows Add set appends', () => {
    const view = Object.create(WorkoutEditorView.prototype) as unknown as {
      model: {
        exercises: {
          name: string
          kind: 'strength' | 'bodyweight'
          strengthSets: { set?: number; weight?: number; reps?: number }[]
          durationEntries: { set?: number; durationSeconds?: number }[]
          bodyweightSets: { set?: number; level?: number; reps?: number }[]
        }[]
      }
      exerciseHistory: unknown
      markDirty: ReturnType<typeof vi.fn>
      render: ReturnType<typeof vi.fn>
      applyKindSwitch(index: number, nextKind: 'bodyweight', clearedRows: boolean): void
    }
    view.model = {
      exercises: [
        {
          name: 'Push-up',
          kind: 'strength',
          strengthSets: [{ set: 1, weight: 10, reps: 8 }],
          durationEntries: [],
          bodyweightSets: [],
        },
      ],
    }
    view.exerciseHistory = null
    view.markDirty = vi.fn()
    view.render = vi.fn()

    view.applyKindSwitch(0, 'bodyweight', true)

    expect(view.model.exercises[0]?.bodyweightSets).toEqual([{ set: 1, level: 1 }])
  })
})

describe('WorkoutEditorView editor round-trip', () => {
  // Lock: loading an entry into the editor and saving it straight back preserves every field.
  it('round-trips a strength entry through the editor conversions unchanged', () => {
    const entry: StrengthExerciseEntry = {
      exerciseName: 'Bench Press',
      kind: 'strength',
      strengthSets: [
        { set: 1, weight: 60, reps: 8 },
        { set: 2, weight: 60, reps: 6, note: 'grindy' },
      ],
      note: 'paused reps',
      next: { direction: 'up', step: 2.5 },
    }

    expect(toWorkoutExercise(toEditorExercise(entry))).toEqual(entry)
  })

  // Lock: loading an entry into the editor and saving it straight back preserves every field.
  it('round-trips a duration entry through the editor conversions unchanged', () => {
    const entry: DurationExerciseEntry = {
      exerciseName: 'Plank',
      kind: 'duration',
      durationEntries: [
        { set: 1, durationSeconds: 60 },
        { set: 2, durationSeconds: 45, note: 'shaky' },
      ],
      note: 'knees off',
      next: { direction: 'stay' },
    }

    expect(toWorkoutExercise(toEditorExercise(entry))).toEqual(entry)
  })
})

describe('WorkoutEditorView repeat set', () => {
  const renderCard = (ex: {
    name: string
    kind: ExerciseKind
    strengthSets: unknown[]
    durationEntries: unknown[]
    bodyweightSets: unknown[]
  }): TestElement => {
    const view = createExerciseCardRenderView()
    view.model = { exercises: [ex] }
    view.exerciseHistory = new Map()
    Object.assign(view, { markDirty: vi.fn(), render: vi.fn(), focusRowCell: vi.fn() })
    const list = new TestElement('div')
    view.renderExerciseCard(list as unknown as HTMLElement, 0)
    return list
  }

  const repeatButton = (list: TestElement): (TestElement & { disabled?: boolean }) | undefined =>
    list
      .findByClass('fitkit-row-actions')
      ?.children.find((child) => child.tagName === 'button' && child.textContent === 'Repeat')

  const emptyCard = (kind: ExerciseKind) => ({
    name: 'Any',
    kind,
    strengthSets: [],
    durationEntries: [],
    bodyweightSets: [],
  })

  it.each(['strength', 'bodyweight'] as const)(
    'places Repeat right after Add set on a %s card',
    (kind) => {
      const actions = renderCard(emptyCard(kind)).findByClass('fitkit-row-actions')

      expect(actions?.children.map((child) => child.textContent)).toEqual(['Add set', 'Repeat'])
    },
  )

  it('appends a strength set with the last weight and reps, leaving its note behind', () => {
    const ex = {
      name: 'Squat',
      kind: 'strength' as const,
      strengthSets: [
        { set: 1, weight: 60, reps: 8 },
        { set: 2, weight: 80, reps: 5, note: 'grindy' },
      ],
      durationEntries: [],
      bodyweightSets: [],
    }

    repeatButton(renderCard(ex))?.listenersFor('click')[0]?.({})

    expect(ex.strengthSets[2]).toEqual({ set: 3, weight: 80, reps: 5 })
  })

  it('appends a bodyweight set with the last level, reps and load', () => {
    const ex = {
      name: 'Push-up',
      kind: 'bodyweight' as const,
      strengthSets: [],
      durationEntries: [],
      bodyweightSets: [
        { set: 1, level: 2, reps: 12 },
        { set: 2, level: 3, reps: 8, load: 10, note: 'last one' },
      ],
    }

    repeatButton(renderCard(ex))?.listenersFor('click')[0]?.({})

    expect(ex.bodyweightSets[2]).toEqual({ set: 3, level: 3, reps: 8, load: 10 })
  })

  it('appends a duration entry with the last duration, leaving its start stamp and note behind', () => {
    const ex = {
      name: 'Plank',
      kind: 'duration' as const,
      strengthSets: [],
      durationEntries: [
        { set: 1, durationSeconds: 45, startedAt: '2026-09-30T07:00:00', note: 'shaky' },
      ],
      bodyweightSets: [],
    }

    repeatButton(renderCard(ex))?.listenersFor('click')[0]?.({})

    expect(ex.durationEntries[1]).toEqual({ set: 2, durationSeconds: 45 })
  })

  it.each([
    { button: 'Add set', kind: 'strength' as const, rows: 'strengthSets' as const },
    { button: 'Repeat', kind: 'strength' as const, rows: 'strengthSets' as const },
    { button: 'Add set', kind: 'bodyweight' as const, rows: 'bodyweightSets' as const },
    { button: 'Repeat', kind: 'bodyweight' as const, rows: 'bodyweightSets' as const },
    { button: 'Repeat', kind: 'duration' as const, rows: 'durationEntries' as const },
  ])(
    'numbers a set made by $button on a $kind card after the highest, so a deleted set is not reused',
    ({ button, kind, rows }) => {
      const ex = {
        ...emptyCard(kind),
        [rows]: [
          { set: 1, level: 1 },
          { set: 3, level: 1 },
        ],
      }

      renderCard(ex)
        .findByClass('fitkit-row-actions')
        ?.children.find((child) => child.tagName === 'button' && child.textContent === button)
        ?.listenersFor('click')[0]?.({})

      expect(ex[rows].map((row) => (row as { set?: number }).set)).toEqual([1, 3, 4])
    },
  )

  it.each(['strength', 'bodyweight', 'duration'] as const)(
    'disables Repeat on an empty %s card, since there is no set to copy',
    (kind) => {
      expect(repeatButton(renderCard(emptyCard(kind)))?.disabled).toBe(true)
    },
  )

  it.each([
    { kind: 'strength' as const, rows: { strengthSets: [{ set: 1 }] } },
    { kind: 'bodyweight' as const, rows: { bodyweightSets: [{ set: 1, level: 1 }] } },
    { kind: 'duration' as const, rows: { durationEntries: [{}] } },
  ])('enables Repeat once a $kind card has a set', ({ kind, rows }) => {
    expect(repeatButton(renderCard({ ...emptyCard(kind), ...rows }))?.disabled).toBe(false)
  })
})
