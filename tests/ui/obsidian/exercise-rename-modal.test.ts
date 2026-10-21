import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  return { Modal, Notice }
})

vi.mock('../../../src/vault/exercise-rename-apply', () => ({
  buildExerciseRenamePlanFromVault: vi.fn(),
  applyExerciseRenamePlan: vi.fn(),
}))

import type { ExerciseRenamePlan } from '../../../src/domain/exercise-rename-planner'
import type FitKitPlugin from '../../../src/main'
import {
  describeRenameApplyFailures,
  describeRenameApplySuccess,
  ExerciseRenameModal,
} from '../../../src/ui/obsidian/exercise-rename-modal'
import {
  applyExerciseRenamePlan,
  buildExerciseRenamePlanFromVault,
  type ExerciseRenameApplyResult,
} from '../../../src/vault/exercise-rename-apply'

/** Direct text nodes per element, mirroring the old fake's own-text plus children walk. */
function collectText(element: Element): string[] {
  const own = [...element.childNodes]
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? '')
    .join('')
  const texts = own ? [own] : []
  return [...texts, ...[...element.children].flatMap((child) => collectText(child))]
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
 * Keeps `saveSettings` typed as `Mock` so asserting on it avoids `@typescript-eslint/unbound-method`.
 * Cast to `FitKitPlugin` only where the modal constructor receives it.
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

const nameInput = (modal: ExerciseRenameModal): HTMLInputElement => {
  const input = modal.contentEl.querySelector('input')
  if (!input) {
    throw new Error('Expected the name input.')
  }
  return input
}

const typeName = (modal: ExerciseRenameModal, value: string): void => {
  const input = nameInput(modal)
  input.value = value
  input.dispatchEvent(new harnessWindow.Event('input', { bubbles: true }))
}

/** Lets the awaited vault mocks settle and the modal redraw after the click that started them. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn++) {
    await Promise.resolve()
  }
}

/** Opens the modal, types nothing, and walks the Preview changes button to the preview stage. */
async function openPreview(
  plugin: ReturnType<typeof createPluginStub>,
  options: { oldName?: string; onApplied?: () => void } = {},
): Promise<ExerciseRenameModal> {
  const modal = new ExerciseRenameModal(plugin as unknown as FitKitPlugin, {
    oldName: 'Row',
    ...options,
  })
  modal.onOpen()
  findButtons(modal.contentEl, 'Preview changes')[0]?.click()
  await settle()
  return modal
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

    const modal = await openPreview(createPluginStub())

    const text = collectText(modal.contentEl)
    expect(text).toContain("Can't rename this exercise")
    expect(text).toContain('New name is identical to the current name.')
    expect(findButtons(modal.contentEl, 'Confirm rename')).toHaveLength(0)
    expect(outline(modal.contentEl)).toMatchSnapshot()
    expect(findUnstyledClasses(modal.contentEl)).toEqual([])
  })

  it('states the note file rename with both paths, row counts, and the kept alias for a plain rename', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(basePlan())

    const modal = await openPreview(createPluginStub())

    const text = collectText(modal.contentEl)
    expect(text).toContain(
      "Rename: 'Fitness/Exercises/Row.md' → 'Fitness/Exercises/Barbell Row.md'.",
    )
    expect(text.some((line) => line.includes('Fitness/Workouts/2026-05-08.md'))).toBe(true)
    expect(text.some((line) => line.includes('3'))).toBe(true)
    expect(text).toContain(
      "'Row' will be kept as an alias of 'Barbell Row', so existing references still resolve.",
    )
    expect(text).toContain('No references will be left stale.')
    expect(findButtons(modal.contentEl, 'Confirm rename')).toHaveLength(1)
    expect(findButtons(modal.contentEl, 'Confirm merge')).toHaveLength(0)
    expect(outline(modal.contentEl)).toMatchSnapshot()
    expect(findUnstyledClasses(modal.contentEl)).toEqual([])
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

    const modal = await openPreview(createPluginStub())

    const text = collectText(modal.contentEl).join(' ')
    expect(text).toContain('2 reference(s) use a pathed or aliased wikilink')
    expect(text).toContain('will not be rewritten here')
    expect(outline(modal.contentEl)).toMatchSnapshot()
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

    const modal = await openPreview(createPluginStub())

    const text = collectText(modal.contentEl).join(' ')
    expect(text).toContain(
      "'Fitness/Exercises/Row.md' will be removed after merging into 'Fitness/Exercises/Barbell Row.md'.",
    )
    expect(text).toContain("'Fitness/Exercises/Row.md' will be removed")
    expect(text).toContain('Its Notes section has text')
    expect(text).toContain('Merged from Row')
    expect(text).toContain('Other aliases carried over: Rows.')
    expect(findButtons(modal.contentEl, 'Confirm merge')).toHaveLength(1)
    expect(outline(modal.contentEl)).toMatchSnapshot()
  })

  it('shows the rename with no note file and no workout notes', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(
      basePlan({
        sourceNotePath: null,
        targetNotePath: null,
        workoutNotes: [],
        totalHeadingOccurrences: 0,
        totalFieldOccurrences: 0,
        aliasesToKeep: ['Row', 'Rows'],
      }),
    )

    const modal = await openPreview(createPluginStub())

    expect(outline(modal.contentEl)).toMatchSnapshot()
  })

  it('goes back to the input stage with the name that was typed', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(basePlan())
    const modal = new ExerciseRenameModal(createPluginStub() as unknown as FitKitPlugin, {
      oldName: 'Row',
    })
    modal.onOpen()
    typeName(modal, 'Barbell Row')
    findButtons(modal.contentEl, 'Preview changes')[0]?.click()
    await settle()

    findButtons(modal.contentEl, 'Back')[0]?.click()

    expect(nameInput(modal).value).toBe('Barbell Row')
    expect(vi.mocked(buildExerciseRenamePlanFromVault).mock.calls[0]?.[3]).toBe('Barbell Row')
  })

  it('goes back from a refusal to the input stage', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(
      basePlan({ operation: null, refusal: { reason: 'unchanged', message: 'Same name.' } }),
    )
    const modal = await openPreview(createPluginStub())

    findButtons(modal.contentEl, 'Back')[0]?.click()

    expect(nameInput(modal).value).toBe('Row')
  })
})

