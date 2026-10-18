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
  const { mixinFileView } = await import('../fixtures/obsidian-file-view')

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
    setIcon: () => {},
  }
})

import { TFile } from 'obsidian'
import type { App, WorkspaceLeaf } from 'obsidian'

import type { IndexEntry } from '../../src/domain/types'
import FitKitPlugin from '../../src/main'
import { DEFAULT_SETTINGS } from '../../src/settings'
import { WorkoutEditorView } from '../../src/ui/workout-editor-view'
import { buildMockVaultFolderTree } from '../fixtures/mock-vault-folder-tree'
import { createTestRoot, harnessDocument, harnessWindow } from '../harness/obsidian-dom'
import { findUnstyledClasses } from '../harness/stylesheet'

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

const openedModal = (): { contentEl: HTMLElement; titleEl: HTMLElement } => {
  const modal = obsidian.modals.at(-1)
  if (!modal) {
    throw new Error('no modal opened')
  }
  return modal
}

/** Clicks a button in the choice the latest modal offers, by its text. */
const choose = (text: string): void => {
  const found = [...openedModal().contentEl.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  )
  if (!found) {
    throw new Error(`${text} not offered`)
  }
  found.click()
}

const menuItem = (title: string): MockMenuItem => {
  const item = obsidian.menus.at(-1)?.items.find((candidate) => candidate.title === title)
  if (!item) {
    throw new Error(`${title} menu item not offered`)
  }
  return item
}

/** Picks a type through Change type..., which opens the types as a second menu. */
const switchTo = async (type: string): Promise<void> => {
  menuItem('Change type...').onClick?.()
  await vi.waitFor(() => menuItem(`Switch to ${type}`))
  menuItem(`Switch to ${type}`).onClick?.()
}

/** Waits for autosave to leave the note's body lines (after the frontmatter) equal to `expected`. */
const savedBody = async (contents: Map<string, string>, expected: string[]): Promise<void> => {
  await vi.waitFor(() => {
    const lines = (contents.get(WORKOUT_PATH) ?? '').split('\n')
    expect(lines.slice(6, -1)).toEqual(expected)
  })
}

