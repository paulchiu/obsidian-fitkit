import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestRoot, findButtons, harnessDocument } from '../../harness/obsidian-dom'
import { outline } from '../../harness/outline'
import { findUnstyledClasses } from '../../harness/stylesheet'
import { watchUnmounts } from '../../harness/unmount'

const notices: string[] = []

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

  class Notice {
    constructor(message: string) {
      notices.push(message)
    }
  }

  return { Modal, Notice }
})

import { EditLevelsModal } from '../../../src/ui/obsidian/edit-levels-modal'

/** The stubbed `window.setTimeout` queues here so a test can see what waits for the next tick. */
const timers: (() => void)[] = []
const flushTimers = (): void => timers.splice(0).forEach((run) => run())

function openModal(options?: { initial?: string[]; onSave?: (levels: string[]) => void }): {
  modal: EditLevelsModal
  contentEl: HTMLElement
  onSave: ReturnType<typeof vi.fn>
} {
  const onSave = vi.fn()
  const modal = new EditLevelsModal({} as never, {
    exerciseName: 'Push-up',
    initial: options?.initial ?? ['Wall push-up', 'Knee push-up'],
    onSave: options?.onSave ?? onSave,
  })
  harnessDocument.body.appendChild(modal.contentEl)
  modal.onOpen()
  return { modal, contentEl: modal.contentEl, onSave }
}

describe('edit levels modal', () => {
  beforeEach(() => {
    notices.length = 0
    timers.length = 0
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void): number => timers.push(callback),
    })
  })

  afterEach(() => {
    harnessDocument.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('prefills one rung per line, then on the next tick focuses the end of the text', () => {
    const { contentEl } = openModal()

    const textarea = contentEl.querySelector('textarea')
    if (!textarea) {
      throw new Error('Expected a textarea.')
    }
    textarea.setSelectionRange(0, 0)
    expect(textarea.value).toBe('Wall push-up\nKnee push-up')
    expect(harnessDocument.activeElement).not.toBe(textarea)

    flushTimers()

    expect(harnessDocument.activeElement).toBe(textarea)
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([25, 25])
  })

  it('saves trimmed rungs with blanks dropped', () => {
    const { contentEl, onSave } = openModal()

    const textarea = contentEl.querySelector('textarea')
    const [save] = findButtons(contentEl, 'Save')
    if (!textarea || !save) {
      throw new Error('Expected textarea and Save button.')
    }

    textarea.value = '  Incline push-up  \n\nKnee push-up\n'
    save.click()

    expect(onSave).toHaveBeenCalledWith(['Incline push-up', 'Knee push-up'])
  })

  it('refuses an empty ladder without saving or closing', () => {
    const { modal, contentEl, onSave } = openModal()
    const close = vi.spyOn(modal, 'close')

    const textarea = contentEl.querySelector('textarea')
    const [save] = findButtons(contentEl, 'Save')
    if (!textarea || !save) {
      throw new Error('Expected textarea and Save button.')
    }

    textarea.value = '  \n\n'
    save.click()

    expect(onSave).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(notices).toEqual(['Enter at least one level.'])
  })

  it('draws the labelled text box and action row under the exercise title', () => {
    const { modal, contentEl } = openModal()

    expect(modal.titleEl.textContent).toBe('Edit levels for Push-up')
    expect(modal.modalEl.classList.contains('fitkit-set-note-modal-shell')).toBe(true)
    expect(outline(contentEl)).toMatchSnapshot()
    expect(findUnstyledClasses(contentEl)).toEqual([])
  })

  it('closes without saving from Cancel and clears the shell class', () => {
    const { modal, contentEl, onSave } = openModal()

    findButtons(contentEl, 'Cancel')[0]?.click()

    expect(onSave).not.toHaveBeenCalled()
    expect(modal.modalEl.classList.contains('fitkit-set-note-modal-shell')).toBe(false)
    expect(contentEl.children).toHaveLength(0)
  })

  it('saves once when Save is pressed again while the close is still under way', () => {
    const { modal, contentEl, onSave } = openModal()
    vi.spyOn(modal, 'close').mockImplementation(() => {})

    const [save] = findButtons(contentEl, 'Save')
    save?.click()
    save?.click()

    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('unmounts its component when it closes', () => {
    const { modal } = openModal()
    const unmounts = watchUnmounts()
    try {
      modal.close()
    } finally {
      unmounts.stop()
    }

    expect(unmounts.names).toContain('TextAreaForm')
  })
})