describe('ExerciseRenameModal input stage', () => {
  beforeEach(() => {
    obsidianMock.notices = []
    vi.mocked(buildExerciseRenamePlanFromVault).mockReset()
    vi.mocked(applyExerciseRenamePlan).mockReset()
  })

  it('draws the explanation, the name field and the actions', () => {
    const modal = new ExerciseRenameModal(createPluginStub() as unknown as FitKitPlugin, {
      oldName: 'Row',
    })

    modal.onOpen()

    expect(outline(modal.contentEl)).toMatchSnapshot()
    expect(findUnstyledClasses(modal.contentEl)).toEqual([])
  })

  it('starts the field on the old name', () => {
    const modal = new ExerciseRenameModal(createPluginStub() as unknown as FitKitPlugin, {
      oldName: 'Row',
    })

    modal.onOpen()

    expect(nameInput(modal).value).toBe('Row')
  })

  it('checks the vault with the typed name', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(basePlan())
    const plugin = createPluginStub()
    const modal = new ExerciseRenameModal(plugin as unknown as FitKitPlugin, { oldName: 'Row' })
    modal.onOpen()

    typeName(modal, 'Barbell Row')
    findButtons(modal.contentEl, 'Preview changes')[0]?.click()

    expect(vi.mocked(buildExerciseRenamePlanFromVault).mock.calls[0]?.slice(2)).toEqual([
      'Row',
      'Barbell Row',
    ])
  })

  it('shows a checking line while the vault is read', () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockReturnValue(new Promise(() => {}))
    const modal = new ExerciseRenameModal(createPluginStub() as unknown as FitKitPlugin, {
      oldName: 'Row',
    })
    modal.onOpen()

    findButtons(modal.contentEl, 'Preview changes')[0]?.click()

    expect(outline(modal.contentEl)).toMatchSnapshot()
  })

  it('returns to the input with the error when the vault cannot be read', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockRejectedValue(new Error('Disk gone'))
    const modal = await openPreview(createPluginStub())

    expect(outline(modal.contentEl)).toMatchSnapshot()
    expect(nameInput(modal).value).toBe('Row')
  })
})

