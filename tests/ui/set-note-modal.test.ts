import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createTestRoot,
  harnessDocument,
  installObsidianDomExtensions,
} from '../harness/obsidian-dom'

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

import { SetNoteModal } from '../../src/ui/set-note-modal'

interface ModalElements {
  contentEl: HTMLElement
  modalEl: HTMLElement
  titleEl: HTMLElement
}

function modalElements(modal: SetNoteModal): ModalElements {
  return modal
}

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
    installObsidianDomExtensions()
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
    const save = [...contentEl.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save',
    )
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
    const save = [...contentEl.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save',
    )
    if (!textarea || !save) {
      throw new Error('Expected textarea and Save button.')
    }

    textarea.value = '   '
    save.click()

    expect(onSave).toHaveBeenCalledWith(undefined)
  })
})
