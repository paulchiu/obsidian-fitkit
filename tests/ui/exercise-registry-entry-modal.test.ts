import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createTestRoot,
  harnessWindow,
  installObsidianDomExtensions,
} from '../harness/obsidian-dom'

const obsidianMock = vi.hoisted((): { notices: string[] } => ({ notices: [] }))

vi.mock('obsidian', () => {
  class Modal {
    contentEl = createTestRoot()

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

function openModalWithKind(kind: 'strength' | 'duration'): {
  modal: ExerciseRegistryEntryModal
  plugin: FitKitPlugin
} {
  const plugin = createPluginStub([])
  const modal = new ExerciseRegistryEntryModal(
    plugin,
    { kind: 'create', initial: { name: 'Plank', kind } },
    vi.fn(),
  )
  modal.onOpen()
  return { modal, plugin }
}

/** The kind select is the first select the modal renders; the second is the unit select. */
function kindSelectIn(modal: ExerciseRegistryEntryModal): HTMLSelectElement {
  const root = modal.contentEl
  const select = root.querySelectorAll('select')[0]
  if (!select) {
    throw new Error('Expected the modal to render a kind select.')
  }
  return select
}

function saveIn(modal: ExerciseRegistryEntryModal): void {
  const root = modal.contentEl
  const save = [...root.querySelectorAll('button')].find((button) => button.textContent === 'Save')
  if (!save) {
    throw new Error('Expected the modal to render a Save button.')
  }
  save.click()
}

function createPluginStub(registry: ExerciseRegistryEntry[]): FitKitPlugin {
  return {
    app: {},
    settings: { exerciseRegistry: registry },
    saveSettings: vi.fn(() => Promise.resolve()),
  } as unknown as FitKitPlugin
}

describe('ExerciseRegistryEntryModal kind select', () => {
  beforeEach(() => {
    installObsidianDomExtensions()
    obsidianMock.notices = []
  })

  it('lists strength, duration then bodyweight with their current labels', () => {
    const select = kindSelectIn(openModalWithKind('strength').modal)
    const options = [...select.querySelectorAll('option')]

    expect(options.map((option) => option.value)).toEqual(['strength', 'duration', 'bodyweight'])
    expect(options.map((option) => option.textContent)).toEqual([
      'Strength',
      'Duration',
      'Bodyweight',
    ])
  })

  it('keeps the held kind when the select reports an unrecognised value', () => {
    const { modal, plugin } = openModalWithKind('duration')
    const select = kindSelectIn(modal)

    select.value = 'cardio'
    select.dispatchEvent(new harnessWindow.Event('change'))
    saveIn(modal)

    expect(plugin.settings.exerciseRegistry[0]).toMatchObject({
      name: 'Plank',
      kind: 'duration',
    })
  })
})

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

  it('keeps the ladder when an edit changes only the aliases', async () => {
    const original: ExerciseRegistryEntry = {
      name: 'Push-up',
      kind: 'bodyweight',
      levels: ['Wall push-up', 'Knee push-up'],
      aliases: [],
    }
    const plugin = createPluginStub([original])
    const modal = new ExerciseRegistryEntryModal(plugin, { kind: 'edit', original }, vi.fn())

    const modalPrivate = modal as unknown as ModalPrivate
    modalPrivate.aliasesText = 'Pushup'
    await modalPrivate.handleSave()

    expect(plugin.settings.exerciseRegistry[0]?.levels).toEqual(['Wall push-up', 'Knee push-up'])
  })
})