describe('ExerciseRenameModal cancel', () => {
  beforeEach(() => {
    obsidianMock.notices = []
    vi.mocked(buildExerciseRenamePlanFromVault).mockReset()
    vi.mocked(applyExerciseRenamePlan).mockReset()
  })

  it('names the modal through setTitle rather than a heading in the body', () => {
    const plugin = createPluginStub()
    const modal = new ExerciseRenameModal(plugin as unknown as FitKitPlugin, { oldName: 'Row' })

    modal.onOpen()

    expect(modal.titleEl.textContent).toBe('Rename exercise')
    expect(
      [...modal.contentEl.children].some((child) => child.tagName.toLowerCase() === 'h2'),
    ).toBe(false)
  })

  it('writes nothing when cancelled at the input stage', () => {
    const plugin = createPluginStub()
    const modal = new ExerciseRenameModal(plugin as unknown as FitKitPlugin, { oldName: 'Row' })
    const closeSpy = vi.spyOn(modal, 'close')
    modal.onOpen()

    const cancel = findButtons(modal.contentEl, 'Cancel')
    expect(cancel).toHaveLength(1)
    cancel[0]?.click()

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
    modal.onOpen()
    findButtons(modal.contentEl, 'Preview changes')[0]?.click()
    await settle()

    const cancel = findButtons(modal.contentEl, 'Cancel')
    expect(cancel).toHaveLength(1)
    cancel[0]?.click()

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
    const modal = await openPreview(plugin, { onApplied })
    const closeSpy = vi.spyOn(modal, 'close')

    findButtons(modal.contentEl, 'Confirm rename')[0]?.click()
    await settle()

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

  it('disables the actions and says Applying while the rename runs', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(basePlan())
    vi.mocked(applyExerciseRenamePlan).mockReturnValue(new Promise(() => {}))
    const modal = await openPreview(createPluginStub())

    findButtons(modal.contentEl, 'Confirm rename')[0]?.click()

    expect(outline(modal.contentEl)).toMatchSnapshot()
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
    const modal = await openPreview(plugin, { onApplied })
    const closeSpy = vi.spyOn(modal, 'close')

    findButtons(modal.contentEl, 'Confirm rename')[0]?.click()
    await settle()

    expect(closeSpy).not.toHaveBeenCalled()
    expect(onApplied).not.toHaveBeenCalled()
    expect(obsidianMock.notices).toHaveLength(0)
    const text = collectText(modal.contentEl).join(' ')
    expect(text).toContain('Rename only partly completed')
    expect(text).toContain('Disk full')
    /** The retry preview is recomputed from scratch, matching the engine's rescan design. */
    expect(vi.mocked(buildExerciseRenamePlanFromVault)).toHaveBeenCalledTimes(2)
    expect(outline(modal.contentEl)).toMatchSnapshot()
  })

  it('shows a warning and keeps the modal open when applying throws outright', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(basePlan())
    vi.mocked(applyExerciseRenamePlan).mockRejectedValue(new Error('Vault write failed'))
    const modal = await openPreview(createPluginStub())
    const closeSpy = vi.spyOn(modal, 'close')

    findButtons(modal.contentEl, 'Confirm rename')[0]?.click()
    await settle()

    expect(closeSpy).not.toHaveBeenCalled()
    const text = collectText(modal.contentEl).join(' ')
    expect(text).toContain('Could not apply the rename')
    expect(text).toContain('Vault write failed')
  })
})

describe('ExerciseRenameModal closing', () => {
  beforeEach(() => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockReset()
  })

  afterEach(() => {
    harnessDocument.body.replaceChildren()
  })

  it('unmounts its component from every stage', async () => {
    vi.mocked(buildExerciseRenamePlanFromVault).mockResolvedValue(basePlan())
    const atInput = new ExerciseRenameModal(createPluginStub() as unknown as FitKitPlugin, {
      oldName: 'Row',
    })
    atInput.onOpen()
    const atPreview = await openPreview(createPluginStub())

    const unmounts = watchUnmounts()
    try {
      atInput.onClose()
      atPreview.onClose()
    } finally {
      unmounts.stop()
    }

    expect(unmounts.names).toContain('InputStage')
    expect(unmounts.names).toContain('PreviewStage')
    expect(atInput.contentEl.children).toHaveLength(0)
    expect(atPreview.contentEl.children).toHaveLength(0)
  })

  it('draws nothing when the vault answers after the modal closed', async () => {
    let answer: (plan: ExerciseRenamePlan) => void = () => {}
    vi.mocked(buildExerciseRenamePlanFromVault).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const modal = new ExerciseRenameModal(createPluginStub() as unknown as FitKitPlugin, {
      oldName: 'Row',
    })
    modal.onOpen()
    findButtons(modal.contentEl, 'Preview changes')[0]?.click()
    modal.onClose()

    answer(basePlan())
    await settle()

    expect(modal.contentEl.children).toHaveLength(0)
  })

  it('draws again when reopened after closing', () => {
    const modal = new ExerciseRenameModal(createPluginStub() as unknown as FitKitPlugin, {
      oldName: 'Row',
    })
    modal.onOpen()
    modal.onClose()

    modal.onOpen()

    expect(nameInput(modal).value).toBe('Row')
  })
})
