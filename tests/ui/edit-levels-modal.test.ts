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
    return this.appendChild('div', options)
  }

  createEl(tagName: string, options: TestElementOptions = {}): TestElement {
    return this.appendChild(tagName, options)
  }

  private appendChild(tagName: string, options: TestElementOptions): TestElement {
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

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) {
      listener()
    }
  }

  empty(): void {
    this.children.length = 0
    this.textContent = ''
  }

  focus(): void {
    this.focused = true
  }

  setSelectionRange(_start: number, _end: number): void {}

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

  findButton(text: string): TestElement | null {
    if (this.tagName === 'button' && this.textContent === text) {
      return this
    }
    for (const child of this.children) {
      const found = child.findButton(text)
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

const notices: string[] = []

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
  contentEl: TestElement
  onSave: ReturnType<typeof vi.fn>
} {
  const onSave = vi.fn()
  const modal = new EditLevelsModal({} as never, {
    exerciseName: 'Push-up',
    initial: options?.initial ?? ['Wall push-up', 'Knee push-up'],
    onSave: options?.onSave ?? onSave,
  })
  modal.onOpen()
  return { modal, contentEl: modal.contentEl as unknown as TestElement, onSave }
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
    vi.unstubAllGlobals()
  })

  it('prefills one rung per line and focuses the end of the text', () => {
    const { contentEl } = openModal()

    const textarea = contentEl.findByTag('textarea')
    expect(textarea?.value).toBe('Wall push-up\nKnee push-up')
    expect(textarea?.focused).toBe(true)
  })

  it('saves trimmed rungs with blanks dropped', () => {
    const { contentEl, onSave } = openModal()

    const textarea = contentEl.findByTag('textarea')
    const save = contentEl.findButton('Save')
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

    const textarea = contentEl.findByTag('textarea')
    const save = contentEl.findButton('Save')
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
