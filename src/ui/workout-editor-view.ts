import type { App, WorkspaceLeaf } from 'obsidian'
import { ItemView, Menu, Modal, Notice, TFile, normalizePath, setIcon } from 'obsidian'

import { reorderArray } from '../domain/array-utils'
import {
  defaultBodyweightLevels,
  describeBodyweightLadderChanges,
  formatBodyweightLevelLabel,
  formatBodyweightLevelShort,
  pickBestBodyweightSet,
  type BodyweightLadder,
  type BodyweightLadderChange,
} from '../domain/bodyweight-levels'
import {
  formatDurationInput,
  parseDurationInput,
  ZERO_DURATION_DISPLAY,
} from '../domain/duration-input'
import { formatErrorMessage } from '../domain/error'
import { assertUnreachableKind, EXERCISE_KINDS } from '../domain/exercise-kind'
import {
  formatExerciseHistoryBadges,
  formatNextPlanBadge,
  pickMaxWeightSet,
  type ExerciseHistoryByName,
  type ExerciseHistorySummary,
} from '../domain/exercise-history'
import {
  createRegistry,
  kindForName,
  levelsForName,
  normalize,
  upsertEntry,
  type ExerciseRegistry,
  type ExerciseRegistryEntry,
} from '../domain/exercise-registry'
import type {
  ExerciseNoteKindUpdateResult,
  ExerciseNoteLevelsUpdateResult,
} from '../domain/exercise-note-migrate'
import { setExerciseNoteKind, setExerciseNoteLevels } from '../domain/exercise-note-migrate'
import { filterSuggestableNames } from '../domain/exercise-suggestions'
import {
  formatNumber as formatPlanNumber,
  nextPlanTargetWeight,
  type NextPlan,
  type NextPlanDirection,
} from '../domain/next-plan'
import {
  parseWorkoutNote,
  relabelSetsAsFirstLevel,
  serializeWorkoutNote,
  setRowCount,
  withNoteAndNext,
  type BodyweightExerciseEntry,
  type BodyweightSet,
  type DurationEntry,
  type DurationExerciseEntry,
  type ExerciseEntry,
  type ExerciseKind,
  type PreserveBlock,
  type StrengthExerciseEntry,
  type StrengthSet,
  type WorkoutNoteModel,
} from '../domain/workout-note-model'
import type FitKitPlugin from '../main'
import { exercisesFolder, workoutsFolder } from '../settings-paths'
import { findExerciseNotePath } from '../vault/exercise-catalog'
import { composeExerciseNote } from '../vault/exercise-note'
import { planExerciseFileOpen } from '../vault/exercise-file-plan'
import { exerciseHistoryFromVault } from '../vault/exercise-history-vault'
import {
  applyLadderOverrides,
  bodyweightLevelsFor,
  exerciseRegistryWithVaultNotes,
  sameLevels,
} from '../vault/exercise-registry-vault'
import { FileSession } from '../vault/file-session'
import { markdownFilesInFolder } from '../vault/folder-scan'
import { ensureParentFolder } from '../vault/vault-utils'
import { ConfirmModal } from './confirm-modal'
import { EditLevelsModal } from './edit-levels-modal'
import { ExerciseSuggestModal } from './exercise-suggest-modal'
import { KindSwitchChoiceModal, type KindSwitchChoice } from './kind-switch-choice-modal'
import { SetNoteModal } from './set-note-modal'
import { PlanStepModal } from './plan-step-modal'

interface DragSession {
  pointerId: number
  fromIndex: number
  toIndex: number
  startY: number
  card: HTMLElement
  handle: HTMLElement
  list: HTMLElement
  indicator: HTMLElement
}

interface ActiveTimer {
  card: ExerciseCard
  entry: EditableDurationEntry
  startedAtMs: number
  accumulator: number
  intervalId: number
  inputEl: HTMLInputElement | null
}

interface ActiveRestTimer {
  startedAtMs: number
  intervalId: number
  labelEl: HTMLElement | null
}

export const VIEW_TYPE_FITKIT_WORKOUT_EDITOR = 'fitkit-workout-editor'

interface EditableStrengthSet {
  set?: number
  weight?: number
  reps?: number
  note?: string
}

interface EditableDurationEntry {
  set?: number
  durationSeconds?: number
  note?: string
}

interface EditableBodyweightSet {
  set?: number
  level?: number
  reps?: number
  load?: number
  note?: string
}

interface ExerciseCard {
  name: string
  kind: ExerciseKind
  exerciseNotes?: string
  next?: NextPlan
  strengthSets: EditableStrengthSet[]
  durationEntries: EditableDurationEntry[]
  bodyweightSets: EditableBodyweightSet[]
}

/** Column label of the cell focused after adding an exercise, per kind. */
const FOCUS_COLUMN_LABELS: Record<ExerciseKind, string> = {
  strength: 'Weight',
  duration: 'Duration',
  bodyweight: 'Reps',
}

const NEXT_PLAN_OPTIONS: ReadonlyArray<{
  direction: NextPlanDirection
  icon: string
  menuLabel: string
}> = [
  { direction: 'up', icon: 'arrow-up', menuLabel: 'Plan: increase' },
  { direction: 'stay', icon: 'minus', menuLabel: 'Plan: keep' },
  { direction: 'down', icon: 'arrow-down', menuLabel: 'Plan: decrease' },
]

interface EditorWorkoutModel {
  isFitKitWorkout: boolean
  date: string
  name: string
  sourcePath: string
  exercises: ExerciseCard[]
  preserveBlocks: PreserveBlock[]
  frontmatterExtra: string[]
}

