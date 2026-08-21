import { beforeEach, describe, expect, it, vi } from 'vitest'

const obsidianMock = vi.hoisted((): { notices: string[] } => ({ notices: [] }))

vi.mock('obsidian', () => {
  class Modal {
    contentEl = new TestElement('div')

    constructor(readonly app: unknown) {}

    open(): void {}

    close(): void {}
  }

  class Notice {
    constructor(readonly message: string) {
      obsidianMock.notices.push(message)
    }
  }

  return { Modal, Notice }
})

vi.mock('../../src/vault/exercise-rename-apply', () => ({
  buildExerciseRenamePlanFromVault: vi.fn(),
  applyExerciseRenamePlan: vi.fn(),
}))

import type { ExerciseRenamePlan } from '../../src/domain/exercise-rename-planner'
import type FitKitPlugin from '../../src/main'
import {
  describeRenameApplyFailures,
  describeRenameApplySuccess,
  ExerciseRenameModal,
} from '../../src/ui/exercise-rename-modal'
import {
  applyExerciseRenamePlan,
  buildExerciseRenamePlanFromVault,
  type ExerciseRenameApplyResult,
} from '../../src/vault/exercise-rename-apply'

interface TestElementOptions {
  cls?: string
  text?: string
}

type TestListener = () => void

class TestElement {
  readonly attributes = new Map<string, string>()
  readonly children: TestElement[] = []
  readonly classes = new Set<string>()
  readonly listeners = new Map<string, TestListener[]>()
  disabled = false
  value = ''
  textContent = ''

  constructor(readonly tagName: string) {}

  createEl(tagName: string, options: TestElementOptions = {}): TestElement {
    const child = new TestElement(tagName)
    this.children.push(child)
    return this.applyOptions(child, options)
  }

  createSpan(options: TestElementOptions = {}): TestElement {
    return this.createEl('span', options)
  }

  createDiv(options: TestElementOptions = {}): TestElement {
    return this.createEl('div', options)
  }

  private applyOptions(child: TestElement, options: TestElementOptions): TestElement {
    if (options.cls) {
      for (const cls of options.cls.split(' ')) {
        if (cls) child.classes.add(cls)
      }
    }
    if (options.text !== undefined) {
      child.textContent = options.text
    }
    return child
  }

  addEventListener(type: string, listener: TestListener): void {
    const current = this.listeners.get(type) ?? []
    this.listeners.set(type, [...current, listener])
  }

  trigger(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener()
    }
  }

  addClass(name: string): void {
    this.classes.add(name)
  }

  setText(text: string): void {
    this.textContent = text
  }

  setAttr(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  focus(): void {}

  empty(): void {
    this.children.length = 0
    this.textContent = ''
  }
}

function collectText(element: TestElement): string[] {
  const own = element.textContent ? [element.textContent] : []
  return [...own, ...element.children.flatMap((child) => collectText(child))]
}

function findAll(root: TestElement, predicate: (el: TestElement) => boolean): TestElement[] {
  const matches: TestElement[] = []
  if (predicate(root)) {
    matches.push(root)
  }
  for (const child of root.children) {
    matches.push(...findAll(child, predicate))
  }
  return matches
}

function findButtons(root: TestElement, text: string): TestElement[] {
  return findAll(root, (el) => el.tagName === 'button' && el.textContent === text)
}

function basePlan(overrides: Partial<ExerciseRenamePlan> = {}): ExerciseRenamePlan {
  return {
    oldName: 'Row',
    newName: 'Barbell Row',
    operation: 'rename',
    refusal: null,
    sourceNotePath: 'Fitness/Exercises/Row.md',
    targetNotePath: 'Fitness/Exercises/Barbell Row.md',
    targetAlreadyExists: false,
    targetNoteExists: false,
    sourceTombstoned: false,
    targetTombstoned: false,
    losingNoteHasProse: false,
    aliasesToKeep: ['Row'],
    resultKind: 'strength',
    resultUnit: 'kg',
    workoutNotes: [
      {
        path: 'Fitness/Workouts/2026-05-08.md',
        headingOccurrences: 1,
        fieldOccurrences: 2,
        staleOccurrences: 0,
      },
    ],
    totalHeadingOccurrences: 1,
    totalFieldOccurrences: 2,
    totalStaleOccurrences: 0,
    ...overrides,
  }
}

