import { beforeEach, describe, expect, it, vi } from 'vitest'

const obsidianMock = vi.hoisted((): { notices: string[] } => ({ notices: [] }))

vi.mock('obsidian', () => {
  class Modal {
    constructor(readonly app: unknown) {}

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

function createPluginStub(registry: ExerciseRegistryEntry[]): FitKitPlugin {
  return {
    app: {},
    settings: { exerciseRegistry: registry },
    saveSettings: vi.fn(() => Promise.resolve()),
  } as unknown as FitKitPlugin
}

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
