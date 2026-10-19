import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createTestRoot,
  findButtons,
  harnessDocument,
  modalElements,
} from '../../harness/obsidian-dom'
import { outline } from '../../harness/outline'
import { findUnstyledClasses } from '../../harness/stylesheet'
import { watchUnmounts } from '../../harness/unmount'

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

import { SetNoteModal } from '../../../src/ui/obsidian/set-note-modal'

/** The stubbed `window.setTimeout` queues here so a test can see what waits for the next tick. */
const timers: (() => void)[] = []
const flushTimers = (): void => timers.splice(0).forEach((run) => run())

/** Focus only lands when the element is connected, so each modal renders attached. */
function openModal(options: {
  title: string
  initial: string
  onSave: (next: string | undefined) => void
}): SetNoteModal {
  const modal = new SetNoteModal({} as never, options)
  const { contentEl } = modalElements(modal)
  harnessDocument.body.appendChild(contentEl)
  modal.onOpen()
  return modal
}

describe('set note modal', () => {
  beforeEach(() => {
    timers.length = 0
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void): number => timers.push(callback),
    })
  })

  afterEach(() => {
    harnessDocument.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('marks the modal and action row for keyboard-safe layout', () => {
    const modal = openModal({
      title: 'Note for set 2',
      initial: 'Set bar down twice',
      onSave: vi.fn(),
    })

    const { contentEl, modalEl } = modalElements(modal)
    expect(modalEl.classList.contains('fitkit-set-note-modal-shell')).toBe(true)
    expect(contentEl.classList.contains('fitkit-set-note-modal')).toBe(true)
    expect(contentEl.querySelector('.fitkit-set-note-actions')).not.toBeNull()
    flushTimers()
    expect(harnessDocument.activeElement).toBe(contentEl.querySelector('textarea'))
  })

  it('names the modal through setTitle rather than a heading in the body', () => {
    const modal = openModal({ title: 'Note for set 2', initial: '', onSave: vi.fn() })

    const { contentEl, titleEl } = modalElements(modal)
    expect(titleEl.textContent).toBe('Note for set 2')
    expect(contentEl.querySelector('h2')).toBeNull()
  })

  it('saves non-empty note text and clears the modal shell class on close', () => {
    const onSave = vi.fn()
    const modal = openModal({ title: 'Note for set 2', initial: '', onSave })

    const { contentEl, modalEl } = modalElements(modal)
    const textarea = contentEl.querySelector('textarea')
    const [save] = findButtons(contentEl, 'Save')
    if (!textarea || !save) {
      throw new Error('Expected textarea and Save button.')
    }

    textarea.value = 'Set bar down twice'
    save.click()

    expect(onSave).toHaveBeenCalledWith('Set bar down twice')
    expect(modalEl.classList.contains('fitkit-set-note-modal-shell')).toBe(false)
    expect(contentEl.children).toHaveLength(0)
  })

  it('saves blank note text as undefined', () => {
    const onSave = vi.fn()
    const modal = openModal({ title: 'Note for set 2', initial: '', onSave })

    const { contentEl } = modalElements(modal)
    const textarea = contentEl.querySelector('textarea')
    const [save] = findButtons(contentEl, 'Save')
    if (!textarea || !save) {
      throw new Error('Expected textarea and Save button.')
    }

    textarea.value = '   '
    save.click()

    expect(onSave).toHaveBeenCalledWith(undefined)
  })

  it('draws the labelled text box and action row', () => {
    const modal = openModal({ title: 'Note for set 2', initial: 'Set bar down', onSave: vi.fn() })

    const { contentEl } = modalElements(modal)
    expect(outline(contentEl)).toMatchSnapshot()
    expect(findUnstyledClasses(contentEl)).toEqual([])
  })

  it('prefills the note, then on the next tick focuses it with the caret at the end', () => {
    const modal = openModal({ title: 'Note for set 2', initial: 'Set bar down', onSave: vi.fn() })

    const textarea = modalElements(modal).contentEl.querySelector('textarea')
    if (!textarea) {
      throw new Error('Expected a textarea.')
    }
    textarea.setSelectionRange(0, 0)
    expect(textarea.value).toBe('Set bar down')
    expect(harnessDocument.activeElement).not.toBe(textarea)

    flushTimers()

    expect(harnessDocument.activeElement).toBe(textarea)
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([12, 12])
  })

  it('keeps the whitespace around a note it saves', () => {
    const onSave = vi.fn()
    const modal = openModal({ title: 'Note for set 2', initial: '', onSave })

    const { contentEl } = modalElements(modal)
    const textarea = contentEl.querySelector('textarea')
    if (!textarea) {
      throw new Error('Expected a textarea.')
    }
    textarea.value = '  Set bar down \n'
    findButtons(contentEl, 'Save')[0]?.click()

    expect(onSave).toHaveBeenCalledExactlyOnceWith('  Set bar down \n')
  })

  it('saves whitespace with line breaks as no note', () => {
    const onSave = vi.fn()
    const modal = openModal({ title: 'Note for set 2', initial: 'x', onSave })

    const { contentEl } = modalElements(modal)
    const textarea = contentEl.querySelector('textarea')
    if (!textarea) {
      throw new Error('Expected a textarea.')
    }
    textarea.value = ' \n\t\n '
    findButtons(contentEl, 'Save')[0]?.click()

    expect(onSave).toHaveBeenCalledExactlyOnceWith(undefined)
  })

  it('closes without saving from Cancel', () => {
    const onSave = vi.fn()
    const modal = openModal({ title: 'Note for set 2', initial: 'x', onSave })

    const { contentEl, modalEl } = modalElements(modal)
    findButtons(contentEl, 'Cancel')[0]?.click()

    expect(onSave).not.toHaveBeenCalled()
    expect(modalEl.classList.contains('fitkit-set-note-modal-shell')).toBe(false)
    expect(contentEl.children).toHaveLength(0)
  })

  it('saves once when Save is pressed again while the close is still under way', () => {
    const onSave = vi.fn()
    const modal = openModal({ title: 'Note for set 2', initial: 'x', onSave })
    vi.spyOn(modal, 'close').mockImplementation(() => {})

    const [save] = findButtons(modalElements(modal).contentEl, 'Save')
    save?.click()
    save?.click()

    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('unmounts its component when it closes', () => {
    const modal = openModal({ title: 'Note', initial: 'x', onSave: vi.fn() })
    const unmounts = watchUnmounts()
    try {
      modal.close()
    } finally {
      unmounts.stop()
    }

    expect(unmounts.names).toContain('TextAreaForm')
  })
})