function baseResult(overrides: Partial<ExerciseRenameApplyResult> = {}): ExerciseRenameApplyResult {
  return {
    operation: 'rename',
    noteRenamed: true,
    finalNotePath: 'Fitness/Exercises/Barbell Row.md',
    workoutNotesRewritten: 1,
    headingOccurrencesRewritten: 1,
    fieldOccurrencesRewritten: 2,
    proseCarried: false,
    loserNoteRemoved: false,
    tombstonesReconciled: 0,
    noteMigrationWarnings: [],
    touchedWorkoutPaths: [],
    failures: [],
    ...overrides,
  }
}

/**
 * Returned type deliberately keeps `saveSettings` as `Mock`, not the real
 * class method signature: asserting on a bound class method (`expect(plugin.saveSettings)...`)
 * trips `@typescript-eslint/unbound-method`. Cast to `FitKitPlugin` only at
 * the `ExerciseRenameModal` constructor call site, where it is passed rather
 * than asserted on.
 */
function createPluginStub() {
  return {
    app: {},
    settings: { exerciseRegistry: [], deletedExercises: [] },
    cachedIndex: null,
    saveSettings: vi.fn(() => Promise.resolve()),
    refreshIndexEntry: vi.fn(() => Promise.resolve()),
  }
}

type ModalPrivate = {
  contentEl: TestElement
  plan: ExerciseRenamePlan | null
  computePreview(): Promise<void>
  handleConfirm(): Promise<void>
}

describe('describeRenameApplyFailures', () => {
  it('names the failed stage and file and says earlier changes were saved', () => {
    const message = describeRenameApplyFailures([
      {
        path: 'Fitness/Workouts/2026-05-08.md',
        stage: 'workout-note-rewrite',
        message: 'Disk full',
      },
    ])

    expect(message).toContain('rewriting the workout note')
    expect(message).toContain('Fitness/Workouts/2026-05-08.md')
    expect(message).toContain('Disk full')
    expect(message).toContain('saved')
  })
})

describe('describeRenameApplySuccess', () => {
  it('reports the note rename path and the rewritten reference count', () => {
    const message = describeRenameApplySuccess(basePlan(), baseResult())

    expect(message).toContain("Renamed the note file to 'Fitness/Exercises/Barbell Row.md'.")
    expect(message).toContain('Updated 3 reference(s) across 1 workout note(s).')
  })

  it('states explicitly when zero workout notes needed updating', () => {
    const message = describeRenameApplySuccess(
      basePlan(),
      baseResult({
        headingOccurrencesRewritten: 0,
        fieldOccurrencesRewritten: 0,
        workoutNotesRewritten: 0,
      }),
    )

    expect(message).toContain('No workout notes needed updating.')
  })

  it('reports a merge that carried prose over and removed the losing note', () => {
    const message = describeRenameApplySuccess(
      basePlan({ operation: 'merge' }),
      baseResult({ loserNoteRemoved: true, proseCarried: true }),
    )

    expect(message).toContain("Merged 'Row' into 'Barbell Row', carrying its notes over")
  })

  it('reports a merge with nothing to carry over', () => {
    const message = describeRenameApplySuccess(
      basePlan({ operation: 'merge' }),
      baseResult({ loserNoteRemoved: true, proseCarried: false }),
    )

    expect(message).toContain('nothing to carry over')
  })

  it('surfaces note migration warnings so a customised query is not silently left stale', () => {
    const message = describeRenameApplySuccess(
      basePlan(),
      baseResult({
        noteMigrationWarnings: [{ kind: 'custom-notes-section' }],
      }),
    )

    expect(message).toContain('1 note section(s) look customised')
  })
})

