import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExerciseRegistryEntry } from '../../src/domain/exercise-registry'

interface MockMenuItemState {
  title?: string
  icon?: string
  disabled?: boolean
  warning?: boolean
  checked?: boolean
  onClick?: () => void
}

interface MockMenuState {
  items: MockMenuItemState[]
  position?: { x: number; y: number }
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

vi.mock('obsidian', () => {
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

    showAtPosition(position: { x: number; y: number }): void {
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

  return {
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

vi.mock('../../src/vault/exercise-registry-vault', () => ({
  exerciseRegistryWithVaultNotes: registryVaultMock.exerciseRegistryWithVaultNotes,
}))

import { TFile } from 'obsidian'
import { WorkoutEditorView } from '../../src/ui/workout-editor-view'

interface TestElementOptions {
  cls?: string
  text?: string
  attr?: Record<string, string>
}

interface TestEvent {
  stopPropagation?: () => void
}

type TestListener = (event: TestEvent) => void

class TestElement {
  readonly attributes = new Map<string, string>()
  readonly children: TestElement[] = []
  readonly classes = new Set<string>()
  readonly dataset: Record<string, string> = {}
  readonly listeners = new Map<string, TestListener[]>()
  parent: TestElement | null = null
  textContent = ''

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

  removeClass(cls: string): void {
    this.classes.delete(cls)
  }

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
    return {
      bottom: 20,
      height: 10,
      left: 10,
      right: 20,
      top: 10,
      width: 10,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    }
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

describe('WorkoutEditorView row actions', () => {
  afterEach(() => {
    obsidianMock.menus = []
    obsidianMock.platform.isMobile = false
    vi.unstubAllGlobals()
  })

  it('renders the kebab on mobile without installing swipe actions', () => {
    obsidianMock.platform.isMobile = true
    const view = createRowActionView()
    const container = new TestElement('div')
    const body = container.createDiv({ cls: 'fitkit-row-body' })

    view.renderRowActions(container as unknown as HTMLElement, body as unknown as HTMLElement, {
      label: 'set 1',
      currentNote: undefined,
      onDelete: vi.fn(),
      onNoteSave: vi.fn(),
    })

    const kebab = body.findByClass('fitkit-row-kebab')
    expect(kebab?.tagName).toBe('button')
    expect(kebab?.attributes.get('aria-label')).toBe('Options for set 1')
    expect(kebab?.attributes.get('data-icon')).toBe('more-vertical')
    expect(container.findByClass('fitkit-row-track')).toBeNull()
    expect(container.findByClass('fitkit-row-reveal')).toBeNull()
    expect(body.listenersFor('pointerdown')).toHaveLength(0)

    kebab?.listenersFor('click')[0]?.({ stopPropagation: vi.fn() })

    expect(obsidianMock.menus).toHaveLength(1)
    expect(obsidianMock.menus[0]?.items).toMatchObject([
      { title: 'Edit note', icon: 'pencil' },
      { title: 'Delete row', icon: 'trash-2', warning: true },
    ])
    expect(obsidianMock.menus[0]?.items.map((item) => item.title)).not.toContain(
      'Open exercise file',
    )
    expect(obsidianMock.menus[0]?.position).toEqual({ x: 10, y: 20 })
  })

  it('adds Open exercise file to the exercise card menu before kind and move actions', () => {
    vi.stubGlobal('HTMLElement', TestElement)
    const view = createCardMenuView()
    view.model = {
      exercises: [
        {
          name: 'Squat',
          kind: 'strength',
          strengthSets: [],
          durationEntries: [],
        },
      ],
    }
    const button = new TestElement('button')

    view.openCardMenu({ currentTarget: button } as unknown as MouseEvent, 0)

    expect(obsidianMock.menus).toHaveLength(1)
    expect(obsidianMock.menus[0]?.items.map((item) => item.title)).toEqual([
      'Open exercise file',
      'Rename exercise',
      'Add exercise note',
      'Plan: increase',
      'Plan: keep',
      'Plan: decrease',
      'Set plan step...',
      'Switch to duration',
      'Move up',
      'Move down',
      'Remove exercise',
    ])
  })

  it('routes the card menu Open exercise file item through the shared handler', () => {
    vi.stubGlobal('HTMLElement', TestElement)
    const view = createCardMenuView()
    const exercise = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [],
      durationEntries: [],
    }
    view.model = { exercises: [exercise] }
    view.openOrCreateExerciseFile = vi.fn(() => Promise.resolve())
    const button = new TestElement('button')

    view.openCardMenu({ currentTarget: button } as unknown as MouseEvent, 0)
    obsidianMock.menus[0]?.items[0]?.onClick?.()

    expect(view.openOrCreateExerciseFile).toHaveBeenCalledWith(exercise)
  })

  it('renders the exercise name as an open-file link and moves rename to the pencil', () => {
    const view = createExerciseCardRenderView()
    view.model = {
      exercises: [
        {
          name: 'Squat',
          kind: 'strength',
          strengthSets: [],
          durationEntries: [],
        },
      ],
    }
    view.exerciseHistory = null
    view.openRenameExerciseModal = vi.fn(() => Promise.resolve())
    const list = new TestElement('div')

    view.renderExerciseCard(list as unknown as HTMLElement, 0)

    const nameButton = list.findByClass('fitkit-name-button')
    expect(nameButton?.attributes.get('aria-label')).toBe('Open exercise file for Squat')
    expect(nameButton?.findByClass('fitkit-name-button-text')?.textContent).toBe('Squat')
    expect(nameButton?.findByClass('fitkit-name-button-icon')?.attributes.get('data-icon')).toBe(
      'arrow-up-right',
    )
    expect(list.findByClass('fitkit-rename-button')).toBeNull()
    expect(list.findByClass('fitkit-card-top')?.children).toHaveLength(3)
  })

  it('reaches rename through the card menu', () => {
    vi.stubGlobal('HTMLElement', TestElement)
    const view = createCardMenuView()
    view.model = {
      exercises: [{ name: 'Squat', kind: 'strength', strengthSets: [], durationEntries: [] }],
    }
    view.openRenameExerciseModal = vi.fn(() => Promise.resolve())

    view.openCardMenu({ currentTarget: new TestElement('button') } as unknown as MouseEvent, 0)

    const rename = obsidianMock.menus[0]?.items.find((item) => item.title === 'Rename exercise')
    expect(rename?.icon).toBe('pencil')
    rename?.onClick?.()
    expect(view.openRenameExerciseModal).toHaveBeenCalledWith(0)
  })

  it('opens an existing exercise note when the rendered name is clicked', async () => {
    const view = createExerciseCardRenderView()
    const existingFile = new TFile()
    view.app = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) =>
          path === 'Fitness/Exercises/Squat.md' ? existingFile : null,
        ),
        create: vi.fn(),
      },
      workspace: {
        setActiveLeaf: vi.fn(),
        openLinkText: vi.fn(() => Promise.resolve()),
      },
    }
    view.leaf = { id: 'leaf' }
    view.model = {
      sourcePath: 'Fitness/Workouts/2026-06-15.md',
      exercises: [
        {
          name: 'Squat',
          kind: 'strength',
          strengthSets: [],
          durationEntries: [],
        },
      ],
    }
    view.exerciseHistory = null
    const list = new TestElement('div')

    view.renderExerciseCard(list as unknown as HTMLElement, 0)
    list.findByClass('fitkit-name-button')?.listenersFor('click')[0]?.({})
    await flushPromises()

    expect(view.app.workspace.setActiveLeaf).toHaveBeenCalledWith(view.leaf, { focus: true })
    expect(view.app.workspace.openLinkText).toHaveBeenCalledWith(
      'Fitness/Exercises/Squat.md',
      'Fitness/Workouts/2026-06-15.md',
      false,
    )
    expect(view.app.vault.create).not.toHaveBeenCalled()
  })

  it('clears and persists a deleted exercise tombstone when opening an existing note', async () => {
    const view = createExerciseCardRenderView()
    const existingFile = new TFile()
    view.plugin.settings.deletedExercises = ['squat', 'bench']
    view.app = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) =>
          path === 'Fitness/Exercises/Squat.md' ? existingFile : null,
        ),
        create: vi.fn(),
      },
      workspace: {
        setActiveLeaf: vi.fn(),
        openLinkText: vi.fn(() => Promise.resolve()),
      },
    }
    view.leaf = { id: 'leaf' }
    view.model = {
      sourcePath: 'Fitness/Workouts/2026-06-15.md',
      exercises: [
        {
          name: 'Squat',
          kind: 'strength',
          strengthSets: [],
          durationEntries: [],
        },
      ],
    }
    view.exerciseHistory = null
    const list = new TestElement('div')

