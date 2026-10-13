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
  class SuggestModal extends Modal {}
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
): Promise<{ view: WorkoutEditorView; contents: Map<string, string> }> => {
  const file = Object.assign(new TFile(), { path: WORKOUT_PATH, basename: '2026-10-12' })
  const contents = new Map([[WORKOUT_PATH, source]])
  const vault = {
    getFolderByPath: buildMockVaultFolderTree([file]).getFolderByPath,
    read: async (target: TFile): Promise<string> => contents.get(target.path) ?? '',
    process: async (target: TFile, callback: (text: string) => string): Promise<void> => {
      contents.set(target.path, callback(contents.get(target.path) ?? ''))
    },
    getAbstractFileByPath: (path: string): TFile | null => (path === WORKOUT_PATH ? file : null),
  }
  const app = {
    vault,
    metadataCache: { getFileCache: () => null, on: () => ({}) },
  }
  const plugin = Object.create(FitKitPlugin.prototype) as FitKitPlugin
  plugin.app = app as unknown as App
  plugin.settings = { ...DEFAULT_SETTINGS, ...settings }
  plugin.refreshIndexEntry = async (): Promise<void> => {}
  const view = new WorkoutEditorView({ app } as unknown as WorkspaceLeaf, plugin)
  await view.onOpen()
  await view.setState({ file: WORKOUT_PATH }, { history: false })
  return { view, contents }
}

const button = (view: WorkoutEditorView, label: string): HTMLButtonElement => {
  const found = view.contentEl.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!found) {
    throw new Error(`${label} button not rendered`)
  }
  return found
}

const menuItem = (title: string): MockMenuItem => {
  const item = obsidian.menus.at(-1)?.items.find((candidate) => candidate.title === title)
  if (!item) {
    throw new Error(`${title} menu item not offered`)
  }
  return item
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

  it('writes the plan line chosen through Set interval plan', async () => {
    const { view, contents } = await openView(
      workoutSource(
        '## [[Exercise Bike]]',
        '',
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 600]',
      ),
    )

    button(view, 'Exercise options').click()
    menuItem('Set interval plan').onClick?.()
    const modal = obsidian.modals.at(-1)
    modal?.contentEl.querySelector<HTMLButtonElement>('.fitkit-btn-primary')?.click()

    await savedBody(contents, [
      '## [[Exercise Bike]]',
      '',
      '- [exercise:: [[Exercise Bike]]] [plan:: 8 x 30s @ 300W, 90s rest]',
      '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 600]',
    ])
  })

  it('shows the plan, the intensity and rest of each rep, and where Run will pick up', async () => {
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
    expect({
      plan: view.contentEl.querySelector('.fitkit-plan-line')?.textContent,
      run: button(view, 'Run interval plan').textContent,
      watts: inputs('Watts'),
      rest: inputs('Rest'),
    }).toEqual({
      plan: '8 x 30s @ 300W, 90s rest',
      run: 'Run from rep 3',
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

  describe('run', () => {
    const BIKE = [
      '## [[Exercise Bike]]',
      '',
      '- [exercise:: [[Exercise Bike]]] [plan:: 3 x 30s @ 300W, 90s rest]',
    ]

    const runnerText = (view: WorkoutEditorView, selector: string): string | null | undefined =>
      view.contentEl.querySelector(`.fitkit-runner ${selector}`)?.textContent

    it('takes over the tab with a clock counting the work down and a Rest button', async () => {
      const { view } = await openView(workoutSource(...BIKE))

      button(view, 'Run interval plan').click()
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
      button(view, 'Run interval plan').click()

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

    it('ends work by itself when its time runs out and writes the rep with the target', async () => {
      const { view, contents } = await openView(workoutSource(...BIKE))
      button(view, 'Run interval plan').click()

      runTo('07:15:31')

      expect(runnerText(view, '.fitkit-runner-primary')).toBe('Skip')
      await savedBody(contents, [
        ...BIKE,
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 300] [rest:: 0] [started:: 2026-10-12T07:15:30+10:00]',
      ])
    })

    it('corrects the rep just done from the stepper during rest', async () => {
      const { view, contents } = await openView(workoutSource(...BIKE))
      button(view, 'Run interval plan').click()
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

    it('pauses with the time banked, and End run returns to the card with the rows kept', async () => {
      const { view, contents } = await openView(workoutSource(...BIKE))
      button(view, 'Run interval plan').click()
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
      button(view, 'Run interval plan').click()
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
      button(view, 'Run interval plan').click()

      runTo('07:15:31')

      expect([
        runnerText(view, '.fitkit-runner-phase'),
        runnerText(view, '.fitkit-runner-hits'),
      ]).toEqual(['Run finished', '2/3'])
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

    it('offers Run instead of the stopwatch on a card with a plan', async () => {
      const { view } = await openView(workoutSource(...BIKE))

      expect(view.contentEl.querySelector('button[aria-label="Start timer"]')).toBeNull()
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
      menuItem('Set interval plan').onClick?.()
      const modal = obsidian.modals.at(-1)
      if (modal) {
        collect(modal.contentEl)
      }
      button(view, 'Run interval plan').click()
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

    describe('cues', () => {
      /** Platform boundaries: tones started and screen locks held, as the device would see them. */
      let tones: number[]
      let locks: string[]

      beforeEach(() => {
        tones = []
        locks = []
        class FakeAudioContext {
          currentTime = 0
          destination = {}
          state = 'running'
          async resume(): Promise<void> {}
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
              return { release: async () => void locks.push('release') }
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
        button(view, 'Run interval plan').click()

        runTo('07:15:31')

        expect(tones).toEqual([880, 880, 880, 1320])
      })

      it('stays silent when interval beeps are off', async () => {
        const { view } = await openView(workoutSource(...BIKE), { intervalBeepsEnabled: false })
        button(view, 'Run interval plan').click()

        runTo('07:15:31')

        expect(tones).toEqual([])
      })

      it('keeps the screen awake while the runner is open and lets it sleep after', async () => {
        const { view } = await openView(workoutSource(...BIKE))
        button(view, 'Run interval plan').click()
        await vi.waitFor(() => expect(locks).toEqual(['acquire screen']))

        button(view, 'End run').click()

        await vi.waitFor(() => expect(locks).toEqual(['acquire screen', 'release']))
      })
    })
  })
})