export class WorkoutEditorView extends ItemView {
  private session: FileSession | null = null
  private model: EditorWorkoutModel | null = null
  private exerciseHistory: ExerciseHistoryByName | null = null
  private dirty = false
  private conflictDetected = false
  private resizeObserver: ResizeObserver | null = null
  private autoSaveTimer: number | null = null
  private autoSaveInflight = false
  private autoSaveRequeued = false
  private dragSession: DragSession | null = null
  private activeTimer: ActiveTimer | null = null
  private activeRestTimer: ActiveRestTimer | null = null
  private seededWeightsStore?: WeakSet<EditableStrengthSet>
  private ladderOverridesStore?: Map<string, string[]>
  private lastRestSeconds: number | null = null
  /**
   * Ladders this session wrote that the metadata cache may not report yet.
   * Renders overlay them until the snapshot catches up, so a card never
   * shows the rungs from before its own write. Lazily created because
   * prototype-built views never run field initializers.
   */
  private get ladderOverrides(): Map<string, string[]> {
    this.ladderOverridesStore ??= new Map<string, string[]>()
    return this.ladderOverridesStore
  }

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: FitKitPlugin,
  ) {
    super(leaf)
  }

  getViewType(): string {
    return VIEW_TYPE_FITKIT_WORKOUT_EDITOR
  }

  getDisplayText(): string {
    return this.session?.file.basename ?? 'Workout editor'
  }

  getIcon(): string {
    return 'dumbbell'
  }

  get currentFile(): TFile | null {
    return this.session?.file ?? null
  }

  refreshSettingsDrivenUi(): void {
    if (!this.isRestTimerEnabled()) {
      this.clearRestTimerState()
    }
    if (this.model && this.session) {
      this.render()
    }
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('fitkit-editor-root')
    this.resizeObserver = new ResizeObserver(() => this.updateNarrowState())
    this.resizeObserver.observe(this.contentEl)
    this.updateNarrowState()
    this.registerDragLifetimeListeners()
    this.renderEmpty('Open a workout note to edit.')
  }

  private registerDragLifetimeListeners(): void {
    const cancel = (evt: PointerEvent): void => {
      if (!this.dragSession || evt.pointerId !== this.dragSession.pointerId) {
        return
      }
      this.endDrag(false)
    }
    const finish = (evt: PointerEvent): void => {
      if (!this.dragSession || evt.pointerId !== this.dragSession.pointerId) {
        return
      }
      this.endDrag(true)
    }
    this.registerDomEvent(activeWindow, 'pointerup', finish)
    this.registerDomEvent(activeWindow, 'pointercancel', cancel)
    this.registerDomEvent(activeWindow, 'lostpointercapture', cancel)
  }

  async onClose(): Promise<void> {
    this.stopTimer({ write: true })
    this.clearRestTimerState()
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer)
      this.autoSaveTimer = null
    }
    await this.flushAutoSave()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.dragSession) {
      this.endDrag(false)
    }
    this.contentEl.empty()
    this.session = null
    this.model = null
    this.exerciseHistory = null
  }

  private updateNarrowState(): void {
    this.setNarrowState(this.contentEl.clientWidth < 600, this.contentEl.clientWidth < 360)
    this.refreshLevelLabels()
  }

  /** Narrow state through the Obsidian class helpers so the test realm can observe it. */
  private setNarrowState(narrow: boolean, compact: boolean): void {
    if (narrow) {
      this.contentEl.addClass('is-narrow')
    } else {
      this.contentEl.removeClass('is-narrow')
    }
    if (compact) {
      this.contentEl.addClass('is-compact')
    } else {
      this.contentEl.removeClass('is-compact')
    }
  }

  /**
   * Refit every rung label after a resize. Labels fit themselves on first
   * render; only a width change afterwards can overflow a new one. Each
   * label unshortens before measuring, so the measure always reads live
   * widths and every tick converges instead of oscillating.
   */
  private refreshLevelLabels(): void {
    for (const label of this.contentEl.querySelectorAll('.fitkit-bodyweight-level-label')) {
      if (!label.instanceOf(HTMLElement)) {
        continue
      }
      const full = label.querySelector('.fitkit-bodyweight-level-full')
      if (!full?.instanceOf(HTMLElement)) {
        continue
      }
      label.removeClass('is-label-short')
      this.fitLevelLabel(label, full)
    }
  }

  async loadFile(file: TFile): Promise<void> {
    this.stopTimer({ write: true })
    this.clearRestTimerState()
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer)
      this.autoSaveTimer = null
    }
    if (this.session && this.dirty && !this.conflictDetected) {
      await this.flushAutoSave()
    }
    /** Fresh mount has no model yet; show a skeleton so the user is not staring at the onOpen empty state during the disk read. Retargets keep the previous content visible for a single-paint transition. */
    let skeletonShownAt: number | null = null
    if (!this.model) {
      this.renderSkeleton()
      skeletonShownAt = Date.now()
    }
    this.session = new FileSession(this.app, file)
    const { model, isWorkout, warnings } = await this.session.load()
    this.model = toEditorWorkoutModel(model, isWorkout, file.path)
    this.exerciseHistory = await this.loadExerciseHistory()
    this.dirty = false
    this.conflictDetected = false
    if (skeletonShownAt !== null) {
      const elapsed = Date.now() - skeletonShownAt
      const minSkeletonMs = 500
      if (elapsed < minSkeletonMs) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, minSkeletonMs - elapsed))
      }
    }
    this.render()
    if (warnings.length > 0) {
      new Notice(`Loaded with ${warnings.length} parse warning(s).`)
    }
  }

  async reloadFromDisk(): Promise<void> {
    if (!this.session) {
      return
    }
    this.abortTimer()
    this.clearRestTimer()
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer)
      this.autoSaveTimer = null
    }
    const { model, isWorkout } = await this.session.load()
    this.model = toEditorWorkoutModel(model, isWorkout, this.session.file.path)
    if (!this.model.isFitKitWorkout) {
      this.exerciseHistory = null
    }
    this.dirty = false
    this.conflictDetected = false
    this.render()
    new Notice('Reloaded from disk.')
  }

  private renderEmpty(message: string): void {
    this.contentEl.empty()
    const wrap = this.contentEl.createDiv({ cls: 'fitkit-empty' })
    wrap.setText(message)
  }

  renderSkeleton(): void {
    this.contentEl.empty()
    const wrap = this.contentEl.createDiv({ cls: 'fitkit-skeleton' })
    for (let i = 0; i < 3; i++) {
      const card = wrap.createDiv({ cls: 'fitkit-skeleton-card' })
      const top = card.createDiv({ cls: 'fitkit-skeleton-row' })
      top.createDiv({ cls: 'fitkit-skeleton-line is-tall is-medium' })
      top.createDiv({ cls: 'fitkit-skeleton-line is-tall is-short' })
      card.createDiv({ cls: 'fitkit-skeleton-line is-short' })
      card.createDiv({ cls: 'fitkit-skeleton-line' })
      card.createDiv({ cls: 'fitkit-skeleton-line is-medium' })
    }
  }

  private render(): void {
    if (!this.model || !this.session) {
      this.renderEmpty('No file loaded.')
      return
    }
    this.contentEl.empty()
    const container = this.contentEl.createDiv({ cls: 'fitkit-container' })

    this.renderHeader(container)

    if (!this.model.isFitKitWorkout) {
      const warn = container.createDiv({ cls: 'fitkit-warn' })
      warn.setText(
        'This note has no `type: workout` frontmatter. The editor will not save changes here.',
      )
      return
    }

    if (this.conflictDetected) {
      const banner = container.createDiv({ cls: 'fitkit-conflict' })
      banner.createSpan({
        text: 'File changed on disk. Reload to pick up external edits before continuing.',
      })
      const btn = banner.createEl('button', {
        cls: 'fitkit-btn fitkit-btn-warn',
        text: 'Reload from disk',
      })
      btn.addEventListener('click', () => void this.reloadFromDisk())
    }

    const list = container.createDiv({ cls: 'fitkit-exercise-list' })
    /** One merged snapshot per render: every card reads its ladder from this instead of rebuilding it. */
    const registry = this.registryForRender()
    for (let i = 0; i < this.model.exercises.length; i++) {
      this.renderExerciseCard(list, i, registry)
    }

    const footer = container.createDiv({ cls: 'fitkit-footer' })
    const addBtn = footer.createEl('button', { cls: 'fitkit-btn', text: 'Add exercise' })
    addBtn.addEventListener('click', () => void this.openAddExerciseModal())
    this.renderFooterRestTimer(footer)
  }

  private renderFooterRestTimer(footer: HTMLElement): void {
    if (!this.isRestTimerEnabled()) {
      return
    }
    const timer = this.activeRestTimer
    const control = footer.createDiv({ cls: 'fitkit-rest-timer-control' })
    const button = control.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-muted fitkit-rest-timer-button',
      attr: {
        type: 'button',
        'aria-label': timer ? 'Stop rest timer' : 'Start rest timer',
      },
    })
    setIcon(button, timer ? 'square' : 'timer')
    const label = button.createSpan({
      cls: 'fitkit-rest-timer-label',
      text: timer ? `Stop ${formatDurationInput(this.liveRestSeconds(timer))}` : 'Start rest',
    })
    if (timer) {
      timer.labelEl = label
    }
    button.addEventListener('click', () => {
      if (this.activeRestTimer) {
        this.stopRestTimer()
      } else {
        this.startRestTimer()
      }
    })

    if (!timer && this.lastRestSeconds !== null) {
      control.createSpan({
        cls: 'fitkit-rest-timer-last',
        text: `Last rest ${formatDurationInput(this.lastRestSeconds)}`,
      })
    }
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: 'fitkit-header' })

    const meta = header.createDiv({ cls: 'fitkit-meta' })
    if (this.model?.isFitKitWorkout) {
      const nameField = meta.createDiv({ cls: 'fitkit-name-field' })
      const nameInput = nameField.createEl('input', {
        cls: 'fitkit-workout-name-input',
        attr: {
          type: 'text',
          id: 'fitkit-workout-name',
          placeholder: 'Untitled workout',
          'aria-label': 'Workout name',
        },
      })
      nameInput.value = this.model.name
      nameInput.addEventListener('input', () => {
        if (!this.model) {
          return
        }
        this.model.name = nameInput.value
        this.markDirty()
      })
    }
    meta.createSpan({ cls: 'fitkit-meta-line', text: this.metaLineText() })
  }

  private renderExerciseCard(list: HTMLElement, index: number, registry?: ExerciseRegistry): void {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex) {
      return
    }
    /** Direct card renders (and tests) build their own snapshot; full renders share one. */
    const snapshot = registry ?? this.registryForRender()

    const card = list.createDiv({ cls: 'fitkit-card' })
    card.dataset.exerciseIndex = String(index)

    const top = card.createDiv({ cls: 'fitkit-card-top' })

    const handle = top.createEl('button', {
      cls: 'fitkit-drag-handle',
      attr: {
        type: 'button',
        'aria-label': 'Drag to reorder',
        tabindex: '0',
      },
    })
    setIcon(handle, 'grip-vertical')
    this.installCardDrag(card, handle, list)

    const nameButton = top.createEl('button', {
      cls: 'fitkit-name-button',
      attr: { type: 'button', 'aria-label': `Open exercise file for ${ex.name}` },
    })
    nameButton.createSpan({ cls: 'fitkit-name-button-text', text: ex.name })
    const linkIcon = nameButton.createSpan({
      cls: 'fitkit-name-button-icon',
      attr: { 'aria-hidden': 'true' },
    })
    setIcon(linkIcon, 'arrow-up-right')
    nameButton.addEventListener('click', () => void this.openOrCreateExerciseFile(ex))

    const gearBtn = top.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-muted fitkit-card-icon-button fitkit-gear-button',
      attr: { type: 'button', 'aria-label': 'Exercise options' },
    })
    setIcon(gearBtn, 'settings')
    gearBtn.addEventListener('click', (evt) => this.openCardMenu(evt, index))

    this.renderExerciseHistoryBadges(card, ex, snapshot)

    if (ex.exerciseNotes && ex.exerciseNotes.length > 0) {
      const line = card.createDiv({
        cls: 'fitkit-note-line fitkit-exercise-note-line',
        attr: { role: 'button', tabindex: '0' },
      })
      line.setText(ex.exerciseNotes)
      const open = (): void => this.openExerciseNoteModal(ex)
      line.addEventListener('click', open)
      line.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault()
          open()
        }
      })
    }

    switch (ex.kind) {
      case 'strength':
        this.renderStrengthTable(card, ex, index)
        break
      case 'bodyweight':
        this.renderBodyweightTable(card, ex, index, snapshot)
        break
      case 'duration':
        this.renderDurationTable(card, ex, index)
        break
      default:
        assertUnreachableKind(ex.kind)
    }
  }

  private renderStrengthTable(card: HTMLElement, ex: ExerciseCard, exerciseIndex: number): void {
    const wrap = card.createDiv({ cls: 'fitkit-set-area' })

    const header = wrap.createDiv({ cls: 'fitkit-set-row fitkit-set-head' })
    // The set column is a figure now, too narrow for a label; the rows still name it.
    header.createSpan({ cls: 'fitkit-set-label fitkit-set-figure' })
    header.createSpan({ cls: 'fitkit-set-label', text: 'Weight' })
    header.createSpan({ cls: 'fitkit-set-label', text: 'Reps' })

    for (let i = 0; i < ex.strengthSets.length; i++) {
      this.renderStrengthRow(wrap, ex, i)
    }

    const actions = wrap.createDiv({ cls: 'fitkit-row-actions' })
    const addBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Add set' })
    addBtn.addEventListener('click', () => {
      const last = ex.strengthSets[ex.strengthSets.length - 1]
      const next: EditableStrengthSet = { set: ex.strengthSets.length + 1 }
      if (last?.weight !== undefined) {
        next.weight = last.weight
      }
      ex.strengthSets.push(next)
      this.markDirty()
      this.render()
      this.focusRowCell(exerciseIndex, ex.strengthSets.length - 1, 'Weight')
    })
  }

  private renderStrengthRow(wrap: HTMLElement, ex: ExerciseCard, i: number): void {
    const set = ex.strengthSets[i]
    if (!set) {
      return
    }
    // The logging loop only ever touches the bottom row; the ones above it are session history.
    const isLive = i === ex.strengthSets.length - 1
    const container = wrap.createDiv({ cls: isLive ? 'fitkit-row fitkit-row--live' : 'fitkit-row' })
    const body = container.createDiv({ cls: 'fitkit-row-body' })
    const row = body.createDiv({ cls: 'fitkit-set-row' })

    const setCell = this.createCell(row, 'Set', 'fitkit-set-figure')
    setCell.setText(String(set.set ?? i + 1))

    const weightInput = this.createInputCell(row, 'Weight', {
      type: 'number',
      step: '0.1',
      inputmode: 'decimal',
    })
    weightInput.value = set.weight !== undefined ? String(set.weight) : ''
    if (this.seededWeights.has(set)) {
      weightInput.addClass('fitkit-input--unconfirmed')
    }
    weightInput.addEventListener('input', () => {
      this.seededWeights.delete(set)
      weightInput.removeClass('fitkit-input--unconfirmed')
      set.weight = parseNumberInput(weightInput.value)
      this.markDirty()
    })

    const repsInput = this.createInputCell(row, 'Reps', { type: 'number', inputmode: 'numeric' })
    repsInput.value = set.reps !== undefined ? String(set.reps) : ''
    repsInput.addEventListener('input', () => {
      set.reps = parseNumberInput(repsInput.value)
      this.markDirty()
    })
    this.renderRowActions(container, body, {
      label: `set ${i + 1}`,
      currentNote: set.note,
      onDelete: () => {
        ex.strengthSets.splice(i, 1)
        this.markDirty()
        this.render()
      },
      onNoteSave: (next) => {
        set.note = next
        this.markDirty()
        this.render()
      },
      onRenumber: () => {
        ex.strengthSets.forEach((row, index) => {
          row.set = index + 1
        })
        this.markDirty()
        this.render()
      },
    })
  }

  private renderBodyweightTable(
    card: HTMLElement,
    ex: ExerciseCard,
    exerciseIndex: number,
    registry: ExerciseRegistry,
  ): void {
    card.addClass('fitkit-bodyweight-card')
    const levels = levelsForName(registry, ex.name)
    const showLoad = ex.bodyweightSets.some((entry) => entry.load !== undefined)
    const wrap = card.createDiv({ cls: 'fitkit-set-area' })

    const header = wrap.createDiv({
      cls: showLoad
        ? 'fitkit-bodyweight-row fitkit-set-head has-load'
        : 'fitkit-bodyweight-row fitkit-set-head',
    })
    header.createSpan({ cls: 'fitkit-set-label fitkit-set-figure' })
    header.createSpan({ cls: 'fitkit-set-label', text: 'Level' })
    header.createSpan({ cls: 'fitkit-set-label', text: 'Reps' })
    if (showLoad) {
      header.createSpan({ cls: 'fitkit-set-label', text: 'Load' })
    }
    header.createSpan({ cls: 'fitkit-bodyweight-head-spacer', attr: { 'aria-hidden': 'true' } })

    for (let i = 0; i < ex.bodyweightSets.length; i++) {
      this.renderBodyweightRow(wrap, ex, i, levels, showLoad)
    }

    const actions = wrap.createDiv({ cls: 'fitkit-row-actions' })
    const addBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Add set' })
    addBtn.addEventListener('click', () => {
      const last = ex.bodyweightSets[ex.bodyweightSets.length - 1]
      ex.bodyweightSets.push({ set: ex.bodyweightSets.length + 1, level: last?.level ?? 1 })
      this.markDirty()
      this.render()
      this.focusRowCell(exerciseIndex, ex.bodyweightSets.length - 1, 'Reps')
    })
  }

  private renderBodyweightRow(
    wrap: HTMLElement,
    ex: ExerciseCard,
    i: number,
    levels: BodyweightLadder | undefined,
    showLoad: boolean,
  ): void {
    const set = ex.bodyweightSets[i]
    if (!set) {
      return
    }
    const level = set.level ?? 1
    const container = wrap.createDiv({ cls: 'fitkit-row' })
    const body = container.createDiv({ cls: 'fitkit-row-body' })
    const row = body.createDiv({
      cls: showLoad ? 'fitkit-bodyweight-row has-load' : 'fitkit-bodyweight-row',
    })

    const setCell = this.createCell(row, 'Set', 'fitkit-set-figure')
    setCell.setText(String(set.set ?? i + 1))

    this.renderBodyweightLevelCell(row, ex, i, levels, level)

    const repsInput = this.createInputCell(row, 'Reps', { type: 'number', inputmode: 'numeric' })
    repsInput.value = set.reps !== undefined ? String(set.reps) : ''
    repsInput.addEventListener('input', () => {
      set.reps = parseNumberInput(repsInput.value)
      this.markDirty()
    })

    if (showLoad) {
      const loadCell = this.createCell(row, 'Load', 'fitkit-bodyweight-load')
      if (set.load !== undefined) {
        const loadInput = loadCell.createEl('input', {
          cls: 'fitkit-input',
          attr: { type: 'number', step: '0.1', inputmode: 'decimal' },
        })
        loadInput.setAttr('aria-label', 'Load')
        loadInput.value = String(set.load)
        loadInput.addEventListener('input', () => {
          set.load = parseNumberInput(loadInput.value)
          this.markDirty()
        })
      }
    }

    this.renderRowActions(container, body, {
      label: `bodyweight entry ${i + 1}`,
      currentNote: set.note,
      onDelete: () => {
        ex.bodyweightSets.splice(i, 1)
        this.markDirty()
        this.render()
      },
      onNoteSave: (next) => {
        set.note = next
        this.markDirty()
        this.render()
      },
      onRenumber: () => {
        ex.bodyweightSets.forEach((entry, index) => {
          entry.set = index + 1
        })
        this.markDirty()
        this.render()
      },
      loadMenu: {
        hasLoad: set.load !== undefined,
        onAddLoad: () => {
          const previous = ex.bodyweightSets[i - 1]
          set.load = previous?.load ?? 0
          this.markDirty()
          this.render()
        },
        onRemoveLoad: () => {
          set.load = undefined
          this.markDirty()
          this.render()
        },
      },
    })
  }

  private renderBodyweightLevelCell(
    row: HTMLElement,
    ex: ExerciseCard,
    rowIndex: number,
    levels: BodyweightLadder | undefined,
    level: number,
  ): void {
    const rungCount = levels?.length ?? 0
    const cell = this.createCell(row, 'Level')
    const stepper = cell.createDiv({ cls: 'fitkit-bodyweight-stepper' })

    const minus = stepper.createEl('button', {
      cls: 'fitkit-btn fitkit-bodyweight-step',
      attr: { type: 'button', 'aria-label': `Lower level for set ${rowIndex + 1}` },
    })
    setIcon(minus, 'minus')
    minus.disabled = level <= 1
    minus.addEventListener('click', () => {
      if (level > 1) {
        this.setBodyweightLevel(ex, rowIndex, level - 1)
      }
    })

    const label = stepper.createEl('button', {
      cls: 'fitkit-bodyweight-level-label',
      attr: {
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-label': `Level for set ${rowIndex + 1}: ${formatBodyweightLevelLabel(levels, level)}`,
      },
    })
    const full = label.createSpan({
      cls: 'fitkit-bodyweight-level-full',
      text: formatBodyweightLevelLabel(levels, level),
    })
    label.createSpan({
      cls: 'fitkit-bodyweight-level-short',
      text: formatBodyweightLevelShort(level),
    })
    const chevron = label.createSpan({
      cls: 'fitkit-bodyweight-level-chevron',
      attr: { 'aria-hidden': 'true' },
    })
    setIcon(chevron, 'chevron-down')
    label.addEventListener('click', () => {
      const menu = new Menu()
      const top = Math.max(rungCount, level)
      for (let n = 1; n <= top; n++) {
        const target = n
        menu.addItem((item) =>
          item
            .setTitle(formatBodyweightLevelLabel(levels, target))
            .setChecked(target === level)
            .onClick(() => this.setBodyweightLevel(ex, rowIndex, target)),
        )
      }
      const rect = label.getBoundingClientRect()
      menu.showAtPosition({ x: rect.left, y: rect.bottom })
    })

    const plus = stepper.createEl('button', {
      cls: 'fitkit-btn fitkit-bodyweight-step',
      attr: { type: 'button', 'aria-label': `Raise level for set ${rowIndex + 1}` },
    })
    setIcon(plus, 'plus')
    plus.disabled = rungCount === 0 || level >= rungCount
    plus.addEventListener('click', () => {
      if (rungCount > 0 && level < rungCount) {
        this.setBodyweightLevel(ex, rowIndex, level + 1)
      }
    })
    this.fitLevelLabel(label, full)
  }

  private setBodyweightLevel(ex: ExerciseCard, rowIndex: number, level: number): void {
    const set = ex.bodyweightSets[rowIndex]
    if (!set) {
      return
    }
    set.level = level
    this.markDirty()
    this.render()
  }

  /**
   * Shorten a rung name that overflows its own text slot. A shortened label
   * hides its measured span, so fitting one directly keeps it short; resize
   * refits unshorten first so the measure below always reads live widths.
   */
  private fitLevelLabel(
    label: HTMLElement,
    full: HTMLElement,
    widths: LevelLabelWidths = measureLevelLabelWidths(full),
  ): void {
    if (label.hasClass('is-label-short')) {
      return
    }
    if (shouldShortenLevelLabel(widths.content, widths.available)) {
      label.addClass('is-label-short')
    } else {
      label.removeClass('is-label-short')
    }
  }

  private renderDurationTable(card: HTMLElement, ex: ExerciseCard, exerciseIndex: number): void {
    const wrap = card.createDiv({ cls: 'fitkit-set-area' })

    const header = wrap.createDiv({ cls: 'fitkit-set-row fitkit-duration-row fitkit-set-head' })
    // The set column is a figure now, too narrow for a label; the rows still name it.
    header.createSpan({ cls: 'fitkit-set-label fitkit-set-figure' })
    header.createSpan({ cls: 'fitkit-set-label', text: 'Duration' })

    for (let i = 0; i < ex.durationEntries.length; i++) {
      this.renderDurationRow(wrap, ex, i, exerciseIndex)
    }

    const actions = wrap.createDiv({ cls: 'fitkit-row-actions' })
    const addBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Add set' })
    addBtn.addEventListener('click', () => {
      if (this.activeTimer && this.activeTimer.card === ex) {
        this.stopTimer({ write: true })
      }
      ex.durationEntries.push({})
      this.markDirty()
      this.render()
    })

    const isRunningHere = this.activeTimer?.card === ex
    const timerBtn = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-timer-button',
      text: isRunningHere ? 'Stop timer' : 'Start timer',
      attr: { 'aria-label': isRunningHere ? 'Stop timer' : 'Start timer' },
    })
    setIcon(timerBtn, isRunningHere ? 'square' : 'play')
    timerBtn.addEventListener('click', () => {
      if (this.activeTimer && this.activeTimer.card === ex) {
        this.stopTimer({ write: true })
      } else {
        this.startCardTimer(ex)
      }
    })
  }

  private renderDurationRow(
    wrap: HTMLElement,
    ex: ExerciseCard,
    i: number,
    exerciseIndex: number,
  ): void {
    const durationEntry = ex.durationEntries[i]
    if (!durationEntry) {
      return
    }
    const isTiming = this.activeTimer?.entry === durationEntry
    const container = wrap.createDiv({
      cls: isTiming ? 'fitkit-row fitkit-row--timing' : 'fitkit-row',
    })
    container.dataset.fitkitTimerRow = `${exerciseIndex}:${i}`
    const body = container.createDiv({ cls: 'fitkit-row-body' })
    const row = body.createDiv({ cls: 'fitkit-set-row fitkit-duration-row' })

    const setCell = this.createCell(row, 'Set', 'fitkit-set-figure')
    setCell.setText(String(durationEntry.set ?? i + 1))

    const durationCell = this.createCell(row, 'Duration')
    if (isTiming && this.activeTimer) {
      const durationInput = durationCell.createEl('input', {
        cls: 'fitkit-input fitkit-duration-input',
        attr: { type: 'text', 'aria-label': 'Duration' },
      })
      durationInput.value = formatDurationInput(this.liveSeconds(this.activeTimer))
      durationInput.toggleAttribute('disabled', true)
      this.activeTimer.inputEl = durationInput
    } else {
      this.renderDurationInput(durationCell, durationEntry)
    }

    this.renderRowActions(container, body, {
      label: `duration entry ${i + 1}`,
      currentNote: durationEntry.note,
      onDelete: () => {
        if (this.activeTimer?.entry === durationEntry) {
          this.abortTimer()
        }
        ex.durationEntries.splice(i, 1)
        this.markDirty()
        this.render()
      },
      onNoteSave: (next) => {
        durationEntry.note = next
        this.markDirty()
        this.render()
      },
      onRenumber: () => {
        ex.durationEntries.forEach((entry, index) => {
          entry.set = index + 1
        })
        this.markDirty()
        this.render()
      },
    })
  }

  private renderDurationInput(cell: HTMLElement, durationEntry: EditableDurationEntry): void {
    const input = cell.createEl('input', {
      cls: 'fitkit-input fitkit-duration-input',
      attr: {
        type: 'text',
        inputmode: 'text',
        placeholder: ZERO_DURATION_DISPLAY,
      },
    })
    input.setAttr('aria-label', 'Duration')
    input.setAttr('data-fitkit-default-focus', 'true')
    input.value = formatDurationInput(durationEntry.durationSeconds)

    const sync = (mark: boolean): boolean => {
      const parsed = parseDurationInput(input.value)
      setAriaInvalid(input, parsed === null)
      if (parsed === null) {
        return false
      }
      durationEntry.durationSeconds = parsed.seconds
      if (mark) {
        this.markDirty()
      }
      return true
    }

    input.addEventListener('input', () => void sync(true))
    input.addEventListener('blur', () => {
      const parsed = parseDurationInput(input.value)
      setAriaInvalid(input, false)
      if (parsed === null) {
        input.value = formatDurationInput(durationEntry.durationSeconds)
        return
      }
      durationEntry.durationSeconds = parsed.seconds
      input.value = parsed.display
    })
  }

  private openExerciseNoteModal(ex: ExerciseCard): void {
    new SetNoteModal(this.app, {
      title: `Note for ${ex.name}`,
      initial: ex.exerciseNotes ?? '',
      onSave: (next) => {
        ex.exerciseNotes = next && next.length > 0 ? next : undefined
        this.markDirty()
        this.render()
      },
    }).open()
  }

  private openEditLevelsModal(ex: ExerciseCard): void {
    new EditLevelsModal(this.app, {
      exerciseName: ex.name,
      initial: this.currentBodyweightLevels(ex.name) ?? defaultBodyweightLevels(ex.name),
      onSave: (levels) => {
        void this.confirmLadderEdit(ex, levels)
      },
    }).open()
  }

  /**
   * Applies an edited ladder behind the history warning: occupied positions
   * whose meaning would change are reported first, and the edit only
   * proceeds on confirmation. Logged sets keep their numbers throughout.
   */
  private async confirmLadderEdit(ex: ExerciseCard, levels: string[]): Promise<void> {
    const previous = this.currentBodyweightLevels(ex.name) ?? []
    const changes = describeBodyweightLadderChanges(previous, levels, [
      ...(await this.occupiedBodyweightLevels(ex)),
    ])
    if (changes.length > 0) {
      const confirmed = await this.confirmLadderChanges(ex.name, changes)
      if (!confirmed) {
        return
      }
    }
    await this.persistLadder(ex.name, levels)
  }

  private confirmLadderChanges(name: string, changes: BodyweightLadderChange[]): Promise<boolean> {
    const warning = formatLadderChangesWarning(name, changes)
    return new Promise((resolve) => {
      new ConfirmModal(
        this.app,
        {
          title: warning.title,
          message: warning.message,
          confirmText: 'Apply edit',
          cancelText: 'Cancel',
        },
        resolve,
      ).open()
    })
  }

  /**
   * Levels with logged sets for an exercise: the card's rows plus every rung
   * recorded for it across saved workout notes. Unreadable notes are
   * skipped; the warning must never block on them.
   */
  private async occupiedBodyweightLevels(ex: ExerciseCard): Promise<Set<number>> {
    const occupied = new Set<number>()
    for (const set of ex.bodyweightSets) {
      if (set.level !== undefined) {
        occupied.add(set.level)
      }
    }
    const key = normalize(ex.name)
    for (const file of markdownFilesInFolder(this.app, workoutsFolder(this.plugin.settings))) {
      let text: string
      try {
        text = await this.app.vault.cachedRead(file)
      } catch {
        continue
      }
      const parsed = parseWorkoutNote(text, file.path)
      if (!parsed.isWorkout || !parsed.model) {
        continue
      }
      for (const entry of parsed.model.exercises) {
        if (entry.kind !== 'bodyweight' || normalize(entry.exerciseName) !== key) {
          continue
        }
        for (const set of entry.bodyweightSets) {
          occupied.add(set.level)
        }
      }
    }
    return occupied
  }

  /**
   * Snapshot for rendering, with ladders this session wrote overlaid.
   * Vault writes land on disk before the metadata cache reports them, so
   * the render straight after a ladder write would otherwise show stale rungs.
   */
  private registryForRender(): ExerciseRegistry {
    const snapshot = createRegistry(exerciseRegistryWithVaultNotes(this.app, this.plugin.settings))
    this.pruneLadderOverrides(snapshot)
    return createRegistry(applyLadderOverrides(snapshot.entries, this.ladderOverrides))
  }

  /**
   * Freshest ladder for decisions and menus: a value this session wrote
   * wins until the snapshot reports it, so later reads never shadow it.
   */
  private currentBodyweightLevels(name: string): string[] | undefined {
    const override = this.ladderOverrides.get(normalize(name))
    if (override !== undefined) {
      return [...override]
    }
    return bodyweightLevelsFor(this.app, this.plugin.settings, name)
  }

  /**
   * Drops overrides the snapshot has caught up with. Without this a later
   * outside edit to the same ladder would stay hidden behind the override.
   */
  private pruneLadderOverrides(snapshot: ExerciseRegistry): void {
    for (const [key, levels] of this.ladderOverrides) {
      if (sameLevels(levelsForName(snapshot, key) ?? [], levels)) {
        this.ladderOverrides.delete(key)
      }
    }
  }

  /**
   * Writes an edited ladder to whichever store wins on read: the exercise
   * note when one exists, else the registry entry (created when missing).
   */
  private async persistLadder(name: string, levels: string[]): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    const notePath = findExerciseNotePath(this.app, this.plugin.settings, trimmed)
    const noteFile = notePath ? this.app.vault.getAbstractFileByPath(notePath) : null
    if (noteFile instanceof TFile) {
      let result: ExerciseNoteLevelsUpdateResult | undefined
      await this.app.vault.process(noteFile, (text) => {
        result = setExerciseNoteLevels(text, levels)
        return result.markdown
      })
      if (result?.changed) {
        this.ladderOverrides.set(normalize(trimmed), [...levels])
        new Notice(`Exercise note now records levels for ${trimmed}.`)
      }
      this.render()
      return
    }
    const settings = this.plugin.settings
    const current = createRegistry(settings.exerciseRegistry)
    const key = normalize(trimmed)
    const existing = current.entries.find((entry) => normalize(entry.name) === key)
    const nextEntry: ExerciseRegistryEntry = existing
      ? { ...existing, aliases: [...existing.aliases], levels: [...levels] }
      : { name: trimmed, kind: 'bodyweight', aliases: [], levels: [...levels] }
    settings.exerciseRegistry = upsertEntry(current, nextEntry).entries
    await this.plugin.saveSettings()
    this.ladderOverrides.set(key, [...levels])
    new Notice(`Registry now records levels for ${trimmed}.`)
    this.render()
  }

  private renderRowActions(
    container: HTMLElement,
    body: HTMLElement,
    opts: {
      label: string
      currentNote: string | undefined
      onDelete: () => void
      onNoteSave: (next: string | undefined) => void
      onRenumber?: () => void
      loadMenu?: { hasLoad: boolean; onAddLoad: () => void; onRemoveLoad: () => void }
    },
  ): void {
    const openNoteModal = (): void => {
      new SetNoteModal(this.app, {
        title: `Note for ${opts.label}`,
        initial: opts.currentNote ?? '',
        onSave: opts.onNoteSave,
      }).open()
    }
    const triggerDelete = (): void => {
      void this.confirmAndDeleteRow(opts.label, opts.onDelete)
    }

    this.renderRowKebab(
      body,
      opts.label,
      openNoteModal,
      triggerDelete,
      opts.onRenumber,
      opts.loadMenu,
    )

    if (opts.currentNote && opts.currentNote.length > 0) {
      const line = container.createDiv({
        cls: 'fitkit-note-line',
        attr: { role: 'button', tabindex: '0' },
      })
      line.setText(opts.currentNote)
      line.addEventListener('click', openNoteModal)
      line.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault()
          openNoteModal()
        }
      })
    }
  }

  private renderRowKebab(
    body: HTMLElement,
    label: string,
    onNote: () => void,
    onDelete: () => void,
    onRenumber?: () => void,
    loadMenu?: { hasLoad: boolean; onAddLoad: () => void; onRemoveLoad: () => void },
  ): void {
    const kebab = body.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-muted fitkit-row-kebab',
      attr: { type: 'button', 'aria-label': `Options for ${label}` },
    })
    setIcon(kebab, 'more-vertical')
    kebab.addEventListener('click', (evt) => {
      evt.stopPropagation()
      const menu = new Menu()
      menu.addItem((item) => item.setTitle('Edit note').setIcon('pencil').onClick(onNote))
      if (loadMenu) {
        if (loadMenu.hasLoad) {
          menu.addItem((item) =>
            item.setTitle('Remove load').setIcon('minus').onClick(loadMenu.onRemoveLoad),
          )
        } else {
          menu.addItem((item) =>
            item.setTitle('Add load').setIcon('plus').onClick(loadMenu.onAddLoad),
          )
        }
      }
      if (onRenumber) {
        menu.addItem((item) =>
          item.setTitle('Renumber sets').setIcon('list-ordered').onClick(onRenumber),
        )
      }
      menu.addItem((item) =>
        item.setTitle('Delete row').setIcon('trash-2').setWarning(true).onClick(onDelete),
      )
      const rect = kebab.getBoundingClientRect()
      menu.showAtPosition({ x: rect.left, y: rect.bottom })
    })
  }

  private async confirmAndDeleteRow(label: string, onDelete: () => void): Promise<void> {
    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        this.app,
        {
          title: 'Remove row?',
          message: `Remove ${label}? This cannot be undone.`,
          confirmText: 'Remove',
          cancelText: 'Cancel',
        },
        resolve,
      ).open()
    })
    if (confirmed) {
      onDelete()
    }
  }

  private startCardTimer(card: ExerciseCard): void {
    this.clearRestTimer()
    if (this.activeTimer && this.activeTimer.card !== card) {
      this.stopTimer({ write: true })
    }
    if (card.durationEntries.length === 0) {
      card.durationEntries.push({})
    }
    const entry = card.durationEntries[card.durationEntries.length - 1]
    if (!entry) {
      return
    }
    if (this.activeTimer && this.activeTimer.entry === entry) {
      return
    }
    const accumulator = entry.durationSeconds ?? 0
    const intervalId = window.setInterval(() => this.tickTimer(), 1000)
    this.activeTimer = {
      card,
      entry,
      startedAtMs: Date.now(),
      accumulator,
      intervalId,
      inputEl: null,
    }
    this.markDirty()
    this.render()
  }

  private stopTimer(opts: { write: boolean; render?: boolean }): void {
    const timer = this.activeTimer
    if (!timer) {
      return
    }
    window.clearInterval(timer.intervalId)
    if (opts.write) {
      timer.entry.durationSeconds = this.liveSeconds(timer)
      this.markDirty()
    }
    this.activeTimer = null
    if (opts.render !== false) {
      this.render()
    }
  }

  private abortTimer(): void {
    this.stopTimer({ write: false })
  }

  private tickTimer(): void {
    const timer = this.activeTimer
    if (!timer || !timer.inputEl) {
      return
    }
    timer.inputEl.value = formatDurationInput(this.liveSeconds(timer))
  }

  private liveSeconds(timer: ActiveTimer): number {
    return timer.accumulator + Math.max(0, Math.floor((Date.now() - timer.startedAtMs) / 1000))
  }

  private startRestTimer(): void {
    if (!this.isRestTimerEnabled()) {
      return
    }
    if (this.activeRestTimer) {
      return
    }
    this.lastRestSeconds = null
    if (this.activeTimer) {
      this.stopTimer({ write: true, render: false })
    }
    const intervalId = window.setInterval(() => this.tickRestTimer(), 1000)
    this.activeRestTimer = {
      startedAtMs: Date.now(),
      intervalId,
      labelEl: null,
    }
    this.render()
  }

  private stopRestTimer(): void {
    const timer = this.activeRestTimer
    if (!timer) {
      return
    }
    const restSeconds = this.liveRestSeconds(timer)
    this.clearRestTimer()
    this.lastRestSeconds = restSeconds
    this.render()
  }

  private clearRestTimer(): void {
    const timer = this.activeRestTimer
    if (!timer) {
      return
    }
    window.clearInterval(timer.intervalId)
    this.activeRestTimer = null
  }

  private clearRestTimerState(): void {
    this.clearRestTimer()
    this.lastRestSeconds = null
  }

  private tickRestTimer(): void {
    const timer = this.activeRestTimer
    if (!timer?.labelEl) {
      return
    }
    timer.labelEl.setText(`Stop ${formatDurationInput(this.liveRestSeconds(timer))}`)
  }

  private liveRestSeconds(timer: ActiveRestTimer): number {
    return Math.max(0, Math.floor((Date.now() - timer.startedAtMs) / 1000))
  }

  private isRestTimerEnabled(): boolean {
    return this.plugin.settings.strengthRestTimerEnabled !== false
  }

  private async switchKind(index: number, nextKind: ExerciseKind): Promise<void> {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex || ex.kind === nextKind) {
      return
    }
    const hadRows = hasRows(ex)
    const registry = createRegistry(exerciseRegistryWithVaultNotes(this.app, this.plugin.settings))
    const registryKind = kindForName(registry, ex.name)
    const choice = await this.chooseKindSwitch(ex, nextKind, registryKind)
    if (choice === 'cancel') {
      return
    }
    /** Captured before the switch clears the card; the relabel offer below marks these as level 1. */
    const relabelSource = nextKind === 'bodyweight' ? toWorkoutExercise(ex) : null
    this.applyKindSwitch(index, nextKind, hadRows)
    if (choice === 'workout-and-registry') {
      await this.persistKindChange(ex.name, nextKind)
    }
    if (nextKind === 'bodyweight' && relabelSource) {
      /** Workout-only leaves durable stores alone: a ladder seeded into a note whose kind was not switched would be unreadable, and a registry entry would leak past the chosen scope. */
      if (choice === 'workout-and-registry') {
        await this.seedBodyweightLadder(ex)
      }
      await this.offerFirstLevelRelabel(index, relabelSource)
    }
  }

  /**
   * Seeds a fresh bodyweight card's ladder with one rung named after the
   * exercise, the same default a new bodyweight note carries, so the level
   * menu is usable immediately. An existing ladder is left alone.
   */
  private async seedBodyweightLadder(ex: ExerciseCard): Promise<void> {
    if ((this.currentBodyweightLevels(ex.name) ?? []).length > 0) {
      return
    }
    await this.persistLadder(ex.name, defaultBodyweightLevels(ex.name))
  }

  /**
   * Offers to mark the rows cleared by a switch to bodyweight as the first
   * rung. The count comes from the pre-switch entry, so the prompt states
   * the real number; declining keeps the cleared card as the switch left it.
   */
  private async offerFirstLevelRelabel(index: number, previous: ExerciseEntry): Promise<void> {
    if (!this.model) {
      return
    }
    const count = setRowCount(previous)
    if (count === 0) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex || ex.kind !== 'bodyweight') {
      return
    }
    const sets = count === 1 ? '1 already-logged set' : `${count} already-logged sets`
    const confirmed = await this.confirmFirstLevelRelabel(
      `${ex.name} has ${sets} in this workout. Mark them as level 1 of the new ladder? Strength weights carry as load, and declining keeps the cleared card.`,
    )
    if (!confirmed) {
      return
    }
    ex.bodyweightSets = relabelSetsAsFirstLevel(previous)
    this.markDirty()
    this.render()
  }

  private confirmFirstLevelRelabel(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      new ConfirmModal(
        this.app,
        {
          title: 'Mark logged sets as level 1?',
          message,
          confirmText: 'Mark as level 1',
          cancelText: 'Cancel',
        },
        resolve,
      ).open()
    })
  }

  /**
   * Writes the kind switch to the exercise note when one exists, and to the
   * registry either way. An exercise note always beats the registry overlay
   * (see buildExerciseRegistrySnapshot), so the note decides behaviour; the
   * registry copy keeps the settings table and its readers truthful.
   */
  private async persistKindChange(name: string, nextKind: ExerciseKind): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    const notePath = findExerciseNotePath(this.app, this.plugin.settings, trimmed)
    const noteFile = notePath ? this.app.vault.getAbstractFileByPath(notePath) : null
    if (noteFile instanceof TFile) {
      let result: ExerciseNoteKindUpdateResult | undefined
      await this.app.vault.process(noteFile, (text) => {
        result = setExerciseNoteKind(text, nextKind)
        return result.markdown
      })
      if (result?.changed) {
        new Notice(`Exercise note now records ${trimmed} as ${nextKind}.`)
        /**
         * The registry is read on its own by the settings table, so leaving
         * it behind would mislead the next reader and raise a conflict
         * against the note that just won. The note still wins on read.
         */
        await this.persistRegistryKind(trimmed, nextKind)
      } else {
        new Notice(
          `Could not update the exercise note for ${trimmed}; its frontmatter was left unchanged.`,
        )
      }
      return
    }
    await this.persistRegistryKind(trimmed, nextKind)
  }

  private chooseKindSwitch(
    card: ExerciseCard,
    nextKind: ExerciseKind,
    registryKind: ExerciseKind | null,
  ): Promise<KindSwitchChoice> {
    return new Promise((resolve) => {
      new KindSwitchChoiceModal(
        this.app,
        {
          exerciseName: card.name,
          currentKind: card.kind,
          nextKind,
          hasRows: hasRows(card),
          registryKind,
        },
        resolve,
      ).open()
    })
  }

  private async persistRegistryKind(name: string, nextKind: ExerciseKind): Promise<void> {
    const settings = this.plugin.settings
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    const current = createRegistry(settings.exerciseRegistry)
    const trimmedKey = normalize(trimmed)
    const existing = current.entries.find((entry) => normalize(entry.name) === trimmedKey)
    const nextEntry: ExerciseRegistryEntry = existing
      ? { ...existing, aliases: [...existing.aliases], kind: nextKind }
      : { name: trimmed, kind: nextKind, aliases: [] }
    const updated = upsertEntry(current, nextEntry)
    settings.exerciseRegistry = updated.entries
    await this.plugin.saveSettings()
    new Notice(`Registry now records ${trimmed} as ${nextKind}.`)
  }

  private async confirmKindSwitch(card: ExerciseCard, nextKind: ExerciseKind): Promise<boolean> {
    if (!hasRows(card)) {
      return true
    }
    return new Promise((resolve) => {
      new ConfirmModal(
        this.app,
        {
          title: 'Switch exercise type?',
          message: `${card.name} has ${card.kind} rows. Switching to ${nextKind} will clear those rows from the editor.`,
          confirmText: 'Switch and discard',
          cancelText: 'Cancel',
        },
        resolve,
      ).open()
    })
  }

  private applyKindSwitch(index: number, nextKind: ExerciseKind, clearedRows: boolean): void {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex || ex.kind === nextKind) {
      return
    }
    if (this.activeTimer?.card === ex) {
      this.abortTimer()
    }
    const previousKind = ex.kind
    ex.kind = nextKind
    ex.strengthSets = []
    ex.durationEntries = []
    ex.bodyweightSets = []
    this.markSeededWeight(seedEmptyRow(ex, this.exerciseHistory?.get(ex.name)))
    this.markDirty()
    this.render()
    if (clearedRows) {
      new Notice(`Switched to ${nextKind}. Previous ${previousKind} rows were cleared.`)
    }
  }

  /** Rows whose weight came from the plan and has not been typed over yet. View state only; never written to the note. */
  private get seededWeights(): WeakSet<EditableStrengthSet> {
    this.seededWeightsStore ??= new WeakSet<EditableStrengthSet>()
    return this.seededWeightsStore
  }

  private markSeededWeight(row: EditableStrengthSet | null): void {
    if (row) {
      this.seededWeights.add(row)
    }
  }

  private createCell(row: HTMLElement, label: string, cls?: string): HTMLElement {
    const cell = row.createDiv({ cls: cls ? `fitkit-cell ${cls}` : 'fitkit-cell' })
    cell.dataset.label = label
    return cell
  }

  private createInputCell(
    row: HTMLElement,
    label: string,
    attr: Record<string, string>,
  ): HTMLInputElement {
    const cell = this.createCell(row, label)
    const input = cell.createEl('input', { cls: 'fitkit-input', attr })
    input.setAttr('aria-label', label)
    return input
  }

  private focusRowCell(exerciseIndex: number, rowIndex: number, label: string): void {
    const cards = this.contentEl.querySelectorAll('.fitkit-exercise-list > .fitkit-card')
    const card = cards.item(exerciseIndex)
    if (!card?.instanceOf(HTMLElement)) {
      return
    }
    const rows = card.querySelectorAll('.fitkit-set-area > .fitkit-row')
    const row = rows.item(rowIndex)
    if (!row?.instanceOf(HTMLElement)) {
      return
    }
    const selector = `.fitkit-cell[data-label="${label}"] input.fitkit-input`
    const preferredInput = row.querySelector(`${selector}[data-fitkit-default-focus="true"]`)
    const input = preferredInput ?? row.querySelector(selector)
    if (input instanceof HTMLInputElement) {
      input.focus()
      input.select()
    }
  }

  private moveExercise(index: number, delta: number): void {
    if (!this.model) {
      return
    }
    const target = index + delta
    if (target < 0 || target >= this.model.exercises.length) {
      return
    }
    const arr = this.model.exercises
    const a = arr[index]
    const b = arr[target]
    if (!a || !b) {
      return
    }
    arr[index] = b
    arr[target] = a
    this.markDirty()
    this.render()
  }

  private removeExercise(index: number): void {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (ex && this.activeTimer?.card === ex) {
      this.abortTimer()
    }
    this.model.exercises.splice(index, 1)
    this.markDirty()
    this.render()
  }

  /**
   * The plan the user records for next session. Choosing the active direction
   * again clears it, matching the segmented control this replaced.
   */
  private addNextPlanMenuItems(menu: Menu, ex: ExerciseCard): void {
    for (const option of NEXT_PLAN_OPTIONS) {
      const isActive = ex.next?.direction === option.direction
      menu.addItem((item) =>
        item
          .setTitle(option.menuLabel)
          .setIcon(option.icon)
          .setChecked(isActive)
          .onClick(() => {
            ex.next = isActive ? undefined : buildNextPlan(option.direction, ex.next?.step)
            this.markDirty()
            this.render()
          }),
      )
    }

    const canSetStep = ex.next !== undefined && ex.next.direction !== 'stay'
    menu.addItem((item) =>
      item
        .setTitle('Set plan step...')
        .setIcon('ruler')
        .setDisabled(!canSetStep)
        .onClick(() => {
          const plan = ex.next
          if (!plan || plan.direction === 'stay') {
            return
          }
          new PlanStepModal(this.app, {
            exerciseName: ex.name,
            kind: ex.kind,
            initial: plan.step === undefined ? '' : formatPlanNumber(plan.step),
            onSave: (step) => {
              ex.next = buildNextPlan(plan.direction, step)
              this.markDirty()
              this.render()
            },
          }).open()
        }),
    )
  }

  private openCardMenu(evt: MouseEvent, index: number): void {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex) {
      return
    }
    const lastIndex = this.model.exercises.length - 1

    const menu = new Menu()
    menu.addItem((item) =>
      item
        .setTitle('Open exercise file')
        .setIcon('file-text')
        .onClick(() => void this.openOrCreateExerciseFile(ex)),
    )
    menu.addItem((item) =>
      item
        .setTitle('Rename exercise')
        .setIcon('pencil')
        .onClick(() => void this.openRenameExerciseModal(index)),
    )
    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle(ex.exerciseNotes ? 'Edit exercise note' : 'Add exercise note')
        .setIcon('sticky-note')
        .onClick(() => this.openExerciseNoteModal(ex)),
    )
    if (ex.kind === 'bodyweight') {
      menu.addItem((item) =>
        item
          .setTitle('Edit levels')
          .setIcon('list')
          .onClick(() => this.openEditLevelsModal(ex)),
      )
    }
    if (ex.kind === 'strength' || ex.kind === 'bodyweight') {
      menu.addSeparator()
      this.addNextPlanMenuItems(menu, ex)
    }
    menu.addSeparator()
    for (const nextKind of EXERCISE_KINDS) {
      if (nextKind === ex.kind) {
        continue
      }
      menu.addItem((item) =>
        item
          .setTitle(`Switch to ${nextKind}`)
          .setIcon('repeat')
          .onClick(() => void this.switchKind(index, nextKind)),
      )
    }
    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle('Move up')
        .setIcon('chevron-up')
        .setDisabled(index === 0)
        .onClick(() => this.moveExercise(index, -1)),
    )
    menu.addItem((item) =>
      item
        .setTitle('Move down')
        .setIcon('chevron-down')
        .setDisabled(index === lastIndex)
        .onClick(() => this.moveExercise(index, 1)),
    )
    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle('Remove exercise')
        .setIcon('trash-2')
        .setWarning(true)
        .onClick(() => void this.confirmAndRemoveExercise(index)),
    )

    const target = evt.currentTarget
    if (target instanceof HTMLElement) {
      const rect = target.getBoundingClientRect()
      menu.showAtPosition({ x: rect.left, y: rect.bottom })
    } else {
      menu.showAtMouseEvent(evt)
    }
  }

  private renderExerciseHistoryBadges(
    card: HTMLElement,
    ex: ExerciseCard,
    registry: ExerciseRegistry,
  ): void {
    const summary = this.exerciseHistory?.get(ex.name)
    /** One lookup per card: both badge kinds read the same ladder. */
    const levels = levelsForName(registry, ex.name)
    const badges = formatExerciseHistoryBadges(summary, ex.kind, levels)
    const planBadge = formatNextPlanBadge(
      summary,
      ex.kind,
      {
        plan: ex.next,
        sessionMax: pickMaxWeightSet(ex.strengthSets),
        sessionBodyweightMax: pickBestBodyweightSet(ex.bodyweightSets),
      },
      levels,
    )
    if (badges.length === 0 && !planBadge) {
      return
    }

    const historyRow = card.createDiv({ cls: 'fitkit-card-history' })
    for (const badge of badges) {
      historyRow.createSpan({
        cls: 'fitkit-card-badge',
        text: badge.text,
        attr: {
          title: badge.title,
          'aria-label': `${badge.text}: ${badge.title}`,
        },
      })
    }

    if (!planBadge) {
      return
    }
    const plan = historyRow.createSpan({
      cls: 'fitkit-card-badge fitkit-plan-badge',
      attr: {
        title: planBadge.title,
        'aria-label': `${planBadge.text}: ${planBadge.title}`,
      },
    })
    const icon = plan.createSpan({ cls: 'fitkit-plan-badge-icon', attr: { 'aria-hidden': 'true' } })
    setIcon(icon, planBadge.icon)
    plan.createSpan({ text: planBadge.text })
  }

  private async loadExerciseHistory(): Promise<ExerciseHistoryByName | null> {
    if (!this.model?.isFitKitWorkout) {
      return null
    }
    try {
      return await exerciseHistoryFromVault(this.plugin, {
        sourcePath: this.model.sourcePath,
        date: this.model.date,
      })
    } catch (error) {
      new Notice(`Could not load exercise history: ${formatError(error)}`)
      return null
    }
  }

  private async openOrCreateExerciseFile(exercise: ExerciseCard): Promise<void> {
    const plan = planExerciseFileOpen({
      name: exercise.name,
      kind: exercise.kind,
      noteExists: (path) => this.app.vault.getAbstractFileByPath(path) instanceof TFile,
      registryEntries: exerciseRegistryWithVaultNotes(this.app, this.plugin.settings),
      exercisesFolderPath: exercisesFolder(this.plugin.settings),
      workoutsFolderPath: workoutsFolder(this.plugin.settings),
      sourcePath: this.model?.sourcePath ?? '',
    })

    if (plan.kind === 'error') {
      new Notice(plan.message)
      return
    }

    const deletedKey = normalize(plan.name)
    const previousDeleted = this.plugin.settings.deletedExercises ?? []
    const hadTombstone = previousDeleted.some(
      (deletedName) => normalize(deletedName) === deletedKey,
    )
    let shouldClearTombstone = false

    if (plan.kind === 'create') {
      try {
        await ensureParentFolder(this.app, plan.path)
        await this.app.vault.create(
          plan.path,
          composeExerciseNote(plan.name, plan.exerciseKind, plan.workoutsFolderPath, plan.unit),
        )
        new Notice(`Created exercise note for '${plan.name}'.`)
        shouldClearTombstone = true
      } catch (error) {
        new Notice(
          `Could not create exercise note for '${plan.name}': ${formatErrorMessage(error)}.`,
        )
        return
      }
    }

    try {
      this.app.workspace.setActiveLeaf(this.leaf, { focus: true })
      await this.app.workspace.openLinkText(plan.path, plan.sourcePath || plan.path, false)
      shouldClearTombstone = true
    } catch (error) {
      new Notice(`Could not open exercise file: ${formatError(error)}`)
    }

    if (hadTombstone && shouldClearTombstone) {
      this.plugin.settings.deletedExercises = previousDeleted.filter(
        (deletedName) => normalize(deletedName) !== deletedKey,
      )
      await this.plugin.saveSettings()
    }
  }

  private installCardDrag(card: HTMLElement, handle: HTMLElement, list: HTMLElement): void {
    handle.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0) {
        return
      }
      if (this.dragSession) {
        return
      }
      const fromIndex = readCardIndex(card)
      if (fromIndex === null) {
        return
      }
      evt.preventDefault()
      handle.setPointerCapture(evt.pointerId)
      const indicator = list.createDiv({ cls: 'fitkit-drop-indicator' })
      const session: DragSession = {
        pointerId: evt.pointerId,
        fromIndex,
        toIndex: fromIndex,
        startY: evt.clientY,
        card,
        handle,
        list,
        indicator,
      }
      this.dragSession = session
      card.addClass('is-dragging')
      this.positionDropIndicator(session)
    })

    handle.addEventListener('pointermove', (evt) => {
      const session = this.dragSession
      if (!session || evt.pointerId !== session.pointerId) {
        return
      }
      const dy = evt.clientY - session.startY
      session.card.style.setProperty('--fitkit-drag-offset', `${dy}px`)
      session.toIndex = this.computeDropIndex(session, evt.clientY)
      this.positionDropIndicator(session)
    })
  }

  private computeDropIndex(session: DragSession, pointerY: number): number {
    const cards = Array.from(session.list.querySelectorAll<HTMLElement>(':scope > .fitkit-card'))
    let target = session.fromIndex
    for (let i = 0; i < cards.length; i++) {
      const sibling = cards[i]
      if (!sibling || sibling === session.card) {
        continue
      }
      const rect = sibling.getBoundingClientRect()
      const midpoint = rect.top + rect.height / 2
      if (pointerY < midpoint) {
        target = i
        break
      }
      target = i
    }
    return target
  }

  private positionDropIndicator(session: DragSession): void {
    const cards = Array.from(session.list.querySelectorAll<HTMLElement>(':scope > .fitkit-card'))
    const reference = cards[session.toIndex] ?? null
    if (reference === session.indicator) {
      return
    }
    if (reference) {
      session.list.insertBefore(session.indicator, reference)
    } else {
      session.list.appendChild(session.indicator)
    }
  }

  private endDrag(commit: boolean): void {
    const session = this.dragSession
    if (!session) {
      return
    }
    this.dragSession = null
    session.card.removeClass('is-dragging')
    session.card.style.removeProperty('--fitkit-drag-offset')
    if (session.handle.hasPointerCapture(session.pointerId)) {
      session.handle.releasePointerCapture(session.pointerId)
    }
    session.indicator.remove()
    if (!commit || !this.model) {
      return
    }
    const { fromIndex, toIndex } = session
    const targetIndex = toIndex > fromIndex ? toIndex - 1 : toIndex
    if (fromIndex === targetIndex) {
      return
    }
    this.model.exercises = reorderArray(this.model.exercises, fromIndex, targetIndex)
    this.markDirty()
    this.render()
  }

  private async confirmAndRemoveExercise(index: number): Promise<void> {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex) {
      return
    }
    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        this.app,
        {
          title: 'Remove exercise?',
          message: `Remove "${ex.name}"? This cannot be undone.`,
          confirmText: 'Remove',
          cancelText: 'Cancel',
        },
        resolve,
      ).open()
    })
    if (!confirmed) {
      return
    }
    this.removeExercise(index)
  }

  private async openAddExerciseModal(): Promise<void> {
    if (!this.model) {
      return
    }
    const names = await this.collectExerciseSuggestions()
    const registry = createRegistry(exerciseRegistryWithVaultNotes(this.app, this.plugin.settings))
    new ExerciseSuggestModal(this.app, names, (name) => {
      void this.addExerciseFromSuggestion(name, registry)
    }).open()
  }

  private async addExerciseFromSuggestion(
    name: string,
    registry: ReturnType<typeof createRegistry>,
  ): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || !this.model) {
      return
    }
    const exerciseIndex = this.model.exercises.length
    const registryKind = kindForName(registry, trimmed)
    const kind: ExerciseKind = registryKind ?? 'strength'
    const card: ExerciseCard = {
      name: trimmed,
      kind,
      strengthSets: [],
      durationEntries: [],
      bodyweightSets: [],
    }
    this.markSeededWeight(seedEmptyRow(card, this.exerciseHistory?.get(trimmed)))
    this.model.exercises.push(card)
    this.markDirty()
    this.render()
    const focusLabel = FOCUS_COLUMN_LABELS[kind]
    this.focusRowCell(exerciseIndex, 0, focusLabel)

    if (registryKind === null) {
      const wasDeleted = (this.plugin.settings.deletedExercises ?? []).some(
        (deletedName) => normalize(deletedName) === normalize(trimmed),
      )
      const createNote = await this.promptForUnknownExercise(trimmed, wasDeleted)
      if (createNote !== null) {
        await this.persistUnknownExercise(trimmed, kind, createNote)
      }
    }
  }

  private async promptForUnknownExercise(
    name: string,
    wasDeleted: boolean,
  ): Promise<boolean | null> {
    return new Promise((resolve) => {
      new UnknownExerciseModal(this.app, name, wasDeleted, resolve).open()
    })
  }

  private async persistUnknownExercise(
    name: string,
    kind: ExerciseKind,
    createNote: boolean,
  ): Promise<void> {
    let settingsChanged = false
    const deletedKey = normalize(name)
    const previousDeleted = this.plugin.settings.deletedExercises ?? []
    const hadTombstone = previousDeleted.some(
      (deletedName) => normalize(deletedName) === deletedKey,
    )

    if (createNote) {
      const path = normalizePath(`${exercisesFolder(this.plugin.settings)}/${name}.md`)
      if (!this.app.vault.getAbstractFileByPath(path)) {
        try {
          await ensureParentFolder(this.app, path)
          await this.app.vault.create(
            path,
            composeExerciseNote(name, kind, workoutsFolder(this.plugin.settings)),
          )
        } catch (error) {
          new Notice(`Could not create exercise note for '${name}': ${formatErrorMessage(error)}.`)
          return
        }
        /**
         * A note-backed exercise still needs a registry entry so it shows up in
         * the settings Registry table, which lists settings.exerciseRegistry
         * directly rather than the note-merged snapshot.
         */
        const registry = createRegistry(this.plugin.settings.exerciseRegistry)
        if (kindForName(registry, name) === null) {
          this.plugin.settings.exerciseRegistry = upsertEntry(registry, {
            name,
            kind,
            aliases: [],
          }).entries
          settingsChanged = true
        }
        new Notice(`Created exercise note for '${name}'.`)
      } else {
        new Notice(
          hadTombstone
            ? `Restored '${name}' using the existing exercise note.`
            : `Using existing exercise note for '${name}'.`,
        )
      }
    } else {
      const registry = createRegistry(this.plugin.settings.exerciseRegistry)
      if (kindForName(registry, name) === null) {
        this.plugin.settings.exerciseRegistry = upsertEntry(registry, {
          name,
          kind,
          aliases: [],
        }).entries
        settingsChanged = true
        new Notice(`Added '${name}' as a no-note registry entry.`)
      }
    }

    if (hadTombstone) {
      this.plugin.settings.deletedExercises = previousDeleted.filter(
        (deletedName) => normalize(deletedName) !== deletedKey,
      )
      settingsChanged = true
    }

    if (settingsChanged) {
      await this.plugin.saveSettings()
    }
  }

  private async openRenameExerciseModal(index: number): Promise<void> {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex) {
      return
    }
    const names = await this.collectExerciseSuggestions()
    const registry = createRegistry(exerciseRegistryWithVaultNotes(this.app, this.plugin.settings))
    const modal = new ExerciseSuggestModal(this.app, names, (name) => {
      const trimmed = name.trim()
      if (!trimmed || !this.model) {
        return
      }
      void this.applyRename(index, trimmed, registry)
    })
    modal.open()
    modal.inputEl.value = ex.name
    modal.inputEl.dispatchEvent(new Event('input'))
  }

  private async applyRename(
    index: number,
    trimmed: string,
    registry: ReturnType<typeof createRegistry>,
  ): Promise<void> {
    if (!this.model) {
      return
    }
    const target = this.model.exercises[index]
    if (!target) {
      return
    }
    if (target.name === trimmed) {
      return
    }
    const nextKind = kindForName(registry, trimmed)
    if (nextKind && nextKind !== target.kind) {
      const hadRows = hasRows(target)
      const confirmed = await this.confirmKindSwitch(target, nextKind)
      if (!confirmed) {
        return
      }
      /** Captured before the switch clears the card, mirroring the card menu path. */
      const relabelSource = nextKind === 'bodyweight' ? toWorkoutExercise(target) : null
      target.name = trimmed
      this.applyKindSwitch(index, nextKind, hadRows)
      if (nextKind === 'bodyweight' && relabelSource) {
        const switched = this.model.exercises[index]
        if (switched) {
          await this.seedBodyweightLadder(switched)
        }
        await this.offerFirstLevelRelabel(index, relabelSource)
      }
      return
    }
    target.name = trimmed
    this.markDirty()
    this.render()
  }

  private async collectExerciseSuggestions(): Promise<string[]> {
    const names = new Set<string>()
    const exerciseFolder = exercisesFolder(this.plugin.settings)
    const workoutFolder = workoutsFolder(this.plugin.settings)
    const registryKeys = new Set(
      this.plugin.settings.exerciseRegistry.map((entry) => normalize(entry.name)),
    )

    for (const file of markdownFilesInFolder(this.app, exerciseFolder)) {
      names.add(file.basename)
    }

    for (const file of markdownFilesInFolder(this.app, workoutFolder)) {
      try {
        const text = await this.app.vault.cachedRead(file)
        const result = parseWorkoutNote(text, file.path)
        if (!result.isWorkout || !result.model) {
          continue
        }
        for (const exercise of result.model.exercises) {
          names.add(exercise.exerciseName)
        }
      } catch {
        /** Suggestion-list collection should never break the editor; skip unreadable or unparseable files silently. */
        continue
      }
    }

    return filterSuggestableNames(
      Array.from(names),
      this.plugin.settings.deletedExercises ?? [],
      registryKeys,
    ).sort((a, b) => a.localeCompare(b))
  }

  private markDirty(): void {
    this.dirty = true
    this.updateMetaText()
    this.scheduleAutoSave()
  }

  /**
   * The meta line is the only place the file identifies itself now that the
   * pane heading is gone. Workout notes are date-named, so the date is dropped
   * when it just repeats the basename.
   */
  private metaLineText(): string {
    const basename = this.session?.file?.basename
    const identity: string[] = []
    if (basename) {
      identity.push(basename)
    }
    const date = this.model?.date
    if (date && date !== basename) {
      identity.push(date)
    }

    const parts: string[] = []
    if (identity.length > 0) {
      parts.push(identity.join(', '))
    }
    if (this.dirty) {
      parts.push('unsaved')
    }
    return parts.join(' | ')
  }

  private updateMetaText(): void {
    const line = this.contentEl.querySelector('.fitkit-meta-line')
    if (line instanceof HTMLElement) {
      line.setText(this.metaLineText())
    }
  }

  private scheduleAutoSave(): void {
    if (this.conflictDetected) {
      return
    }
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer)
    }
    this.autoSaveTimer = window.setTimeout(() => {
      this.autoSaveTimer = null
      void this.flushAutoSave()
    }, this.plugin.settings.autosaveDebounceMs)
  }

  private async flushAutoSave(): Promise<void> {
    if (!this.session || !this.model) {
      return
    }
    if (!this.dirty || !this.model.isFitKitWorkout) {
      return
    }
    if (this.conflictDetected) {
      return
    }
    if (this.autoSaveInflight) {
      this.autoSaveRequeued = true
      return
    }
    this.autoSaveInflight = true
    /**
     * Captured before the write so a concurrent onClose/loadFile on this view
     * (which can null out or reassign this.session while we await below)
     * cannot make the refresh below crash or target the wrong file.
     */
    const session = this.session
    const path = session.file.path
    try {
      const nextText = serializeWorkoutNote(toWorkoutNoteModel(this.model))
      const result = await session.saveIfUnchanged(nextText)
      if (!result.ok) {
        this.conflictDetected = true
        new Notice('File changed on disk. Reload before further edits.')
        this.render()
        return
      }
      this.dirty = false
      this.updateMetaText()
      /** A refresh failure is a cache-staleness problem, not a save failure; never let it surface as an unhandled rejection or block the finally below. */
      await this.plugin.refreshIndexEntry(path).catch(() => undefined)
    } finally {
      this.autoSaveInflight = false
      if (this.autoSaveRequeued) {
        this.autoSaveRequeued = false
        /** Only reschedule if the view is still live; onClose may have torn down session/model while this save was in flight. */
        if (this.session) {
          this.scheduleAutoSave()
        }
      }
    }
  }
}