    view.renderExerciseCard(list as unknown as HTMLElement, 0)
    list.findByClass('fitkit-name-button')?.listenersFor('click')[0]?.({})
    await flushPromises()

    expect(view.app.vault.create).not.toHaveBeenCalled()
    expect(view.plugin.settings.deletedExercises).toEqual(['bench'])
    expect(view.plugin.saveSettings).toHaveBeenCalledTimes(1)
    expect(view.app.workspace.openLinkText).toHaveBeenCalledWith(
      'Fitness/Exercises/Squat.md',
      'Fitness/Workouts/2026-06-15.md',
      false,
    )
  })

  it('opens the canonical exercise note when the rendered name is an alias', async () => {
    const view = createExerciseCardRenderView()
    const existingFile = new TFile()
    registryVaultMock.exerciseRegistryWithVaultNotes.mockReturnValue([
      { name: 'Back squat', kind: 'strength', unit: 'lbs', aliases: ['Squat'] },
    ])
    view.app = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) =>
          path === 'Fitness/Exercises/Back squat.md' ? existingFile : null,
        ),
        create: vi.fn(),
      },
      workspace: {
        setActiveLeaf: vi.fn(),
        openLinkText: vi.fn(() => Promise.resolve()),
      },
    }
    view.leaf = { id: 'leaf' }
    view.model = {
      sourcePath: 'Fitness/Workouts/2026-06-15.md',
      exercises: [
        {
          name: 'Squat',
          kind: 'strength',
          strengthSets: [],
          durationEntries: [],
        },
      ],
    }
    view.exerciseHistory = null
    const list = new TestElement('div')

    view.renderExerciseCard(list as unknown as HTMLElement, 0)
    list.findByClass('fitkit-name-button')?.listenersFor('click')[0]?.({})
    await flushPromises()

    expect(view.app.vault.getAbstractFileByPath).toHaveBeenCalledWith(
      'Fitness/Exercises/Back squat.md',
    )
    expect(view.app.vault.create).not.toHaveBeenCalled()
    expect(view.app.workspace.openLinkText).toHaveBeenCalledWith(
      'Fitness/Exercises/Back squat.md',
      'Fitness/Workouts/2026-06-15.md',
      false,
    )
  })

  it('creates and opens a missing exercise note when the rendered name is clicked', async () => {
    const view = createExerciseCardRenderView()
    registryVaultMock.exerciseRegistryWithVaultNotes.mockReturnValue([
      { name: 'Squat', kind: 'strength', unit: 'lbs', aliases: [] },
    ])
    view.app = {
      vault: {
        getAbstractFileByPath: vi.fn(() => null),
        create: vi.fn(() => Promise.resolve({ path: 'Fitness/Exercises/Squat.md' })),
      },
      workspace: {
        setActiveLeaf: vi.fn(),
        openLinkText: vi.fn(() => Promise.resolve()),
      },
    }
    view.leaf = { id: 'leaf' }
    view.model = {
      sourcePath: 'Fitness/Workouts/2026-06-15.md',
      exercises: [
        {
          name: 'Squat',
          kind: 'strength',
          strengthSets: [],
          durationEntries: [],
        },
      ],
    }
    view.exerciseHistory = null
    const list = new TestElement('div')

    view.renderExerciseCard(list as unknown as HTMLElement, 0)
    list.findByClass('fitkit-name-button')?.listenersFor('click')[0]?.({})
    await flushPromises()

    expect(vaultUtilsMock.ensureParentFolder).toHaveBeenCalledWith(
      view.app,
      'Fitness/Exercises/Squat.md',
    )
    expect(view.app.vault.create).toHaveBeenCalledWith(
      'Fitness/Exercises/Squat.md',
      expect.stringContaining('unit: lbs'),
    )
    expect(obsidianMock.notices).toContain("Created exercise note for 'Squat'.")
    expect(view.app.workspace.openLinkText).toHaveBeenCalledWith(
      'Fitness/Exercises/Squat.md',
      'Fitness/Workouts/2026-06-15.md',
      false,
    )
  })

  it('clears and persists a deleted exercise tombstone when creating from the rendered name', async () => {
    const view = createExerciseCardRenderView()
    view.plugin.settings.deletedExercises = ['squat', 'bench']
    registryVaultMock.exerciseRegistryWithVaultNotes.mockReturnValue([
      { name: 'Squat', kind: 'strength', unit: 'lbs', aliases: [] },
    ])
    view.app = {
      vault: {
        getAbstractFileByPath: vi.fn(() => null),
        create: vi.fn(() => Promise.resolve({ path: 'Fitness/Exercises/Squat.md' })),
      },
      workspace: {
        setActiveLeaf: vi.fn(),
        openLinkText: vi.fn(() => Promise.resolve()),
      },
    }
    view.leaf = { id: 'leaf' }
    view.model = {
      sourcePath: 'Fitness/Workouts/2026-06-15.md',
      exercises: [
        {
          name: 'Squat',
          kind: 'strength',
          strengthSets: [],
          durationEntries: [],
        },
      ],
    }
    view.exerciseHistory = null
    const list = new TestElement('div')

    view.renderExerciseCard(list as unknown as HTMLElement, 0)
    list.findByClass('fitkit-name-button')?.listenersFor('click')[0]?.({})
    await flushPromises()

    expect(view.plugin.settings.deletedExercises).toEqual(['bench'])
    expect(view.plugin.saveSettings).toHaveBeenCalledTimes(1)
    expect(view.app.workspace.openLinkText).toHaveBeenCalledWith(
      'Fitness/Exercises/Squat.md',
      'Fitness/Workouts/2026-06-15.md',
      false,
    )
  })

  it.each([
    {
      kind: 'strength',
      history: {
        strength: {
          personalBest: { weight: 95, reps: 8 },
          lastSessionMax: {
            value: { weight: 90, reps: 8 },
            date: '2026-04-20',
          },
        },
      },
      texts: ['PB 95', 'last 90x8'],
    },
    {
      kind: 'duration',
      history: {
        duration: {
          personalBestSeconds: 270,
          lastSessionMaxSeconds: {
            value: 240,
            date: '2026-04-20',
          },
        },
      },
      texts: ['PB 4m30s', 'last 4m'],
    },
  ])('renders $kind PB and Last badges when history exists', ({ kind, history, texts }) => {
    const view = createExerciseCardRenderView()
    view.model = {
      exercises: [
        {
          name: 'Squat',
          kind,
          strengthSets: [],
          durationEntries: [],
        },
      ],
    }
    view.exerciseHistory = new Map([['Squat', history]])
    const list = new TestElement('div')

    view.renderExerciseCard(list as unknown as HTMLElement, 0)

    const card = list.findByClass('fitkit-card')
    const top = card?.children.find((child) => child.classes.has('fitkit-card-top'))
    const historyRow = card?.children.find((child) => child.classes.has('fitkit-card-history'))
    expect(card).not.toBeNull()
    expect(top).toBeDefined()
    expect(historyRow).toBeDefined()
    expect(top?.parent).toBe(card)
    expect(historyRow?.parent).toBe(card)
    expect(card?.children.indexOf(historyRow as TestElement)).toBe(
      (card?.children.indexOf(top as TestElement) ?? -2) + 1,
    )
    const badgeTexts = historyRow
      ?.findAllByClass('fitkit-card-badge')
      .map((badge) => badge.textContent)
    expect(badgeTexts).toEqual(texts)
    const badgeTitles = historyRow
      ?.findAllByClass('fitkit-card-badge')
      .map((badge) => badge.attributes.get('title') ?? '')
    expect(badgeTitles?.some((title) => /\d{4}-\d{2}-\d{2}/.test(title))).toBe(true)
  })

  it('renders no exercise notes textarea and no note line when the exercise has no note', () => {
    const view = createExerciseCardRenderView()
    view.model = {
      exercises: [{ name: 'Squat', kind: 'strength', strengthSets: [], durationEntries: [] }],
    }
    view.exerciseHistory = new Map()
    const list = new TestElement('div')

    view.renderExerciseCard(list as unknown as HTMLElement, 0)

    expect(list.findByTag('textarea')).toBeNull()
    expect(list.findByClass('fitkit-exercise-note-line')).toBeNull()
  })

  it('renders the exercise note as a clickable note line when one exists', () => {
    const view = createExerciseCardRenderView()
    view.model = {
      exercises: [
        {
          name: 'Squat',
          kind: 'strength',
          exerciseNotes: 'Belt on from set 2',
          strengthSets: [],
          durationEntries: [],
        },
      ],
    }
    view.exerciseHistory = new Map()
    const list = new TestElement('div')

    view.renderExerciseCard(list as unknown as HTMLElement, 0)

    const line = list.findByClass('fitkit-exercise-note-line')
    expect(list.findByTag('textarea')).toBeNull()
    expect(line?.textContent).toBe('Belt on from set 2')
    expect(line?.attributes.get('role')).toBe('button')
    expect(line?.attributes.get('tabindex')).toBe('0')
    expect(line?.listenersFor('click')).toHaveLength(1)
    expect(line?.listenersFor('keydown')).toHaveLength(1)
  })

  it('titles the card menu note item by whether a note already exists', () => {
    vi.stubGlobal('HTMLElement', TestElement)
    const view = createCardMenuView()
    view.model = {
      exercises: [
        {
          name: 'Squat',
          kind: 'strength',
          exerciseNotes: 'Belt on from set 2',
          strengthSets: [],
          durationEntries: [],
        },
      ],
    }

    view.openCardMenu({ currentTarget: new TestElement('button') } as unknown as MouseEvent, 0)

    expect(obsidianMock.menus[0]?.items.map((item) => item.title)).toContain('Edit exercise note')
  })

  it('omits PB and Last badges when history is absent', () => {
    const view = createExerciseCardRenderView()
    view.model = {
      exercises: [
        {
          name: 'Squat',
          kind: 'strength',
          strengthSets: [],
          durationEntries: [],
        },
      ],
    }
    view.exerciseHistory = new Map()
    const list = new TestElement('div')

    view.renderExerciseCard(list as unknown as HTMLElement, 0)

    expect(list.findByClass('fitkit-card-history')).toBeNull()
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
      exerciseRegistry: {
        name: string
        kind: 'strength' | 'duration'
        unit: 'kg' | 'lbs'
        aliases: string[]
      }[]
      deletedExercises?: string[]
    }
    saveSettings: ReturnType<typeof vi.fn>
  }
  persistUnknownExercise(
    name: string,
    kind: 'strength' | 'duration',
    createNote: boolean,
  ): Promise<void>
}

