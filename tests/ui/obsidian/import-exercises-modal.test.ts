import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestRoot, findButtons, harnessWindow } from '../../harness/obsidian-dom'
import { watchUnmounts } from '../../harness/unmount'
import { outline } from '../../harness/outline'
import { findUnstyledClasses } from '../../harness/stylesheet'

const obsidianMock = vi.hoisted((): { notices: string[] } => ({ notices: [] }))

vi.mock('obsidian', () => {
  class Modal {
    contentEl = createTestRoot()

    titleEl = createTestRoot()

    setTitle(title: string): this {
      this.titleEl.textContent = title
      return this
    }

    constructor(readonly app: unknown) {}

    open(): void {}

    close(): void {}
  }

  class Notice {
    constructor(readonly message: string) {
      obsidianMock.notices.push(message)
    }
  }

  return {
    Modal,
    Notice,
  }
})

vi.mock('../../../src/vault/exercise-import-planner', () => {
  class ExerciseImportApplyError extends Error {
    partialResult = { notesCreated: 0, notePathsCreated: [], settingsChanged: false }
    originalError: unknown
  }

  return {
    ExerciseImportApplyError,
    applyExerciseImportPlan: vi.fn(),
    buildExerciseImportPlan: vi.fn(),
  }
})

import {
  applyExerciseImportPlan,
  buildExerciseImportPlan,
} from '../../../src/vault/exercise-import-planner'
import type { ExerciseImportPlanRow } from '../../../src/vault/exercise-import-planner'
import { ImportExercisesModal } from '../../../src/ui/obsidian/import-exercises-modal'

function row(overrides: Partial<ExerciseImportPlanRow>): ExerciseImportPlanRow {
  return {
    name: 'Foam roll thigh',
    type: 'duration',
    unit: 'kg',
    status: 'known',
    registryName: 'Foam roll thigh',
    notePath: null,
    noteExists: false,
    tombstoned: false,
    createNote: false,
    createNoNoteEntry: false,
    restoreIgnored: false,
    sourcePaths: ['Fitness/Workouts/2026-05-07.md'],
    ...overrides,
  }
}

/** The action cell's text for `target`, read from the modal that lists it. */
async function actionCellText(target: ExerciseImportPlanRow): Promise<string[]> {
  const { modal } = await openModalWithRows([target])
  const cell = modal.contentEl.querySelector('td[data-label="Actions"]')
  if (!cell) {
    throw new Error('Expected an actions cell.')
  }
  return collectText(cell)
}

/** Direct text nodes per element, mirroring the old fake's own-text plus children walk. */
function collectText(element: Element): string[] {
  const own = [...element.childNodes]
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? '')
    .join('')
  const texts = own ? [own] : []
  return [...texts, ...[...element.children].flatMap((child) => collectText(child))]
}

function kindSelectForModal(modal: ImportExercisesModal): HTMLSelectElement {
  const select = modal.contentEl.querySelector('select')
  if (!select) {
    throw new Error('Expected the kind cell to render a select.')
  }
  return select
}

async function openModalWithRows(rows: ExerciseImportPlanRow[]): Promise<{
  modal: ImportExercisesModal
  rows: ExerciseImportPlanRow[]
}> {
  vi.mocked(buildExerciseImportPlan).mockResolvedValue({ rows })
  const modal = new ImportExercisesModal({ app: {} } as never, {})
  modal.onOpen()
  await vi.waitFor(() => {
    if (!modal.contentEl.querySelector('table')) {
      throw new Error('Waiting for the modal rows to render.')
    }
  })
  return { modal, rows }
}