class UnknownExerciseModal extends Modal {
  private choice: boolean | null = null

  constructor(
    app: App,
    private name: string,
    private wasDeleted: boolean,
    private onChoice: (createNote: boolean | null) => void,
  ) {
    super(app)
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    this.setTitle('Add exercise')
    contentEl.createEl('p', {
      text: this.wasDeleted
        ? `"${this.name}" was previously deleted and ignored. Add it again?`
        : `"${this.name}" is not in your exercise registry yet.`,
      cls: 'fitkit-import-muted',
    })

    const checkboxRow = contentEl.createEl('label', { cls: 'fitkit-import-checkbox-row' })
    const checkbox = checkboxRow.createEl('input', { attr: { type: 'checkbox' } })
    checkbox.checked = true
    checkboxRow.createSpan({ text: 'Create exercise note' })

    const actions = contentEl.createDiv({ cls: 'fitkit-import-actions' })
    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Skip' })
    cancel.addEventListener('click', () => {
      this.choice = null
      this.close()
    })
    const add = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-primary',
      text: 'Add exercise',
    })
    add.addEventListener('click', () => {
      this.choice = checkbox.checked
      this.close()
    })
  }

  onClose(): void {
    this.contentEl.empty()
    this.onChoice(this.choice)
  }
}

/**
 * Widths behind a rung label decision: the text slot against its content.
 * A separate function so tests can observe the measuring path; element
 * widths read zero in the test realm unless the test sets them.
 */