describe('WorkoutEditorView unknown exercise persistence', () => {
  const resetEnsureParentFolderMock = (): void => {
    vaultUtilsMock.ensureParentFolder.mockClear()
    vaultUtilsMock.ensureParentFolder.mockResolvedValue(undefined)
  }

  const createPersistUnknownExerciseView = (
    options: {
      existingNote?: boolean
      deletedExercises?: string[]
      createRejects?: Error
    } = {},
  ): PersistUnknownExerciseView => {
    const view = Object.create(WorkoutEditorView.prototype) as PersistUnknownExerciseView
    view.app = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) =>
          options.existingNote && path === 'Fitness/Exercises/Squat.md' ? { path } : null,
        ),
        create: vi.fn((_path: string, _contents: string) => {
          if (options.createRejects) {
            return Promise.reject(options.createRejects)
          }
          return Promise.resolve({ path: _path })
        }),
      },
    }
    view.plugin = {
      settings: {
        fitnessRoot: 'Fitness',
        exerciseRegistry: [],
        deletedExercises: options.deletedExercises,
      },
      saveSettings: vi.fn(() => Promise.resolve()),
    }
    return view
  }

  beforeEach(() => {
    obsidianMock.notices = []
    resetEnsureParentFolderMock()
  })

  afterEach(() => {
    resetEnsureParentFolderMock()
  })

  it('notices when note creation reuses an existing exercise note without a tombstone', async () => {
    const view = createPersistUnknownExerciseView({ existingNote: true })

    await view.persistUnknownExercise('Squat', 'strength', true)

    expect(view.app.vault.create).not.toHaveBeenCalled()
    expect(view.plugin.saveSettings).not.toHaveBeenCalled()
    expect(obsidianMock.notices).toEqual(["Using existing exercise note for 'Squat'."])
  })

  it('notices and clears the tombstone when note creation restores an existing exercise note', async () => {
    const view = createPersistUnknownExerciseView({
      existingNote: true,
      deletedExercises: ['squat', 'bench'],
    })

    await view.persistUnknownExercise('Squat', 'strength', true)

    expect(view.app.vault.create).not.toHaveBeenCalled()
    expect(view.plugin.settings.deletedExercises).toEqual(['bench'])
    expect(view.plugin.saveSettings).toHaveBeenCalledTimes(1)
    expect(obsidianMock.notices).toEqual(["Restored 'Squat' using the existing exercise note."])
  })

  it('adds a registry entry alongside a newly created exercise note', async () => {
    const view = createPersistUnknownExerciseView()

    await view.persistUnknownExercise('Squat', 'strength', true)

    expect(view.app.vault.create).toHaveBeenCalledTimes(1)
    expect(view.plugin.settings.exerciseRegistry).toEqual([
      { name: 'Squat', kind: 'strength', aliases: [] },
    ])
    expect(view.plugin.saveSettings).toHaveBeenCalledTimes(1)
    expect(obsidianMock.notices).toEqual(["Created exercise note for 'Squat'."])
  })

  it('notices and does not save settings when parent folder creation fails', async () => {
    vaultUtilsMock.ensureParentFolder.mockRejectedValue(new Error('no folder'))
    const view = createPersistUnknownExerciseView()

    await view.persistUnknownExercise('Squat', 'strength', true)

    expect(view.app.vault.create).not.toHaveBeenCalled()
    expect(view.plugin.saveSettings).not.toHaveBeenCalled()
    expect(obsidianMock.notices).toEqual(["Could not create exercise note for 'Squat': no folder."])
  })

  it('notices and does not save settings when vault.create fails', async () => {
    const view = createPersistUnknownExerciseView({ createRejects: new Error('read only') })

    await view.persistUnknownExercise('Squat', 'strength', true)

    expect(vaultUtilsMock.ensureParentFolder).toHaveBeenCalledWith(
      view.app,
      'Fitness/Exercises/Squat.md',
    )
    expect(view.app.vault.create).toHaveBeenCalledTimes(1)
    expect(view.plugin.saveSettings).not.toHaveBeenCalled()
    expect(obsidianMock.notices).toEqual(["Could not create exercise note for 'Squat': read only."])
  })
})

