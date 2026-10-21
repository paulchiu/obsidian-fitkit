import type { WorkspaceLeaf } from 'obsidian'
import { FileView, Menu, Notice, TFile } from 'obsidian'
import { createRef, render as renderTree, type RefObject } from 'preact'

import { reorderArray } from '../../domain/array-utils'
import {
  defaultBodyweightLevels,
  describeBodyweightLadderChanges,
  formatBodyweightLevelLabel,
  pickBestBodyweightSet,
  type BodyweightLadder,
  type BodyweightLadderChange,
} from '../../domain/bodyweight-levels'
import { formatErrorMessage } from '../../domain/error'
import {
  resumeSession,
  startSession,
  stepSession,
  type RunEvent,
  type RunSession,
  type RunTransition,
} from '../../domain/interval-session'
import { INTENSITY_KINDS } from '../../domain/interval-plan'
import type { IntervalProgram } from '../../domain/interval-program'
import { parseIntervalPresets } from '../../domain/interval-presets'
import { assertUnreachableKind } from '../../domain/exercise-kind'
import {
  formatExerciseHistoryBadges,
  formatNextPlanBadge,
  pickMaxWeightSet,
  type ExerciseHistoryByName,
  type ExerciseHistorySummary,
} from '../../domain/exercise-history'
import {
  typeForName,
  levelsForName,
  normalize,
  unitForName,
  type ExerciseRegistry,
} from '../../domain/exercise-registry'
import { formatLocalTimestamp } from '../../domain/dates'
import { DEFAULT_WEIGHT_UNIT } from '../../domain/weight-unit'
import {
  EXERCISE_TYPES,
  kindOfType,
  loggedTypeOf,
  type ExerciseType,
} from '../../domain/exercise-type'
import { formatNumber } from '../../domain/number-format'
import { planTypeSwitch, type TypeSwitchPlan } from '../../domain/exercise-type-switch'
import { filterSuggestableNames } from '../../domain/exercise-suggestions'
import { nextPlanTargetWeight, type NextPlan, type NextPlanDirection } from '../../domain/next-plan'
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
} from '../../domain/workout-note-model'
import type FitKitPlugin from '../../main'
import { exercisesFolder, isInFolder, workoutsFolder } from '../../settings-paths'
import { createAutosaver, type Autosaver } from '../../vault/autosaver'
import { composeExerciseNote } from '../../vault/exercise-note'
import { planExerciseFileOpen } from '../../vault/exercise-file-plan'
import { exerciseHistoryFromVault } from '../../vault/exercise-history-vault'
import { exerciseRegistryWithVaultNotes } from '../../vault/exercise-registry-vault'
import {
  createExerciseStore,
  type EnsureKnownResult,
  type ExerciseStore,
  type LadderRecordResult,
  type TypeRecordResult,
} from '../../vault/exercise-store'
import { FileSession } from '../../vault/file-session'
import { markdownFilesInFolder } from '../../vault/folder-scan'
import { ensureParentFolder } from '../../vault/vault-utils'
import { ConfirmModal } from './confirm-modal'
import { EditLevelsModal } from './edit-levels-modal'
import { createCuePlayer, type CuePlayer } from './interval-cues'
import { clockSeconds } from '../model/interval-runner'
import { EditorRoot, type EditorPage, type EditorScene } from '../components/editor-root'
import type { CardHandlers, CardProps, LoadMenu } from '../components/exercise-card'
import { HostContext } from '../components/host'
import { LayoutContext, type Layout } from '../components/layout'
import type { RowControls } from '../components/set-rows'
import { intervalColumns, type ExerciseCard } from '../model/editor-card'
import type {
  EditableBodyweightSet,
  EditableDurationEntry,
  EditableStrengthSet,
} from '../model/set-rows'
import { formatClock } from '../model/clock'
import { obsidianHost } from './host'
import { createTabScreens, type ScreenStop, type TabScreens, type WakeHold } from './tab-screens'
import { IntervalPlanModal } from './interval-plan-modal'
import { ExerciseSuggestModal } from './exercise-suggest-modal'
import { KindSwitchChoiceModal, type KindSwitchChoice } from './kind-switch-choice-modal'
import { menuAnchorForTrigger } from './menu-anchor'
import { SetNoteModal } from './set-note-modal'
import { UnknownExerciseModal } from './unknown-exercise-modal'
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
  clock: RefObject<HTMLDivElement>
}

