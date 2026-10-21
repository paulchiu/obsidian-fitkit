import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  type TAbstractFile,
  type WorkspaceLeaf,
  normalizePath,
} from 'obsidian'

import { frontmatterTypeIs } from './domain/frontmatter'
import { formatIsoDate } from './domain/dates'
import {
  SYNC_REPAIR_STEPS,
  type SyncRepairOutcome,
  type SyncRepairPreview,
  type SyncRepairResult,
  type SyncRepairStep,
} from './domain/sync-repair'
import { formatErrorMessage } from './domain/error'
import type { FitKitIndex, IndexDiagnostic } from './domain/types'
import {
  DEFAULT_SETTINGS,
  FitKitSettingTab,
  settingsFromStored,
  type FitKitSettings,
} from './settings'
import { dashboardPath, workoutFilename, workoutsFolder } from './settings-paths'
import { renderExerciseChartBlock } from './ui/obsidian/exercise-chart-block'
import { ParseDiagnosticsModal } from './ui/obsidian/parse-diagnostics-modal'
import { renderWorkoutReadingModeSection } from './ui/obsidian/workout-reading-mode'
import {
  VIEW_TYPE_FITKIT_WORKOUT_EDITOR,
  WorkoutEditorView,
} from './ui/obsidian/workout-editor-view'
import { previewDashboard, regenerateDashboard } from './vault/dashboard'
import {
  applyRegistryBackfillPlan,
  buildRegistryBackfillPlan,
} from './vault/exercise-registry-backfill'
import {
  applyExerciseNoteSync,
  formatExerciseNoteSyncSummary,
  planExerciseNoteSync,
  summariseExerciseNoteSync,
} from './vault/exercise-note-sync'
import { buildExerciseRegistrySnapshot } from './vault/exercise-registry-vault'
import { createWorkoutIndex, type WorkoutIndex } from './vault/workout-index'

function emptyWorkoutMarkdown(date: string): string {
  return `---\ntype: workout\ndate: ${date}\nname: \n---\n`
}