interface PersistRegistryKindView {
  plugin: {
    settings: {
      exerciseRegistry: ExerciseRegistryEntry[]
    }
    saveSettings: ReturnType<typeof vi.fn>
  }
  persistRegistryKind(name: string, nextKind: 'strength' | 'duration'): Promise<void>
}

describe('WorkoutEditorView registry kind persistence', () => {
  const createPersistRegistryKindView = (
    exerciseRegistry: ExerciseRegistryEntry[],
  ): PersistRegistryKindView => {
    const view = Object.create(WorkoutEditorView.prototype) as PersistRegistryKindView
    view.plugin = {
      settings: { exerciseRegistry },
      saveSettings: vi.fn(() => Promise.resolve()),
    }
    return view
  }

  beforeEach(() => {
    obsidianMock.notices = []
  })

  it('updates the existing entry for a case-variant name instead of duplicating it', async () => {
    const view = createPersistRegistryKindView([
      { name: 'Squat', kind: 'strength', unit: 'kg', aliases: ['back squat'] },
    ])

    await view.persistRegistryKind('squat', 'duration')

    expect(view.plugin.settings.exerciseRegistry).toHaveLength(1)
    expect(view.plugin.settings.exerciseRegistry[0]).toMatchObject({
      name: 'Squat',
      kind: 'duration',
      aliases: ['back squat'],
    })
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
      getMarkdownFiles: () => PersistKindChangeMarkdownFile[]
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
  persistKindChange(name: string, nextKind: 'strength' | 'duration'): Promise<void>
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
        getMarkdownFiles: () => markdownFiles,
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

  it('writes the switched kind into the exercise note and leaves the registry untouched', async () => {
    const { view, contents } = createPersistKindChangeView([
      {
        path: 'Fitness/Exercises/Squat.md',
        basename: 'Squat',
        frontmatter: { type: 'exercise', kind: 'duration' },
      },
    ])

    await view.persistKindChange('Squat', 'strength')

    expect(view.app.vault.process).toHaveBeenCalledTimes(1)
    expect(contents.get('Fitness/Exercises/Squat.md')).toContain('kind: strength')
    expect(view.plugin.settings.exerciseRegistry).toEqual([])
    expect(view.plugin.saveSettings).not.toHaveBeenCalled()
    expect(obsidianMock.notices).toEqual(['Exercise note now records Squat as strength.'])
  })

  it('matches the note case-insensitively', async () => {
    const { view, contents } = createPersistKindChangeView([
      {
        path: 'Fitness/Exercises/Squat.md',
        basename: 'Squat',
        frontmatter: { type: 'exercise', kind: 'duration' },
      },
    ])

    await view.persistKindChange('squat', 'strength')

    expect(contents.get('Fitness/Exercises/Squat.md')).toContain('kind: strength')
  })

  it('falls back to the registry when no exercise note exists for the name', async () => {
    const { view } = createPersistKindChangeView([])

    await view.persistKindChange('Air bike', 'duration')

    expect(view.app.vault.process).not.toHaveBeenCalled()
    expect(view.plugin.settings.exerciseRegistry).toMatchObject([
      { name: 'Air bike', kind: 'duration' },
    ])
    expect(view.plugin.saveSettings).toHaveBeenCalledTimes(1)
    expect(obsidianMock.notices).toEqual(['Registry now records Air bike as duration.'])
  })

  it('routes a matching unreadable note through the note writer without changing the registry', async () => {
    const { view, contents } = createPersistKindChangeView([
      {
        path: 'Fitness/Exercises/Squat.md',
        basename: 'Squat',
      },
    ])
    const malformed = '---\ntype: exercise\nkind: duration\n'
    contents.set('Fitness/Exercises/Squat.md', malformed)

    await view.persistKindChange('Squat', 'strength')

    expect(view.app.vault.process).toHaveBeenCalledTimes(1)
    expect(contents.get('Fitness/Exercises/Squat.md')).toBe(malformed)
    expect(view.plugin.settings.exerciseRegistry).toEqual([])
    expect(view.plugin.saveSettings).not.toHaveBeenCalled()
    expect(obsidianMock.notices).toEqual([
      'Could not update the exercise note for Squat; its frontmatter was left unchanged.',
    ])
  })
})

interface TimerExerciseCard {
  name: string
  kind: 'duration'
  strengthSets: unknown[]
  durationEntries: { durationSeconds?: number; set?: number; note?: string }[]
}

interface RestTimerExerciseCard {
  name: string
  kind: 'strength' | 'duration'
  strengthSets: { set?: number; weight?: number; reps?: number; note?: string }[]
  durationEntries: { durationSeconds?: number; set?: number; note?: string }[]
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
  model: { exercises: TimerExerciseCard[] }
  exerciseHistory: unknown
  activeTimer: unknown
  contentEl: TestElement
  render: ReturnType<typeof vi.fn>
  markDirty: ReturnType<typeof vi.fn>
  focusRowCell: ReturnType<typeof vi.fn>
  renderDurationTable(card: HTMLElement, ex: TimerExerciseCard, index: number): void
  renderDurationRow(
    wrap: HTMLElement,
    ex: TimerExerciseCard,
    i: number,
    exerciseIndex: number,
  ): void
  startCardTimer(card: TimerExerciseCard): void
  stopTimer(opts: { write: boolean; render?: boolean }): void
  abortTimer(): void
  liveSeconds(timer: { accumulator: number; startedAtMs: number }): number
}

interface RestTimerView {
  plugin: { settings: { strengthRestTimerEnabled: boolean } }
  session: unknown
  model: RestTimerWorkoutModel
  exerciseHistory: unknown
  activeTimer: unknown
  activeRestTimer: unknown
  lastRestSeconds: number | null
  contentEl: TestElement
  render: ReturnType<typeof vi.fn>
  markDirty: ReturnType<typeof vi.fn>
  focusRowCell: ReturnType<typeof vi.fn>
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
  activeTimer: unknown
  activeRestTimer: unknown
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
    view.model = createRestTimerModel([ex])
    view.exerciseHistory = null
    view.activeTimer = null
    view.activeRestTimer = null
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
    view.activeTimer = null
    view.activeRestTimer = null
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
    expect(view.activeRestTimer).toBeNull()
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
    }
    const view = createRestTimerView(ex)
    view.plugin.settings.strengthRestTimerEnabled = false

    view.startRestTimer()

    expect(view.activeRestTimer).toBeNull()
    expect(view.render).not.toHaveBeenCalled()
  })

  it('starts without dirtying or mutating the workout model', () => {
    const set = { set: 1, weight: 80, reps: 5 }
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [set],
      durationEntries: [],
    }
    const view = createRestTimerView(ex)

    view.startRestTimer()

    expect(view.activeRestTimer).toMatchObject({ startedAtMs: Date.now() })
    expect(set).toEqual({ set: 1, weight: 80, reps: 5 })
    expect(view.lastRestSeconds).toBeNull()
    expect(view.markDirty).not.toHaveBeenCalled()
    expect(view.render).toHaveBeenCalled()
  })

  it('updates the visible footer rest timer label while running', () => {
    const set = { set: 1, weight: 80, reps: 5 }
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [set],
      durationEntries: [],
    }
    const view = createRestTimerView(ex)

    view.startRestTimer()
    vi.setSystemTime(new Date('2026-05-03T00:00:03Z'))
    const footer = new TestElement('div')
    view.renderFooterRestTimer(footer as unknown as HTMLElement)

    const label = footer.findByClass('fitkit-rest-timer-label')
    expect(label?.textContent).toBe('Stop 3s')

    vi.setSystemTime(new Date('2026-05-03T00:00:07Z'))
    view.tickRestTimer()

    expect(label?.textContent).toBe('Stop 7s')
    expect(set).toEqual({ set: 1, weight: 80, reps: 5 })
    expect(view.markDirty).not.toHaveBeenCalled()
  })

  it('stopping captures the elapsed rest duration for the footer readout', () => {
    const set = { set: 1, weight: 80, reps: 5 }
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [set],
      durationEntries: [],
    }
    const view = createRestTimerView(ex)

    view.startRestTimer()
    vi.setSystemTime(new Date('2026-05-03T00:00:12Z'))
    view.stopRestTimer()
    const footer = new TestElement('div')
    view.renderFooterRestTimer(footer as unknown as HTMLElement)

    expect(view.activeRestTimer).toBeNull()
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
    }
    const view = createRestTimerView(ex)

    view.startRestTimer()
    vi.setSystemTime(new Date('2026-05-03T00:00:09Z'))
    view.stopRestTimer()
    view.startRestTimer()
    const footer = new TestElement('div')
    view.renderFooterRestTimer(footer as unknown as HTMLElement)

    expect(view.lastRestSeconds).toBeNull()
    expect(footer.findByClass('fitkit-rest-timer-label')?.textContent).toBe('Stop 0s')
    expect(footer.findByClass('fitkit-rest-timer-last')).toBeNull()
  })

  it('clears active and last rest state when the setting is disabled', () => {
    const set = { set: 1, weight: 80, reps: 5 }
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [set],
      durationEntries: [],
    }
    const view = createRestTimerView(ex)
    view.session = { file: { path: 'Workouts/A.md' } }

    view.startRestTimer()
    vi.setSystemTime(new Date('2026-05-03T00:00:05Z'))
    view.stopRestTimer()
    expect(view.lastRestSeconds).toBe(5)

    view.plugin.settings.strengthRestTimerEnabled = false
    view.refreshSettingsDrivenUi()

    expect(view.activeRestTimer).toBeNull()
    expect(view.lastRestSeconds).toBeNull()
    expect(view.render).toHaveBeenCalled()

    view.plugin.settings.strengthRestTimerEnabled = true
    view.startRestTimer()
    view.plugin.settings.strengthRestTimerEnabled = false
    view.refreshSettingsDrivenUi()

    expect(view.activeRestTimer).toBeNull()
    expect(view.lastRestSeconds).toBeNull()
  })

  it('clears active and last rest state on file load and close', async () => {
    const set = { set: 1, weight: 80, reps: 5 }
    const ex: RestTimerExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [set],
      durationEntries: [],
    }
    const view = createRestTimerView(ex)

    view.startRestTimer()
    vi.setSystemTime(new Date('2026-05-03T00:00:04Z'))
    view.stopRestTimer()
    await view
      .loadFile({ path: 'Workouts/B.md', extension: 'md', basename: 'B', stat: { mtime: 0 } })
      .catch(() => undefined)

    expect(view.activeRestTimer).toBeNull()
    expect(view.lastRestSeconds).toBeNull()
    expect(set).toEqual({ set: 1, weight: 80, reps: 5 })

    view.startRestTimer()
    await view.onClose().catch(() => undefined)

    expect(view.activeRestTimer).toBeNull()
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
            },
          ],
          preserveBlocks: [],
          frontmatterExtra: [],
        },
        isWorkout: true,
      }),
    }
    view.lastRestSeconds = 12
    view.activeRestTimer = {
      startedAtMs: Date.now(),
      intervalId: window.setInterval(() => undefined, 1000),
      labelEl: null,
    }

    await view.reloadFromDisk()

    expect(view.activeRestTimer).toBeNull()
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
    }
    const view = createRestTimerView(ex)
    view.activeTimer = {
      card: ex,
      entry: durationEntry,
      startedAtMs: Date.now(),
      accumulator: 30,
      intervalId: 0,
      inputEl: null,
    }

    vi.setSystemTime(new Date('2026-05-03T00:00:08Z'))
    view.startRestTimer()

    expect(durationEntry.durationSeconds).toBe(38)
    expect(view.activeTimer).toBeNull()
    expect(view.activeRestTimer).toMatchObject({ startedAtMs: Date.now() })
    expect(view.markDirty).toHaveBeenCalled()
    expect(view.render).toHaveBeenCalledTimes(1)
  })
})

