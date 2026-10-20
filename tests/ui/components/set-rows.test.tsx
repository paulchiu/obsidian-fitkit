import { describe, expect, it } from 'vitest'

import type { Host } from '../../../src/ui/components/host'
import {
  renderBodyweightRows,
  renderDurationRows,
  type RowControls,
} from '../../../src/ui/components/set-rows'
import type { EditableBodyweightSet, EditableDurationEntry } from '../../../src/ui/model/set-rows'
import { createTestRoot, harnessWindow } from '../../harness/obsidian-dom'

const host: Host = { icon: (el, name) => el.setAttribute('data-icon', name) }

const controls = (): RowControls => ({
  label: 'set',
  note: undefined,
  openNote: () => {},
  openMenu: () => {},
})

const apply = <T extends object>(row: T, patch: Partial<T>): void => {
  Object.assign(row, patch)
}

const typeInto = (input: HTMLInputElement, value: string): void => {
  input.value = value
  input.dispatchEvent(new harnessWindow.Event('input'))
}

describe('set rows redrawn in place', () => {
  const drawDurations = (root: HTMLElement, entries: EditableDurationEntry[]): void => {
    renderDurationRows(
      root,
      {
        entries,
        exerciseIndex: 0,
        columns: { plan: null, intensity: null, rest: false },
        markCaughtUp: false,
        controls,
        onEdit: apply,
      },
      host,
    )
  }

  const durationInputs = (root: HTMLElement): HTMLInputElement[] => [
    ...root.querySelectorAll<HTMLInputElement>('input[aria-label="Duration"]'),
  ]

  it('keeps a row its input and the text typed there when a row above it goes', () => {
    const root = createTestRoot()
    const first: EditableDurationEntry = { set: 1, durationSeconds: 30 }
    const second: EditableDurationEntry = { set: 2, durationSeconds: 45 }
    drawDurations(root, [first, second])
    const [, typed] = durationInputs(root)
    if (!typed) throw new Error('second row not drawn')

    typeInto(typed, '90')
    drawDurations(root, [second])

    expect(durationInputs(root)).toHaveLength(1)
    expect(durationInputs(root)[0]).toBe(typed)
    expect([typed.value, second.durationSeconds]).toEqual(['90', 90])
  })

  it('refits a rung label whose name changes, unshortening it once the name fits', () => {
    const root = createTestRoot()
    const set: EditableBodyweightSet = { set: 1, level: 2, reps: 10 }
    const draw = (): void => {
      renderBodyweightRows(
        root,
        {
          sets: [set],
          levels: ['Wall', 'Incline push-up on a bench'],
          showLoad: false,
          controls,
          onEdit: apply,
          setLevel: () => {},
          openLevelMenu: () => {},
          fitLabel: (label, full) =>
            label.classList.toggle('is-label-short', (full.textContent ?? '').length > 12),
        },
        host,
      )
    }
    const short = (): boolean | undefined =>
      root.querySelector('.fitkit-bodyweight-level-label')?.classList.contains('is-label-short')

    draw()
    const drawn = short()
    draw()
    const redrawn = short()
    set.level = 1
    draw()

    expect([drawn, redrawn, short()]).toEqual([true, true, false])
  })
})