const BUSY_LEAF_RETRY_MS = 50
const BUSY_LEAF_MAX_ATTEMPTS = 40

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export default class FitKitPlugin extends Plugin {
  settings!: FitKitSettings
  private indexWorkoutsFolder?: string
  private workoutIndexStore?: WorkoutIndex

  private get workoutIndex(): WorkoutIndex {
    this.workoutIndexStore ??= createWorkoutIndex(this.app, () => this.settings)
    return this.workoutIndexStore
  }

  get cachedIndex(): FitKitIndex | null {
    return this.workoutIndex.cachedIndex
  }

  set cachedIndex(index: FitKitIndex | null) {
    this.workoutIndex.cachedIndex = index
  }

  get lastDiagnostics(): IndexDiagnostic[] {
    return this.workoutIndex.lastDiagnostics
  }

  set lastDiagnostics(diagnostics: IndexDiagnostic[]) {
    this.workoutIndex.lastDiagnostics = diagnostics
  }

  /** The workout each tab was switched to markdown for, which file-open routing leaves alone. */
  private markdownChoiceStore?: WeakMap<WorkspaceLeaf, TFile>
  private get markdownChoiceByLeaf(): WeakMap<WorkspaceLeaf, TFile> {
    this.markdownChoiceStore ??= new WeakMap<WorkspaceLeaf, TFile>()
    return this.markdownChoiceStore
  }

  async onload(): Promise<void> {
    await this.loadSettings()
    this.indexWorkoutsFolder = normalizePath(workoutsFolder(this.settings))
    this.addSettingTab(new FitKitSettingTab(this.app, this))

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if ('children' in file && Array.isArray(file.children) && file.children.length === 0) {
          return
        }
        this.invalidateForVaultChange(file)
      }),
    )
    this.registerEvent(this.app.vault.on('modify', (file) => this.invalidateForVaultChange(file)))
    this.registerEvent(this.app.vault.on('delete', (file) => this.invalidateForVaultChange(file)))
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => this.invalidateForVaultChange(file, oldPath)),
    )

    this.registerMarkdownCodeBlockProcessor('fitkit-chart', (source, el, ctx) =>
      renderExerciseChartBlock(this, source, el, ctx),
    )
    this.registerMarkdownPostProcessor((el, ctx) => renderWorkoutReadingModeSection(this, el, ctx))

    this.registerView(VIEW_TYPE_FITKIT_WORKOUT_EDITOR, (leaf) => new WorkoutEditorView(leaf, this))

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (!file) {
          return
        }
        void this.maybeRouteWorkoutFile(file)
      }),
    )

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
        if (source !== 'more-options' || !leaf || !(file instanceof TFile)) {
          return
        }
        if (leaf.view instanceof MarkdownView && this.isWorkoutFile(file)) {
          menu.addItem((item) =>
            item
              .setSection('pane')
              .setTitle('Open in workout editor')
              .setIcon('dumbbell')
              .onClick(() => this.openLeafInWorkoutEditor(leaf, file)),
          )
        }
      }),
    )

    this.app.workspace.onLayoutReady(() => this.sweepLeavesForWorkout())

    this.addCommand({
      id: 'open-todays-workout',
      name: "Open today's workout",
      callback: async () => {
        const today = formatIsoDate(new Date())
        const folder = normalizePath(workoutsFolder(this.settings))
        const path = normalizePath(`${folder}/${workoutFilename(today)}`)
        let file = this.app.vault.getAbstractFileByPath(path)
        if (!(file instanceof TFile)) {
          if (!this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder).catch(() => undefined)
          }
          file = await this.app.vault.create(path, emptyWorkoutMarkdown(today))
        }
        if (file instanceof TFile) {
          await this.openWorkoutEditor(file)
        }
      },
    })

    this.addCommand({
      id: 'open-workout-editor',
      name: 'Open workout editor for current file',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile()
        const ok = file instanceof TFile && file.extension.toLowerCase() === 'md'
        if (!ok) {
          return false
        }
        if (!checking && file) {
          void this.openWorkoutEditor(file)
        }
        return true
      },
    })
  }

  refreshWorkoutEditorViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_FITKIT_WORKOUT_EDITOR)) {
      const view = leaf.view
      if (view instanceof WorkoutEditorView) {
        view.refreshSettingsDrivenUi()
      }
    }
  }

  private invalidateForVaultChange(file: TAbstractFile, oldPath?: string): void {
    const folder = normalizePath(workoutsFolder(this.settings))
    const relevantPath = (path: string): boolean => {
      if ('extension' in file) {
        return path.startsWith(`${folder}/`) && path.toLowerCase().endsWith('.md')
      }
      return path === folder || path.startsWith(`${folder}/`) || folder.startsWith(`${path}/`)
    }
    if (relevantPath(file.path) || (oldPath !== undefined && relevantPath(oldPath))) {
      this.workoutIndex.invalidate()
    }
  }

  getIndex(): Promise<FitKitIndex> {
    return this.workoutIndex.getIndex()
  }

  async rebuildWorkoutIndex(): Promise<void> {
    this.workoutIndex.invalidate()
    const index = await this.getIndex()
    new Notice(
      `Indexed ${index.entries.length} workout(s)${
        this.lastDiagnostics.length ? `, ${this.lastDiagnostics.length} diagnostic(s)` : ''
      }.`,
    )
  }

  refreshIndexEntry(path: string): Promise<void> {
    return this.workoutIndex.refreshEntry(path)
  }

  async rebuildDashboard(): Promise<void> {
    new Notice(await this.regenerateDashboardFresh())
  }

  private async regenerateDashboardFresh(): Promise<string> {
    this.workoutIndex.invalidate()
    const index = await this.getIndex()
    const result = await regenerateDashboard(this.app, this.settings, index)
    return `Dashboard rebuilt: ${result.sectionCount} section(s) at ${result.path}.`
  }

  async restoreHiddenDashboardSections(): Promise<void> {
    await this.clearHiddenDashboardSections()
    this.workoutIndex.invalidate()
    const index = await this.getIndex()
    const result = await regenerateDashboard(this.app, this.settings, index)
    new Notice(`Restored hidden sections; ${result.sectionCount} section(s) now in dashboard.`)
  }

  /** Returns how many sections were hidden. */
  private async clearHiddenDashboardSections(): Promise<number> {
    const path = normalizePath(dashboardPath(this.settings))
    const hidden = this.settings.hiddenDashboardSectionsByPath[path]
    if (hidden) {
      delete this.settings.hiddenDashboardSectionsByPath[path]
      await this.saveSettings()
    }
    return hidden?.length ?? 0
  }

  showParseDiagnostics(): void {
    if (this.lastDiagnostics.length === 0) {
      new Notice('No diagnostics from the last index build.')
      return
    }
    new ParseDiagnosticsModal(this.app, this.lastDiagnostics).open()
  }

  /**
   * Backfills `settings.exerciseRegistry` with every note-backed and history-only exercise.
   * Never touches an existing overlay entry or materializes a unit.
   */
  async rebuildExerciseRegistry(): Promise<void> {
    new Notice(await this.backfillExerciseRegistry())
  }

  private async backfillExerciseRegistry(): Promise<string> {
    const plan = await buildRegistryBackfillPlan(this.app, this.settings)
    this.settings.exerciseRegistry = applyRegistryBackfillPlan(
      this.settings.exerciseRegistry,
      plan.entriesToAdd,
    )
    await this.saveSettings()
    return `Rebuilt registry: ${plan.addedFromNotes} added from notes, ${plan.addedFromHistory} added from history-only exercises, ${plan.alreadyPresent} already present, ${plan.skippedTombstoned} skipped (ignored).`
  }

  showExerciseRegistryDiagnostics(): void {
    const diagnostics = buildExerciseRegistrySnapshot(this.app, this.settings).diagnostics
    if (diagnostics.length === 0) {
      new Notice('No exercise registry diagnostics.')
      return
    }
    new ParseDiagnosticsModal(this.app, diagnostics, 'Exercise registry diagnostics').open()
  }

  private async openWorkoutEditor(file: TFile): Promise<void> {
    /** iterateRootLeaves walks main-area leaves only; detach any others so a drawer leaf stranded by an earlier version is cleaned up. */
    let mainAreaLeaf: WorkspaceLeaf | null = null
    this.app.workspace.iterateRootLeaves((leaf) => {
      if (!mainAreaLeaf && leaf.view.getViewType() === VIEW_TYPE_FITKIT_WORKOUT_EDITOR) {
        mainAreaLeaf = leaf
      }
    })
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_FITKIT_WORKOUT_EDITOR)) {
      if (leaf !== mainAreaLeaf) {
        leaf.detach()
      }
    }
    const leaf = mainAreaLeaf ?? this.app.workspace.getLeaf('tab')
    await this.swapLeafToWorkoutEditor(leaf, file)
  }

  /** The file travels in the view state, so the view loads it in setState and Obsidian persists it with the workspace. */
  private async swapLeafToWorkoutEditor(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    await leaf.setViewState({
      type: VIEW_TYPE_FITKIT_WORKOUT_EDITOR,
      active: true,
      state: { file: file.path },
    })
    await this.app.workspace.revealLeaf(leaf)
  }

  async openLeafAsMarkdown(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    this.markdownChoiceByLeaf.set(leaf, file)
    await leaf.setViewState({ type: 'markdown', state: { file: file.path } })
  }

  private async openLeafInWorkoutEditor(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    this.markdownChoiceByLeaf.delete(leaf)
    await this.swapLeafToWorkoutEditor(leaf, file)
  }

  private async maybeRouteWorkoutFile(file: TFile): Promise<void> {
    if (!this.shouldAutoOpenWorkoutEditor()) {
      return
    }
    if (file.extension.toLowerCase() !== 'md') {
      return
    }
    if (!this.isWorkoutFile(file)) {
      return
    }
    /** Require an active markdown view for the event file. file-open fires for genuine clicks AND for internal Obsidian transitions (revealLeaf, leaf history). The markdown view is the user-click signal. */
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView)
    if (!markdownView || markdownView.file !== file) {
      return
    }
    if (this.markdownChoiceByLeaf.get(markdownView.leaf) === file) {
      return
    }
    const editorLeaf = this.findExistingEditorLeaf()
    if (editorLeaf) {
      const view = editorLeaf.view
      if (view instanceof WorkoutEditorView && view.currentFile?.path === file.path) {
        return
      }
      if (markdownView.leaf !== editorLeaf) {
        markdownView.leaf.detach()
      }
      await this.swapLeafToWorkoutEditor(editorLeaf, file)
      return
    }
    await this.swapOpeningLeafToWorkoutEditor(markdownView, file)
  }

  /** file-open fires while Obsidian is still opening the leaf, and Obsidian ignores setViewState on a busy leaf, so retry until the swap takes or the leaf moves on to something else. */
  private async swapOpeningLeafToWorkoutEditor(
    markdownView: MarkdownView,
    file: TFile,
  ): Promise<void> {
    const leaf = markdownView.leaf
    const stillShowingWorkoutMarkdown = (): boolean =>
      leaf.view === markdownView && markdownView.file === file
    for (let attempt = 0; attempt < BUSY_LEAF_MAX_ATTEMPTS; attempt++) {
      await this.swapLeafToWorkoutEditor(leaf, file)
      if (!stillShowingWorkoutMarkdown()) {
        return
      }
      await delay(BUSY_LEAF_RETRY_MS)
      if (!stillShowingWorkoutMarkdown()) {
        return
      }
    }
  }

  private findExistingEditorLeaf(): WorkspaceLeaf | null {
    let mainAreaLeaf: WorkspaceLeaf | null = null
    this.app.workspace.iterateRootLeaves((leaf) => {
      if (!mainAreaLeaf && leaf.view.getViewType() === VIEW_TYPE_FITKIT_WORKOUT_EDITOR) {
        mainAreaLeaf = leaf
      }
    })
    if (mainAreaLeaf) {
      return mainAreaLeaf
    }
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_FITKIT_WORKOUT_EDITOR)[0] ?? null
  }

  private sweepLeavesForWorkout(): void {
    if (!this.shouldAutoOpenWorkoutEditor()) {
      return
    }
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view
      if (view instanceof MarkdownView && view.file && this.isWorkoutFile(view.file)) {
        void this.swapLeafToWorkoutEditor(leaf, view.file)
      }
    }
  }

  private shouldAutoOpenWorkoutEditor(): boolean {
    return this.settings?.autoOpenWorkoutEditor !== false
  }

  private isWorkoutFile(file: TFile): boolean {
    return frontmatterTypeIs(this.app.metadataCache.getFileCache(file)?.frontmatter, 'workout')
  }

  /** Scans what each sync and repair step would change, writing nothing. */
  async previewSyncRepair(): Promise<SyncRepairPreview> {
    this.workoutIndex.invalidate()
    const index = await this.getIndex()
    const registryPlan = await buildRegistryBackfillPlan(this.app, this.settings)
    const notesPlan = await planExerciseNoteSync(
      this.app,
      this.settings,
      applyRegistryBackfillPlan(this.settings.exerciseRegistry, registryPlan.entriesToAdd),
    )
    const notes = summariseExerciseNoteSync(notesPlan)
    const dashboard = await previewDashboard(this.app, this.settings, index)
    return {
      workoutCount: index.entries.length,
      exerciseNoteCount: notes.files,
      registry: {
        toAdd: registryPlan.entriesToAdd.length,
        fromNotes: registryPlan.addedFromNotes,
        fromHistory: registryPlan.addedFromHistory,
      },
      notes: {
        toUpdate: notes.updated,
        current: notes.already,
        skipped: notes.skipped + notes.skippedMalformedFrontmatter,
      },
      hiddenSections: this.settings.hiddenDashboardSectionsByPath[dashboard.path]?.length ?? 0,
      dashboard: { sectionCount: dashboard.sectionCount, changed: dashboard.changed },
      diagnostics: this.diagnosticCounts(),
    }
  }

  /** Runs the ticked steps in order, re-reading the vault for each, and stops at the first failure. */
  async applySyncRepair(steps: readonly SyncRepairStep[]): Promise<SyncRepairOutcome> {
    const results: SyncRepairResult[] = []
    for (const step of SYNC_REPAIR_STEPS.filter((candidate) => steps.includes(candidate))) {
      try {
        results.push({ step, ok: true, summary: await this.runSyncRepairStep(step) })
      } catch (error) {
        results.push({ step, ok: false, message: formatErrorMessage(error) })
        break
      }
    }
    return { results, diagnostics: this.diagnosticCounts() }
  }

  private async runSyncRepairStep(step: SyncRepairStep): Promise<string> {
    switch (step) {
      case 'registry':
        return this.backfillExerciseRegistry()
      case 'notes': {
        const plan = await planExerciseNoteSync(
          this.app,
          this.settings,
          this.settings.exerciseRegistry,
        )
        return formatExerciseNoteSyncSummary(
          summariseExerciseNoteSync(await applyExerciseNoteSync(this.app, plan)),
        )
      }
      case 'hidden-sections': {
        const restored = await this.clearHiddenDashboardSections()
        return `Restored ${restored} hidden section(s).`
      }
      case 'dashboard':
        return this.regenerateDashboardFresh()
    }
  }

  private diagnosticCounts(): SyncRepairPreview['diagnostics'] {
    return {
      parse: this.lastDiagnostics.length,
      registry: buildExerciseRegistrySnapshot(this.app, this.settings).diagnostics.length,
    }
  }

  async syncExerciseNotes(): Promise<void> {
    const plan = await planExerciseNoteSync(this.app, this.settings, this.settings.exerciseRegistry)
    const applied = await applyExerciseNoteSync(this.app, plan)
    new Notice(formatExerciseNoteSyncSummary(summariseExerciseNoteSync(applied)))
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<FitKitSettings> | null
    if (
      stored &&
      stored.schemaVersion !== undefined &&
      stored.schemaVersion !== DEFAULT_SETTINGS.schemaVersion
    ) {
      this.settings = { ...DEFAULT_SETTINGS }
      await this.saveSettings()
      return
    }
    this.settings = settingsFromStored(stored)
  }

  async saveSettings(): Promise<void> {
    const folder = normalizePath(workoutsFolder(this.settings))
    if (this.indexWorkoutsFolder !== folder) {
      this.workoutIndex.invalidate()
      this.indexWorkoutsFolder = folder
    }
    await this.saveData(this.settings)
  }
}