describe('WorkoutEditorView duration timer', () => {
  const createTimerView = (ex: TimerExerciseCard): TimerView => {
    const view = Object.create(WorkoutEditorView.prototype) as TimerView
    view.model = { exercises: [ex] }
    view.exerciseHistory = null
    view.activeTimer = null
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
    }
    const view = createTimerView(ex)
    const card = new TestElement('div')

    view.renderDurationTable(card as unknown as HTMLElement, ex, 0)

    const actions = card.findByClass('fitkit-row-actions')
    const buttons = actions?.children.filter((c) => c.tagName === 'button') ?? []
    expect(buttons.map((b) => b.textContent)).toEqual(['Add set', 'Start timer'])
    expect(buttons[1]?.attributes.get('data-icon')).toBe('play')
  })

  it('shows the duration set number as a figure rather than an editable field', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 60 }, { set: 7, durationSeconds: 30 }],
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

  it('renders Stop timer with square icon when the card is the active timer', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{}],
    }
    const view = createTimerView(ex)
    view.activeTimer = {
      card: ex,
      entry: ex.durationEntries[0],
      startedAtMs: Date.now(),
      accumulator: 0,
      intervalId: 0,
      inputEl: null,
    }
    const card = new TestElement('div')

    view.renderDurationTable(card as unknown as HTMLElement, ex, 0)

    const actions = card.findByClass('fitkit-row-actions')
    const buttons = actions?.children.filter((c) => c.tagName === 'button') ?? []
    expect(buttons.map((b) => b.textContent)).toEqual(['Add set', 'Stop timer'])
    expect(buttons[1]?.attributes.get('data-icon')).toBe('square')
  })

  it('startCardTimer auto-creates a row when none exist and sets the active timer', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [],
    }
    const view = createTimerView(ex)

    view.startCardTimer(ex)

    expect(ex.durationEntries).toHaveLength(1)
    const timer = view.activeTimer as { card: unknown; entry: unknown; accumulator: number }
    expect(timer.card).toBe(ex)
    expect(timer.entry).toBe(ex.durationEntries[0])
    expect(timer.accumulator).toBe(0)
    expect(view.markDirty).toHaveBeenCalled()
    expect(view.render).toHaveBeenCalled()
  })

  it('startCardTimer accumulates from the existing duration value', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 30 }],
    }
    const view = createTimerView(ex)

    view.startCardTimer(ex)

    const timer = view.activeTimer as { accumulator: number }
    expect(timer.accumulator).toBe(30)
  })

  it('liveSeconds returns accumulator plus elapsed wall-clock seconds', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 30 }],
    }
    const view = createTimerView(ex)

    view.startCardTimer(ex)
    vi.setSystemTime(new Date('2026-04-28T00:00:05Z'))
    const timer = view.activeTimer as { accumulator: number; startedAtMs: number }
    expect(view.liveSeconds(timer)).toBe(35)
  })

  it('stopTimer writes accumulator + elapsed back into the row and clears the timer', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 30 }],
    }
    const view = createTimerView(ex)

    view.startCardTimer(ex)
    vi.setSystemTime(new Date('2026-04-28T00:00:12Z'))
    view.stopTimer({ write: true })

    expect(ex.durationEntries[0]?.durationSeconds).toBe(42)
    expect(view.activeTimer).toBeNull()
  })

  it('abortTimer clears the timer without writing back', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 10 }],
    }
    const view = createTimerView(ex)

    view.startCardTimer(ex)
    view.render.mockClear()
    vi.setSystemTime(new Date('2026-04-28T00:00:05Z'))
    view.abortTimer()

    expect(ex.durationEntries[0]?.durationSeconds).toBe(10)
    expect(view.activeTimer).toBeNull()
    expect(view.render).toHaveBeenCalledTimes(1)
  })

  it('leaves focus alone when a duration set is added, since the timer fills it', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 60 }],
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
    }
    const view = createTimerView(ex)

    view.startCardTimer(ex)
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
    expect(view.activeTimer).toBeNull()
  })

  it('deleting the active row aborts the timer without writing back', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 30 }],
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

    view.startCardTimer(ex)
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
    expect(view.activeTimer).toBeNull()
  })

  it('loadFile flushes a running timer (writes elapsed seconds) before swapping to a new file', async () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 30 }],
    }
    const view = createTimerView(ex)
    view.startCardTimer(ex)
    vi.setSystemTime(new Date('2026-04-28T00:00:12Z'))

    /** loadFile reaches FileSession.load after the timer flush; allow the unmocked vault call to throw and assert the flush effect. */
    await (view as unknown as { loadFile: (f: unknown) => Promise<void> })
      .loadFile({ path: 'Workouts/B.md', extension: 'md', basename: 'B', stat: { mtime: 0 } })
      .catch(() => undefined)

    expect(ex.durationEntries[0]?.durationSeconds).toBe(42)
    expect(view.activeTimer).toBeNull()
  })

  it('onClose flushes a running timer (writes elapsed seconds) before tearing down', async () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 30 }],
    }
    const view = createTimerView(ex)
    view.startCardTimer(ex)
    vi.setSystemTime(new Date('2026-04-28T00:00:12Z'))

    /** onClose calls contentEl.empty() after the timer flush; TestElement does not implement empty so absorb the throw and assert the flush effect. */
    await (view as unknown as { onClose: () => Promise<void> }).onClose().catch(() => undefined)

    expect(ex.durationEntries[0]?.durationSeconds).toBe(42)
    expect(view.activeTimer).toBeNull()
  })

  it('renderDurationRow displays stored seconds in one formatted duration text input', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 90 }],
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

  it('renderDurationRow shows the live counter, disables the input, and adds the timing class', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 59 }],
    }
    const view = createTimerView(ex)
    view.startCardTimer(ex)
    vi.setSystemTime(new Date('2026-04-28T00:00:02Z'))

    const wrap = new TestElement('div')
    view.renderDurationRow(wrap as unknown as HTMLElement, ex, 0, 0)

    const row = wrap.findByClass('fitkit-row')
    expect(row?.classes.has('fitkit-row--timing')).toBe(true)
    expect(row?.dataset.fitkitTimerRow).toBe('0:0')
    const durationCell = row
      ?.findAllByClass('fitkit-cell')
      .find((c) => c.dataset.label === 'Duration')
    const input = durationCell?.children[0]
    expect(input?.attributes.has('disabled')).toBe(true)
    expect((input as unknown as { value?: string } | undefined)?.value).toBe('1m1s')
  })
})

