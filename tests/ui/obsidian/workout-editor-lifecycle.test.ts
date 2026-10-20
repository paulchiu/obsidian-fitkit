import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', async () =>
  (await import('../../fixtures/obsidian-editor-mock')).createObsidianMock(),
)

import { TFile } from 'obsidian'

import { ExerciseCardBody } from '../../../src/ui/components/exercise-card'
import { countRenders } from '../../harness/renders'
import { harnessDocument, harnessWindow } from '../../harness/obsidian-dom'
import { watchUnmounts } from '../../harness/unmount'
import {
  advance,
  button,
  card,
  cellInput,
  createEditor,
  firstRow,
  noteBody,
  openEditor,
  rows,
  settle,
  typeInto,
  useEditorEnvironment,
  WORKOUT_PATH,
  workoutNote,
} from '../../fixtures/workout-editor'

useEditorEnvironment()

const SQUAT = ['## [[Squat]]', '', '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]']

describe('WorkoutEditorView reload after a conflict', () => {
  it('draws the disk copy and drops the banner when Reload from disk is pressed', async () => {
    const { view, contents } = await openEditor({ body: SQUAT })
    contents.set(
      WORKOUT_PATH,
      workoutNote(SQUAT.map((line) => line.replace('[reps:: 5]', '[reps:: 12]'))),
    )
    typeInto(cellInput(firstRow(view), 'Reps') as HTMLInputElement, '7')
    await vi.waitFor(() => button(view.contentEl, 'Reload from disk'))

    button(view.contentEl, 'Reload from disk').click()
    await vi.waitFor(() => expect(view.contentEl.querySelector('.fitkit-conflict')).toBeNull())

    expect((cellInput(firstRow(view), 'Reps') as HTMLInputElement).value).toBe('12')
  })
})

describe('WorkoutEditorView closing', () => {
  it('lets a save in flight settle, then leaves nothing drawn and disconnects its observer', async () => {
    let disconnects = 0
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {
          disconnects++
        }
      },
    )
    const { view, plugin, contents } = await openEditor({ body: SQUAT })
    const vault = (plugin.app as unknown as { vault: { process: Process } }).vault
    const write = vault.process
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vault.process = async (target, callback) => {
      await gate
      return write(target, callback)
    }
    typeInto(cellInput(firstRow(view), 'Reps') as HTMLInputElement, '9')

    let closed = false
    const closing = view.onClose().then(() => {
      closed = true
    })
    await settle()
    const midSave = [closed, view.contentEl.childElementCount > 0, disconnects]
    release()
    await closing

    expect(midSave).toEqual([false, true, 0])
    expect(noteBody(contents)).toContain(
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 9]',
    )
    expect([view.contentEl.childElementCount, disconnects]).toEqual([0, 1])
  })
})

type Process = (target: unknown, callback: (text: string) => string) => Promise<string>

const PLANK = ['## [[Plank]]', '', '- [exercise:: [[Plank]]] [set:: 1] [duration:: 30]']

const TWO = [
  ...SQUAT,
  '',
  '## [[Deadlift]]',
  '',
  '- [exercise:: [[Deadlift]]] [set:: 1] [weight:: 140] [reps:: 3]',
]

describe('WorkoutEditorView redraws in place', () => {
  it('keeps the focused input, its typed text and its focus when an exercise note changes', async () => {
    const editor = createEditor({ body: PLANK })
    let changed: (file: TFile) => void = () => {}
    const cache = (editor.plugin.app as unknown as { metadataCache: { on: unknown } }).metadataCache
    cache.on = (_event: string, callback: (file: TFile) => void) => {
      changed = callback
      return {}
    }
    await editor.view.onOpen()
    await editor.view.setState({ file: WORKOUT_PATH }, { history: false })
    const duration = cellInput(firstRow(editor.view), 'Duration') as HTMLInputElement
    duration.focus()
    typeInto(duration, '90')

    changed(Object.assign(new TFile(), { path: 'Fitness/Exercises/Plank.md' }))

    const after = cellInput(firstRow(editor.view), 'Duration')
    expect([after === duration, after?.value, harnessDocument.activeElement === duration]).toEqual([
      true,
      '90',
      true,
    ])
  })

  it('redraws only the card that changed, leaving the other its node', async () => {
    const { view } = await openEditor({ body: TWO })
    const untouched = card(view, 1)

    const renders = countRenders(ExerciseCardBody, () => {
      button(card(view, 0), 'Add set').click()
    })

    expect([renders, card(view, 1) === untouched, rows(card(view, 0)).length]).toEqual([1, true, 2])
  })

  it('redraws no card while the workout name is typed', async () => {
    const { view } = await openEditor({ body: TWO })

    const renders = countRenders(ExerciseCardBody, () => {
      typeInto(
        view.contentEl.querySelector('input[aria-label="Workout name"]') as HTMLInputElement,
        'Push day',
      )
    })

    expect(renders).toBe(0)
  })
})

