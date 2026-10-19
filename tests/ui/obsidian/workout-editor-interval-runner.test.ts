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
  const { mixinFileView } = await import('../../fixtures/obsidian-file-view')

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
  class SuggestModal extends Modal {
    inputEl = obsidian.createRoot().createEl('input')
    setPlaceholder(): void {}
    async onOpen(): Promise<void> {}
    onClose(): void {}
  }
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
    /** Marks where an icon lands, so structure snapshots pin it. */
    setIcon: (el: HTMLElement, name: string) => el.setAttribute('data-icon', name),
  }
})

import { TFile } from 'obsidian'
import type { App, WorkspaceLeaf } from 'obsidian'

import type { IndexEntry } from '../../../src/domain/types'
import FitKitPlugin from '../../../src/main'
import { DEFAULT_SETTINGS } from '../../../src/settings'
import { WorkoutEditorView } from '../../../src/ui/obsidian/workout-editor-view'
import { buildMockVaultFolderTree } from '../../fixtures/mock-vault-folder-tree'
import { createTestRoot, harnessDocument, harnessWindow } from '../../harness/obsidian-dom'
import { outline } from '../../harness/outline'
import { findUnstyledClasses } from '../../harness/stylesheet'

obsidian.createRoot = createTestRoot

const WORKOUT_PATH = 'Fitness/Workouts/2026-10-12.md'

const workoutSource = (...body: string[]): string =>
  ['---', 'type: workout', 'date: 2026-10-12', 'name: Intervals', '---', '', ...body, ''].join('\n')

/** Interval callbacks the view registered; `tick()` runs them as time passing would. */
let intervals = new Map<number, () => void>()

const tick = (): void => {
  for (const callback of [...intervals.values()]) {
    callback()
  }
}

/** Moves the wall clock to a Brisbane time on the workout's day and fires the view's ticks. */
const at = (time: string): void => {
  vi.setSystemTime(new Date(`2026-10-12T${time}+10:00`))
  tick()
}

/** Walks the clock forward a second at a time to `time`, the way the view's ticks would see it. */
const runTo = (time: string): void => {
  const target = Date.parse(`2026-10-12T${time}+10:00`)
  while (Date.now() < target) {
    vi.setSystemTime(Math.min(Date.now() + 1000, target))
    tick()
  }
}

/** A real WorkoutEditorView over an in-memory vault holding one workout note. */
const openView = async (
  source: string,
  settings: Partial<typeof DEFAULT_SETTINGS> = {},
  history: IndexEntry[] = [],
  otherNotes: Record<string, string> = {},
): Promise<{ view: WorkoutEditorView; contents: Map<string, string>; plugin: FitKitPlugin }> => {
  const files = [WORKOUT_PATH, ...Object.keys(otherNotes)].map((path) =>
    Object.assign(new TFile(), {
      path,
      basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
    }),
  )
  const contents = new Map([[WORKOUT_PATH, source], ...Object.entries(otherNotes)])
  const vault = {
    getFolderByPath: buildMockVaultFolderTree(files).getFolderByPath,
    read: async (target: TFile): Promise<string> => contents.get(target.path) ?? '',
    process: async (target: TFile, callback: (text: string) => string): Promise<void> => {
      contents.set(target.path, callback(contents.get(target.path) ?? ''))
    },
    getAbstractFileByPath: (path: string): TFile | null =>
      files.find((candidate) => candidate.path === path) ?? null,
  }
  const app = {
    vault,
    metadataCache: { getFileCache: () => null, on: () => ({}) },
  }
  const plugin = Object.create(FitKitPlugin.prototype) as FitKitPlugin
  plugin.app = app as unknown as App
  plugin.settings = { ...DEFAULT_SETTINGS, ...settings }
  plugin.refreshIndexEntry = async (): Promise<void> => {}
  plugin.saveData = async (): Promise<void> => {}
  plugin.cachedIndex = { schemaVersion: 1, builtAt: 0, entries: history, diagnostics: [] }
  const view = new WorkoutEditorView({ app } as unknown as WorkspaceLeaf, plugin)
  await view.onOpen()
  await view.setState({ file: WORKOUT_PATH }, { history: false })
  return { view, contents, plugin }
}
const button = (view: WorkoutEditorView, label: string): HTMLButtonElement => {
  const found = view.contentEl.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!found) {
    throw new Error(`${label} button not rendered`)
  }
  return found
}

