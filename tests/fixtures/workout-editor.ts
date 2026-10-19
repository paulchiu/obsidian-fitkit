import { afterEach, beforeEach, expect, vi } from 'vitest'
import { TFile } from 'obsidian'
import type { App, WorkspaceLeaf } from 'obsidian'

import type { IndexEntry } from '../../src/domain/types'
import FitKitPlugin from '../../src/main'
import { DEFAULT_SETTINGS, type FitKitSettings } from '../../src/settings'
import { WorkoutEditorView } from '../../src/ui/obsidian/workout-editor-view'
import { harnessDocument, harnessWindow } from '../harness/obsidian-dom'
import { buildMockVaultFolderTree } from './mock-vault-folder-tree'
import {
  obsidianRecord,
  resetObsidianRecord,
  type MockMenu,
  type MockMenuItem,
} from './obsidian-editor-mock'

/** The day every editor fixture's workout is dated, after any history a test logs. */
export const WORKOUT_DATE = '2026-06-15'

export const WORKOUT_PATH = `Fitness/Workouts/${WORKOUT_DATE}.md`

/** A workout note dated {@link WORKOUT_DATE}, with `body` below its frontmatter. */
export const workoutNote = (body: string[], date = WORKOUT_DATE): string =>
  ['---', 'type: workout', `date: ${date}`, 'name: Leg day', '---', '', ...body, ''].join('\n')

/** An exercise note's text for `frontmatter`, the shape the exercise store rewrites. */
const exerciseNoteText = (frontmatter: Record<string, unknown>): string => {
  const lines = Object.entries(frontmatter).flatMap(([key, value]) =>
    Array.isArray(value)
      ? [`${key}:`, ...value.map((item) => `  - ${String(item)}`)]
      : [`${key}: ${String(value)}`],
  )
  return ['---', ...lines, '---', ''].join('\n')
}

export interface EditorOptions {
  /** The workout note's lines below its frontmatter. */
  body: string[]
  settings?: Partial<FitKitSettings>
  /** Prior sessions the plugin index holds, feeding the history badges and seeding. */
  history?: IndexEntry[]
  /** Exercise notes by name, as the frontmatter the metadata cache reports. */
  exerciseNotes?: Record<string, Record<string, unknown>>
  /** Other workout notes by path, with their text. */
  workouts?: Record<string, string>
  /** Holds every read of the vault until `releaseRead()`, so a test can see the view mid-load. */
  deferRead?: boolean
}

export interface Editor {
  view: WorkoutEditorView
  plugin: FitKitPlugin
  leaf: unknown
  /** Every note's text by path, as the vault holds it now. */
  contents: Map<string, string>
  /** Settings as each `saveData` call persisted them. */
  saved: FitKitSettings[]
  created: string[]
  folders: string[]
  /** Lets reads held by `deferRead` finish. */
  releaseRead: () => void
  workspace: {
    setActiveLeaf: ReturnType<typeof vi.fn>
    openLinkText: ReturnType<typeof vi.fn>
  }
}

const opened: WorkoutEditorView[] = []

/**
 * A real WorkoutEditorView, opened and loaded with a workout note over an
 * in-memory vault. Its pane is attached to the harness document so focus and
 * `activeElement` behave.
 */
export const openEditor = async (options: EditorOptions): Promise<Editor> => {
  const editor = createEditor(options)
  await editor.view.onOpen()
  await editor.view.setState({ file: WORKOUT_PATH }, { history: false })
  return editor
}

