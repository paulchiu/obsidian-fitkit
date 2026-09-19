import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', () => {
  class Modal {
    contentEl = new TestElement('div')

    titleEl = new TestElement('div')

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

interface TestElementOptions {
  cls?: string
  text?: string
  attr?: Record<string, string>
  value?: string
}

type TestListener = () => void

class TestElement {
  readonly attributes = new Map<string, string>()
  readonly children: TestElement[] = []
  readonly classes = new Set<string>()
  readonly dataset: Record<string, string> = {}
  readonly listeners = new Map<string, TestListener[]>()
  checked = false
  parent: TestElement | null = null
  textContent = ''
  value = ''

  constructor(readonly tagName: string) {}

  createEl(tagName: string, options: TestElementOptions = {}): TestElement {
    const child = new TestElement(tagName)
    child.parent = this
    if (options.cls) {
      child.addClasses(options.cls)
    }
    if (options.text !== undefined) {
      child.textContent = options.text
    }
    if (options.value !== undefined) {
      child.value = options.value
    }
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      child.setAttr(name, value)
    }
    this.children.push(child)
    return child
  }

  createSpan(options: TestElementOptions = {}): TestElement {
    return this.createEl('span', options)
  }

  createDiv(options: TestElementOptions = {}): TestElement {
    const child = new TestElement('div')
    child.parent = this
    if (options.cls) {
      child.addClasses(options.cls)
    }
    if (options.text !== undefined) {
      child.textContent = options.text
    }
    if (options.value !== undefined) {
      child.value = options.value
    }
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      child.setAttr(name, value)
    }
    this.children.push(child)
    return child
  }

  addClass(className: string): void {
    this.classes.add(className)
  }

  addEventListener(type: string, listener: TestListener): void {
    const current = this.listeners.get(type) ?? []
    this.listeners.set(type, [...current, listener])
  }

  addClasses(classNames: string): void {
    for (const className of classNames.split(' ')) {
      if (className) {
        this.classes.add(className)
      }
    }
  }

  empty(): void {
    this.children.length = 0
    this.textContent = ''
  }

  setAttr(name: string, value: string): void {
    this.attributes.set(name, value)
    if (name.startsWith('data-')) {
      this.dataset[name.slice('data-'.length)] = value
    }
  }

  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener()
    }
  }
}

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
  const actionCell = new TestElement('td')
  actionCell.dataset.label = 'Actions'
  const renderActionsCellContent = (
    modal as unknown as {
      renderActionsCellContent: (cell: HTMLElement, row: ExerciseImportPlanRow) => void
    }
  ).renderActionsCellContent.bind(modal)

  renderActionsCellContent(actionCell as unknown as HTMLElement, row)

  return collectText(actionCell)
}

function collectText(element: TestElement): string[] {
  const own = element.textContent ? [element.textContent] : []
  return [...own, ...element.children.flatMap((child) => collectText(child))]
}

function kindSelectForModal(modal: ImportExercisesModal): TestElement {
  const select = findByTag(modal.contentEl as unknown as TestElement, 'select')
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
    if (!findByTag(modal.contentEl as unknown as TestElement, 'select')) {
      throw new Error('Waiting for the modal rows to render.')
    }
  })
  return { modal, rows }
}

function findByTag(element: TestElement, tagName: string): TestElement | null {
  if (element.tagName === tagName) {
    return element
  }
  for (const child of element.children) {
    const found = findByTag(child, tagName)
    if (found) {
      return found
    }
  }
  return null
}

describe('ImportExercisesModal kind select', () => {
  it('lists strength then duration with their current labels', async () => {
    const { modal } = await openModalWithRows([row({ status: 'unknown', registryName: null })])
    const select = kindSelectForModal(modal)

    expect(select.children.map((option) => option.value)).toEqual(['strength', 'duration'])
    expect(select.children.map((option) => option.textContent)).toEqual(['Strength', 'Duration'])
  })

  it('keeps the row kind when the select reports an unrecognised value', async () => {
    const target = row({ kind: 'duration', status: 'unknown', registryName: null })
    const { modal } = await openModalWithRows([target])
    const select = kindSelectForModal(modal)

    select.value = 'cardio'
    select.fire('change')

    expect(target.kind).toBe('duration')
  })
})

describe('ImportExercisesModal actions', () => {
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