describe('WorkoutEditorView interval plans', () => {
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

  it('keeps the plan and interval fields when an edit saves the note', async () => {
    const body = [
      '## [[Exercise Bike]]',
      '',
      '- [exercise:: [[Exercise Bike]]] [plan:: 8 x 30s @ 300W, 90s rest]',
      '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 305] [rest:: 90]',
      '- [exercise:: [[Exercise Bike]]] [set:: 2] [duration:: 30] [load:: 20] [level:: 4] [rest:: 41]',
    ]
    const { view, contents } = await openView(workoutSource(...body))

    const name = view.contentEl.querySelector<HTMLInputElement>('input[aria-label="Workout name"]')
    if (!name) {
      throw new Error('name input not rendered')
    }
    name.value = 'Bike intervals'
    name.dispatchEvent(new harnessWindow.Event('input'))

    await vi.waitFor(() => {
      expect(contents.get(WORKOUT_PATH)).toContain('name: Bike intervals')
    })
    await savedBody(contents, body)
  })

  it('offers the presets from settings, the starter plans unless changed', async () => {
    const source = workoutSource(
      '## [[Exercise Bike]]',
      '',
      '- [exercise:: [[Exercise Bike]]] [duration:: 0]',
    )
    const chips = async (settings: Partial<typeof DEFAULT_SETTINGS>): Promise<string[]> => {
      const { view } = await openView(source, settings)
      button(view, 'Exercise options').click()
      await switchTo('interval')
      choose('Just this workout')
      await vi.waitFor(() => expect(openedModal().titleEl.textContent).toContain('Interval plan'))
      return [...openedModal().contentEl.querySelectorAll('.fitkit-plan-presets button')].map(
        (chip) => chip.textContent ?? '',
      )
    }

    expect([
      await chips({}),
      await chips({ intervalPresets: 'Bike: 10 x 4m @ 300W, 1m rest\nOops: lots' }),
    ]).toEqual([['Tabata', 'EMOM', 'Over-unders', 'Pyramid', '30/30', 'Norwegian 4x4'], ['Bike']])
  })

  it('writes the plan line chosen through the plan form', async () => {
    const { view, contents } = await openView(
      workoutSource(
        '## [[Exercise Bike]]',
        '',
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 600]',
      ),
    )

    button(view, 'Exercise options').click()
    await switchTo('interval')
    choose('Just this workout')
    await vi.waitFor(() => expect(openedModal().titleEl.textContent).toContain('Interval plan'))
    const modal = openedModal()
    const plan = modal.contentEl.querySelector<HTMLTextAreaElement>('textarea[aria-label="Plan"]')
    if (!plan) {
      throw new Error('Plan not rendered')
    }
    plan.value = '(x 6 (over 1m 300W) (under 2m 220W))'
    plan.dispatchEvent(new harnessWindow.Event('input', { bubbles: true }))
    modal.contentEl.querySelector<HTMLButtonElement>('.fitkit-btn-primary')?.click()

    await savedBody(contents, [
      '## [[Exercise Bike]]',
      '',
      '- [exercise:: [[Exercise Bike]]] [plan:: (x 6 (over 1m 300W) (under 2m 220W))]',
      '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 600]',
    ])
  })

  it('shows the plan as a profile and a legend, each logged rep by hit, and where Start will pick up', async () => {
    const { view } = await openView(
      workoutSource(
        '## [[Exercise Bike]]',
        '',
        '- [exercise:: [[Exercise Bike]]] [plan:: 8 x 30s @ 300W, 90s rest]',
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 305] [rest:: 90]',
        '- [exercise:: [[Exercise Bike]]] [set:: 2] [duration:: 22] [watts:: 280] [rest:: 75]',
      ),
    )

    const inputs = (label: string): string[] =>
      [...view.contentEl.querySelectorAll<HTMLInputElement>(`input[aria-label="${label}"]`)].map(
        (input) => input.value,
      )
    const plan = view.contentEl.querySelector('.fitkit-plan-line')
    expect({
      legend: plan?.querySelector('.fitkit-plan-legend')?.textContent,
      totals: [...(plan?.querySelectorAll('.fitkit-plan-totals span') ?? [])].map(
        (span) => span.textContent,
      ),
      bars: plan?.querySelectorAll('.fitkit-plan-bar.is-key-1').length,
      progress: [...(plan?.querySelectorAll('.fitkit-plan-progress') ?? [])]
        .slice(0, 3)
        .map((bar) => bar.getAttribute('class')),
      marker: plan?.querySelectorAll('.fitkit-plan-marker').length,
      run: button(view, 'Start interval plan').textContent,
      watts: inputs('Watts'),
      rest: inputs('Rest'),
    }).toEqual({
      legend: '8× work 30s 300W · rest 90s',
      totals: ['8 reps · 14m30s', '2 of 8 done'],
      bars: 8,
      progress: [
        'fitkit-plan-progress is-hit',
        'fitkit-plan-progress is-miss',
        'fitkit-plan-progress is-todo',
      ],
      marker: 1,
      run: 'Start from rep 3',
      watts: ['305', '280'],
      rest: ['1m30s', '1m15s'],
    })
  })

  it('carries intensity and rest into the rows Add set and Repeat create', async () => {
    const { view, contents } = await openView(
      workoutSource(
        '## [[Spin Bike]]',
        '',
        '- [exercise:: [[Spin Bike]]] [set:: 1] [duration:: 20] [level:: 12] [rest:: 40] [notes:: easy]',
      ),
    )
    const actionButton = (text: string): HTMLButtonElement => {
      const found = [...view.contentEl.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.textContent === text,
      )
      if (!found) {
        throw new Error(`${text} not rendered`)
      }
      return found
    }

    actionButton('Repeat').click()
    actionButton('Add set').click()

    await savedBody(contents, [
      '## [[Spin Bike]]',
      '',
      '- [exercise:: [[Spin Bike]]] [set:: 1] [duration:: 20] [level:: 12] [rest:: 40] [notes:: easy]',
      '- [exercise:: [[Spin Bike]]] [set:: 2] [duration:: 20] [level:: 12] [rest:: 40]',
      '- [exercise:: [[Spin Bike]]] [duration:: 0] [level:: 12] [rest:: 40]',
    ])
  })

  it('saves an edit made during a write once its debounce fires after the write', async () => {
    const { view, contents } = await openView(
      workoutSource(...['## [[Plank]]', '', '- [exercise:: [[Plank]]] [duration:: 60]']),
    )
    const timeouts: Array<() => void> = []
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void): number => timeouts.push(callback),
      clearTimeout: (): void => {},
      setInterval: (): number => 0,
      clearInterval: (): void => {},
    })
    const rename = (value: string): void => {
      const name = view.contentEl.querySelector<HTMLInputElement>(
        'input[aria-label="Workout name"]',
      )
      if (!name) {
        throw new Error('name input not rendered')
      }
      name.value = value
      name.dispatchEvent(new harnessWindow.Event('input'))
    }

    rename('First')
    timeouts.shift()?.()
    rename('Second')
    await vi.waitFor(() => expect(contents.get(WORKOUT_PATH)).toContain('name: First'))
    for (const fire of timeouts.splice(0)) {
      fire()
    }

    await vi.waitFor(() => expect(contents.get(WORKOUT_PATH)).toContain('name: Second'))
  })

  describe('switching to interval', () => {
    const menuTitles = (): Array<string | undefined> =>
      obsidian.menus.at(-1)?.items.map((item) => item.title) ?? []

    const saveForm = (): void => {
      const save = openedModal().contentEl.querySelector<HTMLButtonElement>('.fitkit-btn-primary')
      if (!save) {
        throw new Error('Save not rendered')
      }
      save.click()
    }

    it('offers Switch to interval on a duration card and writes the plan chosen in one step', async () => {
      const { view, contents } = await openView(
        workoutSource(
          '## [[Exercise Bike]]',
          '',
          '- [exercise:: [[Exercise Bike]]] [duration:: 0]',
        ),
      )

      button(view, 'Exercise options').click()
      const titles = menuTitles()
      menuItem('Change type...').onClick?.()
      await vi.waitFor(() => menuItem('Switch to interval'))
      const types = menuTitles()
      menuItem('Switch to interval').onClick?.()
      choose('Just this workout')
      await vi.waitFor(() => expect(obsidian.modals.length).toBe(2))
      saveForm()

      expect(types).toEqual(['Switch to strength', 'Switch to interval', 'Switch to bodyweight'])
      expect(titles).not.toContain('Set interval plan')
      await savedBody(contents, [
        '## [[Exercise Bike]]',
        '',
        '- [exercise:: [[Exercise Bike]]] [plan:: (x 8 (work 30s 300W) (rest 90s))]',
        '- [exercise:: [[Exercise Bike]]] [duration:: 0]',
      ])
    })

    it('treats a card with a plan as interval, editable in place and switchable back to duration', async () => {
      const rows = [
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 300] [rest:: 90]',
      ]
      const { view, contents } = await openView(
        workoutSource(
          '## [[Exercise Bike]]',
          '',
          '- [exercise:: [[Exercise Bike]]] [plan:: 3 x 30s @ 300W, 90s rest]',
          ...rows,
        ),
      )

      button(view, 'Exercise options').click()
      const titles = menuTitles()
      menuItem('Change type...').onClick?.()
      await vi.waitFor(() => menuItem('Switch to duration'))
      const types = menuTitles()
      menuItem('Switch to duration').onClick?.()
      choose('Just this workout')

      expect(titles).toContain('Edit interval plan')
      expect(types).toEqual(['Switch to strength', 'Switch to duration', 'Switch to bodyweight'])
      await savedBody(contents, ['## [[Exercise Bike]]', '', ...rows])
    })

    it('switches a strength card straight to interval, naming interval when it asks', async () => {
      const { view, contents } = await openView(
        workoutSource('## [[Sled Push]]', '', '- [exercise:: [[Sled Push]]] [set:: 1]'),
      )

      button(view, 'Exercise options').click()
      await switchTo('interval')
      const title = openedModal().titleEl.textContent
      choose('Just this workout')
      await vi.waitFor(() => expect(obsidian.modals.length).toBe(2))
      saveForm()

      expect([title, obsidian.notices.at(-1)]).toEqual([
        'Switch Sled Push to interval?',
        'Switched to interval. Previous strength rows were cleared.',
      ])
      await savedBody(contents, [
        '## [[Sled Push]]',
        '',
        '- [exercise:: [[Sled Push]]] [plan:: (x 8 (work 30s 300W) (rest 90s))]',
        '- [exercise:: [[Sled Push]]] [duration:: 0]',
      ])
    })
  })

  describe('run', () => {
    const BIKE = [
      '## [[Exercise Bike]]',
      '',
      '- [exercise:: [[Exercise Bike]]] [plan:: 3 x 30s @ 300W, 90s rest]',
    ]

    const runnerText = (view: WorkoutEditorView, selector: string): string | null | undefined =>
      view.contentEl.querySelector(`.fitkit-runner ${selector}`)?.textContent

    it('moves the clock on each tick without rebuilding the runner', async () => {
      const { view } = await openView(workoutSource(...BIKE))
      button(view, 'Start interval plan').click()
      const runner = view.contentEl.querySelector('.fitkit-runner')

      runTo('07:15:04')

      expect([
        view.contentEl.querySelector('.fitkit-runner') === runner,
        runnerText(view, '.fitkit-runner-clock'),
      ]).toEqual([true, '0:26'])
    })

    it('takes over the tab with a clock counting the work down and a Rest button', async () => {
      const { view } = await openView(workoutSource(...BIKE))

      button(view, 'Start interval plan').click()
      at('07:15:10')

      expect({
        cards: view.contentEl.querySelectorAll('.fitkit-card').length,
        phase: runnerText(view, '.fitkit-runner-phase'),
        clock: runnerText(view, '.fitkit-runner-clock'),
        primary: runnerText(view, '.fitkit-runner-primary'),
      }).toEqual({ cards: 0, phase: 'Work · rep 1 of 3', clock: '0:20', primary: 'Rest' })
    })

    const runnerButton = (view: WorkoutEditorView, text: string): HTMLButtonElement => {
      const found = [
        ...view.contentEl.querySelectorAll<HTMLButtonElement>('.fitkit-runner button'),
      ].find((candidate) => candidate.textContent === text)
      if (!found) {
        throw new Error(`${text} not on the runner`)
      }
      return found
    }

    it('writes the seconds done when Rest ends work early, and the rest taken when Skip ends rest', async () => {
      const { view, contents } = await openView(workoutSource(...BIKE))
      button(view, 'Start interval plan').click()

      at('07:15:22')
      runnerButton(view, 'Rest').click()
      at('07:16:00')
      runnerButton(view, 'Skip').click()

      await savedBody(contents, [
        ...BIKE,
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 22] [watts:: 300] [rest:: 38]',
        '- [exercise:: [[Exercise Bike]]] [set:: 2] [duration:: 0] [started:: 2026-10-12T07:16:00+10:00]',
      ])
    })

    it('corrects the rep just done from the stepper during rest', async () => {
      const { view, contents } = await openView(workoutSource(...BIKE))
      button(view, 'Start interval plan').click()
      at('07:15:20')
      runnerButton(view, 'Rest').click()

      button(view, 'Lower last rep').click()
      button(view, 'Lower last rep').click()

      expect(runnerText(view, '.fitkit-runner-stepper-value')).toBe('Rep 1: 290 W')
      await savedBody(contents, [
        ...BIKE,
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 20] [watts:: 290] [rest:: 0] [started:: 2026-10-12T07:15:20+10:00]',
      ])
    })

    it('shows the runner from the top and returns the list to where it was scrolled', async () => {
      const { view } = await openView(workoutSource(...BIKE))
      view.contentEl.scrollTop = 420

      button(view, 'Start interval plan').click()
      const runnerScroll = view.contentEl.scrollTop
      button(view, 'End run').click()

      expect([runnerScroll, view.contentEl.scrollTop]).toEqual([0, 420])
    })

    it('pauses with the time banked, and End run returns to the card with the rows kept', async () => {
      const { view, contents } = await openView(workoutSource(...BIKE))
      button(view, 'Start interval plan').click()
      at('07:15:12')

      button(view, 'Pause run').click()
      await savedBody(contents, [
        ...BIKE,
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 12] [paused:: true]',
      ])
      at('07:20:00')
      button(view, 'Resume run').click()
      at('07:20:05')
      button(view, 'End run').click()

      expect(view.contentEl.querySelectorAll('.fitkit-runner').length).toBe(0)
      await savedBody(contents, [
        ...BIKE,
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 17]',
      ])
    })

    it('pauses the run when the tab closes mid-run', async () => {
      const { view, contents } = await openView(workoutSource(...BIKE))
      button(view, 'Start interval plan').click()
      at('07:15:12')

      await view.onClose()

      await savedBody(contents, [
        ...BIKE,
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 12] [paused:: true]',
      ])
    })

    it('shows how many reps hit the target when the run finishes', async () => {
      const { view } = await openView(
        workoutSource(
          ...BIKE,
          '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 300] [rest:: 90]',
          '- [exercise:: [[Exercise Bike]]] [set:: 2] [duration:: 30] [watts:: 250] [rest:: 90]',
        ),
      )
      button(view, 'Start interval plan').click()

      runTo('07:15:31')

      const dots = [...view.contentEl.querySelectorAll('.fitkit-runner-dot')].map((dot) =>
        dot.classList.contains('is-hit')
          ? 'hit'
          : dot.classList.contains('is-miss')
            ? 'miss'
            : 'open',
      )
      expect([
        runnerText(view, '.fitkit-runner-phase'),
        runnerText(view, '.fitkit-runner-hits'),
        dots,
      ]).toEqual(['Run finished', '2/3', ['hit', 'miss', 'hit']])
    })

    it('catches up reps that ended while Obsidian was closed and says how many', async () => {
      vi.setSystemTime(new Date('2026-10-12T07:19:40+10:00'))
      const { view, contents } = await openView(
        workoutSource(
          '## [[Exercise Bike]]',
          '',
          '- [exercise:: [[Exercise Bike]]] [plan:: 4 x 30s @ 300W, 90s rest]',
          '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 280] [rest:: 90]',
          '- [exercise:: [[Exercise Bike]]] [set:: 2] [duration:: 0] [started:: 2026-10-12T07:17:00+10:00]',
        ),
      )

      expect([obsidian.notices.at(-1), runnerText(view, '.fitkit-runner-phase')]).toEqual([
        '2 reps finished while Obsidian was closed. They have the target filled in, so check their watts.',
        'Rest · rep 3 of 4',
      ])
      await savedBody(contents, [
        '## [[Exercise Bike]]',
        '',
        '- [exercise:: [[Exercise Bike]]] [plan:: 4 x 30s @ 300W, 90s rest]',
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 280] [rest:: 90]',
        '- [exercise:: [[Exercise Bike]]] [set:: 2] [duration:: 30] [watts:: 300] [rest:: 90] [notes:: logged while Obsidian was closed]',
        '- [exercise:: [[Exercise Bike]]] [set:: 3] [duration:: 30] [watts:: 300] [rest:: 0] [started:: 2026-10-12T07:19:30+10:00] [notes:: logged while Obsidian was closed]',
      ])
    })

    it('reports a cut-off run past the end of the plan and can end it there', async () => {
      vi.setSystemTime(new Date('2026-10-12T08:00:00+10:00'))
      const source = workoutSource(
        ...BIKE,
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 300] [rest:: 0] [started:: 2026-10-12T07:15:30+10:00]',
      )
      const { view, contents } = await openView(source)

      const phase = runnerText(view, '.fitkit-runner-phase')
      runnerButton(view, 'End run here').click()

      expect(phase).toBe('Run cut off at rep 1 rest')
      await savedBody(contents, [
        ...BIKE,
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 300]',
      ])
    })

    it('resumes a cut-off run from the next rep', async () => {
      vi.setSystemTime(new Date('2026-10-12T08:00:00+10:00'))
      const { view, contents } = await openView(
        workoutSource(
          ...BIKE,
          '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 300] [rest:: 0] [started:: 2026-10-12T07:15:30+10:00]',
        ),
      )

      runnerButton(view, 'Resume rep 2').click()

      await savedBody(contents, [
        ...BIKE,
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 300] [rest:: 90]',
        '- [exercise:: [[Exercise Bike]]] [set:: 2] [duration:: 0] [started:: 2026-10-12T08:00:00+10:00]',
      ])
    })

    it('offers Start instead of the stopwatch on a card with a plan', async () => {
      const { view } = await openView(workoutSource(...BIKE))

      expect([
        view.contentEl.querySelector('button[aria-label="Start timer"]'),
        button(view, 'Start interval plan').textContent,
      ]).toEqual([null, 'Start'])
    })

    it('styles every class the plan card, the runner screens and the plan form render', async () => {
      const rendered: string[] = []
      const collect = (root: Element): void => {
        rendered.push(...findUnstyledClasses(root))
      }
      const { view } = await openView(
        workoutSource(
          ...BIKE,
          '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 300] [rest:: 90]',
        ),
      )
      collect(view.contentEl)
      button(view, 'Exercise options').click()
      menuItem('Edit interval plan').onClick?.()
      collect(openedModal().contentEl)
      button(view, 'Start interval plan').click()
      collect(view.contentEl)
      at('07:15:20')
      runnerButton(view, 'Rest').click()
      collect(view.contentEl)
      button(view, 'Pause run').click()
      collect(view.contentEl)
      button(view, 'Resume run').click()
      runTo('07:17:30')
      collect(view.contentEl)

      expect([runnerText(view, '.fitkit-runner-phase'), [...new Set(rendered)]]).toEqual([
        'Run finished',
        [],
      ])
    })

    it('runs a fresh card from rep 1, in place of its blank seeded row', async () => {
      const { view, contents } = await openView(
        workoutSource(...BIKE, '- [exercise:: [[Exercise Bike]]] [duration:: 0]'),
      )

      const label = button(view, 'Start interval plan').textContent
      button(view, 'Start interval plan').click()

      expect([label, runnerText(view, '.fitkit-runner-phase')]).toEqual([
        'Start',
        'Work · rep 1 of 3',
      ])
      await savedBody(contents, [
        ...BIKE,
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 0] [started:: 2026-10-12T07:15:00+10:00]',
      ])
    })

    it('starts from rep 1 when the first row has watts typed but no time or rest', async () => {
      const { view, contents } = await openView(
        workoutSource(
          ...BIKE,
          '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 0] [watts:: 300]',
        ),
      )

      const label = button(view, 'Start interval plan').textContent
      button(view, 'Start interval plan').click()

      expect([label, runnerText(view, '.fitkit-runner-phase')]).toEqual([
        'Start',
        'Work · rep 1 of 3',
      ])
      await savedBody(contents, [
        ...BIKE,
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 0] [watts:: 300] [started:: 2026-10-12T07:15:00+10:00]',
      ])
    })

    it('removes the plan line when Clear plan is chosen', async () => {
      const { view, contents } = await openView(
        workoutSource(...BIKE, '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30]'),
      )

      button(view, 'Exercise options').click()
      menuItem('Edit interval plan').onClick?.()
      const clear = [...openedModal().contentEl.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === 'Clear plan',
      )
      clear?.click()

      await savedBody(contents, [
        '## [[Exercise Bike]]',
        '',
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30]',
      ])
    })

    it('starts a run after a stopwatch on another card is done, keeping its time', async () => {
      const plank = ['## [[Plank]]', '', '- [exercise:: [[Plank]]] [set:: 1] [duration:: 0]']
      const { view, contents } = await openView(workoutSource(...plank, '', ...BIKE))
      button(view, 'Start timer').click()
      at('07:15:45')
      button(view, 'Close timer').click()

      button(view, 'Start interval plan').click()

      await savedBody(contents, [
        '## [[Plank]]',
        '',
        '- [exercise:: [[Plank]]] [set:: 1] [duration:: 45]',
        '',
        ...BIKE,
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 0] [started:: 2026-10-12T07:15:45+10:00]',
      ])
    })

    describe('cues', () => {
      /** Platform boundaries: tones started and screen locks held, as the device would see them. */
      let tones: number[]
      let locks: string[]
      let closed: string[]

      beforeEach(() => {
        tones = []
        locks = []
        closed = []
        class FakeAudioContext {
          currentTime = 0
          destination = {}
          state = 'running'
          async resume(): Promise<void> {}
          async close(): Promise<void> {
            closed.push('audio')
          }
          createGain(): unknown {
            return {
              gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
              connect: () => {},
            }
          }
          createOscillator(): unknown {
            const oscillator = {
              frequency: { value: 0 },
              connect: () => {},
              start: () => tones.push(oscillator.frequency.value),
              stop: () => {},
            }
            return oscillator
          }
        }
        Object.defineProperty(harnessWindow, 'AudioContext', {
          configurable: true,
          value: FakeAudioContext,
        })
        Object.defineProperty(harnessWindow.navigator, 'wakeLock', {
          configurable: true,
          value: {
            request: async (type: string): Promise<unknown> => {
              locks.push(`acquire ${type}`)
              return { addEventListener: () => {}, release: async () => void locks.push('release') }
            },
          },
        })
      })

      afterEach(() => {
        Reflect.deleteProperty(harnessWindow, 'AudioContext')
        Reflect.deleteProperty(harnessWindow.navigator as object, 'wakeLock')
      })

      it('beeps the last three seconds of work and the change to rest', async () => {
        const { view } = await openView(workoutSource(...BIKE))
        button(view, 'Start interval plan').click()

        runTo('07:15:31')

        expect(tones).toEqual([880, 880, 880, 1320])
      })

      it('double-beeps when work runs straight into the next step', async () => {
        const { view } = await openView(
          workoutSource(
            '## [[Exercise Bike]]',
            '',
            '- [exercise:: [[Exercise Bike]]] [plan:: (x 2 (on 30s 350W) (off 30s 150W))]',
          ),
        )
        button(view, 'Start interval plan').click()

        runTo('07:15:31')

        expect(tones).toEqual([880, 880, 880, 1100, 1100])
      })

      it('stays silent when interval beeps are off', async () => {
        const { view } = await openView(workoutSource(...BIKE), { intervalBeepsEnabled: false })
        button(view, 'Start interval plan').click()

        runTo('07:15:31')

        expect(tones).toEqual([])
      })

      it('keeps the screen awake while the runner is open, then lets it sleep and frees the audio', async () => {
        const { view } = await openView(workoutSource(...BIKE))
        button(view, 'Start interval plan').click()
        await vi.waitFor(() => expect(locks).toEqual(['acquire screen']))

        button(view, 'End run').click()

        await vi.waitFor(() =>
          expect([locks, closed]).toEqual([['acquire screen', 'release'], ['audio']]),
        )
      })
    })

    describe('with named steps', () => {
      const ON_OFF = [
        '## [[Exercise Bike]]',
        '',
        '- [exercise:: [[Exercise Bike]]] [plan:: (x 2 (on 30s 350W) (off 30s 150W))]',
      ]

      it('heads the clock with the step, its target and what comes next', async () => {
        const { view } = await openView(workoutSource(...ON_OFF))

        button(view, 'Start interval plan').click()
        at('07:15:10')

        expect({
          phase: runnerText(view, '.fitkit-runner-phase'),
          step: runnerText(view, '.fitkit-runner-step'),
          target: runnerText(view, '.fitkit-runner-target'),
          next: runnerText(view, '.fitkit-runner-next'),
          rounds: runnerText(view, '.fitkit-runner-rounds'),
          primary: runnerText(view, '.fitkit-runner-primary'),
        }).toEqual({
          phase: 'Work · rep 1 of 4',
          step: 'on',
          target: '350W target',
          next: 'Next: off 30s @ 150W',
          rounds: 'Round 1 of 2',
          primary: 'Next',
        })
      })

      it('counts sets and rounds when repeats nest', async () => {
        const { view } = await openView(
          workoutSource(
            '## [[Exercise Bike]]',
            '',
            '- [exercise:: [[Exercise Bike]]] [plan:: (x 2 (x 2 (over 1m 300W) (under 1m 220W)) (rest 2m))]',
            '- [exercise:: [[Exercise Bike]]] [set:: 1] [step:: over] [duration:: 60] [watts:: 300]',
            '- [exercise:: [[Exercise Bike]]] [set:: 2] [step:: under] [duration:: 60] [watts:: 220]',
            '- [exercise:: [[Exercise Bike]]] [set:: 3] [step:: over] [duration:: 60] [watts:: 300]',
            '- [exercise:: [[Exercise Bike]]] [set:: 4] [step:: under] [duration:: 60] [watts:: 220] [rest:: 120]',
          ),
        )

        button(view, 'Start interval plan').click()

        expect(runnerText(view, '.fitkit-runner-rounds')).toBe('Set 2 of 2 · round 1 of 2')
      })

      it('finishes on the last step and scores hits against targeted steps only', async () => {
        const { view, contents } = await openView(
          workoutSource(
            '## [[Exercise Bike]]',
            '',
            '- [exercise:: [[Exercise Bike]]] [plan:: (warmup 30s) (hard 30s 300W)]',
            '- [exercise:: [[Exercise Bike]]] [set:: 1] [step:: warmup] [duration:: 30]',
          ),
        )
        button(view, 'Start interval plan').click()
        at('07:15:10')
        const primary = runnerText(view, '.fitkit-runner-primary')

        runTo('07:15:31')

        expect([primary, runnerText(view, '.fitkit-runner-hits')]).toEqual(['Finish', '1/1'])
        await savedBody(contents, [
          '## [[Exercise Bike]]',
          '',
          '- [exercise:: [[Exercise Bike]]] [plan:: (warmup 30s) (hard 30s 300W)]',
          '- [exercise:: [[Exercise Bike]]] [set:: 1] [step:: warmup] [duration:: 30]',
          '- [exercise:: [[Exercise Bike]]] [set:: 2] [step:: hard] [duration:: 30] [watts:: 300]',
        ])
      })
    })
  })

  describe('long set lists', () => {
    const repRows = (count: number): string[] =>
      Array.from(
        { length: count },
        (_, i) =>
          `- [exercise:: [[Exercise Bike]]] [set:: ${i + 1}] [duration:: 30] [watts:: 300] [rest:: 90]`,
      )

    const longBike = (count: number): string =>
      workoutSource(
        '## [[Exercise Bike]]',
        '',
        '- [exercise:: [[Exercise Bike]]] [plan:: 20 x 30s @ 300W, 90s rest]',
        ...repRows(count),
      )

    /** jsdom has no layout, so each set row stands 40px tall against the harness's 768px window. */
    beforeEach(() => {
      vi.spyOn(harnessWindow.HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
        function (this: HTMLElement) {
          return this.querySelectorAll('.fitkit-row').length * 40
        },
      )
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    const toggle = (view: WorkoutEditorView): HTMLButtonElement | null =>
      view.contentEl.querySelector<HTMLButtonElement>('.fitkit-set-toggle:not([hidden])')

    const capped = (view: WorkoutEditorView): boolean =>
      view.contentEl.querySelector('.fitkit-set-rows')?.classList.contains('is-capped') ?? false

    it('caps a set list taller than half the screen, and expands and collapses it', async () => {
      const { view } = await openView(longBike(20))

      const states = [[capped(view), toggle(view)?.textContent]]
      toggle(view)?.click()
      states.push([capped(view), toggle(view)?.textContent])
      toggle(view)?.click()
      states.push([capped(view), toggle(view)?.textContent])

      expect(states).toEqual([
        [true, 'Show all 20 sets'],
        [false, 'Show fewer sets'],
        [true, 'Show all 20 sets'],
      ])
    })

    it('keeps an expanded set list open when a set is added', async () => {
      const { view } = await openView(longBike(20))

      toggle(view)?.click()
      const addSet = [...view.contentEl.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === 'Add set',
      )
      addSet?.click()

      expect([capped(view), toggle(view)?.textContent]).toEqual([false, 'Show fewer sets'])
    })

    it('leaves a set list that fits in half the screen alone', async () => {
      const { view } = await openView(longBike(3))

      expect([capped(view), toggle(view)]).toEqual([false, null])
    })
  })

  describe('remembering the interval plan', () => {
    const LAST_BIKE: IndexEntry = {
      path: 'Fitness/Workouts/2026-10-05.md',
      mtime: 1,
      date: '2026-10-05',
      name: 'Intervals',
      exercises: [
        { exerciseName: 'Exercise Bike', kind: 'duration', plan: '10 x 4m @ 300W, 1m rest' },
      ],
    }
    const BIKE_IS_DURATION = {
      exerciseRegistry: [{ name: 'Exercise Bike', kind: 'duration' as const, aliases: [] }],
    }

    it('starts an added exercise with the plan it last ran, ready to start from rep 1', async () => {
      const { view, contents } = await openView(workoutSource(), BIKE_IS_DURATION, [LAST_BIKE])

      const add = [...view.contentEl.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === 'Add exercise',
      )
      add?.click()
      await vi.waitFor(() => expect(obsidian.modals.at(-1)?.titleEl).toBeDefined())
      const picker = obsidian.modals.at(-1) as unknown as { inputEl: HTMLInputElement }
      picker.inputEl.value = 'Exercise Bike'
      picker.inputEl.dispatchEvent(
        new (harnessWindow.KeyboardEvent as typeof KeyboardEvent)('keydown', { key: 'Enter' }),
      )

      await vi.waitFor(() => expect(button(view, 'Start interval plan').textContent).toBe('Start'))
      await vi.waitFor(() =>
        expect(contents.get(WORKOUT_PATH)).toContain(
          '- [exercise:: [[Exercise Bike]]] [plan:: 10 x 4m @ 300W, 1m rest]',
        ),
      )
    })

    it('fills the plan form with the last plan when a card switches to interval', async () => {
      const { view } = await openView(
        workoutSource(
          '## [[Exercise Bike]]',
          '',
          '- [exercise:: [[Exercise Bike]]] [duration:: 0]',
        ),
        BIKE_IS_DURATION,
        [LAST_BIKE],
      )

      button(view, 'Exercise options').click()
      await switchTo('interval')
      choose('Just this workout')
      await vi.waitFor(() => expect(obsidian.modals.length).toBe(2))

      expect(
        openedModal().contentEl.querySelector<HTMLTextAreaElement>('textarea[aria-label="Plan"]')
          ?.value,
      ).toBe('10 x 4m @ 300W, 1m rest')
    })
  })

  describe('interval as a saved type', () => {
    const BIKE_NOTE_PATH = 'Fitness/Exercises/Exercise Bike.md'
    const bikeNote = (...frontmatter: string[]): Record<string, string> => ({
      [BIKE_NOTE_PATH]: ['---', 'type: exercise', ...frontmatter, '---', '', 'Body.', ''].join(
        '\n',
      ),
    })
    const BIKE_IS_INTERVAL = {
      exerciseRegistry: [
        { name: 'Exercise Bike', kind: 'duration' as const, interval: true as const, aliases: [] },
      ],
    }
    const bikeCard = workoutSource(
      '## [[Exercise Bike]]',
      '',
      '- [exercise:: [[Exercise Bike]]] [duration:: 0]',
    )

    const addExercise = async (view: WorkoutEditorView, name: string): Promise<void> => {
      ;[...view.contentEl.querySelectorAll('button')]
        .find((candidate) => candidate.textContent === 'Add exercise')
        ?.click()
      await vi.waitFor(() => expect(obsidian.modals.at(-1)?.titleEl).toBeDefined())
      const picker = obsidian.modals.at(-1) as unknown as { inputEl: HTMLInputElement }
      picker.inputEl.value = name
      picker.inputEl.dispatchEvent(
        new (harnessWindow.KeyboardEvent as typeof KeyboardEvent)('keydown', { key: 'Enter' }),
      )
    }

    it('opens the plan form with the starters when an interval exercise with no plan yet is added', async () => {
      const { view } = await openView(workoutSource(), BIKE_IS_INTERVAL)

      await addExercise(view, 'Exercise Bike')

      await vi.waitFor(() =>
        expect(openedModal().titleEl.textContent).toBe('Interval plan for Exercise Bike'),
      )
      expect(
        [...openedModal().contentEl.querySelectorAll('.fitkit-plan-presets button')].map(
          (preset) => preset.textContent,
        ),
      ).toEqual(['Tabata', 'EMOM', 'Over-unders', 'Pyramid', '30/30', 'Norwegian 4x4'])
    })

    it('records the switch to interval in the exercise note and registry when asked', async () => {
      const { view, contents, plugin } = await openView(
        bikeCard,
        { exerciseRegistry: [{ name: 'Exercise Bike', kind: 'duration', aliases: [] }] },
        [],
        bikeNote('kind: duration'),
      )

      button(view, 'Exercise options').click()
      await switchTo('interval')
      const question = openedModal().contentEl.textContent
      choose('Update registry too')

      await vi.waitFor(() =>
        expect(openedModal().titleEl.textContent).toBe('Interval plan for Exercise Bike'),
      )
      expect(question).toContain(
        'The exercise registry currently records Exercise Bike as duration.',
      )
      expect(question).not.toContain('will be cleared')
      expect(contents.get(BIKE_NOTE_PATH)).toContain('kind: duration\ninterval: true\n')
      expect(plugin.settings.exerciseRegistry).toEqual([
        { name: 'Exercise Bike', kind: 'duration', interval: true, aliases: [] },
      ])
    })

    it('records the switch to interval in the registry alone when the exercise has no note', async () => {
      const { view, plugin } = await openView(bikeCard, {
        exerciseRegistry: [{ name: 'Exercise Bike', kind: 'duration', aliases: [] }],
      })

      button(view, 'Exercise options').click()
      await switchTo('interval')
      choose('Update registry too')

      await vi.waitFor(() =>
        expect(plugin.settings.exerciseRegistry).toEqual([
          { name: 'Exercise Bike', kind: 'duration', interval: true, aliases: [] },
        ]),
      )
    })

    it('goes straight to the plan form when the registry already records interval', async () => {
      const { view } = await openView(bikeCard, BIKE_IS_INTERVAL)

      button(view, 'Exercise options').click()
      await switchTo('interval')

      expect(obsidian.modals).toHaveLength(1)
      expect(openedModal().titleEl.textContent).toBe('Interval plan for Exercise Bike')
    })

    it('still asks before a kind switch the registry already records', async () => {
      const { view } = await openView(
        workoutSource('## [[Sled Push]]', '', '- [exercise:: [[Sled Push]]] [notes:: heavy]'),
        { exerciseRegistry: [{ name: 'Sled Push', kind: 'duration', aliases: [] }] },
      )

      button(view, 'Exercise options').click()
      await switchTo('duration')

      expect(openedModal().titleEl.textContent).toBe('Switch Sled Push to duration?')
    })

    it('clears the interval marker when an interval card switches back to duration for all workouts', async () => {
      const { view, contents, plugin } = await openView(
        workoutSource(
          '## [[Exercise Bike]]',
          '',
          '- [exercise:: [[Exercise Bike]]] [plan:: 3 x 30s @ 300W, 90s rest]',
          '- [exercise:: [[Exercise Bike]]] [duration:: 0]',
        ),
        BIKE_IS_INTERVAL,
        [],
        bikeNote('kind: duration', 'interval: true'),
      )

      button(view, 'Exercise options').click()
      await switchTo('duration')
      choose('Update registry too')

      await vi.waitFor(() =>
        expect(plugin.settings.exerciseRegistry).toEqual([
          { name: 'Exercise Bike', kind: 'duration', aliases: [] },
        ]),
      )
      expect(contents.get(BIKE_NOTE_PATH)).not.toContain('interval')
      await savedBody(contents, [
        '## [[Exercise Bike]]',
        '',
        '- [exercise:: [[Exercise Bike]]] [duration:: 0]',
      ])
    })
  })
})