export interface LevelLabelWidths {
  available: number
  content: number
}

/** The text span against its own slot, never the padded button around it. */
export function measureLevelLabelWidths(full: HTMLElement): LevelLabelWidths {
  return { available: full.clientWidth, content: full.scrollWidth }
}

/**
 * Whether a rung name needs its compact form. The name shortens only when
 * its own rendered width overruns the space the cell offers, so an
 * arbitrarily long ladder name still fits on a wide window.
 */
export function shouldShortenLevelLabel(labelWidth: number, availableWidth: number): boolean {
  return labelWidth > availableWidth
}

function parseNumberInput(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return undefined
  }
  const n = Number(trimmed)
  if (Number.isNaN(n)) {
    return undefined
  }
  return n
}

function setAriaInvalid(element: HTMLElement, invalid: boolean): void {
  if (invalid) {
    element.setAttr('aria-invalid', 'true')
  } else {
    element.toggleAttribute('aria-invalid', false)
  }
}

function hasRows(card: ExerciseCard): boolean {
  return (
    card.strengthSets.length > 0 ||
    card.durationEntries.length > 0 ||
    card.bodyweightSets.length > 0
  )
}

/**
 * Seed the first row of a fresh exercise. A strength row starts at the weight
 * the plan recorded last session, since that number is chosen before the set;
 * reps are never seeded, since they are only known after it.
 */