describe('ExerciseRenameModal preview', () => {
  beforeEach(() => {
    obsidianMock.notices = []
    vi.mocked(buildExerciseRenamePlanFromVault).mockReset()
    vi.mocked(applyExerciseRenamePlan).mockReset()
  })

  it('shows the refusal message and no confirm action when the plan refuses', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(
      basePlan({
        operation: null,
        refusal: { reason: 'unchanged', message: 'New name is identical to the current name.' },
      }),
    )
    const modal = new ExerciseRenameModal(createPluginStub() as unknown as FitKitPlugin, {
      oldName: 'Row',
    })
    const modalPrivate = modal as unknown as ModalPrivate

    await modalPrivate.computePreview()

    const text = collectText(modalPrivate.contentEl)
    expect(text).toContain("Can't rename this exercise")
    expect(text).toContain('New name is identical to the current name.')
    expect(findButtons(modalPrivate.contentEl, 'Confirm rename')).toHaveLength(0)
  })

  it('states the note file rename with both paths, row counts, and the kept alias for a plain rename', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(basePlan())
    const modal = new ExerciseRenameModal(createPluginStub() as unknown as FitKitPlugin, {
      oldName: 'Row',
    })
    const modalPrivate = modal as unknown as ModalPrivate

    await modalPrivate.computePreview()

    const text = collectText(modalPrivate.contentEl)
    expect(text).toContain(
      "Rename: 'Fitness/Exercises/Row.md' → 'Fitness/Exercises/Barbell Row.md'.",
    )
    expect(text.some((line) => line.includes('Fitness/Workouts/2026-05-08.md'))).toBe(true)
    expect(text.some((line) => line.includes('3'))).toBe(true)
    expect(text).toContain(
      "'Row' will be kept as an alias of 'Barbell Row', so existing references still resolve.",
    )
    expect(text).toContain('No references will be left stale.')
    expect(findButtons(modalPrivate.contentEl, 'Confirm rename')).toHaveLength(1)
    expect(findButtons(modalPrivate.contentEl, 'Confirm merge')).toHaveLength(0)
  })

  it('warns plainly about stale pathed/aliased occurrences instead of silently dropping them', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(
      basePlan({
        totalStaleOccurrences: 2,
        workoutNotes: [
          {
            path: 'Fitness/Workouts/2026-05-08.md',
            headingOccurrences: 0,
            fieldOccurrences: 0,
            staleOccurrences: 2,
          },
        ],
      }),
    )
    const modal = new ExerciseRenameModal(createPluginStub() as unknown as FitKitPlugin, {
      oldName: 'Row',
    })
    const modalPrivate = modal as unknown as ModalPrivate

    await modalPrivate.computePreview()

    const text = collectText(modalPrivate.contentEl).join(' ')
    expect(text).toContain('2 reference(s) use a pathed or aliased wikilink')
    expect(text).toContain('will not be rewritten here')
  })

  it('names what happens to the losing note and its prose on a merge', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(
      basePlan({
        operation: 'merge',
        targetNoteExists: true,
        losingNoteHasProse: true,
        aliasesToKeep: ['Row', 'Rows'],
      }),
    )
    const modal = new ExerciseRenameModal(createPluginStub() as unknown as FitKitPlugin, {
      oldName: 'Row',
    })
    const modalPrivate = modal as unknown as ModalPrivate

    await modalPrivate.computePreview()

    const text = collectText(modalPrivate.contentEl).join(' ')
    expect(text).toContain(
      "'Fitness/Exercises/Row.md' will be removed after merging into 'Fitness/Exercises/Barbell Row.md'.",
    )
    expect(text).toContain("'Fitness/Exercises/Row.md' will be removed")
    expect(text).toContain('Its Notes section has text')
    expect(text).toContain('Merged from Row')
    expect(text).toContain('Other aliases carried over: Rows.')
    expect(findButtons(modalPrivate.contentEl, 'Confirm merge')).toHaveLength(1)
  })
})

describe('ExerciseRenameModal cancel', () => {
  beforeEach(() => {
    obsidianMock.notices = []
    vi.mocked(buildExerciseRenamePlanFromVault).mockReset()
    vi.mocked(applyExerciseRenamePlan).mockReset()
  })

  it('writes nothing when cancelled at the input stage', () => {
    const plugin = createPluginStub()
    const modal = new ExerciseRenameModal(plugin as unknown as FitKitPlugin, { oldName: 'Row' })
    const closeSpy = vi.spyOn(modal, 'close')
    modal.onOpen()
    const modalPrivate = modal as unknown as ModalPrivate

    const cancel = findButtons(modalPrivate.contentEl, 'Cancel')
    expect(cancel).toHaveLength(1)
    cancel[0]?.trigger('click')

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(buildExerciseRenamePlanFromVault).not.toHaveBeenCalled()
    expect(applyExerciseRenamePlan).not.toHaveBeenCalled()
    expect(plugin.saveSettings).not.toHaveBeenCalled()
  })

  it('writes nothing when cancelled at the preview stage', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(basePlan())
    const plugin = createPluginStub()
    const modal = new ExerciseRenameModal(plugin as unknown as FitKitPlugin, { oldName: 'Row' })
    const closeSpy = vi.spyOn(modal, 'close')
    const modalPrivate = modal as unknown as ModalPrivate

    await modalPrivate.computePreview()
    const cancel = findButtons(modalPrivate.contentEl, 'Cancel')
    expect(cancel).toHaveLength(1)
    cancel[0]?.trigger('click')

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(applyExerciseRenamePlan).not.toHaveBeenCalled()
    expect(plugin.saveSettings).not.toHaveBeenCalled()
  })
})