describe('ImportExercisesModal kind select', () => {
  it('lists strength, duration, interval then bodyweight with their current labels', async () => {
    const { modal } = await openModalWithRows([row({ status: 'missing', registryName: null })])
    const select = kindSelectForModal(modal)
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

  it('keeps the row type when the select reports an unrecognised value', async () => {
    const target = row({ type: 'duration', status: 'missing', registryName: null })
    const { modal } = await openModalWithRows([target])
    const select = kindSelectForModal(modal)

    select.value = 'cardio'
    select.dispatchEvent(new harnessWindow.Event('change'))

    expect(target.type).toBe('duration')
  })
})

describe('ImportExercisesModal actions', () => {
  it('offers note creation for registry entries without exercise note files', async () => {
    const text = await actionCellText(row({ noteExists: false }))

    expect(text).toContain('Actions')
    expect(text).toContain('Create note')
    expect(text).not.toContain('No action')
  })

  it('shows no action for known exercises that already have note files', async () => {
    const text = await actionCellText(
      row({
        noteExists: true,
        notePath: 'Fitness/Exercises/Foam roll thigh.md',
      }),
    )

    expect(text).toContain('No action')
    expect(text).not.toContain('Create note')
  })
})

const checkbox = (modal: ImportExercisesModal, label: string): HTMLInputElement => {
  const found = [...modal.contentEl.querySelectorAll('label')].find(
    (el) => el.textContent === label,
  )
  const input = found?.querySelector('input')
  if (!input) {
    throw new Error(`Expected a ${label} checkbox.`)
  }
  return input
}

const tick = (input: HTMLInputElement, checked: boolean): void => {
  input.checked = checked
  input.dispatchEvent(new harnessWindow.Event('change', { bubbles: true }))
}

const labels = (modal: ImportExercisesModal): string[] =>
  [...modal.contentEl.querySelectorAll('label')].map((el) => el.textContent ?? '')

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn++) {
    await Promise.resolve()
  }
}