function seedEmptyRow(
  card: ExerciseCard,
  summary?: ExerciseHistorySummary,
): EditableStrengthSet | null {
  switch (card.kind) {
    case 'bodyweight':
      card.bodyweightSets.push({ set: 1, level: 1 })
      return null
    case 'duration':
      card.durationEntries.push({})
      return null
    case 'strength': {
      const target = seededSetWeight(summary)
      if (target === null) {
        card.strengthSets.push({ set: 1 })
        return null
      }
      const row: EditableStrengthSet = { set: 1, weight: target }
      card.strengthSets.push(row)
      return row
    }
  }
}

function seededSetWeight(summary: ExerciseHistorySummary | undefined): number | null {
  const plan = summary?.nextPlan?.value
  const base = summary?.strength?.lastSessionMax?.value.weight
  if (!plan || base === undefined || base <= 0) {
    return null
  }
  return nextPlanTargetWeight(plan, base)
}

function toEditorWorkoutModel(
  model: WorkoutNoteModel | null,
  isWorkout: boolean,
  sourcePath: string,
): EditorWorkoutModel {
  if (!model) {
    return {
      isFitKitWorkout: isWorkout,
      date: '',
      name: '',
      sourcePath,
      exercises: [],
      preserveBlocks: [],
      frontmatterExtra: [],
    }
  }

  return {
    isFitKitWorkout: isWorkout,
    date: model.date,
    name: model.name,
    sourcePath: model.sourcePath,
    exercises: model.exercises.map(toEditorExercise),
    preserveBlocks: [...model.preserveBlocks],
    frontmatterExtra: [...model.frontmatterExtra],
  }
}

