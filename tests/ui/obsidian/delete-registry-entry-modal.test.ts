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

import { DeleteRegistryEntryModal } from '../../../src/ui/obsidian/delete-registry-entry-modal'

function openModal(notePath: string | null): {
  modal: DeleteRegistryEntryModal
  contentEl: HTMLElement
  resolve: ReturnType<typeof vi.fn>
} {
  const resolve = vi.fn()
  const modal = new DeleteRegistryEntryModal({} as never, { entryName: 'Plank', notePath }, resolve)
  harnessDocument.body.appendChild(modal.contentEl)
  modal.onOpen()
  return { modal, contentEl: modal.contentEl, resolve }
}

describe('delete registry entry modal', () => {
  afterEach(() => {
    harnessDocument.body.replaceChildren()
  })

  it.each([
    ['an exercise note', 'Exercises/Plank.md'],
    ['no exercise note', null],
  ])('draws the warning and actions for %s', (_name, notePath) => {
    const { modal, contentEl } = openModal(notePath)

    expect(modal.titleEl.textContent).toBe('Delete exercise?')
    expect(outline(contentEl)).toMatchSnapshot()
    expect(findUnstyledClasses(contentEl)).toEqual([])
  })

  it('deletes only the entry by default', () => {
    const { contentEl, resolve } = openModal('Exercises/Plank.md')

    findButtons(contentEl, 'Delete')[0]?.click()

    expect(resolve).toHaveBeenCalledExactlyOnceWith({ confirmed: true, alsoDeleteFile: false })
    expect(contentEl.children).toHaveLength(0)
  })

  it('also deletes the note when the box is ticked', () => {
    const { contentEl, resolve } = openModal('Exercises/Plank.md')

    contentEl.querySelector<HTMLInputElement>('input[type=checkbox]')?.click()
    findButtons(contentEl, 'Delete')[0]?.click()

    expect(resolve).toHaveBeenCalledExactlyOnceWith({ confirmed: true, alsoDeleteFile: true })
  })

  it('keeps the note when the box is ticked then unticked before Delete', () => {
    const { contentEl, resolve } = openModal('Exercises/Plank.md')

    const checkbox = contentEl.querySelector<HTMLInputElement>('input[type=checkbox]')
    checkbox?.click()
    checkbox?.click()
    findButtons(contentEl, 'Delete')[0]?.click()

    expect(resolve).toHaveBeenCalledExactlyOnceWith({ confirmed: true, alsoDeleteFile: false })
  })

  it('names the checkbox through its label', () => {
    const { contentEl } = openModal('Exercises/Plank.md')

    const checkbox = contentEl.querySelector('input')
    const label = contentEl.querySelector('label')
    expect(label?.getAttribute('for')).toBe(checkbox?.id)
  })

  it('never deletes the note when cancelled after ticking the box', () => {
    const { contentEl, resolve } = openModal('Exercises/Plank.md')

    contentEl.querySelector<HTMLInputElement>('input[type=checkbox]')?.click()
    findButtons(contentEl, 'Cancel')[0]?.click()

    expect(resolve).toHaveBeenCalledExactlyOnceWith({ confirmed: false, alsoDeleteFile: false })
  })

  it('declines when dismissed without a choice', () => {
    const { modal, contentEl, resolve } = openModal('Exercises/Plank.md')

    modal.close()

    expect(resolve).toHaveBeenCalledExactlyOnceWith({ confirmed: false, alsoDeleteFile: false })
    expect(contentEl.children).toHaveLength(0)
  })

  it('unmounts its component when it closes', () => {
    const { modal } = openModal('Exercises/Plank.md')
    const unmounts = watchUnmounts()
    try {
      modal.close()
    } finally {
      unmounts.stop()
    }

    expect(unmounts.names).toContain('DeleteRegistryEntryBody')
  })
})
