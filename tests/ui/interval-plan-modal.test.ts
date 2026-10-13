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

import { IntervalPlanModal } from '../../src/ui/interval-plan-modal'

const open = (initial?: string): { modal: IntervalPlanModal; onSave: ReturnType<typeof vi.fn> } => {
  const onSave = vi.fn()
  const modal = new IntervalPlanModal({} as never, {
    exerciseName: 'Exercise Bike',
    initial,
    onSave,
  })
  modal.onOpen()
  return { modal, onSave }
}

const field = <T extends HTMLElement>(modal: IntervalPlanModal, label: string): T => {
  const found = modal.contentEl.querySelector<T>(`[aria-label="${label}"]`)
  if (!found) {
    throw new Error(`${label} not rendered`)
  }
  return found
}

const type = (modal: IntervalPlanModal, label: string, value: string): void => {
  const input = field<HTMLInputElement>(modal, label)
  input.value = value
  input.dispatchEvent(new harnessWindow.Event('input', { bubbles: true }))
}

const choose = (modal: IntervalPlanModal, label: string, value: string): void => {
  const select = field<HTMLSelectElement>(modal, label)
  select.value = value
  select.dispatchEvent(new harnessWindow.Event('change', { bubbles: true }))
}

const saveButton = (modal: IntervalPlanModal): HTMLButtonElement => {
  const [save] = findButtons(modal.contentEl, 'Save')
  if (!save) {
    throw new Error('Save not rendered')
  }
  return save
}

const values = (modal: IntervalPlanModal): Record<string, string | boolean> => ({
  reps: field<HTMLInputElement>(modal, 'Reps').value,
  intensity: field<HTMLSelectElement>(modal, 'Intensity').value,
  target: field<HTMLInputElement>(modal, 'Target').value,
  work: field<HTMLInputElement>(modal, 'Work').value,
  open: field<HTMLInputElement>(modal, 'Open work').checked,
  pace: field<HTMLSelectElement>(modal, 'Pace').value,
  gap: field<HTMLInputElement>(modal, 'Rest or period').value,
})

describe('interval plan modal', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { setTimeout: (callback: () => void): number => (callback(), 1) })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens with the fields of the plan already on the card', () => {
    const { modal } = open('6 x open @ 120kg, every 2m')

    expect([modal.titleEl.textContent, values(modal)]).toEqual([
      'Interval plan for Exercise Bike',
      {
        reps: '6',
        intensity: 'load',
        target: '120',
        work: '',
        open: true,
        pace: 'every',
        gap: '2m',
      },
    ])
  })

  it('saves the edited fields as a plan line', () => {
    const { modal, onSave } = open('8 x 30s @ 300W, 90s rest')

    type(modal, 'Reps', '10')
    type(modal, 'Work', '40s')
    choose(modal, 'Pace', 'every')
    type(modal, 'Rest or period', '1:00')
    saveButton(modal).click()

    expect(onSave.mock.calls).toEqual([['10 x 40s @ 300W, every 1m']])
  })

  it('explains a plan that cannot run and will not save it', () => {
    const { modal, onSave } = open('8 x 30s @ 300W, 90s rest')

    const openWork = field<HTMLInputElement>(modal, 'Open work')
    openWork.checked = true
    openWork.dispatchEvent(new harnessWindow.Event('change', { bubbles: true }))
    saveButton(modal).click()

    expect([
      modal.contentEl.querySelector('.fitkit-plan-error')?.textContent,
      saveButton(modal).disabled,
      onSave.mock.calls,
    ]).toEqual([
      'Open work needs a pace of every, so each rep has a start to rest against.',
      true,
      [],
    ])
  })

  it('fills the form from a preset', () => {
    const { modal, onSave } = open(undefined)

    findButtons(modal.contentEl, 'Sled every 2:00')[0]?.click()
    saveButton(modal).click()

    expect(onSave.mock.calls).toEqual([['6 x open @ 120kg, every 2m']])
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