describe('ImportExercisesModal', () => {
  beforeEach(() => {
    obsidianMock.notices = []
    vi.mocked(buildExerciseImportPlan).mockReset()
    vi.mocked(applyExerciseImportPlan).mockReset()
  })

  it('shows the description and a loading line until the plan arrives', () => {
    vi.mocked(buildExerciseImportPlan).mockReturnValue(new Promise(() => {}))
    const modal = new ImportExercisesModal({ app: {} } as never, {})

    modal.onOpen()

    expect(modal.titleEl.textContent).toBe('Import exercises')
    expect(outline(modal.contentEl)).toMatchSnapshot()
  })

  it('takes its title and description from the options', () => {
    vi.mocked(buildExerciseImportPlan).mockReturnValue(new Promise(() => {}))
    const modal = new ImportExercisesModal({ app: {} } as never, {
      title: 'Restore',
      description: 'Pick some.',
    })

    modal.onOpen()

    expect(modal.titleEl.textContent).toBe('Restore')
    expect(modal.contentEl.querySelector('p')?.textContent).toBe('Pick some.')
  })

  it('lists every kind of row with its status cells and actions', async () => {
    const { modal } = await openModalWithRows([
      row({ name: 'Matched', type: 'strength' }),
      row({
        name: 'Fresh',
        status: 'missing',
        registryName: null,
        type: 'duration',
        noteExists: false,
      }),
      row({ name: 'Alias', registryName: 'Alias Full', noteExists: true }),
      row({
        name: 'Gone',
        status: 'ignored',
        registryName: null,
        tombstoned: true,
        type: 'bodyweight',
      }),
    ])

    expect(outline(modal.contentEl)).toMatchSnapshot()
    expect(findUnstyledClasses(modal.contentEl)).toEqual([])
  })

  it('offers Restore for an ignored exercise and reveals its choices when ticked', async () => {
    const { modal } = await openModalWithRows([
      row({ name: 'Gone', status: 'ignored', registryName: null, type: 'bodyweight' }),
    ])
    const before = labels(modal)

    tick(checkbox(modal, 'Restore'), true)

    expect([before, labels(modal)]).toEqual([
      ['Restore'],
      ['Restore', 'Create note', 'No-note entry'],
    ])
    expect(checkbox(modal, 'Restore').checked).toBe(true)
    expect(checkbox(modal, 'Create note').checked).toBe(true)
    expect(outline(modal.contentEl)).toMatchSnapshot()
  })

  it('swaps Create note and No-note entry so only one is chosen', async () => {
    const { modal } = await openModalWithRows([
      row({ name: 'Fresh', status: 'missing', registryName: null }),
    ])

    tick(checkbox(modal, 'Create note'), true)
    tick(checkbox(modal, 'No-note entry'), true)
    const afterEntry = [
      checkbox(modal, 'Create note').checked,
      checkbox(modal, 'No-note entry').checked,
    ]
    tick(checkbox(modal, 'Create note'), true)

    expect([
      afterEntry,
      [checkbox(modal, 'Create note').checked, checkbox(modal, 'No-note entry').checked],
    ]).toEqual([
      [false, true],
      [true, false],
    ])
  })

  it('clears the choices again when Restore is unticked', async () => {
    const { modal } = await openModalWithRows([
      row({ name: 'Gone', status: 'ignored', registryName: null }),
    ])
    tick(checkbox(modal, 'Restore'), true)

    tick(checkbox(modal, 'Restore'), false)

    expect(labels(modal)).toEqual(['Restore'])
  })

  it('applies the type picked in a row', async () => {
    vi.mocked(applyExerciseImportPlan).mockResolvedValue({
      notesCreated: 1,
      registryEntriesCreated: 0,
      tombstonesRemoved: 0,
      settingsChanged: false,
      notePathsCreated: [],
    })
    const { modal } = await openModalWithRows([
      row({ name: 'Fresh', status: 'missing', registryName: null, type: 'strength' }),
    ])
    const select = kindSelectForModal(modal)

    select.value = 'interval'
    select.dispatchEvent(new harnessWindow.Event('change'))
    tick(checkbox(modal, 'Create note'), true)
    findButtons(modal.contentEl, 'Apply')[0]?.click()
    await settle()

    const applied = vi.mocked(applyExerciseImportPlan).mock.calls[0]?.[2]
    expect(applied).toHaveLength(1)
    expect(applied?.[0]).toMatchObject({ name: 'Fresh', type: 'interval', createNote: true })
    expect(obsidianMock.notices[0]).toContain('Created 1 note file(s)')
  })

  it('says so when there are no exercises', async () => {
    vi.mocked(buildExerciseImportPlan).mockResolvedValue({ rows: [] })
    const modal = new ImportExercisesModal({ app: {} } as never, {})
    modal.onOpen()
    await settle()

    expect(outline(modal.contentEl)).toMatchSnapshot()
  })

  it('shows the load error with a Close button', async () => {
    vi.mocked(buildExerciseImportPlan).mockRejectedValue(new Error('Vault unreadable'))
    const modal = new ImportExercisesModal({ app: {} } as never, {})
    const closeSpy = vi.spyOn(modal, 'close')
    modal.onOpen()
    await settle()

    expect(outline(modal.contentEl)).toMatchSnapshot()
    findButtons(modal.contentEl, 'Close')[0]?.click()
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps the modal open with a warning when applying fails', async () => {
    vi.mocked(applyExerciseImportPlan).mockRejectedValue(new Error('Disk full'))
    const { modal } = await openModalWithRows([
      row({ name: 'Fresh', status: 'missing', registryName: null }),
    ])
    const closeSpy = vi.spyOn(modal, 'close')

    findButtons(modal.contentEl, 'Apply')[0]?.click()
    await settle()

    expect(closeSpy).not.toHaveBeenCalled()
    expect(outline(modal.contentEl)).toMatchSnapshot()
    expect(obsidianMock.notices[0]).toContain('Could not apply exercise import: Disk full.')
  })

  it('closes from Cancel without applying', async () => {
    const { modal } = await openModalWithRows([row({})])
    const closeSpy = vi.spyOn(modal, 'close')

    findButtons(modal.contentEl, 'Cancel')[0]?.click()

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(applyExerciseImportPlan).not.toHaveBeenCalled()
  })

  it('unmounts its component when it closes', async () => {
    const { modal } = await openModalWithRows([row({})])
    const unmounts = watchUnmounts()
    try {
      modal.onClose()
    } finally {
      unmounts.stop()
    }

    expect(unmounts.names).toContain('ImportExercisesBody')
    expect(modal.contentEl.children).toHaveLength(0)
  })

  it('draws nothing when the plan arrives after the modal closed', async () => {
    let arrive: (plan: { rows: ExerciseImportPlanRow[] }) => void = () => {}
    vi.mocked(buildExerciseImportPlan).mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve
      }),
    )
    const modal = new ImportExercisesModal({ app: {} } as never, {})
    modal.onOpen()
    modal.onClose()

    arrive({ rows: [row({})] })
    await settle()

    expect(modal.contentEl.children).toHaveLength(0)
  })

  it('clears both choices when Restore is unticked, so retick starts from a note again', async () => {
    const { modal } = await openModalWithRows([
      row({ name: 'Gone', status: 'ignored', registryName: null }),
    ])
    tick(checkbox(modal, 'Restore'), true)
    tick(checkbox(modal, 'No-note entry'), true)

    tick(checkbox(modal, 'Restore'), false)
    tick(checkbox(modal, 'Restore'), true)

    expect([
      checkbox(modal, 'Create note').checked,
      checkbox(modal, 'No-note entry').checked,
    ]).toEqual([true, false])
  })

  it('draws again when reopened after closing', async () => {
    const { modal } = await openModalWithRows([row({})])
    modal.onClose()

    modal.onOpen()
    await settle()

    expect(modal.contentEl.querySelector('table')).not.toBeNull()
  })
})
