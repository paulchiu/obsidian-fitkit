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
import { formatErrorMessage } from './domain/error'
import { createRegistry } from './domain/exercise-registry'
import { migrateExerciseNote } from './domain/exercise-note-migrate'
import type { FitKitIndex, IndexDiagnostic } from './domain/types'
import {
  DEFAULT_SETTINGS,
  FitKitSettingTab,
  settingsFromStored,
  type FitKitSettings,
} from './settings'
import { dashboardPath, exercisesFolder, workoutFilename, workoutsFolder } from './settings-paths'
import { renderExerciseChartBlock } from './ui/obsidian/exercise-chart-block'
import { ParseDiagnosticsModal } from './ui/obsidian/parse-diagnostics-modal'
import { renderWorkoutReadingModeSection } from './ui/obsidian/workout-reading-mode'
import {
  VIEW_TYPE_FITKIT_WORKOUT_EDITOR,
  WorkoutEditorView,
} from './ui/obsidian/workout-editor-view'
import { regenerateDashboard } from './vault/dashboard'
import {
  applyRegistryBackfillPlan,
  buildRegistryBackfillPlan,
} from './vault/exercise-registry-backfill'
import { buildExerciseRegistrySnapshot } from './vault/exercise-registry-vault'
import { markdownFilesInFolder } from './vault/folder-scan'
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
    this.workoutIndex.invalidate()
    const index = await this.getIndex()
    const result = await regenerateDashboard(this.app, this.settings, index)
    new Notice(`Dashboard rebuilt: ${result.sectionCount} section(s) at ${result.path}.`)
  }

  async restoreHiddenDashboardSections(): Promise<void> {
    const path = normalizePath(dashboardPath(this.settings))
    if (this.settings.hiddenDashboardSectionsByPath[path]) {
      delete this.settings.hiddenDashboardSectionsByPath[path]
      await this.saveSettings()
    }
    this.workoutIndex.invalidate()
    const index = await this.getIndex()
    const result = await regenerateDashboard(this.app, this.settings, index)
    new Notice(`Restored hidden sections; ${result.sectionCount} section(s) now in dashboard.`)
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
    const plan = await buildRegistryBackfillPlan(this.app, this.settings)
    this.settings.exerciseRegistry = applyRegistryBackfillPlan(
      this.settings.exerciseRegistry,
      plan.entriesToAdd,
    )
    await this.saveSettings()
    new Notice(
      `Rebuilt registry: ${plan.addedFromNotes} added from notes, ${plan.addedFromHistory} added from history-only exercises, ${plan.alreadyPresent} already present, ${plan.skippedTombstoned} skipped (ignored).`,
    )
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

  async syncExerciseNotes(): Promise<void> {
    const files = markdownFilesInFolder(this.app, exercisesFolder(this.settings))
    const snapshot = buildExerciseRegistrySnapshot(this.app, this.settings)
    const registry = createRegistry(this.settings.exerciseRegistry)
    const conflictPaths = new Set<string>()
    for (const diagnostic of snapshot.diagnostics) {
      if (diagnostic.kind === 'registry-kind-conflict' && diagnostic.path) {
        conflictPaths.add(diagnostic.path)
      }
    }

    let updated = 0
    let already = 0
    let skipped = 0
    let skippedMalformedFrontmatter = 0
    let needsValidation = 0
    let failed = 0
    const failedPaths: string[] = []
    let customisedRecentSessions = 0
    let customisedNotesSections = 0
    for (const file of files) {
      try {
        const source = await this.app.vault.read(file)
        const input = {
          name: file.basename,
          registry,
          fitnessRoot: this.settings.fitnessRoot,
        }
        const result = migrateExerciseNote(source, input)
        if (result.status === 'skipped-non-exercise-type') {
          skipped += 1
          continue
        }
        if (result.status === 'skipped-malformed-frontmatter') {
          skippedMalformedFrontmatter += 1
          continue
        }

        if (result.warnings.some((warning) => warning.kind === 'custom-recent-sessions')) {
          customisedRecentSessions += 1
        }
        if (result.warnings.some((warning) => warning.kind === 'custom-notes-section')) {
          customisedNotesSections += 1
        }
        if (result.warnings.some((warning) => warning.kind === 'registry-kind-conflict')) {
          conflictPaths.add(file.path)
        }

        if (result.changed) {
          await this.app.vault.process(file, (live) => migrateExerciseNote(live, input).markdown)
        }

        if (result.status === 'unknown') {
          needsValidation += 1
        }
        if (result.changed) {
          updated += 1
        } else {
          already += 1
        }
      } catch (error) {
        failed += 1
        failedPaths.push(`${file.path}: ${formatErrorMessage(error)}`)
      }
    }

    const failedHint = failedPaths[0] ? ` (first failure: ${failedPaths[0]})` : ''
    const customisedWarnings = [
      customisedRecentSessions > 0
        ? `${customisedRecentSessions} customised recent sessions block${
            customisedRecentSessions === 1 ? '' : 's'
          }`
        : null,
      customisedNotesSections > 0
        ? `${customisedNotesSections} customised notes section${
            customisedNotesSections === 1 ? '' : 's'
          }`
        : null,
    ].filter((warning): warning is string => warning !== null)
    const customisedSummary =
      customisedWarnings.length > 0 ? ` ${customisedWarnings.join(', ')} left alone.` : ''
    const validationSummary =
      needsValidation > 0
        ? ` (${needsValidation} ${
            needsValidation === 1 ? 'needs' : 'need'
          } validation: kind inferred/defaulted without registry, review kind and metric)`
        : ''
    const conflictSummary =
      conflictPaths.size > 0
        ? `, ${conflictPaths.size} registry kind conflict${
            conflictPaths.size === 1 ? '' : 's'
          } preserved`
        : ''
    const summary = `Synced ${files.length} exercise note${files.length === 1 ? '' : 's'}; ${updated} updated${validationSummary}, ${already} already current, ${skipped} skipped (non-exercise type), ${skippedMalformedFrontmatter} skipped (malformed frontmatter), ${failed} failed${failedHint}${conflictSummary}.${customisedSummary}`
    new Notice(summary)
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
