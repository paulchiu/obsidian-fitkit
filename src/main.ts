import { MarkdownView, Notice, Plugin, TFile, type WorkspaceLeaf, normalizePath } from 'obsidian'

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
import { renderExerciseChartBlock } from './ui/exercise-chart-block'
import { ParseDiagnosticsModal } from './ui/parse-diagnostics-modal'
import { renderWorkoutReadingModeSection } from './ui/workout-reading-mode'
import { VIEW_TYPE_FITKIT_WORKOUT_EDITOR, WorkoutEditorView } from './ui/workout-editor-view'
import { regenerateDashboard } from './vault/dashboard'
import {
  applyRegistryBackfillPlan,
  buildRegistryBackfillPlan,
} from './vault/exercise-registry-backfill'
import { buildExerciseRegistrySnapshot } from './vault/exercise-registry-vault'
import { rebuildIndex, updateIndexEntry } from './vault/index'

function formatTodayIsoDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

function emptyWorkoutMarkdown(date: string): string {
  return `---\ntype: workout\ndate: ${date}\nname: \n---\n`
}

export default class FitKitPlugin extends Plugin {
  settings!: FitKitSettings
  cachedIndex: FitKitIndex | null = null
  lastDiagnostics: IndexDiagnostic[] = []

  /**
   * Chains overlapping calls to refreshIndexEntry, which read-modify-writes
   * cachedIndex across an await, ensuring each runs in order with fresh data.
   * Settled links never reject, so a failed refresh cannot stall later ones.
   */
  private indexRefreshQueue: Promise<void> | null = null

  async onload(): Promise<void> {
    await this.loadSettings()
    this.addSettingTab(new FitKitSettingTab(this.app, this))

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

    this.app.workspace.onLayoutReady(() => this.sweepLeavesForWorkout())

    this.addCommand({
      id: 'open-todays-workout',
      name: "Open today's workout",
      callback: async () => {
        const today = formatTodayIsoDate()
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

  async rebuildWorkoutIndex(): Promise<void> {
    this.cachedIndex = await rebuildIndex(this.app, this.settings)
    this.lastDiagnostics = this.cachedIndex.diagnostics
    new Notice(
      `Indexed ${this.cachedIndex.entries.length} workout(s)${
        this.lastDiagnostics.length ? `, ${this.lastDiagnostics.length} diagnostic(s)` : ''
      }.`,
    )
  }

  /**
   * History badges and charts read the cached index, so a note saved without
   * refreshing it serves stale data until the next manual rebuild. Chained onto
   * indexRefreshQueue so overlapping calls apply in order instead of racing.
   */
  async refreshIndexEntry(path: string): Promise<void> {
    const previous = this.indexRefreshQueue ?? Promise.resolve()
    const run = previous.then(() => this.applyIndexRefresh(path))
    this.indexRefreshQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async applyIndexRefresh(path: string): Promise<void> {
    if (this.cachedIndex === null) {
      return
    }
    this.cachedIndex = await updateIndexEntry(this.app, this.settings, this.cachedIndex, path)
    this.lastDiagnostics = this.cachedIndex.diagnostics
  }

  async rebuildDashboard(): Promise<void> {
    this.cachedIndex = await rebuildIndex(this.app, this.settings)
    this.lastDiagnostics = this.cachedIndex.diagnostics
    const result = await regenerateDashboard(this.app, this.settings, this.cachedIndex)
    new Notice(`Dashboard rebuilt: ${result.sectionCount} section(s) at ${result.path}.`)
  }

  async restoreHiddenDashboardSections(): Promise<void> {
    const path = normalizePath(dashboardPath(this.settings))
    if (this.settings.hiddenDashboardSectionsByPath[path]) {
      delete this.settings.hiddenDashboardSectionsByPath[path]
      await this.saveSettings()
    }
    this.cachedIndex = await rebuildIndex(this.app, this.settings)
    this.lastDiagnostics = this.cachedIndex.diagnostics
    const result = await regenerateDashboard(this.app, this.settings, this.cachedIndex)
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
   * Backfills settings.exerciseRegistry so it lists every exercise the plugin
   * knows about: notes in the exercises folder, and names logged only in
   * workout history. Never touches an existing overlay entry or materializes
   * a unit; see exercise-registry-backfill.ts for the invariants.
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

  private async swapLeafToWorkoutEditor(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    const wasFreshMount = !(leaf.view instanceof WorkoutEditorView)
    if (wasFreshMount) {
      await leaf.setViewState({ type: VIEW_TYPE_FITKIT_WORKOUT_EDITOR, active: true })
      /** Replace the onOpen empty hint with the skeleton synchronously, before any further await, so the user does not see the hint flash between mount and loadFile. */
      const freshView = leaf.view
      if (freshView instanceof WorkoutEditorView) {
        freshView.renderSkeleton()
      }
    }
    await this.app.workspace.revealLeaf(leaf)
    const view = leaf.view
    if (view instanceof WorkoutEditorView) {
      await view.loadFile(file)
    }
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
    await this.swapLeafToWorkoutEditor(markdownView.leaf, file)
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
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter
    const type: unknown = frontmatter?.type
    return typeof type === 'string' && type.toLowerCase() === 'workout'
  }

  async syncExerciseNotes(): Promise<void> {
    const folder = exercisesFolder(this.settings)
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${folder}/`))
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
    await this.saveData(this.settings)
  }
}