export function toEditorExercise(exercise: ExerciseEntry): ExerciseCard {
  let card: ExerciseCard
  switch (exercise.kind) {
    case 'strength':
      card = {
        name: exercise.exerciseName,
        kind: exercise.kind,
        strengthSets: exercise.strengthSets.map(toEditorStrengthSet),
        durationEntries: [],
        bodyweightSets: [],
      }
      break
    case 'bodyweight':
      card = {
        name: exercise.exerciseName,
        kind: exercise.kind,
        strengthSets: [],
        durationEntries: [],
        bodyweightSets: exercise.bodyweightSets.map(toEditorBodyweightSet),
      }
      break
    case 'duration':
      card = {
        name: exercise.exerciseName,
        kind: exercise.kind,
        strengthSets: [],
        durationEntries: exercise.durationEntries.map(toEditorDurationEntry),
        bodyweightSets: [],
      }
      break
    default:
      return assertUnreachableKind(exercise)
  }
  if (exercise.note !== undefined) {
    card.exerciseNotes = exercise.note
  }
  if (exercise.next !== undefined) {
    card.next = exercise.next
  }
  return card
}

function buildNextPlan(direction: NextPlanDirection, step: number | undefined): NextPlan {
  return direction === 'stay' || step === undefined ? { direction } : { direction, step }
}

