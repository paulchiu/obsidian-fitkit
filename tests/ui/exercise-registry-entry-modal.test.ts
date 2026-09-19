import { beforeEach, describe, expect, it, vi } from 'vitest'

const obsidianMock = vi.hoisted((): { notices: string[] } => ({ notices: [] }))

vi.mock('obsidian', () => {
  class Modal {
    contentEl = new TestElement('div')

    constructor(readonly app: unknown) {}

    setTitle(_title: string): this {
      return this
    }

    close(): void {}
  }

  class Notice {
    constructor(readonly message: string) {
      obsidianMock.notices.push(message)
    }
  }

  return { Modal, Notice }
})

import type { ExerciseRegistryEntry } from '../../src/domain/exercise-registry'
import type FitKitPlugin from '../../src/main'
import { ExerciseRegistryEntryModal } from '../../src/ui/exercise-registry-entry-modal'

/**
 * handleSave() reads only private draft fields (name, exerciseKind, weightUnit,
 * aliasesText), never DOM elements, so tests drive it directly without onOpen().
 */
type ModalPrivate = {
  aliasesText: string
  handleSave(): Promise<void>
}

type KindSelectPrivate = {
  kindSelect: TestElement
  exerciseKind: string
}

function openModalWithKind(kind: 'strength' | 'duration'): {
  modal: ExerciseRegistryEntryModal
  select: TestElement
} {
  const plugin = createPluginStub([])
  const modal = new ExerciseRegistryEntryModal(
    plugin,
    { kind: 'create', initial: { name: 'Plank', kind } },
    vi.fn(),
  )
  modal.onOpen()
  const select = (modal as unknown as KindSelectPrivate).kindSelect
  return { modal, select }
}

describe('ExerciseRegistryEntryModal kind select', () => {
  beforeEach(() => {
    obsidianMock.notices = []
  })

  it('lists strength then duration with their current labels', () => {
    const { select } = openModalWithKind('strength')

    expect(select.children.map((option) => option.value)).toEqual(['strength', 'duration'])
    expect(select.children.map((option) => option.textContent)).toEqual(['Strength', 'Duration'])
  })

  it('keeps the held kind when the select reports an unrecognised value', () => {
    const { modal, select } = openModalWithKind('duration')

    select.value = 'cardio'
    select.fire('change')

    expect((modal as unknown as KindSelectPrivate).exerciseKind).toBe('duration')
  })
})

function createPluginStub(registry: ExerciseRegistryEntry[]): FitKitPlugin {
  return {
    app: {},
    settings: { exerciseRegistry: registry },
    saveSettings: vi.fn(() => Promise.resolve()),
  } as unknown as FitKitPlugin
}

interface TestElementOptions {
  cls?: string
  text?: string
  type?: string
  value?: string
}

class TestElement {
  readonly children: TestElement[] = []
  readonly listeners = new Map<string, Array<() => void>>()
  checked = false
  disabled = false
  hidden = false
  rows = 0
  textContent = ''
  value = ''

  constructor(readonly tagName: string = 'div') {}

  createDiv(options: TestElementOptions = {}): TestElement {
    const child = new TestElement('div')
    this.adopt(child, options)
    return child
  }

  createEl(tagName: string, options: TestElementOptions = {}): TestElement {
    if (tagName === 'div') {
      return this.createDiv(options)
    }
    const child = new TestElement(tagName)
    this.adopt(child, options)
    return child
  }

  private adopt(child: TestElement, options: TestElementOptions): void {
    if (options.text !== undefined) {
      child.textContent = options.text
    }
    if (options.value !== undefined) {
      child.value = options.value
    }
    this.children.push(child)
  }

  addEventListener(type: string, listener: () => void): void {
    const current = this.listeners.get(type) ?? []
    this.listeners.set(type, [...current, listener])
  }

  addClass(_className: string): void {}

  empty(): void {
    this.children.length = 0
    this.textContent = ''
  }

  setText(text: string): void {
    this.textContent = text
  }

  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener()
    }
  }

  focus(): void {}
}

describe('ExerciseRegistryEntryModal create-mode prefill', () => {
  beforeEach(() => {
    obsidianMock.notices = []
  })

  it('prefills the history-only candidate name and kind so saving materializes it into the overlay', async () => {
    const plugin = createPluginStub([])
    const modal = new ExerciseRegistryEntryModal(
      plugin,
      { kind: 'create', initial: { name: 'New Plank', kind: 'duration' } },
      vi.fn(),
    )

    const modalPrivate = modal as unknown as ModalPrivate
    await modalPrivate.handleSave()

    expect(plugin.settings.exerciseRegistry).toHaveLength(1)
    expect(plugin.settings.exerciseRegistry[0]).toMatchObject({
      name: 'New Plank',
      kind: 'duration',
      aliases: [],
    })
  })
})

describe('ExerciseRegistryEntryModal unit preservation', () => {
  beforeEach(() => {
    obsidianMock.notices = []
  })

  it('keeps an unrecorded unit unrecorded when only an unrelated field is edited', async () => {
    const original: ExerciseRegistryEntry = { name: 'Bench Press', kind: 'strength', aliases: [] }
    const plugin = createPluginStub([original])
    const modal = new ExerciseRegistryEntryModal(plugin, { kind: 'edit', original }, vi.fn())

    const modalPrivate = modal as unknown as ModalPrivate
    modalPrivate.aliasesText = 'BP'
    await modalPrivate.handleSave()

    expect(plugin.settings.exerciseRegistry).toHaveLength(1)
    expect(plugin.settings.exerciseRegistry[0]).toMatchObject({
      name: 'Bench Press',
      aliases: ['BP'],
    })
    expect(plugin.settings.exerciseRegistry[0]?.unit).toBeUndefined()
  })

  it('still saves an explicit unit chosen through the modal', async () => {
    const original: ExerciseRegistryEntry = { name: 'Bench Press', kind: 'strength', aliases: [] }
    const plugin = createPluginStub([original])
    const modal = new ExerciseRegistryEntryModal(plugin, { kind: 'edit', original }, vi.fn())

    const modalPrivate = modal as unknown as ModalPrivate & {
      weightUnit: string
      unitTouched: boolean
    }
    modalPrivate.weightUnit = 'lbs'
    modalPrivate.unitTouched = true
    await modalPrivate.handleSave()

    expect(plugin.settings.exerciseRegistry[0]?.unit).toBe('lbs')
  })

  it('preserves an existing explicit unit when unrelated fields are edited', async () => {
    const original: ExerciseRegistryEntry = {
      name: 'Deadlift',
      kind: 'strength',
      unit: 'lbs',
      aliases: [],
    }
    const plugin = createPluginStub([original])
    const modal = new ExerciseRegistryEntryModal(plugin, { kind: 'edit', original }, vi.fn())

    const modalPrivate = modal as unknown as ModalPrivate
    modalPrivate.aliasesText = 'DL'
    await modalPrivate.handleSave()

    expect(plugin.settings.exerciseRegistry[0]?.unit).toBe('lbs')
  })
})
