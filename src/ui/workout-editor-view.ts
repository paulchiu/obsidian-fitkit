import type { App, WorkspaceLeaf } from 'obsidian'
import { FileView, Menu, Modal, Notice, TFile, setIcon } from 'obsidian'

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
import { loggedReps, restsAfter, type RunRow } from '../domain/interval-run'
import {
  resumeSession,
  startSession,
  stepSession,
  type RunEvent,
  type RunSession,
  type RunTransition,
} from '../domain/interval-session'
import { summarisePlan } from '../domain/plan-summary'
import { INTENSITY_KINDS, type IntensityKind } from '../domain/interval-plan'
import { parseIntervalProgram, type IntervalProgram } from '../domain/interval-program'
import { parseIntervalPresets } from '../domain/interval-presets'
import { assertUnreachableKind } from '../domain/exercise-kind'
import {
  formatExerciseHistoryBadges,
  formatNextPlanBadge,
  pickMaxWeightSet,
  type ExerciseHistoryByName,
  type ExerciseHistorySummary,
} from '../domain/exercise-history'
import {
  typeForName,
  levelsForName,
  normalize,
  unitForName,
  type ExerciseRegistry,
} from '../domain/exercise-registry'
import { formatLocalTimestamp } from '../domain/local-timestamp'
import { DEFAULT_WEIGHT_UNIT } from '../domain/weight-unit'
import {
  EXERCISE_TYPES,
  kindOfType,
  loggedTypeOf,
  type ExerciseType,
} from '../domain/exercise-type'
import { planTypeSwitch, type TypeSwitchPlan } from '../domain/exercise-type-switch'
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
import { exercisesFolder, isInFolder, workoutsFolder } from '../settings-paths'
import { createAutosaver, type Autosaver } from '../vault/autosaver'
import { composeExerciseNote } from '../vault/exercise-note'
import { planExerciseFileOpen } from '../vault/exercise-file-plan'
import { exerciseHistoryFromVault } from '../vault/exercise-history-vault'
import { exerciseRegistryWithVaultNotes } from '../vault/exercise-registry-vault'
import {
  createExerciseStore,
  type EnsureKnownResult,
  type ExerciseStore,
  type LadderRecordResult,
  type TypeRecordResult,
} from '../vault/exercise-store'
import { FileSession } from '../vault/file-session'
import { markdownFilesInFolder } from '../vault/folder-scan'
import { ensureParentFolder } from '../vault/vault-utils'
import { ConfirmModal } from './confirm-modal'
import { EditLevelsModal } from './edit-levels-modal'
import { createCuePlayer, type CuePlayer } from './interval-cues'
import { clockSeconds, formatClock, renderRunner } from './interval-runner'
import { renderRestTimer, renderSetTimer } from './timer-screen'
import { createTabScreens, type ScreenStop, type TabScreens, type WakeHold } from './tab-screens'
import { IntervalPlanModal } from './interval-plan-modal'
import { ExerciseSuggestModal } from './exercise-suggest-modal'
import { KindSwitchChoiceModal, type KindSwitchChoice } from './kind-switch-choice-modal'
import { menuAnchorForTrigger } from './menu-anchor'
import { renderPlanSummary } from './plan-summary-view'
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

interface Stopwatch {
  startedAtMs: number
  /** Seconds the set already had when this stretch of timing started. */
  accumulator: number
}

/** A duration card's timer shown full-tab; it stays open after Stop so the next set starts from it. */
interface SetTimerScreen {
  kind: 'set'
  card: ExerciseCard
  /** The set on the clock, kept after Stop so Resume and Reset act on it. */
  entry: EditableDurationEntry
  /** Null while the set is stopped. */
  stopwatch: Stopwatch | null
  clockEl: HTMLElement | null
}

interface RunScreen {
  kind: 'run'
  card: ExerciseCard
  session: RunSession
  clockEl: HTMLElement | null
  /** Also the screen's wake lock. */
  cues: CuePlayer
}

interface RestScreen {
  kind: 'rest'
  startedAtMs: number
  clockEl: HTMLElement | null
}

/** A screen that takes over the whole tab in place of the card list. */
type EditorScreen = SetTimerScreen | RunScreen | RestScreen

export const VIEW_TYPE_FITKIT_WORKOUT_EDITOR = 'fitkit-workout-editor'

interface EditableStrengthSet {
  set?: number
  weight?: number
  reps?: number
  note?: string
}

type EditableDurationEntry = RunRow

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
  /** Raw `[plan::]` text; only a duration card writes it back. */
  plan?: string
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

/**
 * A FileView so Obsidian treats the open workout as the active file (reveal in
 * navigation, explorer highlight) and persists it in the workspace state.
 */
export class WorkoutEditorView extends FileView {
  allowNoFile = true
  private session: FileSession | null = null
  private model: EditorWorkoutModel | null = null
  private exerciseHistory: ExerciseHistoryByName | null = null
  private resizeObserver: ResizeObserver | null = null
  private dragSession: DragSession | null = null
  private seededWeightsStore?: WeakSet<EditableStrengthSet>
  private exerciseStoreInstance?: ExerciseStore
  private autosaverInstance?: Autosaver
  private screensInstance?: TabScreens<EditorScreen>
  private lastRestSeconds: number | null = null
  /**
   * One store per view, so its ladder overlay spans the session. Lazily
   * created because prototype-built views never run field initializers.
   */
  private get exerciseStore(): ExerciseStore {
    this.exerciseStoreInstance ??= createExerciseStore(this.app, this.plugin)
    return this.exerciseStoreInstance
  }