interface NextPlanExerciseCard {
  name: string
  kind: 'strength' | 'duration'
  next?: { direction: 'up' | 'down' | 'stay'; step?: number }
  strengthSets: Array<{ set?: number; weight?: number; reps?: number }>
  durationEntries: Array<{ durationSeconds?: number }>
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
  activeTimer: unknown
  markDirty: ReturnType<typeof vi.fn>
  render: ReturnType<typeof vi.fn>
  applyKindSwitch(index: number, nextKind: 'strength' | 'duration', clearedRows: boolean): void
  renderStrengthTable(card: HTMLElement, ex: RestTimerExerciseCard, exerciseIndex: number): void
}

describe('WorkoutEditorView set seeding', () => {
  const seedStrength = (history: unknown): SeedView => {
    const view = Object.create(WorkoutEditorView.prototype) as SeedView
    view.model = {
      exercises: [{ name: 'Squat', kind: 'duration', strengthSets: [], durationEntries: [{}] }],
    }
    view.exerciseHistory = history
    view.activeTimer = null
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
})

describe('WorkoutEditorView next-time plan', () => {
  const createNextPlanView = (ex: NextPlanExerciseCard): NextPlanView => {
    const view = Object.create(WorkoutEditorView.prototype) as NextPlanView
    view.plugin = { settings: { fitnessRoot: 'Fitness', strengthRestTimerEnabled: false } }
    view.model = { exercises: [ex] }
    view.exerciseHistory = null
    view.render = vi.fn()
    view.markDirty = vi.fn()
    view.focusRowCell = vi.fn()
    return view
  }

  const planItems = (
    ex: NextPlanExerciseCard,
    view = createNextPlanView(ex),
  ): MockMenuItemState[] => {
    view.openCardMenu({ currentTarget: new TestElement('button') } as unknown as MouseEvent, 0)
    const items = obsidianMock.menus[obsidianMock.menus.length - 1]?.items ?? []
    return items.filter((item) => item.title?.startsWith('Plan') === true)
  }

  it('offers increase, keep, and decrease on strength cards', () => {
    vi.stubGlobal('HTMLElement', TestElement)
    const items = planItems({
      name: 'Squat',
      kind: 'strength',
      strengthSets: [{ set: 1, weight: 100, reps: 5 }],
      durationEntries: [],
    })

    expect(items.map((item) => item.title)).toEqual([
      'Plan: increase',
      'Plan: keep',
      'Plan: decrease',
    ])
    expect(items.map((item) => item.icon)).toEqual(['arrow-up', 'minus', 'arrow-down'])
    expect(items.every((item) => item.checked === false)).toBe(true)
  })

  it('omits the plan items on duration cards', () => {
    vi.stubGlobal('HTMLElement', TestElement)
    const items = planItems({
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{ durationSeconds: 60 }],
    })

    expect(items).toEqual([])
  })

  it('checks the recorded direction', () => {
    vi.stubGlobal('HTMLElement', TestElement)
    const items = planItems({
      name: 'Squat',
      kind: 'strength',
      next: { direction: 'up', step: 2.5 },
      strengthSets: [{ set: 1, weight: 100, reps: 5 }],
      durationEntries: [],
    })

    expect(items.filter((item) => item.checked).map((item) => item.title)).toEqual([
      'Plan: increase',
    ])
  })

  it('records a direction when one is chosen', () => {
    vi.stubGlobal('HTMLElement', TestElement)
    const ex: NextPlanExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [{ set: 1, weight: 100, reps: 5 }],
      durationEntries: [],
    }
    const view = createNextPlanView(ex)

    planItems(ex, view)[0]?.onClick?.()

    expect(ex.next).toEqual({ direction: 'up' })
    expect(view.markDirty).toHaveBeenCalled()
    expect(view.render).toHaveBeenCalled()
  })

  it('clears the plan when the active direction is chosen again', () => {
    vi.stubGlobal('HTMLElement', TestElement)
    const ex: NextPlanExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      next: { direction: 'up', step: 2.5 },
      strengthSets: [{ set: 1, weight: 100, reps: 5 }],
      durationEntries: [],
    }

    planItems(ex)[0]?.onClick?.()

    expect(ex.next).toBeUndefined()
  })

  it('carries the step across a direction change', () => {
    vi.stubGlobal('HTMLElement', TestElement)
    const ex: NextPlanExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      next: { direction: 'up', step: 2.5 },
      strengthSets: [{ set: 1, weight: 100, reps: 5 }],
      durationEntries: [],
    }

    planItems(ex)[2]?.onClick?.()

    expect(ex.next).toEqual({ direction: 'down', step: 2.5 })
  })

  it.each([
    { label: 'no plan', next: undefined, disabled: true },
    { label: 'a stay plan', next: { direction: 'stay' as const }, disabled: true },
    { label: 'an up plan', next: { direction: 'up' as const }, disabled: false },
  ])('disables the step item for $label', ({ next, disabled }) => {
    vi.stubGlobal('HTMLElement', TestElement)
    const ex: NextPlanExerciseCard = {
      name: 'Squat',
      kind: 'strength',
      strengthSets: [{ set: 1, weight: 100, reps: 5 }],
      durationEntries: [],
    }
    if (next) {
      ex.next = next
    }
    const view = createNextPlanView(ex)
    view.openCardMenu({ currentTarget: new TestElement('button') } as unknown as MouseEvent, 0)

    const step = obsidianMock.menus[obsidianMock.menus.length - 1]?.items.find(
      (item) => item.title === 'Set plan step...',
    )
    expect(step?.disabled).toBe(disabled)
  })

  it('shows the plan just set on this card, so the menu choice has a readout', () => {
    const view = createNextPlanView({
      name: 'Squat',
      kind: 'strength',
      next: { direction: 'up', step: 2.5 },
      strengthSets: [{ set: 1, weight: 100, reps: 5 }],
      durationEntries: [],
    })
    const list = new TestElement('div')
    view.renderExerciseCard(list as unknown as HTMLElement, 0)

    const badge = list.findByClass('fitkit-plan-badge')
    expect(badge?.attributes.get('title')).toBe('Planned for next time: up 2.5 kg from 100 kg')
    expect(badge?.children.map((child) => child.textContent).join('')).toContain('Next: 102.5 kg')
  })

  it('shows the plan recorded last session as a badge', () => {
    const view = createNextPlanView({
      name: 'Squat',
      kind: 'strength',
      strengthSets: [],
      durationEntries: [],
    })
    view.exerciseHistory = new Map([
      [
        'Squat',
        {
          strength: { lastSessionMax: { value: { weight: 100, reps: 5 }, date: '2026-08-10' } },
          nextPlan: { value: { direction: 'up', step: 2.5 }, date: '2026-08-10' },
        },
      ],
    ])
    const list = new TestElement('div')
    view.renderExerciseCard(list as unknown as HTMLElement, 0)

    const badge = list.findByClass('fitkit-plan-badge')
    expect(badge?.attributes.get('title')).toBe('Planned on 2026-08-10: up 2.5 kg from 100 kg')
    expect(badge?.findAllByClass('fitkit-plan-badge-icon')[0]?.attributes.get('data-icon')).toBe(
      'arrow-up',
    )
    expect(badge?.children.map((child) => child.textContent).join('')).toContain('Next: 102.5 kg')
  })
})
