import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HostContext, type Host } from '../../../src/ui/components/host'
import { LayoutContext } from '../../../src/ui/components/layout'
import { BodyweightRows, DurationRows, type RowControls } from '../../../src/ui/components/set-rows'
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
    render(
      <HostContext.Provider value={host}>
        <DurationRows
          entries={entries}
          exerciseIndex={0}
          columns={{ plan: null, intensity: null, rest: false }}
          markCaughtUp={false}
          controls={controls}
          onEdit={apply}
        />
      </HostContext.Provider>,
      root,
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

  describe('rung labels', () => {
    /** jsdom lays nothing out, so a name measures ten pixels a letter against a 120 pixel slot. */
    const prototype = harnessWindow.HTMLElement.prototype
    const measure = (el: HTMLElement): number =>
      el.classList.contains('fitkit-bodyweight-level-full') ? (el.textContent ?? '').length * 10 : 0
    beforeEach(() => {
      Object.defineProperty(prototype, 'scrollWidth', {
        configurable: true,
        get(this: HTMLElement) {
          return measure(this)
        },
      })
      Object.defineProperty(prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains('fitkit-bodyweight-level-full') ? 120 : 0
        },
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(prototype, 'scrollWidth')
      Reflect.deleteProperty(prototype, 'clientWidth')
    })

    const drawLabels = (
      root: HTMLElement,
      set: EditableBodyweightSet,
      resizes: Set<() => void>,
    ) => {
      render(
        <HostContext.Provider value={host}>
          <LayoutContext.Provider
            value={{
              onResize: (refit) => {
                resizes.add(refit)
                return () => resizes.delete(refit)
              },
            }}
          >
            <BodyweightRows
              sets={[set]}
              levels={['Wall', 'Incline push-up on a bench']}
              showLoad={false}
              controls={controls}
              onEdit={apply}
              setLevel={() => {}}
              openLevelMenu={() => {}}
            />
          </LayoutContext.Provider>
        </HostContext.Provider>,
        root,
      )
    }
    const short = (root: HTMLElement): boolean | undefined =>
      root.querySelector('.fitkit-bodyweight-level-label')?.classList.contains('is-label-short')

    it('refits a rung label whose name changes, unshortening it once the name fits', () => {
      const root = createTestRoot()
      const set: EditableBodyweightSet = { set: 1, level: 2, reps: 10 }
      const resizes = new Set<() => void>()

      drawLabels(root, set, resizes)
      const drawn = short(root)
      drawLabels(root, set, resizes)
      const redrawn = short(root)
      set.level = 1
      drawLabels(root, set, resizes)

      expect([drawn, redrawn, short(root)]).toEqual([true, true, false])
    })

    it('refits when the pane resizes, and stops listening once taken down', () => {
      const root = createTestRoot()
      const set: EditableBodyweightSet = { set: 1, level: 2, reps: 10 }
      const resizes = new Set<() => void>()
      drawLabels(root, set, resizes)
      const label = root.querySelector<HTMLElement>('.fitkit-bodyweight-level-label')
      label?.classList.remove('is-label-short')

      for (const refit of resizes) refit()
      const refitted = short(root)
      render(null, root)

      expect([refitted, resizes.size]).toEqual([true, 0])
    })
  })
})