interface RunScreen {
  kind: 'run'
  card: ExerciseCard
  session: RunSession
  clock: RefObject<HTMLDivElement>
  /** Also the screen's wake lock. */
  cues: CuePlayer
}

interface RestScreen {
  kind: 'rest'
  startedAtMs: number
  clock: RefObject<HTMLDivElement>
}

/** A screen that takes over the whole tab in place of the card list. */
type EditorScreen = SetTimerScreen | RunScreen | RestScreen

export const VIEW_TYPE_FITKIT_WORKOUT_EDITOR = 'fitkit-workout-editor'

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
  /** Whether the tree is drawn, so a settle or timer that fires after close draws nothing. */
  private mounted = false
  private resizeListenersStore?: Set<() => void>
  private layoutStore?: Layout
  private cardHandlersStore?: CardHandlers
  private metaLineStore?: RefObject<HTMLSpanElement>
  /** The latest draw asked for while a drag was in progress, made once the drag ends. */
  private sceneAfterDrag?: EditorScene
  private dragSession: DragSession | null = null
  private seededWeightsStore?: WeakSet<EditableStrengthSet>
  private expandedSetListsStore?: WeakSet<ExerciseCard>
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
      onSaveError: () => {
        new Notice('Could not save workout. Edits are unsaved. Edit again to retry before leaving.')
      },
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
    if (this.plugin.isWorkoutFile(file)) {
      this.plugin.addOpenDashboardItem(menu)
    }
  }

  /** Writes any edit still waiting on the autosave debounce. */
  settleEdits(): Promise<void> {
    return this.autosaver.settle()
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
    this.mounted = true
    this.contentEl.addClass('fitkit-editor-root')
    this.resizeObserver = new ResizeObserver(() => {
      this.updateNarrowState()
      for (const refit of [...this.resizeListeners]) {
        refit()
      }
    })
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
    this.mounted = false
    this.screens.teardown('bank')
    this.lastRestSeconds = null
    try {
      await this.autosaver.settle()
    } finally {
      this.resizeObserver?.disconnect()
      this.resizeObserver = null
      if (this.dragSession) {
        this.endDrag(false)
      }
      renderTree(null, this.contentEl)
      this.session = null
      this.model = null
      this.exerciseHistory = null
    }
  }

  private updateNarrowState(): void {
    this.setNarrowState(this.contentEl.clientWidth < 600, this.contentEl.clientWidth < 360)
  }

  /** Lazily created for the same reason as exerciseStore. */
  private get resizeListeners(): Set<() => void> {
    this.resizeListenersStore ??= new Set()
    return this.resizeListenersStore
  }

  /** What the drawn tree can ask of the pane's size; one object, so the context never changes. */
  private get layout(): Layout {
    this.layoutStore ??= {
      onResize: (refit) => {
        this.resizeListeners.add(refit)
        return () => this.resizeListeners.delete(refit)
      },
    }
    return this.layoutStore
  }

  /** The header's meta line, which autosave rewrites between draws. */
  private get metaLine(): RefObject<HTMLSpanElement> {
    this.metaLineStore ??= createRef()
    return this.metaLineStore
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
    const session = new FileSession(this.app, file)
    this.session = session
    const { model, isWorkout, warnings } = await session.load()
    /** Closing the tab or opening another note meanwhile leaves this load nothing to show. */
    if (this.session !== session) {
      return
    }
    this.model = toEditorWorkoutModel(model, isWorkout, file.path)
    const history = await this.loadExerciseHistory()
    if (this.session !== session) {
      return
    }
    this.exerciseHistory = history
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
    const session = this.session
    if (!session) {
      return
    }
    this.screens.teardown('discard')
    /** Autosave stays blocked by the conflict until the disk copy is in, so an edit made during the read cannot write the stale model. */
    const { model, isWorkout } = await session.load()
    if (this.session !== session) {
      return
    }
    this.model = toEditorWorkoutModel(model, isWorkout, session.file.path)
    if (!this.model.isFitKitWorkout) {
      this.exerciseHistory = null
    }
    this.autosaver.reset()
    this.resumeSavedTimer()
    this.render()
    new Notice('Reloaded from disk.')
  }

  private renderEmpty(message: string): void {
    this.draw({ kind: 'empty', message })
  }

  private renderSkeleton(): void {
    this.draw({ kind: 'loading' })
  }

  /**
   * Draws `scene` into the pane, updating what is already there in place. A draw asked for mid-drag
   * waits for the drag to end, since its indicator sits among the cards the draw would reconcile.
   */
  private draw(scene: EditorScene): void {
    if (!this.mounted) {
      return
    }
    if (this.dragSession) {
      this.sceneAfterDrag = scene
      return
    }
    renderTree(
      <HostContext.Provider value={obsidianHost}>
        <LayoutContext.Provider value={this.layout}>
          <EditorRoot scene={scene} />
        </LayoutContext.Provider>
      </HostContext.Provider>,
      this.contentEl,
    )
  }

  private render(): void {
    if (!this.model || !this.session) {
      this.renderEmpty('No file loaded.')
      return
    }
    const screen = this.screens.current()
    if (!screen) {
      this.draw({ kind: 'editor', page: this.page(this.model) })
      return
    }
    switch (screen.kind) {
      case 'run':
        this.draw(this.runScene(screen))
        return
      case 'set':
        this.draw(this.setTimerScene(screen))
        return
      case 'rest':
        this.draw({
          kind: 'rest',
          seconds: this.liveRestSeconds(screen),
          stop: () => this.stopRestTimer(),
          clock: screen.clock,
        })
        return
      default:
        return assertUnreachableKind(screen)
    }
  }

  private page(model: EditorWorkoutModel): EditorPage {
    /** One merged snapshot per render: every card reads its ladder from this instead of rebuilding it. */
    const registry = model.isFitKitWorkout ? this.exerciseStore.registry() : null
    return {
      workoutKey: model,
      name: model.name,
      isWorkout: model.isFitKitWorkout,
      metaLine: this.metaLineText(),
      metaLineRef: this.metaLine,
      conflict: this.autosaver.state().conflict,
      cards: registry
        ? model.exercises.map((ex, index) => this.cardProps(ex, index, registry))
        : [],
      cardHandlers: this.cardHandlers,
      restEnabled: this.isRestTimerEnabled(),
      lastRestSeconds: this.lastRestSeconds,
      handlers: {
        rename: (name) => {
          if (this.model) {
            this.model.name = name
            this.markDirty()
          }
        },
        reload: () => void this.reloadFromDisk(),
        addExercise: () => void this.openAddExerciseModal(),
        startRest: () => this.startRestTimer(),
      },
    }
  }

  private cardProps(
    ex: ExerciseCard,
    index: number,
    registry: ExerciseRegistry,
  ): Omit<CardProps, 'handlers'> {
    const summary = this.exerciseHistory?.get(ex.name)
    /** One lookup per card: both badge kinds read the same ladder and unit. */
    const levels = levelsForName(registry, ex.name)
    const unit = unitForName(registry, ex.name) ?? DEFAULT_WEIGHT_UNIT
    const history = {
      badges: formatExerciseHistoryBadges(summary, ex.kind, unit, levels),
      plan: formatNextPlanBadge(
        summary,
        ex.kind,
        unit,
        {
          plan: ex.next,
          sessionMax: pickMaxWeightSet(ex.strengthSets),
          sessionBodyweightMax: pickBestBodyweightSet(ex.bodyweightSets),
        },
        levels,
      ),
    }
    const seeded = ex.strengthSets.flatMap((set, i) => (this.seededWeights.has(set) ? [i] : []))
    return { ex, index, history, levels, signature: JSON.stringify([ex, seeded, history, levels]) }
  }

  /** The handlers every card calls, created once; each reads the view's state when run. */
  private get cardHandlers(): CardHandlers {
    this.cardHandlersStore ??= {
      openFile: (ex) => void this.openOrCreateExerciseFile(ex),
      openMenu: (evt, ex) => this.openCardMenu(evt, this.model?.exercises.indexOf(ex) ?? -1),
      openNote: (ex) => this.openExerciseNoteModal(ex),
      openPlan: (ex) => this.openIntervalPlanModal(ex),
      attachDrag: (handle) => this.attachCardDrag(handle),
      isExpanded: (ex) => this.expandedSetLists.has(ex),
      setExpanded: (ex, expanded) => {
        if (expanded) {
          this.expandedSetLists.add(ex)
        } else {
          this.expandedSetLists.delete(ex)
        }
      },
      isSeeded: (set) => this.seededWeights.has(set),
      editStrength: (set, patch) => {
        /** Typing over a seeded weight redraws in place to drop its unconfirmed mark. */
        const confirmed = 'weight' in patch && this.seededWeights.delete(set)
        this.editRow(set, patch)
        if (confirmed) {
          this.render()
        }
      },
      editBodyweight: (set, patch) => this.editRow(set, patch),
      editDuration: (entry, patch) => this.editRow(entry, patch),
      rowControls: (rows, row, index, label, loadMenu) =>
        this.rowControls(rows, row, index, label, loadMenu),
      addLoad: (ex, index) => {
        const set = ex.bodyweightSets[index]
        if (set) {
          set.load = ex.bodyweightSets[index - 1]?.load ?? 0
          this.markDirty()
          this.render()
        }
      },
      removeLoad: (ex, index) => {
        const set = ex.bodyweightSets[index]
        if (set) {
          set.load = undefined
          this.markDirty()
          this.render()
        }
      },
      setLevel: (set, level) => this.setBodyweightLevel(set, level),
      openLevelMenu: (set, levels, trigger) => this.openLevelMenu(set, levels, trigger),
      addSet: (ex) => this.addSet(ex),
      repeatSet: (ex) => this.repeatSet(ex),
      startRun: (ex, program) => this.startIntervalRun(ex, program),
      openTimer: (ex) => this.openSetTimer(ex),
    }
    return this.cardHandlersStore
  }

  /** Adds an empty set to `ex`, opening its list so the row shows. */
  private addSet(ex: ExerciseCard): void {
    const index = this.model?.exercises.indexOf(ex) ?? -1
    let focus: { row: number; label: string } | null = null
    switch (ex.kind) {
      case 'strength': {
        const last = ex.strengthSets[ex.strengthSets.length - 1]
        const next: EditableStrengthSet = { set: nextSetNumber(ex.strengthSets) }
        if (last?.weight !== undefined) {
          next.weight = last.weight
        }
        ex.strengthSets.push(next)
        focus = { row: ex.strengthSets.length - 1, label: 'Weight' }
        break
      }
      case 'bodyweight': {
        const last = ex.bodyweightSets[ex.bodyweightSets.length - 1]
        ex.bodyweightSets.push({ set: nextSetNumber(ex.bodyweightSets), level: last?.level ?? 1 })
        focus = { row: ex.bodyweightSets.length - 1, label: 'Reps' }
        break
      }
      case 'duration':
        ex.durationEntries.push(carriedIntervalFields(ex.durationEntries.at(-1)))
        break
      default:
        assertUnreachableKind(ex.kind)
    }
    this.expandedSetLists.add(ex)
    this.markDirty()
    this.render()
    if (focus) {
      this.focusRowCell(index, focus.row, focus.label)
    }
  }

  /** Adds a set to `ex` carrying the last one's values. */
  private repeatSet(ex: ExerciseCard): void {
    switch (ex.kind) {
      case 'strength': {
        const last = ex.strengthSets[ex.strengthSets.length - 1]
        ex.strengthSets.push({
          set: nextSetNumber(ex.strengthSets),
          weight: last?.weight,
          reps: last?.reps,
        })
        break
      }
      case 'bodyweight': {
        const last = ex.bodyweightSets[ex.bodyweightSets.length - 1]
        ex.bodyweightSets.push({
          set: nextSetNumber(ex.bodyweightSets),
          level: last?.level,
          reps: last?.reps,
          load: last?.load,
        })
        break
      }
      case 'duration': {
        const last = ex.durationEntries[ex.durationEntries.length - 1]
        ex.durationEntries.push({
          set: nextSetNumber(ex.durationEntries),
          durationSeconds: last?.durationSeconds,
          ...carriedIntervalFields(last),
        })
        break
      }
      default:
        assertUnreachableKind(ex.kind)
    }
    this.expandedSetLists.add(ex)
    this.markDirty()
    this.render()
  }

  private openLevelMenu(
    set: EditableBodyweightSet,
    levels: BodyweightLadder | undefined,
    trigger: HTMLElement,
  ): void {
    const level = set.level ?? 1
    const menu = new Menu()
    const top = Math.max(levels?.length ?? 0, level)
    for (let n = 1; n <= top; n++) {
      const target = n
      menu.addItem((item) =>
        item
          .setTitle(formatBodyweightLevelLabel(levels, target))
          .setChecked(target === level)
          .onClick(() => this.setBodyweightLevel(set, target)),
      )
    }
    menu.showAtPosition(menuAnchorForTrigger(trigger.getBoundingClientRect()))
  }

  private setBodyweightLevel(set: EditableBodyweightSet, level: number): void {
    set.level = level
    this.markDirty()
    this.render()
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

  /** Writes a typed value into a row; typing never redraws. */
  private editRow<T extends object>(row: T, patch: Partial<T>): void {
    Object.assign(row, patch)
    this.markDirty()
  }

  /** What the note line and options menu of `row`, at `index` in `rows`, do when used. */
  private rowControls<T extends { set?: number; note?: string }>(
    rows: T[],
    row: T,
    index: number,
    label: string,
    loadMenu?: LoadMenu,
  ): RowControls {
    const changed = (): void => {
      this.markDirty()
      this.render()
    }
    const onRenumber = (): void => {
      rows.forEach((entry, i) => {
        entry.set = i + 1
      })
      changed()
    }
    const onDelete = (): void => {
      rows.splice(index, 1)
      changed()
    }
    const openNote = (): void => {
      new SetNoteModal(this.app, {
        title: `Note for ${label}`,
        initial: row.note ?? '',
        onSave: (next) => {
          row.note = next
          changed()
        },
      }).open()
    }
    const openMenu = (trigger: HTMLElement): void => {
      const menu = new Menu()
      menu.addItem((item) => item.setTitle('Edit note').setIcon('pencil').onClick(openNote))
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
      menu.addItem((item) =>
        item.setTitle('Renumber sets').setIcon('list-ordered').onClick(onRenumber),
      )
      menu.addItem((item) =>
        item
          .setTitle('Delete row')
          .setIcon('trash-2')
          .setWarning(true)
          .onClick(() => void this.confirmAndDeleteRow(label, onDelete)),
      )
      menu.showAtPosition(menuAnchorForTrigger(trigger.getBoundingClientRect()))
    }
    return { label, note: row.note, openNote, openMenu }
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
    const screen: SetTimerScreen = { kind: 'set', card, entry, stopwatch: null, clock: createRef() }
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

  private setTimerScene(screen: SetTimerScreen): EditorScene {
    const { card, entry, stopwatch } = screen
    const entries = card.durationEntries
    const index = entries.indexOf(entry)
    return {
      kind: 'set-timer',
      model: {
        exerciseName: card.name,
        set: entry.set ?? index + 1,
        seconds: stopwatch ? this.liveSeconds(stopwatch) : (entry.durationSeconds ?? 0),
        running: stopwatch !== null,
        previousSeconds: entries[index - 1]?.durationSeconds,
      },
      handlers: {
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
      clock: screen.clock,
    }
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
        const screen: SetTimerScreen = {
          kind: 'set',
          card,
          entry,
          stopwatch: null,
          clock: createRef(),
        }
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
    if (!screen?.stopwatch || !screen.clock.current) {
      return
    }
    screen.clock.current.setText(formatClock(this.liveSeconds(screen.stopwatch)))
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
    const run: RunScreen = { kind: 'run', card, session, clock: createRef(), cues }
    this.screens.enter(run, { wake: cues, keepScroll })
    this.screens.startClock(() => this.sendRun({ kind: 'tick' }), 500)
    return run
  }

  private runScene(run: RunScreen): EditorScene {
    const { session } = run
    const primed = (event: RunEvent) => (): void => {
      run.cues.prime()
      this.sendRun(event)
    }
    return {
      kind: 'run',
      model: {
        exerciseName: run.card.name,
        program: session.program,
        rows: session.rows,
        now: Date.now(),
        screen: session.screen,
      },
      handlers: {
        primary: primed({ kind: 'press' }),
        togglePause: primed({ kind: 'toggle-pause' }),
        end: () => this.sendRun({ kind: 'end' }),
        adjust: (delta) => this.sendRun({ kind: 'adjust', delta }),
        resumeCut: primed({ kind: 'resume-cut' }),
        endCut: () => this.sendRun({ kind: 'end-cut' }),
        back: () => this.sendRun({ kind: 'back' }),
      },
      clock: run.clock,
    }
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
    if (effects.redraw === 'clock' && run.clock.current) {
      const clock = { exerciseName: run.card.name, program: session.program, rows: session.rows }
      run.clock.current.setText(formatClock(clockSeconds({ ...clock, now })))
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
    const rest: RestScreen = { kind: 'rest', startedAtMs: Date.now(), clock: createRef() }
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
    if (rest?.kind !== 'rest' || !rest.clock.current) {
      return
    }
    rest.clock.current.setText(formatClock(this.liveRestSeconds(rest)))
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

  /** Cards whose long set list is shown in full; adding a set opens it so the new row shows. */
  private get expandedSetLists(): WeakSet<ExerciseCard> {
    this.expandedSetListsStore ??= new WeakSet<ExerciseCard>()
    return this.expandedSetListsStore
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

  private focusRowCell(exerciseIndex: number, rowIndex: number, label: string): void {
    const cards = this.contentEl.querySelectorAll('.fitkit-exercise-list > .fitkit-card')
    const card = cards.item(exerciseIndex)
    if (!card?.instanceOf(HTMLElement)) {
      return
    }
    const rows = card.querySelectorAll('.fitkit-set-rows > .fitkit-row')
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
            initial: plan.step === undefined ? '' : formatNumber(plan.step, 2),
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

  /** Wires pointer dragging to a card's handle; the result unwires it. */
  private attachCardDrag(handle: HTMLElement): () => void {
    const onDown = (evt: PointerEvent): void => {
      const card = handle.closest('.fitkit-card')
      const list = card?.parentElement
      if (evt.button !== 0 || this.dragSession || !(card instanceof HTMLElement) || !list) {
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
    }
    const onMove = (evt: PointerEvent): void => {
      const session = this.dragSession
      if (!session || evt.pointerId !== session.pointerId) {
        return
      }
      const dy = evt.clientY - session.startY
      session.card.style.setProperty('--fitkit-drag-offset', `${dy}px`)
      session.toIndex = this.computeDropIndex(session, evt.clientY)
      this.positionDropIndicator(session)
    }
    handle.addEventListener('pointerdown', onDown)
    handle.addEventListener('pointermove', onMove)
    return () => {
      handle.removeEventListener('pointerdown', onDown)
      handle.removeEventListener('pointermove', onMove)
    }
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
    const deferred = this.sceneAfterDrag
    this.sceneAfterDrag = undefined
    const { fromIndex, toIndex } = session
    const targetIndex = toIndex > fromIndex ? toIndex - 1 : toIndex
    if (commit && this.model && fromIndex !== targetIndex) {
      this.model.exercises = reorderArray(this.model.exercises, fromIndex, targetIndex)
      this.markDirty()
      this.render()
    } else if (deferred) {
      this.draw(deferred)
    }
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
    const loggedType = loggedTypeOf(target)
    /** The registry already holds the new name's type, so the switch is the card menu's this-workout one. */
    const plan =
      registryType && registryType !== loggedType
        ? planTypeSwitch({ loggedType, target: registryType, registryType, scope: 'workout' })
        : null
    if (plan?.changesKind && !(await this.confirmKindSwitch(target, kindOfType(plan.target)))) {
      return
    }
    target.name = trimmed
    this.markDirty()
    this.render()
    if (plan) {
      await this.runTypeSwitch(index, plan)
    }
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
    const line = this.metaLine.current
    if (line) {
      line.textContent = this.metaLineText()
    }
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
