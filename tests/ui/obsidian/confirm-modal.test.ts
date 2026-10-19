import { afterEach, describe, expect, it, vi } from 'vitest'

import { outline } from '../../harness/outline'
import { createTestRoot, findButtons, harnessDocument } from '../../harness/obsidian-dom'
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

import { ConfirmModal } from '../../../src/ui/obsidian/confirm-modal'

function openModal(): {
  modal: ConfirmModal
  contentEl: HTMLElement
  resolve: ReturnType<typeof vi.fn>
} {
  const resolve = vi.fn()
  const modal = new ConfirmModal(
    {} as never,
    {
      title: 'Delete set?',
      message: 'This cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Keep',
    },
    resolve,
  )
  harnessDocument.body.appendChild(modal.contentEl)
  modal.onOpen()
  return { modal, contentEl: modal.contentEl, resolve }
}

describe('confirm modal', () => {
  afterEach(() => {
    harnessDocument.body.replaceChildren()
  })

  it('draws the message and the two labelled buttons under the given title', () => {
    const { modal, contentEl } = openModal()

    expect(modal.titleEl.textContent).toBe('Delete set?')
    expect(outline(contentEl)).toMatchSnapshot()
    expect(findUnstyledClasses(contentEl)).toEqual([])
  })

  it('resolves true from the confirm button and closes', () => {
    const { contentEl, resolve } = openModal()

    findButtons(contentEl, 'Delete')[0]?.click()

    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith(true)
    expect(contentEl.children).toHaveLength(0)
  })

  it('resolves false from the cancel button', () => {
    const { contentEl, resolve } = openModal()

    findButtons(contentEl, 'Keep')[0]?.click()

    expect(resolve).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('resolves false when dismissed without a choice', () => {
    const { modal, contentEl, resolve } = openModal()

    modal.close()

    expect(resolve).toHaveBeenCalledExactlyOnceWith(false)
    expect(contentEl.children).toHaveLength(0)
  })

  it('unmounts its component when it closes', () => {
    const { modal } = openModal()
    const unmounts = watchUnmounts()
    try {
      modal.close()
    } finally {
      unmounts.stop()
    }

    expect(unmounts.names).toContain('ConfirmBody')
  })
})
