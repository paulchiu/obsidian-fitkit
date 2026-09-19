import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface TestElementOptions {
  cls?: string
  text?: string
  attr?: Record<string, string>
}

type TestListener = () => void

class TestElement {
  readonly attributes = new Map<string, string>()
  readonly children: TestElement[] = []
  readonly classes = new Set<string>()
  readonly listeners = new Map<string, TestListener[]>()
  focused = false
  textContent = ''
  value = ''

  constructor(readonly tagName: string) {}

  addClass(cls: string): void {
    this.addClasses(cls)
  }

  removeClass(cls: string): void {
    this.classes.delete(cls)
  }

  createDiv(options: TestElementOptions = {}): TestElement {
    return this.createEl('div', options)
  }

  createEl(tagName: string, options: TestElementOptions = {}): TestElement {
    const child = new TestElement(tagName)
    if (options.cls) {
      child.addClasses(options.cls)
    }
    if (options.text) {
      child.textContent = options.text
    }
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      child.attributes.set(name, value)
    }
    this.children.push(child)
    return child
  }

  addEventListener(type: string, listener: TestListener): void {
    const current = this.listeners.get(type) ?? []
    this.listeners.set(type, [...current, listener])
  }

  empty(): void {
    this.children.length = 0
    this.textContent = ''
  }

  focus(): void {
    this.focused = true
  }

  select(): void {}

  setAttr(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  findByTag(tagName: string): TestElement | null {
    if (this.tagName === tagName) {
      return this
    }
    for (const child of this.children) {
      const found = child.findByTag(tagName)
      if (found) {
        return found
      }
    }
    return null
  }

  private addClasses(cls: string): void {
    for (const entry of cls.split(/\s+/)) {
      if (entry.length > 0) {
        this.classes.add(entry)
      }
    }
  }
}

vi.mock('obsidian', () => {
  class Modal {
    contentEl = new TestElement('div')
    modalEl = new TestElement('div')

    titleEl = new TestElement('div')

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
  contentEl: TestElement
  titleEl: TestElement
}

function modalElements(modal: PlanStepModal): ModalElements {
  return modal as unknown as ModalElements
}

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
    expect(contentEl.findByTag('label')?.textContent).toBe('Rung change')
    expect(contentEl.findByTag('input')?.attributes.get('placeholder')).toBe('rungs')
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
    expect(contentEl.findByTag('label')?.textContent).toBe('Weight change')
    expect(contentEl.findByTag('input')?.attributes.get('placeholder')).toBe('kg')
  })
})