describe('ExerciseRenameModal confirm', () => {
  beforeEach(() => {
    obsidianMock.notices = []
    vi.mocked(buildExerciseRenamePlanFromVault).mockReset()
    vi.mocked(applyExerciseRenamePlan).mockReset()
  })

  it('applies, saves settings, refreshes the index for each touched note, notifies, and closes on full success', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(basePlan())
    vi.mocked(applyExerciseRenamePlan).mockResolvedValue(
      baseResult({
        touchedWorkoutPaths: ['Fitness/Workouts/2026-05-08.md', 'Fitness/Workouts/2026-05-09.md'],
      }),
    )
    const plugin = createPluginStub()
    const onApplied = vi.fn()
    const modal = new ExerciseRenameModal(plugin as unknown as FitKitPlugin, {
      oldName: 'Row',
      onApplied,
    })
    const closeSpy = vi.spyOn(modal, 'close')
    const modalPrivate = modal as unknown as ModalPrivate

    await modalPrivate.computePreview()
    await modalPrivate.handleConfirm()

    expect(plugin.saveSettings).toHaveBeenCalledTimes(1)
    /**
     * Routed through `refreshIndexEntry` (the plugin's own serialized queue),
     * not a raw `cachedIndex` assignment, so a concurrent refresh for an
     * unrelated note is never clobbered.
     */
    expect(plugin.refreshIndexEntry).toHaveBeenCalledTimes(2)
    expect(plugin.refreshIndexEntry).toHaveBeenNthCalledWith(1, 'Fitness/Workouts/2026-05-08.md')
    expect(plugin.refreshIndexEntry).toHaveBeenNthCalledWith(2, 'Fitness/Workouts/2026-05-09.md')
    expect(obsidianMock.notices).toHaveLength(1)
    expect(obsidianMock.notices[0]).toContain('Renamed the note file')
    expect(onApplied).toHaveBeenCalledTimes(1)
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps the modal open with a warning banner and a refreshed preview on partial failure', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(basePlan())
    vi.mocked(applyExerciseRenamePlan).mockResolvedValue(
      baseResult({
        failures: [
          {
            path: 'Fitness/Workouts/2026-05-08.md',
            stage: 'workout-note-rewrite',
            message: 'Disk full',
          },
        ],
      }),
    )
    const plugin = createPluginStub()
    const onApplied = vi.fn()
    const modal = new ExerciseRenameModal(plugin as unknown as FitKitPlugin, {
      oldName: 'Row',
      onApplied,
    })
    const closeSpy = vi.spyOn(modal, 'close')
    const modalPrivate = modal as unknown as ModalPrivate

    await modalPrivate.computePreview()
    await modalPrivate.handleConfirm()

    expect(closeSpy).not.toHaveBeenCalled()
    expect(onApplied).not.toHaveBeenCalled()
    expect(obsidianMock.notices).toHaveLength(0)
    const text = collectText(modalPrivate.contentEl).join(' ')
    expect(text).toContain('Rename only partly completed')
    expect(text).toContain('Disk full')
    /** The retry preview is recomputed from scratch, matching the engine's rescan design. */
    expect(vi.mocked(buildExerciseRenamePlanFromVault)).toHaveBeenCalledTimes(2)
  })

  it('shows a warning and keeps the modal open when applying throws outright', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(basePlan())
    vi.mocked(applyExerciseRenamePlan).mockRejectedValue(new Error('Vault write failed'))
    const plugin = createPluginStub()
    const modal = new ExerciseRenameModal(plugin as unknown as FitKitPlugin, { oldName: 'Row' })
    const closeSpy = vi.spyOn(modal, 'close')
    const modalPrivate = modal as unknown as ModalPrivate

    await modalPrivate.computePreview()
    await modalPrivate.handleConfirm()

    expect(closeSpy).not.toHaveBeenCalled()
    const text = collectText(modalPrivate.contentEl).join(' ')
    expect(text).toContain('Could not apply the rename')
    expect(text).toContain('Vault write failed')
  })
})
