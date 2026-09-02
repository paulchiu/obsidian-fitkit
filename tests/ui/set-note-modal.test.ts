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

  findByClass(cls: string): TestElement | null {
    if (this.classes.has(cls)) {
      return this
    }
    for (const child of this.children) {
      const found = child.findByClass(cls)
      if (found) {
        return found
      }
    }
    return null
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

import { SetNoteModal } from '../../src/ui/set-note-modal'

interface ModalElements {
  contentEl: TestElement
  modalEl: TestElement
  titleEl: TestElement
}

function modalElements(modal: SetNoteModal): ModalElements {
  return modal as unknown as ModalElements
}

describe('set note modal', () => {
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

  it('marks the modal and action row for keyboard-safe layout', () => {
    const modal = new SetNoteModal({} as never, {
      title: 'Note for set 2',
      initial: 'Set bar down twice',
      onSave: vi.fn(),
    })

    modal.onOpen()

    const { contentEl, modalEl } = modalElements(modal)
    expect(modalEl.classes.has('fitkit-set-note-modal-shell')).toBe(true)
    expect(contentEl.findByClass('fitkit-set-note-modal')).not.toBeNull()
    expect(contentEl.findByClass('fitkit-set-note-actions')).not.toBeNull()
    expect(contentEl.findByTag('textarea')?.focused).toBe(true)
  })

  it('names the modal through setTitle rather than a heading in the body', () => {
    const modal = new SetNoteModal({} as never, {
      title: 'Note for set 2',
      initial: '',
      onSave: vi.fn(),
    })

    modal.onOpen()

    const { contentEl, titleEl } = modalElements(modal)
    expect(titleEl.textContent).toBe('Note for set 2')
    expect(contentEl.findByTag('h2')).toBeNull()
  })

  it('saves non-empty note text and clears the modal shell class on close', () => {
    const onSave = vi.fn()
    const modal = new SetNoteModal({} as never, {
      title: 'Note for set 2',
      initial: '',
      onSave,
    })
    modal.onOpen()

    const { contentEl, modalEl } = modalElements(modal)
    const textarea = contentEl.findByTag('textarea')
    const save = contentEl.findButton('Save')
    if (!textarea || !save) {
      throw new Error('Expected textarea and Save button.')
    }

    textarea.value = 'Set bar down twice'
    save.click()

    expect(onSave).toHaveBeenCalledWith('Set bar down twice')
    expect(modalEl.classes.has('fitkit-set-note-modal-shell')).toBe(false)
    expect(contentEl.children).toHaveLength(0)
  })

  it('saves blank note text as undefined', () => {
    const onSave = vi.fn()
    const modal = new SetNoteModal({} as never, {
      title: 'Note for set 2',
      initial: '',
      onSave,
    })
    modal.onOpen()

    const { contentEl } = modalElements(modal)
    const textarea = contentEl.findByTag('textarea')
    const save = contentEl.findButton('Save')
    if (!textarea || !save) {
      throw new Error('Expected textarea and Save button.')
    }

    textarea.value = '   '
    save.click()

    expect(onSave).toHaveBeenCalledWith(undefined)
  })
})
