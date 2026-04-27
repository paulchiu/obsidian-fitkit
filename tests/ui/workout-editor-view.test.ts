import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface MockMenuItemState {
  title?: string
  icon?: string
  disabled?: boolean
  warning?: boolean
  onClick?: () => void
}

interface MockMenuState {
  items: MockMenuItemState[]
  position?: { x: number; y: number }
}

const obsidianMock = vi.hoisted(
  (): { menus: MockMenuState[]; platform: { isMobile: boolean } } => ({
    menus: [],
    platform: { isMobile: false },
  }),
)

vi.mock('obsidian', () => {
  class Modal {
    contentEl = new TestElement('div')

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
    constructor(readonly message: string) {}
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
  openCardMenu(evt: MouseEvent, index: number): void
}

interface ExerciseCardRenderView {
  model: unknown
  exerciseHistory: unknown
  renderExerciseCard(list: HTMLElement, index: number): void
}

const createCardMenuView = (): CardMenuView =>
  Object.create(WorkoutEditorView.prototype) as CardMenuView

const createExerciseCardRenderView = (): ExerciseCardRenderView =>
  Object.create(WorkoutEditorView.prototype) as ExerciseCardRenderView

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
      'Switch to duration',
      'Move up',
      'Move down',
      'Remove exercise',
    ])
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
      texts: ['PB 95 kg x 8', 'Last max: 90 kg x 8 (2026-04-20)'],
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
      texts: ['PB 270s', 'Last max: 240s (2026-04-20)'],
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
    expect(badgeTexts?.some((text) => /\d{4}-\d{2}-\d{2}/.test(text))).toBe(true)
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

interface TimerExerciseCard {
  name: string
  kind: 'duration'
  strengthSets: unknown[]
  durationEntries: { durationSeconds?: number; set?: number; note?: string }[]
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
  stopTimer(opts: { write: boolean }): void
  abortTimer(): void
  liveSeconds(timer: { accumulator: number; startedAtMs: number }): number
}

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
    vi.stubGlobal('activeWindow', globalThis)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders Start timer next to Add duration entry when no timer is active', () => {
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
    expect(buttons.map((b) => b.textContent)).toEqual(['Add duration entry', 'Start timer'])
    expect(buttons[1]?.attributes.get('data-icon')).toBe('play')
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
    expect(buttons.map((b) => b.textContent)).toEqual(['Add duration entry', 'Stop timer'])
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
    vi.setSystemTime(new Date('2026-04-28T00:00:05Z'))
    view.abortTimer()

    expect(ex.durationEntries[0]?.durationSeconds).toBe(10)
    expect(view.activeTimer).toBeNull()
  })

  it('renderDurationRow shows the live counter, disables the input, and adds the timing class', () => {
    const ex: TimerExerciseCard = {
      name: 'Plank',
      kind: 'duration',
      strengthSets: [],
      durationEntries: [{}],
    }
    const view = createTimerView(ex)
    view.startCardTimer(ex)
    vi.setSystemTime(new Date('2026-04-28T00:00:07Z'))

    const wrap = new TestElement('div')
    view.renderDurationRow(wrap as unknown as HTMLElement, ex, 0, 0)

    const row = wrap.findByClass('fitkit-row')
    expect(row?.classes.has('fitkit-row--timing')).toBe(true)
    expect(row?.dataset.fitkitTimerRow).toBe('0:0')
    const durationCell = row
      ?.findAllByClass('fitkit-cell')
      .find((c) => c.dataset.label === 'Duration (s)')
    const input = durationCell?.children[0]
    expect(input?.attributes.has('disabled')).toBe(true)
    expect((input as unknown as { value?: string } | undefined)?.value).toBe('7')
  })
})