/** As {@link openEditor}, but leaves loading the workout to the test. */
export const createEditor = (options: EditorOptions): Editor => {
  const filesByPath = new Map<string, TFile>()
  const contents = new Map<string, string>()
  const frontmatter = new Map<string, Record<string, unknown>>()
  const addFile = (path: string, text: string): TFile => {
    const file = Object.assign(new TFile(), {
      path,
      basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
    })
    filesByPath.set(path, file)
    contents.set(path, text)
    return file
  }
  addFile(WORKOUT_PATH, workoutNote(options.body))
  for (const [path, text] of Object.entries(options.workouts ?? {})) {
    addFile(path, text)
  }
  for (const [name, matter] of Object.entries(options.exerciseNotes ?? {})) {
    const path = `Fitness/Exercises/${name}.md`
    addFile(path, exerciseNoteText(matter))
    frontmatter.set(path, matter)
  }
  const created: string[] = []
  const folders: string[] = []
  let held: Promise<void> = Promise.resolve()
  let releaseRead = (): void => {}
  if (options.deferRead) {
    held = new Promise((resolve) => {
      releaseRead = resolve
    })
  }
  const read = async (target: TFile): Promise<string> => {
    await held
    return contents.get(target.path) ?? ''
  }
  const vault = {
    getFolderByPath: buildMockVaultFolderTree(
      [...filesByPath.values()].map(({ path, basename }) => ({ path, basename })),
    ).getFolderByPath,
    read,
    cachedRead: read,
    process: async (target: TFile, callback: (text: string) => string): Promise<string> => {
      const next = callback(contents.get(target.path) ?? '')
      contents.set(target.path, next)
      return next
    },
    create: async (path: string, text: string): Promise<TFile> => {
      created.push(path)
      return addFile(path, text)
    },
    createFolder: async (path: string): Promise<void> => {
      folders.push(path)
    },
    getAbstractFileByPath: (path: string): TFile | null => filesByPath.get(path) ?? null,
  }
  const workspace = {
    setActiveLeaf: vi.fn(),
    openLinkText: vi.fn(async (): Promise<void> => {}),
    requestSaveLayout: vi.fn(),
  }
  const app = {
    vault,
    workspace,
    metadataCache: {
      getFileCache: (file: TFile) => {
        const matter = frontmatter.get(file.path)
        return matter ? { frontmatter: matter } : null
      },
      on: () => ({}),
    },
  }
  const saved: FitKitSettings[] = []
  const plugin = Object.create(FitKitPlugin.prototype) as FitKitPlugin
  plugin.app = app as unknown as App
  plugin.settings = { ...structuredClone(DEFAULT_SETTINGS), ...structuredClone(options.settings) }
  plugin.refreshIndexEntry = async (): Promise<void> => {}
  plugin.saveData = async (data: unknown): Promise<void> => {
    saved.push(structuredClone(data) as FitKitSettings)
  }
  plugin.cachedIndex = {
    schemaVersion: 1,
    builtAt: 0,
    entries: options.history ?? [],
    diagnostics: [],
  }
  const leaf = { app }
  const view = new WorkoutEditorView(leaf as unknown as WorkspaceLeaf, plugin)
  harnessDocument.body.appendChild(view.contentEl)
  opened.push(view)
  return { view, plugin, leaf, contents, saved, created, folders, releaseRead, workspace }
}

/** Interval callbacks the view registered; `tick()` runs them as time passing would. */
const intervals = new Map<number, () => void>()

/** Resize observers the view created; `resize()` reports a size change to each. */
const resizeCallbacks: Array<() => void> = []

export const tick = (): void => {
  for (const callback of [...intervals.values()]) {
    callback()
  }
}

export const resize = (): void => {
  for (const callback of resizeCallbacks) {
    callback()
  }
}

/** Moves the wall clock `seconds` on and runs the view's ticks. */
export const advance = (seconds: number): void => {
  vi.setSystemTime(Date.now() + seconds * 1000)
  tick()
}

/**
 * Registers the hooks every editor test needs: a fixed Brisbane clock, the
 * harness realm's DOM globals, timers that fire at once (intervals only on
 * `tick()`), and a fresh record of menus, modals and notices.
 */
