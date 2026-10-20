import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import {
  createTestRoot,
  findButtons,
  harnessDocument,
  harnessWindow,
} from '../../harness/obsidian-dom'
import { watchUnmounts } from '../../harness/unmount'
import { outline } from '../../harness/outline'
import { findUnstyledClasses } from '../../harness/stylesheet'

const obsidianMock = vi.hoisted((): { notices: string[] } => ({ notices: [] }))

vi.mock('obsidian', () => {
  class Modal {
    contentEl = createTestRoot()

    titleEl = createTestRoot()

    constructor(readonly app: unknown) {}

    setTitle(title: string): this {
      this.titleEl.textContent = title
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

import type { ExerciseRegistryEntry } from '../../../src/domain/exercise-registry'
import type FitKitPlugin from '../../../src/main'
import {
  ExerciseRegistryEntryModal,
  type RegistryEntryModalMode,
} from '../../../src/ui/obsidian/exercise-registry-entry-modal'

function openModalWithKind(kind: 'strength' | 'duration'): {
  modal: ExerciseRegistryEntryModal
  plugin: PluginStub
} {
  const plugin = createPluginStub([])
  const modal = new ExerciseRegistryEntryModal(
    plugin as unknown as FitKitPlugin,
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
  const [save] = findButtons(root, 'Save')
  if (!save) {
    throw new Error('Expected the modal to render a Save button.')
  }
  save.click()
}

/** Waits for the save the Save button started: it persists, notifies, then closes. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn++) {
    await Promise.resolve()
  }
}

function openModal(
  plugin: PluginStub,
  mode: RegistryEntryModalMode,
  onSaved = vi.fn(),
): ExerciseRegistryEntryModal {
  const modal = new ExerciseRegistryEntryModal(plugin as unknown as FitKitPlugin, mode, onSaved)
  modal.onOpen()
  return modal
}

function field(modal: ExerciseRegistryEntryModal, selector: string): HTMLElement {
  const found = modal.contentEl.querySelector<HTMLElement>(selector)
  if (!found) {
    throw new Error(`Expected ${selector}.`)
  }
  return found
}

function fire(el: HTMLElement, type: string): void {
  el.dispatchEvent(new harnessWindow.Event(type, { bubbles: true }))
}

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value
  fire(el, 'input')
}

function typeAliases(modal: ExerciseRegistryEntryModal, value: string): void {
  typeInto(field(modal, 'textarea') as HTMLTextAreaElement, value)
}

function pickUnit(modal: ExerciseRegistryEntryModal, unit: string): void {
  const select = modal.contentEl.querySelectorAll('select')[1]
  if (!select) {
    throw new Error('Expected the unit select.')
  }
  select.value = unit
  fire(select, 'change')
}

async function save(modal: ExerciseRegistryEntryModal): Promise<void> {
  saveIn(modal)
  await settle()
}

/** A plain stub, so `saveSettings` stays a mock and is not read as an unbound class method. */
interface PluginStub {
  app: object
  settings: { exerciseRegistry: ExerciseRegistryEntry[] }
  saveSettings: Mock<() => Promise<void>>
}

function createPluginStub(registry: ExerciseRegistryEntry[]): PluginStub {
  return {
    app: {},
    settings: { exerciseRegistry: registry },
    saveSettings: vi.fn(() => Promise.resolve()),
  }
}

describe('ExerciseRegistryEntryModal kind select', () => {
  beforeEach(() => {
    obsidianMock.notices = []
  })

  it('lists strength, duration, interval then bodyweight with their current labels', () => {
    const select = kindSelectIn(openModalWithKind('strength').modal)
    const options = [...select.querySelectorAll('option')]

    expect(options.map((option) => option.value)).toEqual([
      'strength',
      'duration',
      'interval',
      'bodyweight',
    ])
    expect(options.map((option) => option.textContent)).toEqual([
      'Strength',
      'Duration',
      'Interval',
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
    const modal = openModal(plugin, {
      kind: 'create',
      initial: { name: 'New Plank', kind: 'duration' },
    })

    await save(modal)

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
    const modal = openModal(plugin, { kind: 'edit', original })

    typeAliases(modal, 'BP')
    await save(modal)

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
    const modal = openModal(plugin, { kind: 'edit', original })

    pickUnit(modal, 'lbs')
    await save(modal)

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
    const modal = openModal(plugin, { kind: 'edit', original })

    typeAliases(modal, 'DL')
    await save(modal)

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
    const modal = openModal(plugin, { kind: 'edit', original })

    typeAliases(modal, 'Pushup')
    await save(modal)

    expect(plugin.settings.exerciseRegistry[0]?.levels).toEqual(['Wall push-up', 'Knee push-up'])
  })
})

describe('ExerciseRegistryEntryModal interval type', () => {
  it('saves Interval as duration with the interval marker', () => {
    const { modal, plugin } = openModalWithKind('duration')
    const select = kindSelectIn(modal)

    select.value = 'interval'
    select.dispatchEvent(new harnessWindow.Event('change'))
    saveIn(modal)

    expect(plugin.settings.exerciseRegistry[0]).toMatchObject({
      name: 'Plank',
      kind: 'duration',
      interval: true,
    })
  })

  it('shows an interval entry as Interval and keeps it through an alias edit', async () => {
    const original: ExerciseRegistryEntry = {
      name: 'Bike',
      kind: 'duration',
      interval: true,
      aliases: [],
    }
    const plugin = createPluginStub([original])
    const modal = openModal(plugin, { kind: 'edit', original })
    const shown = kindSelectIn(modal).value

    typeAliases(modal, 'Air bike')
    await save(modal)

    expect(shown).toBe('interval')
    expect(plugin.settings.exerciseRegistry[0]).toMatchObject({ kind: 'duration', interval: true })
  })
})

describe('ExerciseRegistryEntryModal form', () => {
  beforeEach(() => {
    obsidianMock.notices = []
  })

  it('draws an empty create form with Save held back by the missing name', () => {
    const modal = openModal(createPluginStub([]), { kind: 'create' })

    expect(modal.contentEl.classList.contains('fitkit-registry-entry-modal')).toBe(true)
    expect(outline(modal.contentEl)).toMatchSnapshot()
    expect(findUnstyledClasses(modal.contentEl)).toEqual([])
  })

  it('draws an edit form with the entry filled in', () => {
    const original: ExerciseRegistryEntry = {
      name: 'Bench Press',
      kind: 'strength',
      unit: 'lbs',
      aliases: ['BP', 'Bench'],
    }
    const modal = openModal(createPluginStub([original]), { kind: 'edit', original })

    expect(modal.titleEl.textContent).toBe('Edit registry entry')
    expect(outline(modal.contentEl)).toMatchSnapshot()
    expect(
      [...modal.contentEl.querySelectorAll('input, textarea, select')].map(
        (el) => (el as HTMLInputElement).value,
      ),
    ).toEqual(['Bench Press', 'strength', 'lbs', 'BP\nBench'])
  })

  it('names the title for a new entry', () => {
    const modal = openModal(createPluginStub([]), { kind: 'create' })

    expect(modal.titleEl.textContent).toBe('Add registry entry')
  })

  it('explains a name that is already taken and holds Save back', () => {
    const taken: ExerciseRegistryEntry = { name: 'Bench Press', kind: 'strength', aliases: [] }
    const modal = openModal(createPluginStub([taken]), { kind: 'create' })

    typeInto(field(modal, 'input') as HTMLInputElement, 'bench press')

    expect(outline(modal.contentEl)).toMatchSnapshot()
    expect(findButtons(modal.contentEl, 'Save')[0]?.disabled).toBe(true)
  })

  it('explains an alias that clashes with another entry', () => {
    const taken: ExerciseRegistryEntry = { name: 'Bench Press', kind: 'strength', aliases: [] }
    const modal = openModal(createPluginStub([taken]), { kind: 'create' })

    typeInto(field(modal, 'input') as HTMLInputElement, 'Floor Press')
    typeAliases(modal, 'Bench Press')

    expect(findButtons(modal.contentEl, 'Save')[0]?.disabled).toBe(true)
    expect(outline(modal.contentEl)).toMatchSnapshot()
  })

  it('allows Save once the name is valid', () => {
    const modal = openModal(createPluginStub([]), { kind: 'create' })

    typeInto(field(modal, 'input') as HTMLInputElement, 'Plank')

    expect(findButtons(modal.contentEl, 'Save')[0]?.disabled).toBe(false)
  })

  it('hides the unit for a duration entry and shows it again for strength', () => {
    const modal = openModal(createPluginStub([]), {
      kind: 'create',
      initial: { name: 'Plank', kind: 'strength' },
    })
    const unitField = (): HTMLElement | undefined =>
      modal.contentEl.querySelectorAll<HTMLElement>('.fitkit-registry-field')[2]
    const kind = kindSelectIn(modal)

    const initially = unitField()?.hasAttribute('hidden')
    kind.value = 'duration'
    fire(kind, 'change')
    const afterDuration = unitField()?.hasAttribute('hidden')
    kind.value = 'bodyweight'
    fire(kind, 'change')

    expect([initially, afterDuration, unitField()?.hasAttribute('hidden')]).toEqual([
      false,
      true,
      false,
    ])
  })

  it('warns that a changed unit reinterprets recorded weights, and drops it when put back', () => {
    const original: ExerciseRegistryEntry = {
      name: 'Bench Press',
      kind: 'strength',
      unit: 'kg',
      aliases: [],
    }
    const modal = openModal(createPluginStub([original]), { kind: 'edit', original })
    const warning = (): string | null | undefined =>
      modal.contentEl.querySelector('.fitkit-registry-field-warning')?.textContent

    const before = warning()
    pickUnit(modal, 'lbs')
    const changed = warning()
    pickUnit(modal, 'kg')

    expect([before, changed, warning()]).toEqual([
      '',
      'Weights and next-time steps already recorded stay as written. Update them yourself if they need converting.',
      '',
    ])
    expect(outline(modal.contentEl)).toMatchSnapshot()
  })

  it('reports the rename and kind change after saving an edit, then closes', async () => {
    const original: ExerciseRegistryEntry = { name: 'Bench', kind: 'strength', aliases: [] }
    const plugin = createPluginStub([original])
    const onSaved = vi.fn()
    const modal = openModal(plugin, { kind: 'edit', original }, onSaved)
    const closeSpy = vi.spyOn(modal, 'close')

    typeInto(field(modal, 'input') as HTMLInputElement, 'Bench Press')
    const kind = kindSelectIn(modal)
    kind.value = 'duration'
    fire(kind, 'change')
    await save(modal)

    expect(obsidianMock.notices).toHaveLength(2)
    expect(obsidianMock.notices[0]).toContain("Renamed 'Bench' → 'Bench Press'")
    expect(obsidianMock.notices[1]).toContain('Kind changed to duration')
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('refuses to save an entry removed elsewhere and closes', async () => {
    const original: ExerciseRegistryEntry = { name: 'Bench', kind: 'strength', aliases: [] }
    const plugin = createPluginStub([original])
    const onSaved = vi.fn()
    const modal = openModal(plugin, { kind: 'edit', original }, onSaved)
    const closeSpy = vi.spyOn(modal, 'close')
    plugin.settings.exerciseRegistry = []

    await save(modal)

    expect(obsidianMock.notices[0]).toContain('That entry was removed elsewhere')
    expect(plugin.saveSettings).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('shows the errors and holds Save back when the registry changed under the form', async () => {
    const plugin = createPluginStub([])
    const modal = openModal(plugin, { kind: 'create' })
    typeInto(field(modal, 'input') as HTMLInputElement, 'Plank')
    plugin.settings.exerciseRegistry = [{ name: 'plank', kind: 'strength', aliases: [] }]

    await save(modal)

    expect(plugin.saveSettings).not.toHaveBeenCalled()
    expect(findButtons(modal.contentEl, 'Save')[0]?.disabled).toBe(true)
    expect(modal.contentEl.querySelector('.fitkit-registry-field-error')?.textContent).not.toBe('')
  })

  it('closes from Cancel without saving', () => {
    const plugin = createPluginStub([])
    const modal = openModal(plugin, { kind: 'create' })
    const closeSpy = vi.spyOn(modal, 'close')

    findButtons(modal.contentEl, 'Cancel')[0]?.click()

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(plugin.saveSettings).not.toHaveBeenCalled()
  })
})

describe('ExerciseRegistryEntryModal redraws', () => {
  afterEach(() => {
    harnessDocument.body.replaceChildren()
  })

  it('leaves the text being typed, and its focus, alone while validation redraws', () => {
    const modal = new ExerciseRegistryEntryModal(
      createPluginStub([]) as unknown as FitKitPlugin,
      { kind: 'create' },
      vi.fn(),
    )
    harnessDocument.body.appendChild(modal.contentEl)
    modal.onOpen()
    const name = field(modal, 'input') as HTMLInputElement
    const aliases = field(modal, 'textarea') as HTMLTextAreaElement

    typeInto(name, 'Chin-up ')
    typeInto(aliases, 'Chin\n')

    expect(field(modal, 'input')).toBe(name)
    expect([name.value, aliases.value]).toEqual(['Chin-up ', 'Chin\n'])
    expect(harnessDocument.activeElement).toBe(name)
  })

  it('unmounts its component when it closes', () => {
    const modal = openModal(createPluginStub([]), { kind: 'create' })
    const unmounts = watchUnmounts()
    try {
      modal.onClose()
    } finally {
      unmounts.stop()
    }

    expect(unmounts.names).toContain('RegistryEntryForm')
    expect(modal.contentEl.children).toHaveLength(0)
  })
})
