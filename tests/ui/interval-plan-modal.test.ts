import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestRoot, findButtons, harnessWindow } from '../harness/obsidian-dom'

vi.mock('obsidian', () => {
  class Modal {
    contentEl = createTestRoot()
    modalEl = createTestRoot()
    titleEl = createTestRoot()

    setTitle(title: string): this {
      this.titleEl.textContent = title
      return this
    }

    constructor(readonly app: unknown) {}

    close(): void {
      const maybeClosable = this as { onClose?: () => void }
      maybeClosable.onClose?.()
    }
  }

  return { Modal }
})

import type { IntervalPreset } from '../../src/domain/interval-presets'
import { IntervalPlanModal } from '../../src/ui/interval-plan-modal'

const SLED = { label: 'Sled', plan: '6 x open @ 120kg, every 2m' }

const open = (
  initial?: string,
  presets: IntervalPreset[] = [SLED],
): { modal: IntervalPlanModal; onSave: ReturnType<typeof vi.fn> } => {
  const onSave = vi.fn()
  const modal = new IntervalPlanModal({} as never, {
    exerciseName: 'Exercise Bike',
    initial,
    presets,
    onSave,
  })
  modal.onOpen()
  return { modal, onSave }
}

const planField = (modal: IntervalPlanModal): HTMLTextAreaElement => {
  const found = modal.contentEl.querySelector<HTMLTextAreaElement>('textarea[aria-label="Plan"]')
  if (!found) {
    throw new Error('Plan field not rendered')
  }
  return found
}

const type = (modal: IntervalPlanModal, value: string): void => {
  const input = planField(modal)
  input.value = value
  input.dispatchEvent(new harnessWindow.Event('input', { bubbles: true }))
}

const saveButton = (modal: IntervalPlanModal): HTMLButtonElement => {
  const [save] = findButtons(modal.contentEl, 'Save')
  if (!save) {
    throw new Error('Save not rendered')
  }
  return save
}

const text = (modal: IntervalPlanModal, selector: string): string | null | undefined =>
  modal.contentEl.querySelector(selector)?.textContent

describe('interval plan modal', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { setTimeout: (callback: () => void): number => (callback(), 1) })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens on the plan already on the card, with how many reps it has and how long it takes', () => {
    const { modal } = open('(x 8 (work 20s 400W) (rest 10s))')

    expect([
      modal.titleEl.textContent,
      planField(modal).value,
      text(modal, '.fitkit-plan-preview'),
    ]).toEqual([
      'Interval plan for Exercise Bike',
      '(x 8 (work 20s 400W) (rest 10s))',
      '8 reps · 3m50s',
    ])
  })

  it('saves a nested plan as typed, on one line', () => {
    const { modal, onSave } = open('8 x 30s @ 300W, 90s rest')

    type(modal, '(warmup 10m 150W)\n  (x 3 (over 1m 300W) (under 2m 220W))')
    saveButton(modal).click()

    expect(onSave.mock.calls).toEqual([['(warmup 10m 150W) (x 3 (over 1m 300W) (under 2m 220W))']])
  })

  it('tidies a one-line plan into its usual spelling', () => {
    const { modal, onSave } = open(undefined)

    type(modal, ' 6 x OPEN @ 120KG ,  every 2:00 ')
    saveButton(modal).click()

    expect(onSave.mock.calls).toEqual([['6 x open @ 120kg, every 2m']])
  })

  it('explains a plan that cannot run and will not save it', () => {
    const { modal, onSave } = open('(x 3 (over 1m 300W))')

    type(modal, '(x 3 (over 1m 300W)')
    saveButton(modal).click()

    expect([
      text(modal, '.fitkit-plan-error'),
      saveButton(modal).disabled,
      onSave.mock.calls,
    ]).toEqual(['Missing ) to close (x.', true, []])
  })

  it('fills the plan from a preset it was given', () => {
    const { modal, onSave } = open(undefined)

    findButtons(modal.contentEl, 'Sled')[0]?.click()
    saveButton(modal).click()

    expect(onSave.mock.calls).toEqual([['6 x open @ 120kg, every 2m']])
  })

  it('shows examples behind the info button, each one ready to use', () => {
    const { modal, onSave } = open(undefined)
    const hiddenAtFirst = modal.contentEl
      .querySelector('.fitkit-plan-examples')
      ?.hasAttribute('hidden')

    modal.contentEl.querySelector<HTMLButtonElement>('button[aria-label="Plan examples"]')?.click()
    const examples = modal.contentEl.querySelector('.fitkit-plan-examples')
    const pyramid = [...(examples?.querySelectorAll('.fitkit-plan-example') ?? [])].find(
      (example) => example.textContent?.includes('(L8 L10 L12'),
    )
    pyramid?.querySelector<HTMLButtonElement>('button')?.click()
    saveButton(modal).click()

    expect({
      hiddenAtFirst,
      shown: !examples?.hasAttribute('hidden'),
      docs: examples?.querySelector('a')?.getAttribute('href'),
      saved: onSave.mock.calls,
    }).toEqual({
      hiddenAtFirst: true,
      shown: true,
      docs: 'https://github.com/paulchiu/obsidian-fitkit/blob/main/docs/note-format.md#interval-plans',
      saved: [['(x 6 (climb 1m (L8 L10 L12 L14 L12 L10)) (rest 1m))']],
    })
  })

  it('leaves out Start from when there are no presets', () => {
    const { modal } = open(undefined, [])

    expect(modal.contentEl.querySelector('.fitkit-plan-presets')).toBeNull()
  })

  it('offers Clear plan only for a card that has one, and clears it', () => {
    const fresh = open(undefined)
    const planned = open('8 x 30s @ 300W, 90s rest')

    findButtons(planned.modal.contentEl, 'Clear plan')[0]?.click()

    expect([findButtons(fresh.modal.contentEl, 'Clear plan'), planned.onSave.mock.calls]).toEqual([
      [],
      [[undefined]],
    ])
  })
})