export const useEditorEnvironment = (): void => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Australia/Brisbane')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${WORKOUT_DATE}T07:15:00+10:00`))
    resetObsidianRecord()
    intervals.clear()
    resizeCallbacks.length = 0
    vi.stubGlobal('HTMLElement', harnessWindow.HTMLElement)
    vi.stubGlobal('HTMLInputElement', harnessWindow.HTMLInputElement)
    vi.stubGlobal('Event', harnessWindow.Event)
    vi.stubGlobal('activeWindow', harnessWindow)
    vi.stubGlobal('activeDocument', harnessDocument)
    let nextId = 1
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
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback)
        }
        observe(): void {}
        disconnect(): void {}
      },
    )
  })

  afterEach(() => {
    for (const view of opened.splice(0)) {
      view.contentEl.remove()
    }
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
}

/** The button whose accessible name is `label`, by `aria-label` or else by its text. */
export const button = (root: Element, label: string): HTMLButtonElement => {
  const found =
    root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
    [...root.querySelectorAll('button')].find((candidate) => candidate.textContent === label)
  if (!found) {
    throw new Error(`${label} button not rendered`)
  }
  return found
}

/** The exercise card at `index` in the list. */
export const card = (view: WorkoutEditorView, index = 0): HTMLElement => {
  const found = view.contentEl.querySelectorAll<HTMLElement>(
    '.fitkit-exercise-list > .fitkit-card',
  )[index]
  if (!found) {
    throw new Error(`no card at ${index}`)
  }
  return found
}

/** A card's set rows, in order. */
/** A card's first set row. */
export const firstRow = (view: WorkoutEditorView, index = 0): HTMLElement => {
  const [row] = rows(card(view, index))
  if (!row) {
    throw new Error('card has no rows')
  }
  return row
}

export const rows = (cardEl: Element): HTMLElement[] => [
  ...cardEl.querySelectorAll<HTMLElement>('.fitkit-set-rows > .fitkit-row'),
]

/** The input in a row's cell labelled `label`, if the cell holds one. */
export const cellInput = (row: Element, label: string): HTMLInputElement | null =>
  row.querySelector<HTMLInputElement>(`.fitkit-cell[data-label="${label}"] input`)

/** The labels across a card's set header. */
export const headLabels = (cardEl: Element): string[] =>
  [...(cardEl.querySelector('.fitkit-set-head')?.children ?? [])].map(
    (cell) => cell.textContent ?? '',
  )

export const typeInto = (input: HTMLInputElement, value: string): void => {
  input.value = value
  input.dispatchEvent(new harnessWindow.Event('input'))
}

export const blur = (input: HTMLInputElement): void => {
  input.dispatchEvent(new harnessWindow.Event('blur'))
}

export const pressKey = (target: Element, key: string): void => {
  target.dispatchEvent(new harnessWindow.KeyboardEvent('keydown', { key, bubbles: true }))
}

export const lastMenu = (): MockMenu => {
  const menu = obsidianRecord.menus.at(-1)
  if (!menu) {
    throw new Error('no menu shown')
  }
  return menu
}

export const menuTitles = (menu: MockMenu = lastMenu()): Array<string | undefined> =>
  menu.items.map((item) => item.title)

export const menuItem = (title: string, menu: MockMenu = lastMenu()): MockMenuItem => {
  const item = menu.items.find((candidate) => candidate.title === title)
  if (!item) {
    throw new Error(`${title} menu item not offered`)
  }
  return item
}

export const chooseMenuItem = (title: string): void => {
  menuItem(title).onClick?.()
}

/** Opens a card's options menu from its gear button. */
export const openCardMenu = (view: WorkoutEditorView, index = 0): MockMenu => {
  button(card(view, index), 'Exercise options').click()
  return lastMenu()
}

/** Opens a set row's options menu from its kebab. */
export const openRowMenu = (row: Element): MockMenu => {
  const kebab = row.querySelector<HTMLButtonElement>('.fitkit-row-kebab')
  if (!kebab) {
    throw new Error('row has no kebab')
  }
  kebab.click()
  return lastMenu()
}

/** Picks a type through the card menu's Change type..., which opens the types as a second menu. */
export const switchCardType = (view: WorkoutEditorView, type: string, index = 0): void => {
  openCardMenu(view, index)
  chooseMenuItem('Change type...')
  chooseMenuItem(`Switch to ${type}`)
}

export const modalTitles = (): string[] =>
  obsidianRecord.modals.map((modal) => modal.titleEl.textContent ?? '')

/** The latest modal opened with `title`, waiting for it to open. */
export const openedModal = async (
  title: string,
): Promise<{ contentEl: HTMLElement; modalEl: HTMLElement; titleEl: HTMLElement }> => {
  await vi.waitFor(() => expect(modalTitles()).toContain(title))
  const modal = [...obsidianRecord.modals]
    .reverse()
    .find((candidate) => candidate.titleEl.textContent === title)
  if (!modal) {
    throw new Error(`${title} modal not opened`)
  }
  return modal
}

/** Clicks `choice` in the latest modal titled `title`, once it opens. */
export const choose = async (title: string, choice: string): Promise<void> => {
  button((await openedModal(title)).contentEl, choice).click()
}

/** The note's body lines below its frontmatter. */
export const noteBody = (contents: Map<string, string>, path = WORKOUT_PATH): string[] =>
  (contents.get(path) ?? '').split('\n').slice(6, -1)

/** Waits for autosave to leave the workout's body equal to `expected`. */
export const savedBody = async (
  contents: Map<string, string>,
  expected: string[],
): Promise<void> => {
  await vi.waitFor(() => expect(noteBody(contents)).toEqual(expected))
}

/** Lets promise chains the view started run to completion. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

/** The rename picker, prefilled with the card's name, renaming it to `name` on Enter. */
export const renameCard = async (
  view: WorkoutEditorView,
  name: string,
  index = 0,
): Promise<void> => {
  openCardMenu(view, index)
  chooseMenuItem('Rename exercise')
  const picker = await pickerModal()
  picker.inputEl.value = name
  pressKey(picker.inputEl, 'Enter')
}

/** The exercise picker the latest suggest modal shows. */
export const pickerModal = async (): Promise<{ inputEl: HTMLInputElement }> => {
  await vi.waitFor(() => expect(obsidianRecord.modals.at(-1)).toHaveProperty('inputEl'))
  /** The picker listens for Enter only once its async `onOpen` has run. */
  await settle()
  return obsidianRecord.modals.at(-1) as unknown as { inputEl: HTMLInputElement }
}

/** Deletes a row through its menu and the confirm that follows. */
export const deleteRow = async (row: Element): Promise<void> => {
  openRowMenu(row)
  chooseMenuItem('Delete row')
  await choose('Remove row?', 'Remove')
}