function toEditorStrengthSet(set: StrengthSet): EditableStrengthSet {
  const editable: EditableStrengthSet = {
    set: set.set,
  }
  if (set.weight !== undefined) {
    editable.weight = set.weight
  }
  if (set.reps !== undefined) {
    editable.reps = set.reps
  }
  if (set.note !== undefined) {
    editable.note = set.note
  }
  return editable
}

function toEditorBodyweightSet(set: BodyweightSet): EditableBodyweightSet {
  const editable: EditableBodyweightSet = { level: set.level }
  if (set.set !== undefined) {
    editable.set = set.set
  }
  if (set.reps !== undefined) {
    editable.reps = set.reps
  }
  if (set.load !== undefined) {
    editable.load = set.load
  }
  if (set.note !== undefined) {
    editable.note = set.note
  }
  return editable
}

function toEditorDurationEntry(entry: DurationEntry): EditableDurationEntry {
  const editable: EditableDurationEntry = {
    durationSeconds: entry.durationSeconds,
  }
  if (entry.set !== undefined) {
    editable.set = entry.set
  }
  if (entry.note !== undefined) {
    editable.note = entry.note
  }
  return editable
}

function toWorkoutNoteModel(model: EditorWorkoutModel): WorkoutNoteModel {
  return {
    date: model.date,
    name: model.name,
    sourcePath: model.sourcePath,
    exercises: model.exercises.map(toWorkoutExercise),
    preserveBlocks: [...model.preserveBlocks],
    frontmatterExtra: [...model.frontmatterExtra],
  }
}