describe('WorkoutEditorView screens', () => {
  it('takes the set timer down when it is closed, and the cards down while it is up', async () => {
    const { view } = await openEditor({ body: PLANK })
    const unmounts = watchUnmounts()

    try {
      button(card(view), 'Start timer').click()
      const whileUp = [
        view.contentEl.querySelector('.fitkit-exercise-list'),
        view.contentEl.querySelector('.fitkit-runner'),
      ]
      button(view.contentEl, 'Close timer').click()

      expect(whileUp.map((el) => el !== null)).toEqual([false, true])
      expect(unmounts.names).toEqual(expect.arrayContaining(['ExerciseCardBody', 'SetTimer']))
      expect(view.contentEl.querySelector('.fitkit-runner')).toBeNull()
      expect(view.contentEl.querySelector('.fitkit-exercise-list')).not.toBeNull()
    } finally {
      unmounts.stop()
    }
  })

  it('takes the rest timer down when it is stopped', async () => {
    const { view } = await openEditor({ body: SQUAT })
    const unmounts = watchUnmounts()

    try {
      button(view.contentEl, 'Start rest timer').click()
      advance(5)
      button(view.contentEl, 'Stop rest timer').click()

      expect(unmounts.names).toContain('RestTimer')
      expect(view.contentEl.querySelector('.fitkit-runner')).toBeNull()
    } finally {
      unmounts.stop()
    }
  })
})

describe('WorkoutEditorView set timer clock', () => {
  it('shows zero again when Reset lands on the seconds first drawn', async () => {
    const { view } = await openEditor({
      body: PLANK.map((l) => l.replace('duration:: 30', 'duration:: 0')),
    })
    button(card(view), 'Start timer').click()
    const clock = (): string | null =>
      view.contentEl.querySelector('.fitkit-runner-clock')?.textContent ?? null
    const started = clock()
    advance(7)
    const ticked = clock()

    button(view.contentEl, 'Reset set').click()

    expect([started, ticked, clock()]).toEqual(['0:00', '0:07', '0:00'])
  })
})

describe('WorkoutEditorView teardown', () => {
  it('unmounts the tree and takes every drag listener down when closed', async () => {
    const proto = harnessWindow.HTMLElement.prototype
    const pointerCalls = (spy: { mock: { calls: unknown[][] } }): number =>
      spy.mock.calls.filter(([type]) => type === 'pointerdown' || type === 'pointermove').length
    const added = vi.spyOn(proto, 'addEventListener')
    const removed = vi.spyOn(proto, 'removeEventListener')
    const { view } = await openEditor({ body: TWO })
    const unmounts = watchUnmounts()

    try {
      await view.onClose()

      expect([pointerCalls(added), pointerCalls(removed)]).toEqual([4, 4])
      expect(unmounts.names).toContain('EditorRoot')
      expect(view.contentEl.childElementCount).toBe(0)
    } finally {
      unmounts.stop()
      added.mockRestore()
      removed.mockRestore()
    }
  })

  it('draws nothing when a render arrives after the tab closed', async () => {
    const { view, plugin } = await openEditor({ body: SQUAT })
    await view.onClose()

    plugin.settings.strengthRestTimerEnabled = false
    view.refreshSettingsDrivenUi()

    expect(view.contentEl.childElementCount).toBe(0)
  })
})
