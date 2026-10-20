import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', async () =>
  (await import('../../fixtures/obsidian-editor-mock')).createObsidianMock(),
)

import {
  button,
  cellInput,
  firstRow,
  noteBody,
  openEditor,
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
