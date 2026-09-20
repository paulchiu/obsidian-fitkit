import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createTestRoot,
  harnessDocument,
  harnessWindow,
  installObsidianDomExtensions,
} from '../harness/obsidian-dom'

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
    constructor(readonly message: string) {}
  }

  return {
    Modal,
    Notice,
  }
})

vi.mock('../../src/vault/exercise-import-planner', () => {
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

import { buildExerciseImportPlan } from '../../src/vault/exercise-import-planner'
import type { ExerciseImportPlanRow } from '../../src/vault/exercise-import-planner'
import { ImportExercisesModal } from '../../src/ui/import-exercises-modal'

function row(overrides: Partial<ExerciseImportPlanRow>): ExerciseImportPlanRow {
  return {
    name: 'Foam roll thigh',
    kind: 'duration',
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

function actionCellText(row: ExerciseImportPlanRow): string[] {
  const modal = new ImportExercisesModal({ app: {} } as never, {})
  const actionCell = harnessDocument.createElement('td')
  actionCell.dataset.label = 'Actions'
  const renderActionsCellContent = (
    modal as unknown as {
      renderActionsCellContent: (cell: HTMLElement, row: ExerciseImportPlanRow) => void
    }
  ).renderActionsCellContent.bind(modal)

  renderActionsCellContent(actionCell, row)

  return collectText(actionCell)
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
    if (!modal.contentEl.querySelector('select')) {
      throw new Error('Waiting for the modal rows to render.')
    }
  })
  return { modal, rows }
}

describe('ImportExercisesModal kind select', () => {
  beforeEach(() => {
    installObsidianDomExtensions()
  })

  it('lists strength, duration then bodyweight with their current labels', async () => {
    const { modal } = await openModalWithRows([row({ status: 'unknown', registryName: null })])
    const select = kindSelectForModal(modal)
    const options = [...select.querySelectorAll('option')]

    expect(options.map((option) => option.value)).toEqual(['strength', 'duration', 'bodyweight'])
    expect(options.map((option) => option.textContent)).toEqual([
      'Strength',
      'Duration',
      'Bodyweight',
    ])
  })

  it('keeps the row kind when the select reports an unrecognised value', async () => {
    const target = row({ kind: 'duration', status: 'unknown', registryName: null })
    const { modal } = await openModalWithRows([target])
    const select = kindSelectForModal(modal)

    select.value = 'cardio'
    select.dispatchEvent(new harnessWindow.Event('change'))

    expect(target.kind).toBe('duration')
  })
})

describe('ImportExercisesModal actions', () => {
  beforeEach(() => {
    installObsidianDomExtensions()
  })

  it('offers note creation for registry entries without exercise note files', () => {
    const text = actionCellText(row({ noteExists: false }))

    expect(text).toContain('Actions')
    expect(text).toContain('Create note')
    expect(text).not.toContain('No action')
  })

  it('shows no action for known exercises that already have note files', () => {
    const text = actionCellText(
      row({
        noteExists: true,
        notePath: 'Fitness/Exercises/Foam roll thigh.md',
      }),
    )

    expect(text).toContain('No action')
    expect(text).not.toContain('Create note')
  })
})
