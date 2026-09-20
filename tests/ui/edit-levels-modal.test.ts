import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestRoot, findButtons, harnessDocument } from '../harness/obsidian-dom'

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

import { EditLevelsModal } from '../../src/ui/edit-levels-modal'

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

  it('prefills one rung per line and focuses the end of the text', () => {
    const { contentEl } = openModal()

    const textarea = contentEl.querySelector('textarea')
    expect(textarea?.value).toBe('Wall push-up\nKnee push-up')
    expect(harnessDocument.activeElement).toBe(textarea)
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
})