/** Title and message behind the ladder history warning, kept apart from the modal so the words the user reads are unit-testable. */
export interface LadderChangesWarning {
  title: string
  message: string
}

/** Every affected level with what it means now and what it would come to mean. */
export function formatLadderChangesWarning(
  name: string,
  changes: BodyweightLadderChange[],
): LadderChangesWarning {
  const lines = changes.map(
    (change) =>
      `Level ${change.level} currently means '${change.from}' and would come to mean '${change.to}'.`,
  )
  return {
    title: `Change what logged levels mean for ${name}?`,
    message: `This edit changes what some already-logged levels mean. ${lines.join(' ')} Logged sets keep their numbers.`,
  }
}

export function toWorkoutExercise(card: ExerciseCard): ExerciseEntry {
  const note = card.exerciseNotes
  const next = card.next
  switch (card.kind) {
    case 'strength': {
      const entry: StrengthExerciseEntry = {
        exerciseName: card.name,
        kind: card.kind,
        strengthSets: card.strengthSets.map(toStrengthSet),
      }
      return withNoteAndNext(entry, note, next)
    }
    case 'duration': {
      const entry: DurationExerciseEntry = {
        exerciseName: card.name,
        kind: card.kind,
        durationEntries: card.durationEntries.map(toDurationEntry),
      }
      return withNoteAndNext(entry, note, next)
    }
    case 'bodyweight': {
      const entry: BodyweightExerciseEntry = {
        exerciseName: card.name,
        kind: card.kind,
        bodyweightSets: card.bodyweightSets.map(toBodyweightSet),
      }
      return withNoteAndNext(entry, note, next)
    }
  }
}

function toStrengthSet(set: EditableStrengthSet, index: number): StrengthSet {
  const strengthSet: StrengthSet = {
    set: set.set ?? index + 1,
  }
  if (set.weight !== undefined) {
    strengthSet.weight = set.weight
  }
  if (set.reps !== undefined) {
    strengthSet.reps = set.reps
  }
  if (set.note !== undefined) {
    strengthSet.note = set.note
  }
  return strengthSet
}

/** A fresh row names no rung yet; the ladder base stands in until the card offers rung picking. */
function toBodyweightSet(set: EditableBodyweightSet): BodyweightSet {
  const bodyweightSet: BodyweightSet = {
    level: set.level ?? 1,
  }
  if (set.set !== undefined) {
    bodyweightSet.set = set.set
  }
  if (set.reps !== undefined) {
    bodyweightSet.reps = set.reps
  }
  if (set.load !== undefined) {
    bodyweightSet.load = set.load
  }
  if (set.note !== undefined) {
    bodyweightSet.note = set.note
  }
  return bodyweightSet
}

function toDurationEntry(entry: EditableDurationEntry): DurationEntry {
  const durationEntry: DurationEntry = {
    durationSeconds: entry.durationSeconds ?? 0,
  }
  if (entry.set !== undefined) {
    durationEntry.set = entry.set
  }
  if (entry.note !== undefined) {
    durationEntry.note = entry.note
  }
  return durationEntry
}

function readCardIndex(card: HTMLElement): number | null {
  const raw = card.dataset.exerciseIndex
  if (!raw) {
    return null
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? null : parsed
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
