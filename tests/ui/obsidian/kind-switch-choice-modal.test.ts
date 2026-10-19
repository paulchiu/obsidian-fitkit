import { afterEach, describe, expect, it, vi } from 'vitest'

import { outline } from '../../harness/outline'
import { createTestRoot, findButtons, harnessDocument } from '../../harness/obsidian-dom'
import { findUnstyledClasses } from '../../harness/stylesheet'
import type { KindSwitchChoiceModalOptions } from '../../../src/ui/obsidian/kind-switch-choice-modal'

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

import { KindSwitchChoiceModal } from '../../../src/ui/obsidian/kind-switch-choice-modal'

function openModal(overrides: Partial<KindSwitchChoiceModalOptions> = {}): {
  modal: KindSwitchChoiceModal
  contentEl: HTMLElement
  resolve: ReturnType<typeof vi.fn>
} {
  const resolve = vi.fn()
  const modal = new KindSwitchChoiceModal(
    {} as never,
    {
      exerciseName: 'Plank',
      currentType: 'strength',
      nextType: 'duration',
      clearsRows: true,
      registryType: 'strength',
      ...overrides,
    },
    resolve,
  )
  harnessDocument.body.appendChild(modal.contentEl)
  modal.onOpen()
  return { modal, contentEl: modal.contentEl, resolve }
}

describe('kind switch choice modal', () => {
  afterEach(() => {
    harnessDocument.body.replaceChildren()
  })

  it.each([
    ['clears rows and the registry differs', {}],
    ['keeps rows and the registry is missing', { clearsRows: false, registryType: null }],
    ['keeps rows and the registry already agrees', { clearsRows: false, registryType: 'duration' }],
  ] as const)('draws the explanation and choices when it %s', (_name, overrides) => {
    const { modal, contentEl } = openModal({ ...overrides })

    expect(modal.titleEl.textContent).toBe('Switch Plank to duration?')
    expect(outline(contentEl)).toMatchSnapshot()
    expect(findUnstyledClasses(contentEl)).toEqual([])
  })

  it.each([
    ['Cancel', 'cancel'],
    ['Just this workout', 'workout'],
    ['Update registry too', 'workout-and-registry'],
  ])('resolves %s as %s and closes', (label, choice) => {
    const { contentEl, resolve } = openModal()

    findButtons(contentEl, label)[0]?.click()

    expect(resolve).toHaveBeenCalledExactlyOnceWith(choice)
    expect(contentEl.children).toHaveLength(0)
  })

  it('resolves cancel when dismissed without a choice', () => {
    const { modal, contentEl, resolve } = openModal()

    modal.close()

    expect(resolve).toHaveBeenCalledExactlyOnceWith('cancel')
    expect(contentEl.children).toHaveLength(0)
  })
})
