import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createTestRoot,
  findButtons,
  harnessDocument,
  harnessWindow,
  modalElements,
} from '../../harness/obsidian-dom'
import { watchUnmounts } from '../../harness/unmount'
import { outline } from '../../harness/outline'
import { findUnstyledClasses } from '../../harness/stylesheet'

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

import { PlanStepModal } from '../../../src/ui/obsidian/plan-step-modal'

describe('plan step modal', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void): number => {
        callback()
        return 1
      },
    })
  })

  afterEach(() => {
    harnessDocument.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('prompts for a rung change on a bodyweight exercise', () => {
    const modal = new PlanStepModal({} as never, {
      exerciseName: 'Push-up',
      kind: 'bodyweight',
      initial: '',
      onSave: vi.fn(),
    })

    modal.onOpen()

    const { contentEl, titleEl } = modalElements(modal)
    expect(titleEl.textContent).toBe('Rung change for Push-up')
    expect(contentEl.querySelector('label')?.textContent).toBe('Rung change')
    expect(contentEl.querySelector('input')?.getAttribute('placeholder')).toBe('rungs')
  })

  it('keeps the weight wording for other kinds', () => {
    const modal = new PlanStepModal({} as never, {
      exerciseName: 'Squat',
      kind: 'strength',
      initial: '',
      onSave: vi.fn(),
    })

    modal.onOpen()

    const { contentEl, titleEl } = modalElements(modal)
    expect(titleEl.textContent).toBe('Weight change for Squat')
    expect(contentEl.querySelector('label')?.textContent).toBe('Weight change')
    expect(contentEl.querySelector('input')?.getAttribute('placeholder')).toBe('kg')
  })
  /** Focus only lands on a connected element, so the modal renders attached. */
  const openAttached = (
    kind: 'strength' | 'bodyweight',
    initial: string,
    onSave = vi.fn(),
  ): PlanStepModal => {
    const modal = new PlanStepModal({} as never, {
      exerciseName: 'Squat',
      kind,
      initial,
      onSave,
    })
    harnessDocument.body.appendChild(modalElements(modal).contentEl)
    modal.onOpen()
    return modal
  }

  const field = (modal: PlanStepModal): HTMLInputElement => {
    const input = modalElements(modal).contentEl.querySelector('input')
    if (!input) {
      throw new Error('Expected an input.')
    }
    return input
  }

  it.each(['strength', 'bodyweight'] as const)(
    'draws the labelled field and actions for %s',
    (kind) => {
      const modal = openAttached(kind, '2.5')

      const { contentEl, modalEl } = modalElements(modal)
      expect(modalEl.classList.contains('fitkit-set-note-modal-shell')).toBe(true)
      expect(outline(contentEl)).toMatchSnapshot()
      expect(findUnstyledClasses(contentEl)).toEqual([])
    },
  )

  it('prefills the step, then focuses it with the text selected', () => {
    const modal = openAttached('strength', '2.5')

    const input = field(modal)
    expect(input.value).toBe('2.5')
    expect(harnessDocument.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3])
  })

  it.each([
    ['2.5', 2.5],
    [' 5 ', 5],
    ['', undefined],
    ['0', undefined],
    ['-1', undefined],
    ['heavy', undefined],
  ])('saves %j as %j from Save', (typed, expected) => {
    const onSave = vi.fn()
    const modal = openAttached('strength', '', onSave)

    field(modal).value = typed
    findButtons(modalElements(modal).contentEl, 'Save')[0]?.click()

    expect(onSave).toHaveBeenCalledExactlyOnceWith(expected)
  })

  it('saves from Enter without letting the key through', () => {
    const onSave = vi.fn()
    const modal = openAttached('strength', '', onSave)
    const input = field(modal)
    input.value = '5'

    const enter = new harnessWindow.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    input.dispatchEvent(enter)

    expect(onSave).toHaveBeenCalledExactlyOnceWith(5)
    expect(enter.defaultPrevented).toBe(true)
  })

  it('ignores other keys', () => {
    const onSave = vi.fn()
    const modal = openAttached('strength', '', onSave)

    field(modal).dispatchEvent(new harnessWindow.KeyboardEvent('keydown', { key: 'a' }))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('closes without saving from Cancel, clearing the shell class', () => {
    const onSave = vi.fn()
    const modal = openAttached('strength', '3', onSave)

    const { contentEl, modalEl } = modalElements(modal)
    findButtons(contentEl, 'Cancel')[0]?.click()

    expect(onSave).not.toHaveBeenCalled()
    expect(modalEl.classList.contains('fitkit-set-note-modal-shell')).toBe(false)
    expect(contentEl.children).toHaveLength(0)
  })

  it('saves once when Save is pressed again while the close is under way', () => {
    const onSave = vi.fn()
    const modal = openAttached('strength', '3', onSave)
    vi.spyOn(modal, 'close').mockImplementation(() => {})

    const [save] = findButtons(modalElements(modal).contentEl, 'Save')
    save?.click()
    save?.click()

    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('unmounts its component when it closes', () => {
    const modal = openAttached('strength', '3')
    const unmounts = watchUnmounts()
    try {
      modal.close()
    } finally {
      unmounts.stop()
    }

    expect(unmounts.names).toContain('PlanStepForm')
  })
})
