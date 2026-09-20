import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestRoot, installObsidianDomExtensions } from '../harness/obsidian-dom'

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

import { PlanStepModal } from '../../src/ui/plan-step-modal'

interface ModalElements {
  contentEl: HTMLElement
  titleEl: HTMLElement
}

function modalElements(modal: PlanStepModal): ModalElements {
  return modal
}

describe('plan step modal', () => {
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
})