  /** Lazily created for the same reason as exerciseStore. */
  private get autosaver(): Autosaver {
    this.autosaverInstance ??= createAutosaver({
      session: () => this.session,
      serialize: () =>
        this.model?.isFitKitWorkout ? serializeWorkoutNote(toWorkoutNoteModel(this.model)) : null,
      debounceMs: () => this.plugin.settings.autosaveDebounceMs,
      refreshIndex: (path) => this.plugin.refreshIndexEntry(path),
      onChange: () => this.updateMetaText(),
      onConflict: () => {
        new Notice('File changed on disk. Reload before further edits.')
        this.render()
      },
    })
    return this.autosaverInstance
  }

  /** Lazily created for the same reason as exerciseStore. */
  private get screens(): TabScreens<EditorScreen> {
    this.screensInstance ??= createTabScreens<EditorScreen>({
      scroller: () => this.contentEl,
      render: () => this.render(),
      stop: (screen, how) => this.stopScreen(screen, how),
    })
    return this.screensInstance
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

  /** Obsidian fires file-menu only from its editable file views, so this tab adds its own switch. */
  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source)
    const file = this.currentFile
    if (source !== 'more-options' || !file) {
      return
    }
    menu.addItem((item) =>
      item
        .setSection('pane')
        .setTitle('Open as Markdown')
        .setIcon('file-text')
        .onClick(() => this.plugin.openLeafAsMarkdown(this.leaf, file)),
    )
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
    this.registerEvent(this.app.metadataCache.on('changed', (file) => this.onMetadataChanged(file)))
    /** The OS drops a wake lock whenever the app is hidden, so take it again on return. */
    this.registerDomEvent(activeDocument, 'visibilitychange', () => {
      if (activeDocument.visibilityState === 'visible') {
        this.screens.wakeAgain()
      }
    })
    this.renderEmpty('Open a workout note to edit.')
  }

  /** Exercise notes own ladders, kinds and units, so an edit made outside the editor re-renders the open workout. */
  private onMetadataChanged(file: TFile): void {
    if (!this.model || !this.session) {
      return
    }
    if (!isInFolder(file.path, exercisesFolder(this.plugin.settings))) {
      return
    }
    this.render()
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
    this.screens.teardown('bank')
    this.lastRestSeconds = null
    await this.autosaver.settle()
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

  async onUnloadFile(): Promise<void> {
    this.screens.teardown('bank')
    this.lastRestSeconds = null
    await this.autosaver.settle()
  }

  async onLoadFile(file: TFile): Promise<void> {
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
    this.autosaver.reset()
    this.resumeSavedTimer()
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
    this.screens.teardown('discard')
    /** Autosave stays blocked by the conflict until the disk copy is in, so an edit made during the read cannot write the stale model. */
    const { model, isWorkout } = await this.session.load()
    this.model = toEditorWorkoutModel(model, isWorkout, this.session.file.path)
    if (!this.model.isFitKitWorkout) {
      this.exerciseHistory = null
    }
    this.autosaver.reset()
    this.resumeSavedTimer()
    this.render()
    new Notice('Reloaded from disk.')
  }

  private renderEmpty(message: string): void {
    this.contentEl.empty()
    const wrap = this.contentEl.createDiv({ cls: 'fitkit-empty' })
    wrap.setText(message)
  }

  private renderSkeleton(): void {
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
    const screen = this.screens.current()
    if (screen?.kind === 'run') {
      this.renderRun(container, screen)
      return
    }
    if (screen?.kind === 'set') {
      this.renderSetTimerScreen(container, screen)
      return
    }
    if (screen?.kind === 'rest') {
      screen.clockEl = renderRestTimer(container, this.liveRestSeconds(screen), {
        stop: () => this.stopRestTimer(),
      })
      return
    }

    this.renderHeader(container)

    if (!this.model.isFitKitWorkout) {
      const warn = container.createDiv({ cls: 'fitkit-warn' })
      warn.setText(
        'This note has no `type: workout` frontmatter. The editor will not save changes here.',
      )
      return
    }

    if (this.autosaver.state().conflict) {
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
    const registry = this.exerciseStore.registry()
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
    const control = footer.createDiv({ cls: 'fitkit-rest-timer-control' })
    const button = control.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-muted fitkit-rest-timer-button',
      attr: { type: 'button', 'aria-label': 'Start rest timer' },
    })
    setIcon(button, 'timer')
    button.createSpan({ cls: 'fitkit-rest-timer-label', text: 'Start rest' })
    button.addEventListener('click', () => this.startRestTimer())

    if (this.lastRestSeconds !== null) {
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
    const snapshot = registry ?? this.exerciseStore.registry()

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
      const next: EditableStrengthSet = { set: nextSetNumber(ex.strengthSets) }
      if (last?.weight !== undefined) {
        next.weight = last.weight
      }
      ex.strengthSets.push(next)
      this.markDirty()
      this.render()
      this.focusRowCell(exerciseIndex, ex.strengthSets.length - 1, 'Weight')
    })
    const repeatBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Repeat' })
    repeatBtn.disabled = ex.strengthSets.length === 0
    repeatBtn.addEventListener('click', () => {
      const last = ex.strengthSets[ex.strengthSets.length - 1]
      ex.strengthSets.push({
        set: nextSetNumber(ex.strengthSets),
        weight: last?.weight,
        reps: last?.reps,
      })
      this.markDirty()
      this.render()
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
      ex.bodyweightSets.push({ set: nextSetNumber(ex.bodyweightSets), level: last?.level ?? 1 })
      this.markDirty()
      this.render()
      this.focusRowCell(exerciseIndex, ex.bodyweightSets.length - 1, 'Reps')
    })
    const repeatBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Repeat' })
    repeatBtn.disabled = ex.bodyweightSets.length === 0
    repeatBtn.addEventListener('click', () => {
      const last = ex.bodyweightSets[ex.bodyweightSets.length - 1]
      ex.bodyweightSets.push({
        set: nextSetNumber(ex.bodyweightSets),
        level: last?.level,
        reps: last?.reps,
        load: last?.load,
      })
      this.markDirty()
      this.render()
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
      menu.showAtPosition(menuAnchorForTrigger(rect))
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
    const columns = intervalColumns(ex)
    if (ex.plan !== undefined) {
      const line = card.createDiv({
        cls: 'fitkit-plan-line',
        attr: { role: 'button', tabindex: '0', 'aria-label': 'Edit interval plan' },
      })
      if (columns.plan) {
        renderPlanSummary(line, summarisePlan(ex.plan, columns.plan, ex.durationEntries), ex.plan)
      } else {
        line.createDiv({ cls: 'fitkit-plan-legend', text: ex.plan })
      }
      line.addEventListener('click', () => this.openIntervalPlanModal(ex))
    }
    const wrap = card.createDiv({ cls: 'fitkit-set-area' })

    const header = wrap.createDiv({
      cls: durationRowClasses(columns, 'fitkit-set-row fitkit-duration-row fitkit-set-head'),
    })
    // The set column is a figure now, too narrow for a label; the rows still name it.
    header.createSpan({ cls: 'fitkit-set-label fitkit-set-figure' })
    header.createSpan({ cls: 'fitkit-set-label', text: 'Duration' })
    if (columns.intensity) {
      header.createSpan({ cls: 'fitkit-set-label', text: INTENSITY_LABELS[columns.intensity] })
    }
    if (columns.rest) {
      header.createSpan({ cls: 'fitkit-set-label', text: 'Rest' })
    }

    for (let i = 0; i < ex.durationEntries.length; i++) {
      this.renderDurationRow(wrap, ex, i, exerciseIndex, columns)
    }

    const actions = wrap.createDiv({ cls: 'fitkit-row-actions' })
    const addBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Add set' })
    addBtn.addEventListener('click', () => {
      if (this.runningSetTimer()?.card === ex) {
        this.stopTimer({ write: true })
      }
      ex.durationEntries.push(carriedIntervalFields(ex.durationEntries.at(-1)))
      this.markDirty()
      this.render()
    })
    const repeatBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Repeat' })
    repeatBtn.disabled = ex.durationEntries.length === 0
    repeatBtn.addEventListener('click', () => {
      if (this.runningSetTimer()?.card === ex) {
        this.stopTimer({ write: true })
      }
      const last = ex.durationEntries[ex.durationEntries.length - 1]
      ex.durationEntries.push({
        set: nextSetNumber(ex.durationEntries),
        durationSeconds: last?.durationSeconds,
        ...carriedIntervalFields(last),
      })
      this.markDirty()
      this.render()
    })

    if (columns.plan) {
      const done = loggedReps(ex.durationEntries)
      const runBtn = actions.createEl('button', {
        cls: 'fitkit-btn fitkit-btn-primary fitkit-run-button',
        text: done > 0 ? `Start from rep ${done + 1}` : 'Start',
        attr: { 'aria-label': 'Start interval plan' },
      })
      runBtn.disabled = done >= columns.plan.steps.length
      const program = columns.plan
      runBtn.addEventListener('click', () => this.startIntervalRun(ex, program))
      return
    }

    const timerBtn = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-timer-button',
      text: 'Start timer',
      attr: { 'aria-label': 'Start timer' },
    })
    setIcon(timerBtn, 'play')
    timerBtn.addEventListener('click', () => this.openSetTimer(ex))
  }

  private renderDurationRow(
    wrap: HTMLElement,
    ex: ExerciseCard,
    i: number,
    exerciseIndex: number,
    columns: IntervalColumns = intervalColumns(ex),
  ): void {
    const durationEntry = ex.durationEntries[i]
    if (!durationEntry) {
      return
    }
    const container = wrap.createDiv({ cls: 'fitkit-row' })
    container.dataset.fitkitTimerRow = `${exerciseIndex}:${i}`
    const body = container.createDiv({ cls: 'fitkit-row-body' })
    const row = body.createDiv({
      cls: durationRowClasses(columns, 'fitkit-set-row fitkit-duration-row'),
    })

    const setCell = this.createCell(row, 'Set', 'fitkit-set-figure')
    setCell.setText(String(durationEntry.set ?? i + 1))

    this.renderDurationInput(this.createCell(row, 'Duration'), durationEntry)
    const intensity = columns.intensity
    if (intensity) {
      const label = INTENSITY_LABELS[intensity]
      const input = this.createInputCell(row, label, {
        type: 'number',
        step: '0.1',
        inputmode: 'decimal',
      })
      input.value = durationEntry[intensity] === undefined ? '' : String(durationEntry[intensity])
      input.addEventListener('input', () => {
        durationEntry[intensity] = parseNumberInput(input.value)
        this.markDirty()
      })
    }
    if (columns.rest) {
      this.renderRestInput(this.createCell(row, 'Rest'), durationEntry)
    }

    this.renderRowActions(container, body, {
      label: `duration entry ${i + 1}`,
      currentNote: durationEntry.note,
      onDelete: () => {
        if (this.runningSetTimer()?.entry === durationEntry) {
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

  private renderRestInput(cell: HTMLElement, durationEntry: EditableDurationEntry): void {
    const input = cell.createEl('input', {
      cls: 'fitkit-input fitkit-duration-input',
      attr: { type: 'text', 'aria-label': 'Rest', placeholder: ZERO_DURATION_DISPLAY },
    })
    input.value = formatDurationInput(durationEntry.restSeconds)
    input.addEventListener('input', () => {
      const parsed = parseDurationInput(input.value)
      setAriaInvalid(input, parsed === null)
      if (parsed !== null) {
        durationEntry.restSeconds = parsed.seconds
        this.markDirty()
      }
    })
    input.addEventListener('blur', () => {
      setAriaInvalid(input, false)
      input.value = formatDurationInput(durationEntry.restSeconds)
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

  /** The plan this exercise's latest prior session ran, which a new or newly interval card starts from. */
  private lastIntervalPlan(name: string): string | undefined {
    return this.exerciseHistory?.get(name)?.intervalPlan?.value
  }

  private openIntervalPlanModal(ex: ExerciseCard): void {
    new IntervalPlanModal(this.app, {
      exerciseName: ex.name,
      initial: ex.plan,
      suggested: this.lastIntervalPlan(ex.name),
      presets: parseIntervalPresets(this.plugin.settings.intervalPresets).presets,
      onSave: (plan) => {
        ex.plan = plan
        this.markDirty()
        this.render()
      },
    }).open()
  }

  private openEditLevelsModal(ex: ExerciseCard): void {
    new EditLevelsModal(this.app, {
      exerciseName: ex.name,
      initial: this.exerciseStore.levelsFor(ex.name) ?? defaultBodyweightLevels(ex.name),
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
    const previous = this.exerciseStore.levelsFor(ex.name) ?? []
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

  private async persistLadder(name: string, levels: string[]): Promise<void> {
    const result = await this.exerciseStore.recordLadder(name, levels)
    if (!result) {
      return
    }
    const notice = ladderRecordNotice(result)
    if (notice) {
      new Notice(notice)
    }
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
      menu.showAtPosition(menuAnchorForTrigger(rect))
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

  /** Takes over the tab with the card's timer, timing its last set (or a new one when it has none). */
  private openSetTimer(card: ExerciseCard): void {
    if (card.durationEntries.length === 0) {
      card.durationEntries.push({})
    }
    const entry = card.durationEntries.at(-1)
    if (!entry) {
      return
    }
    const screen: SetTimerScreen = { kind: 'set', card, entry, stopwatch: null, clockEl: null }
    this.screens.enter(screen, { wake: this.screenWake() })
    this.timeSet(screen)
  }

  /** Starts the clock on the screen's set, adding to any time it already has. */
  private timeSet(screen: SetTimerScreen): void {
    if (screen.stopwatch) {
      return
    }
    const startedAtMs = Date.now()
    screen.entry.startedAt = formatLocalTimestamp(new Date(startedAtMs))
    this.runStopwatch(screen, startedAtMs)
    this.markDirty()
    this.render()
  }

  private renderSetTimerScreen(container: HTMLElement, screen: SetTimerScreen): void {
    const { card, entry, stopwatch } = screen
    const entries = card.durationEntries
    const index = entries.indexOf(entry)
    screen.clockEl = renderSetTimer(
      container,
      {
        exerciseName: card.name,
        set: entry.set ?? index + 1,
        seconds: stopwatch ? this.liveSeconds(stopwatch) : (entry.durationSeconds ?? 0),
        running: stopwatch !== null,
        previousSeconds: entries[index - 1]?.durationSeconds,
      },
      {
        stop: () => this.stopTimer({ write: true }),
        resume: () => this.timeSet(screen),
        reset: () => {
          this.stopTimer({ write: false, render: false })
          delete entry.durationSeconds
          this.timeSet(screen)
        },
        next: () => {
          this.stopTimer({ write: true, render: false })
          const next = { set: nextSetNumber(entries), ...carriedIntervalFields(entries.at(-1)) }
          entries.push(next)
          screen.entry = next
          this.timeSet(screen)
        },
        done: () => {
          this.stopTimer({ write: true, render: false })
          this.screens.leave()
        },
      },
    )
  }

  /** The beep-free wake lock the set and rest timers hold. */
  private screenWake(): WakeHold {
    return createCuePlayer(activeWindow, false)
  }

  /** What ending each screen from outside keeps: a banked stop saves the set or run so far. */
  private stopScreen(screen: EditorScreen, how: ScreenStop): void {
    if (screen.kind === 'set') {
      this.stopTimer({ write: how === 'bank', render: false })
    } else if (screen.kind === 'run' && how === 'bank') {
      this.bankRun(screen)
    }
  }

  /** The set timer screen while its set is being timed. */
  private runningSetTimer(): SetTimerScreen | null {
    const screen = this.screens.current()
    return screen?.kind === 'set' && screen.stopwatch ? screen : null
  }

  /** Picks up a timer the note records as running, such as one cut off when the app was killed. */
  private resumeSavedTimer(): void {
    for (const card of this.model?.exercises ?? []) {
      const plan = intervalColumns(card).plan
      const now = Date.now()
      const resumed = plan && resumeSession(card.durationEntries, plan, now)
      if (resumed) {
        this.applyRun(this.enterRun(card, resumed.session, { keepScroll: true }), resumed, now)
        return
      }
    }
    for (const card of this.model?.exercises ?? []) {
      if (intervalColumns(card).plan) {
        continue
      }
      const entry = card.durationEntries.find((candidate) => candidate.startedAt !== undefined)
      const startedAtMs = Date.parse(entry?.startedAt ?? '')
      if (entry && !Number.isNaN(startedAtMs)) {
        const screen: SetTimerScreen = { kind: 'set', card, entry, stopwatch: null, clockEl: null }
        this.screens.enter(screen, {
          wake: this.screenWake(),
          returnScrollTop: 0,
          keepScroll: true,
        })
        this.runStopwatch(screen, startedAtMs)
        return
      }
    }
  }

  private runStopwatch(screen: SetTimerScreen, startedAtMs: number): void {
    screen.stopwatch = { startedAtMs, accumulator: screen.entry.durationSeconds ?? 0 }
    this.screens.startClock(() => this.tickTimer(), 1000)
  }

  private stopTimer(opts: { write: boolean; render?: boolean }): void {
    const screen = this.runningSetTimer()
    const stopwatch = screen?.stopwatch
    if (!screen || !stopwatch) {
      return
    }
    this.screens.stopClock()
    delete screen.entry.startedAt
    if (opts.write) {
      screen.entry.durationSeconds = this.liveSeconds(stopwatch)
      this.markDirty()
    }
    screen.stopwatch = null
    if (opts.render !== false) {
      this.render()
    }
  }

  private abortTimer(): void {
    this.stopTimer({ write: false })
  }

  private tickTimer(): void {
    const screen = this.runningSetTimer()
    if (!screen?.stopwatch || !screen.clockEl) {
      return
    }
    screen.clockEl.setText(formatClock(this.liveSeconds(screen.stopwatch)))
  }

  private liveSeconds(stopwatch: Stopwatch): number {
    return (
      stopwatch.accumulator + Math.max(0, Math.floor((Date.now() - stopwatch.startedAtMs) / 1000))
    )
  }

  private startIntervalRun(card: ExerciseCard, program: IntervalProgram): void {
    /** Bank what holds the tab before reading the rows the run starts from. */
    this.screens.teardown('bank')
    const now = Date.now()
    const started = startSession(card.durationEntries, program, now)
    const run = this.enterRun(card, started.session)
    run.cues.prime()
    this.applyRun(run, started, now)
  }

  private enterRun(
    card: ExerciseCard,
    session: RunSession,
    { keepScroll = false }: { keepScroll?: boolean } = {},
  ): RunScreen {
    const cues = createCuePlayer(activeWindow, this.plugin.settings.intervalBeepsEnabled !== false)
    const run: RunScreen = { kind: 'run', card, session, clockEl: null, cues }
    this.screens.enter(run, { wake: cues, keepScroll })
    this.screens.startClock(() => this.sendRun({ kind: 'tick' }), 500)
    return run
  }

  private renderRun(container: HTMLElement, run: RunScreen): void {
    const { session } = run
    const primed = (event: RunEvent) => (): void => {
      run.cues.prime()
      this.sendRun(event)
    }
    run.clockEl = renderRunner(
      container,
      {
        exerciseName: run.card.name,
        program: session.program,
        rows: session.rows,
        now: Date.now(),
        screen: session.screen,
      },
      {
        primary: primed({ kind: 'press' }),
        togglePause: primed({ kind: 'toggle-pause' }),
        end: () => this.sendRun({ kind: 'end' }),
        adjust: (delta) => this.sendRun({ kind: 'adjust', delta }),
        resumeCut: primed({ kind: 'resume-cut' }),
        endCut: () => this.sendRun({ kind: 'end-cut' }),
        back: () => this.sendRun({ kind: 'back' }),
      },
    )
  }

  private sendRun(event: RunEvent): void {
    const run = this.screens.current()
    if (run?.kind === 'run') {
      const now = Date.now()
      this.applyRun(run, stepSession(run.session, event, now), now)
    }
  }

  /** Carries out what a run transition asks of the view. */
  private applyRun(run: RunScreen, { session, effects }: RunTransition, now: number): void {
    run.session = session
    if (effects.rows) {
      run.card.durationEntries = effects.rows
      this.markDirty()
    }
    if (effects.notice !== undefined) {
      new Notice(effects.notice)
    }
    if (effects.leave) {
      /** The rows already hold everything, so the card list is all that is left to show. */
      this.screens.leave()
      return
    }
    if (effects.redraw === 'full') {
      this.render()
    }
    if (effects.cue) {
      run.cues.play(effects.cue)
    }
    if (effects.redraw === 'clock' && run.clockEl) {
      const clock = { exerciseName: run.card.name, program: session.program, rows: session.rows }
      run.clockEl.setText(formatClock(clockSeconds({ ...clock, now })))
    }
  }

  /** Pauses a run with the time so far kept in its rows, the way the set timer banks a set. */
  private bankRun(run: RunScreen): void {
    const { rows } = stepSession(run.session, { kind: 'close' }, Date.now()).effects
    if (rows) {
      run.card.durationEntries = rows
      this.markDirty()
    }
  }

  private startRestTimer(): void {
    if (!this.isRestTimerEnabled()) {
      return
    }
    if (this.screens.current()?.kind === 'rest') {
      return
    }
    this.lastRestSeconds = null
    const rest: RestScreen = { kind: 'rest', startedAtMs: Date.now(), clockEl: null }
    this.screens.enter(rest, { wake: this.screenWake() })
    this.screens.startClock(() => this.tickRestTimer(), 1000)
    this.render()
  }

  private stopRestTimer(): void {
    const rest = this.screens.current()
    if (rest?.kind !== 'rest') {
      return
    }
    this.lastRestSeconds = this.liveRestSeconds(rest)
    this.screens.leave()
  }

  private clearRestTimerState(): void {
    if (this.screens.current()?.kind === 'rest') {
      this.screens.teardown('discard')
    }
    this.lastRestSeconds = null
  }

  private tickRestTimer(): void {
    const rest = this.screens.current()
    if (rest?.kind !== 'rest' || !rest.clockEl) {
      return
    }
    rest.clockEl.setText(formatClock(this.liveRestSeconds(rest)))
  }

  private liveRestSeconds(rest: RestScreen): number {
    return Math.max(0, Math.floor((Date.now() - rest.startedAtMs) / 1000))
  }

  private isRestTimerEnabled(): boolean {
    return this.plugin.settings.strengthRestTimerEnabled !== false
  }

  /** The scope question is skipped when there is nothing to choose. */
  private async switchCardType(index: number, target: ExerciseType): Promise<void> {
    const ex = this.model?.exercises[index]
    const current = ex ? loggedTypeOf(ex) : null
    if (!ex || current === null || current === target) {
      return
    }
    const nextKind = kindOfType(target)
    const clearsRows = ex.kind !== nextKind && hasRows(ex)
    const registry = this.exerciseStore.registry()
    const registryType = typeForName(registry, ex.name)
    const choice =
      registryType === target && ex.kind === nextKind
        ? 'workout'
        : await this.chooseTypeSwitch(ex, current, target, registryType, clearsRows)
    if (choice === 'cancel') {
      return
    }
    await this.runTypeSwitch(
      index,
      planTypeSwitch({ loggedType: current, target, registryType, scope: choice }),
    )
  }

  /** Carries out a type switch plan on the card at `index`, the one path both the card menu and rename take. */
  private async runTypeSwitch(index: number, plan: TypeSwitchPlan): Promise<void> {
    const ex = this.model?.exercises[index]
    if (!ex) {
      return
    }
    /** Captured before the switch clears the card; the relabel offer below marks these as level 1. */
    const relabelSource = plan.offersRelabel ? toWorkoutExercise(ex) : null
    if (plan.changesKind) {
      this.applyKindSwitch(index, kindOfType(plan.target), hasRows(ex), plan.announcedAs)
    } else if (plan.dropsPlan) {
      ex.plan = undefined
      this.markDirty()
      this.render()
    }
    if (plan.recordsType) {
      await this.persistTypeChange(ex.name, plan.target)
    }
    if (plan.opensPlanForm) {
      this.openIntervalPlanModal(ex)
    }
    if (plan.seedsLadder) {
      await this.seedBodyweightLadder(ex)
    }
    if (relabelSource) {
      await this.offerFirstLevelRelabel(index, relabelSource)
    }
  }

  /**
   * Seeds a fresh bodyweight card's ladder with one rung named after the
   * exercise, the same default a new bodyweight note carries, so the level
   * menu is usable immediately. An existing ladder is left alone.
   */
  private async seedBodyweightLadder(ex: ExerciseCard): Promise<void> {
    if ((this.exerciseStore.levelsFor(ex.name) ?? []).length > 0) {
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

  private async persistTypeChange(name: string, nextType: ExerciseType): Promise<void> {
    const result = await this.exerciseStore.recordType(name, nextType)
    for (const notice of result ? typeRecordNotices(result, nextType) : []) {
      new Notice(notice)
    }
  }

  private chooseTypeSwitch(
    card: ExerciseCard,
    currentType: ExerciseType,
    nextType: ExerciseType,
    registryType: ExerciseType | null,
    clearsRows: boolean,
  ): Promise<KindSwitchChoice> {
    return new Promise((resolve) => {
      new KindSwitchChoiceModal(
        this.app,
        { exerciseName: card.name, currentType, nextType, clearsRows, registryType },
        resolve,
      ).open()
    })
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

  private applyKindSwitch(
    index: number,
    nextKind: ExerciseKind,
    clearedRows: boolean,
    targetLabel: string = nextKind,
  ): void {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex || ex.kind === nextKind) {
      return
    }
    if (this.runningSetTimer()?.card === ex) {
      this.abortTimer()
    }
    const previousKind = ex.kind
    ex.kind = nextKind
    ex.plan = undefined
    ex.strengthSets = []
    ex.durationEntries = []
    ex.bodyweightSets = []
    this.markSeededWeight(seedEmptyRow(ex, this.exerciseHistory?.get(ex.name)))
    this.markDirty()
    this.render()
    if (clearedRows) {
      new Notice(`Switched to ${targetLabel}. Previous ${previousKind} rows were cleared.`)
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

  private removeExercise(index: number): void {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (ex && this.runningSetTimer()?.card === ex) {
      this.abortTimer()
    }
    this.model.exercises.splice(index, 1)
    this.markDirty()
    this.render()
  }

  /**
   * The plan the user records for next session. Choosing the active direction
   * again clears it, matching the segmented control this replaced. An interval
   * card records the direction alone, so it has no step to set.
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

    if (ex.kind === 'duration') {
      return
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
    const menu = new Menu()
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
    const shownType = loggedTypeOf(ex)
    if (shownType === 'interval') {
      menu.addItem((item) =>
        item
          .setTitle('Edit interval plan')
          .setIcon('timer')
          .onClick(() => this.openIntervalPlanModal(ex)),
      )
    }
    if (ex.kind === 'strength' || ex.kind === 'bodyweight' || shownType === 'interval') {
      menu.addSeparator()
      this.addNextPlanMenuItems(menu, ex)
    }
    menu.addSeparator()
    const show = showCardMenuAt(evt)
    menu.addItem((item) =>
      item
        .setTitle('Change type...')
        .setIcon('repeat')
        /** Obsidian has no public submenu, so the types open as a second menu once this one closes. */
        .onClick(() => window.setTimeout(() => show(this.typeMenu(index, shownType)), 0)),
    )
    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle('Remove exercise')
        .setIcon('trash-2')
        .setWarning(true)
        .onClick(() => void this.confirmAndRemoveExercise(index)),
    )
    show(menu)
  }

  /** The types a card can switch to, leaving out the one it shows. */
  private typeMenu(index: number, shownType: ExerciseType): Menu {
    const menu = new Menu()
    for (const target of EXERCISE_TYPES) {
      if (target === shownType) {
        continue
      }
      menu.addItem((item) =>
        item
          .setTitle(`Switch to ${target}`)
          .setIcon('repeat')
          .onClick(() => void this.switchCardType(index, target)),
      )
    }
    return menu
  }

  private renderExerciseHistoryBadges(
    card: HTMLElement,
    ex: ExerciseCard,
    registry: ExerciseRegistry,
  ): void {
    const summary = this.exerciseHistory?.get(ex.name)
    /** One lookup per card: both badge kinds read the same ladder and unit. */
    const levels = levelsForName(registry, ex.name)
    const unit = unitForName(registry, ex.name) ?? DEFAULT_WEIGHT_UNIT
    const badges = formatExerciseHistoryBadges(summary, ex.kind, unit, levels)
    const planBadge = formatNextPlanBadge(
      summary,
      ex.kind,
      unit,
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

    let shouldClearTombstone = false

    if (plan.kind === 'create') {
      try {
        await ensureParentFolder(this.app, plan.path)
        await this.app.vault.create(
          plan.path,
          composeExerciseNote(plan.name, plan.exerciseType, plan.workoutsFolderPath, plan.unit),
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

    if (shouldClearTombstone) {
      await this.exerciseStore.undelete(plan.name)
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
    const registry = this.exerciseStore.registry()
    new ExerciseSuggestModal(this.app, names, (name) => {
      void this.addExerciseFromSuggestion(name, registry)
    }).open()
  }

  private async addExerciseFromSuggestion(name: string, registry: ExerciseRegistry): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || !this.model) {
      return
    }
    const exerciseIndex = this.model.exercises.length
    const registryType = typeForName(registry, trimmed)
    const kind = kindOfType(registryType ?? 'strength')
    const card: ExerciseCard = {
      name: trimmed,
      kind,
      strengthSets: [],
      durationEntries: [],
      bodyweightSets: [],
    }
    if (kind === 'duration') {
      card.plan = this.lastIntervalPlan(trimmed)
    }
    this.markSeededWeight(seedEmptyRow(card, this.exerciseHistory?.get(trimmed)))
    this.model.exercises.push(card)
    this.markDirty()
    this.render()
    const focusLabel = FOCUS_COLUMN_LABELS[kind]
    this.focusRowCell(exerciseIndex, 0, focusLabel)
    if (registryType === 'interval' && card.plan === undefined) {
      this.openIntervalPlanModal(card)
    }

    if (registryType === null) {
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
    const result = await this.exerciseStore.ensureKnown(name, kind, { createNote })
    const notice = ensureKnownNotice(name, result)
    if (notice) {
      new Notice(notice)
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
    const registry = this.exerciseStore.registry()
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
    registry: ExerciseRegistry,
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
    const registryType = typeForName(registry, trimmed)
    const plan = registryType
      ? planTypeSwitch({
          loggedType: loggedTypeOf(target),
          target: registryType,
          registryType,
          scope: 'registry-known',
        })
      : null
    if (plan?.changesKind) {
      const confirmed = await this.confirmKindSwitch(target, kindOfType(plan.target))
      if (!confirmed) {
        return
      }
      target.name = trimmed
      await this.runTypeSwitch(index, plan)
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
    this.autosaver.markDirty()
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
    if (this.autosaver.state().dirty) {
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

/**
 * Shows a menu under the button `evt` came from, or at the pointer. The position is read now,
 * since `currentTarget` is gone once the event has been handled.
 */
function showCardMenuAt(evt: MouseEvent): (menu: Menu) => void {
  const target = evt.currentTarget
  if (target instanceof HTMLElement) {
    const position = menuAnchorForTrigger(target.getBoundingClientRect())
    return (menu) => menu.showAtPosition(position)
  }
  return (menu) => menu.showAtMouseEvent(evt)
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
      if (exercise.plan !== undefined) {
        card.plan = exercise.plan
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
  return { ...entry }
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

/** Notices for a recorded type change, in the order they are shown. */
export function typeRecordNotices(result: TypeRecordResult, type: ExerciseType): string[] {
  const { name } = result
  const warning = result.customRecentSessions
    ? [
        `The Recent sessions query in the note for ${name} looks customised, so it was left as it is and still reads the old kind's fields.`,
      ]
    : []
  switch (result.wrote) {
    case 'note':
      return [
        ...warning,
        `Exercise note now records ${name} as ${type}.`,
        `Registry now records ${name} as ${type}.`,
      ]
    case 'registry':
      return [...warning, `Registry now records ${name} as ${type}.`]
    case 'note-unchanged':
      return [
        ...warning,
        `Could not update the exercise note for ${name}; its frontmatter was left unchanged.`,
      ]
  }
}

/** Notice for a recorded ladder; null when an unchanged note leaves nothing to report. */
export function ladderRecordNotice(result: LadderRecordResult): string | null {
  switch (result.wrote) {
    case 'note':
      return `Exercise note now records levels for ${result.name}.`
    case 'registry':
      return `Registry now records levels for ${result.name}.`
    case 'note-unchanged':
      return null
  }
}

/** Notice for adding an unknown exercise; null when it was already known. */
export function ensureKnownNotice(name: string, result: EnsureKnownResult): string | null {
  switch (result.outcome) {
    case 'note-created':
      return `Created exercise note for '${name}'.`
    case 'note-reused':
      return result.restored
        ? `Restored '${name}' using the existing exercise note.`
        : `Using existing exercise note for '${name}'.`
    case 'registry-added':
      return `Added '${name}' as a no-note registry entry.`
    case 'already-known':
      return null
    case 'note-failed':
      return `Could not create exercise note for '${name}': ${result.message}.`
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
      if (card.plan !== undefined) {
        entry.plan = card.plan
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
  return { ...entry, durationSeconds: entry.durationSeconds ?? 0 }
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

const INTENSITY_LABELS: Record<IntensityKind, string> = {
  watts: 'Watts',
  load: 'Load',
  level: 'Level',
}

interface IntervalColumns {
  plan: IntervalProgram | null
  intensity: IntensityKind | null
  rest: boolean
}

/** Which interval columns a duration card shows: the plan's intensity, or whichever its rows already log. */
function intervalColumns(card: ExerciseCard): IntervalColumns {
  const parsed = card.plan === undefined ? null : parseIntervalProgram(card.plan)
  const plan = parsed?.ok ? parsed.program : null
  const logged = INTENSITY_KINDS.find((kind) =>
    card.durationEntries.some((entry) => entry[kind] !== undefined),
  )
  return {
    plan,
    intensity: plan?.intensity ?? logged ?? null,
    rest:
      plan?.steps.some(restsAfter) === true ||
      card.durationEntries.some((entry) => entry.restSeconds !== undefined),
  }
}

function durationRowClasses(columns: IntervalColumns, base: string): string {
  return [base, columns.intensity ? 'has-intensity' : '', columns.rest ? 'has-rest' : '']
    .filter(Boolean)
    .join(' ')
}

/** One past the highest set number, so a set added after a deletion never repeats one. */
function nextSetNumber(entries: readonly { set?: number }[]): number {
  return entries.reduce((high, entry, index) => Math.max(high, entry.set ?? index + 1), 0) + 1
}

/** Intensity and rest a new row starts from, copied from the row before it. */
function carriedIntervalFields(last: EditableDurationEntry | undefined): EditableDurationEntry {
  const carried: EditableDurationEntry = {}
  for (const kind of INTENSITY_KINDS) {
    if (last?.[kind] !== undefined) {
      carried[kind] = last[kind]
    }
  }
  if (last?.restSeconds !== undefined) {
    carried.restSeconds = last.restSeconds
  }
  return carried
}