describe('WorkoutEditorView interval runner', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Australia/Brisbane')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-12T07:15:00+10:00'))
    intervals = new Map()
    obsidian.menus.length = 0
    obsidian.modals.length = 0
    obsidian.notices.length = 0
    vi.stubGlobal('HTMLElement', harnessWindow.HTMLElement)
    vi.stubGlobal('HTMLInputElement', harnessWindow.HTMLInputElement)
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

  const BIKE = [
    '## [[Exercise Bike]]',
    '',
    '- [exercise:: [[Exercise Bike]]] [plan:: 3 x 30s @ 300W, 90s rest]',
  ]
  const ON_OFF = [
    '## [[Exercise Bike]]',
    '',
    '- [exercise:: [[Exercise Bike]]] [plan:: (x 2 (on 30s 350W) (off 30s 150W))]',
  ]
  const WARMUP = [
    '## [[Exercise Bike]]',
    '',
    '- [exercise:: [[Exercise Bike]]] [plan:: (warmup 30s)]',
  ]
  const NESTED = [
    '## [[Exercise Bike]]',
    '',
    '- [exercise:: [[Exercise Bike]]] [plan:: (x 2 (x 2 (over 1m 300W) (under 1m 220W)) (rest 2m))]',
  ]
  const BIKE_REP_1 =
    '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 300] [rest:: 0] [started:: 2026-10-12T07:15:30+10:00]'

  const runner = (view: WorkoutEditorView): HTMLElement => {
    const el = view.contentEl.querySelector<HTMLElement>('.fitkit-runner')
    if (!el) {
      throw new Error('No runner rendered')
    }
    return el
  }

  const runnerButton = (view: WorkoutEditorView, text: string): HTMLButtonElement => {
    const found = [
      ...view.contentEl.querySelectorAll<HTMLButtonElement>('.fitkit-runner button'),
    ].find((candidate) => candidate.textContent === text)
    if (!found) {
      throw new Error(`${text} not on the runner`)
    }
    return found
  }

  const start = async (...body: string[]): Promise<WorkoutEditorView> => {
    const { view } = await openView(workoutSource(...body))
    button(view, 'Start interval plan').click()
    return view
  }

  const SCREENS: ReadonlyArray<{
    screen: string
    open: () => Promise<WorkoutEditorView>
  }> = [
    {
      screen: 'working, no step name or stats yet',
      open: async () => {
        const view = await start(...BIKE)
        at('07:15:10')
        return view
      },
    },
    {
      screen: 'working a named step with rounds',
      open: async () => {
        const view = await start(...ON_OFF)
        at('07:15:10')
        return view
      },
    },
    {
      screen: 'working a step in nested repeats',
      open: async () => {
        const { view } = await openView(
          workoutSource(
            ...NESTED,
            '- [exercise:: [[Exercise Bike]]] [set:: 1] [step:: over] [duration:: 60] [watts:: 300]',
            '- [exercise:: [[Exercise Bike]]] [set:: 2] [step:: under] [duration:: 60] [watts:: 220]',
            '- [exercise:: [[Exercise Bike]]] [set:: 3] [step:: over] [duration:: 60] [watts:: 300]',
            '- [exercise:: [[Exercise Bike]]] [set:: 4] [step:: under] [duration:: 60] [watts:: 220] [rest:: 120]',
          ),
        )
        button(view, 'Start interval plan').click()
        return view
      },
    },
    {
      screen: 'working the last step',
      open: async () => {
        const view = await start(...WARMUP)
        at('07:15:10')
        return view
      },
    },
    {
      screen: 'working while paused',
      open: async () => {
        const view = await start(...BIKE)
        at('07:15:12')
        button(view, 'Pause run').click()
        return view
      },
    },
    {
      screen: 'resting with the stepper and stats',
      open: async () => {
        const view = await start(...BIKE)
        at('07:15:20')
        runnerButton(view, 'Rest').click()
        at('07:15:25')
        return view
      },
    },
    {
      screen: 'resting while paused',
      open: async () => {
        const view = await start(...BIKE)
        at('07:15:20')
        runnerButton(view, 'Rest').click()
        button(view, 'Pause run').click()
        return view
      },
    },
    {
      screen: 'finished, scored against targets',
      open: async () => {
        const { view } = await openView(
          workoutSource(
            ...BIKE,
            '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 300] [rest:: 90]',
            '- [exercise:: [[Exercise Bike]]] [set:: 2] [duration:: 30] [watts:: 250] [rest:: 90]',
          ),
        )
        button(view, 'Start interval plan').click()
        runTo('07:15:31')
        return view
      },
    },
    {
      screen: 'finished with no targets',
      open: async () => {
        const view = await start(...WARMUP)
        runTo('07:15:31')
        return view
      },
    },
    {
      screen: 'cut off during rest',
      open: async () => {
        vi.setSystemTime(new Date('2026-10-12T08:00:00+10:00'))
        return (await openView(workoutSource(...BIKE, BIKE_REP_1))).view
      },
    },
    {
      screen: 'cut off during work',
      open: async () => {
        vi.setSystemTime(new Date('2026-10-12T08:00:00+10:00'))
        const row =
          '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 0] [started:: 2026-10-12T07:15:00+10:00]'
        return (await openView(workoutSource(...BIKE, row))).view
      },
    },
  ]

  it.each(SCREENS)('draws the runner $screen', async ({ open }) => {
    const view = await open()

    expect(outline(runner(view))).toMatchSnapshot()
    expect(findUnstyledClasses(view.contentEl)).toEqual([])
  })

  it('moves only the clock text on a tick', async () => {
    const view = await start(...BIKE)
    const before = runner(view)
    const clock = before.querySelector('.fitkit-runner-clock')
    const children = [...before.querySelectorAll('*')]

    runTo('07:15:04')

    expect([
      runner(view) === before,
      before.querySelector('.fitkit-runner-clock') === clock,
      [...before.querySelectorAll('*')].every((el, i) => el === children[i]),
      clock?.textContent,
    ]).toEqual([true, true, true, '0:26'])
  })

  it('steps the dots and rep label as the run moves on', async () => {
    const view = await start(...BIKE)

    runTo('07:15:31')
    const rest = [
      runner(view).className,
      runner(view).querySelector('.fitkit-runner-phase')?.textContent,
    ]
    runnerButton(view, 'Skip').click()

    expect([
      rest,
      runner(view).className,
      runner(view).querySelector('.fitkit-runner-phase')?.textContent,
      [...runner(view).querySelectorAll('.fitkit-runner-dot')].map((dot) => dot.className),
    ]).toEqual([
      ['fitkit-runner is-rest', 'Rest · rep 1 of 3'],
      'fitkit-runner is-work',
      'Work · rep 2 of 3',
      ['fitkit-runner-dot is-hit', 'fitkit-runner-dot is-current', 'fitkit-runner-dot'],
    ])
  })

  it('keeps the pause button live across the redraw it causes', async () => {
    const view = await start(...BIKE)
    at('07:15:12')

    button(view, 'Pause run').click()
    const paused = [
      runnerButton(view, 'Rest').disabled,
      runner(view).classList.contains('is-paused'),
    ]
    button(view, 'Resume run').click()

    expect([
      paused,
      runnerButton(view, 'Rest').disabled,
      runner(view).classList.contains('is-paused'),
    ]).toEqual([[true, true], false, false])
  })

  it('raises the last rep from the stepper', async () => {
    const view = await start(...BIKE)
    at('07:15:20')
    runnerButton(view, 'Rest').click()

    button(view, 'Raise last rep').click()

    expect(runner(view).querySelector('.fitkit-runner-stepper-value')?.textContent).toBe(
      'Rep 1: 305 W',
    )
  })

  describe('priming audio', () => {
    let contexts: number

    beforeEach(() => {
      contexts = 0
      class FakeAudioContext {
        currentTime = 0
        destination = {}
        state = 'running'
        constructor() {
          contexts++
        }
        async resume(): Promise<void> {}
        async close(): Promise<void> {}
      }
      Object.defineProperty(harnessWindow, 'AudioContext', {
        configurable: true,
        value: FakeAudioContext,
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(harnessWindow, 'AudioContext')
    })

    /** A run reopened from the note has no audio until a tap. */
    const reopened = async (): Promise<WorkoutEditorView> => {
      vi.setSystemTime(new Date('2026-10-12T07:15:10+10:00'))
      const { view } = await openView(
        workoutSource(
          ...BIKE,
          '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 0] [started:: 2026-10-12T07:15:00+10:00]',
        ),
      )
      return view
    }

    it.each([
      { control: 'Rest', primes: 1 },
      { control: 'Pause', primes: 1 },
      { control: 'End run', primes: 0 },
    ])('$control primes audio before acting: $primes', async ({ control, primes }) => {
      const view = await reopened()
      const before = contexts

      runnerButton(view, control).click()

      expect(contexts - before).toBe(primes)
    })

    it('primes on Resume of a cut-off run', async () => {
      vi.setSystemTime(new Date('2026-10-12T08:00:00+10:00'))
      const { view } = await openView(workoutSource(...BIKE, BIKE_REP_1))
      const before = contexts

      runnerButton(view, 'Resume rep 2').click()

      expect(contexts - before).toBe(1)
    })

    it('does not prime on End run here or Back to workout', async () => {
      vi.setSystemTime(new Date('2026-10-12T08:00:00+10:00'))
      const { view } = await openView(workoutSource(...BIKE, BIKE_REP_1))
      const before = contexts

      runnerButton(view, 'End run here').click()

      expect(contexts - before).toBe(0)
    })
  })

  describe('leaving', () => {
    it('leaves the tab empty when it closes on the runner', async () => {
      const view = await start(...BIKE)

      await view.onClose()

      expect(view.contentEl.childNodes).toHaveLength(0)
    })

    it('draws a fresh runner when it is opened again after leaving', async () => {
      const view = await start(...BIKE)
      const first = runner(view)
      button(view, 'End run').click()

      button(view, 'Start interval plan').click()

      expect([runner(view) === first, first.isConnected]).toEqual([false, false])
    })
  })
})
