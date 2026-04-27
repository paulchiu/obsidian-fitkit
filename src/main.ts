import { Notice, Plugin, TFile, normalizePath } from 'obsidian'

import type { FitKitIndex, IndexDiagnostic } from './domain/types'
import { parseWorkoutNote } from './domain/workout-note-model'
import { DEFAULT_SETTINGS, FitKitSettingTab, type FitKitSettings } from './settings'
import { dashboardPath, workoutFilename, workoutsFolder } from './settings-paths'
import { CreateMissingExercisesModal } from './ui/create-missing-exercises-modal'
import { ImportModal } from './ui/import-modal'
import { ParseDiagnosticsModal } from './ui/parse-diagnostics-modal'
import { VIEW_TYPE_FITKIT_WORKOUT_EDITOR, WorkoutEditorView } from './ui/workout-editor-view'
import { regenerateDashboard } from './vault/dashboard'
import { rebuildIndex } from './vault/index'

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

  async onload(): Promise<void> {
    await this.loadSettings()
    this.addSettingTab(new FitKitSettingTab(this.app, this))

    this.addCommand({
      id: 'rebuild-index',
      name: 'Rebuild index',
      callback: async () => {
        this.cachedIndex = await rebuildIndex(this.app, this.settings)
        this.lastDiagnostics = this.cachedIndex.diagnostics
        new Notice(
          `Indexed ${this.cachedIndex.entries.length} workout(s)${
            this.lastDiagnostics.length ? `, ${this.lastDiagnostics.length} diagnostic(s)` : ''
          }.`,
        )
      },
    })

    this.addCommand({
      id: 'rebuild-dashboard',
      name: 'Rebuild dashboard',
      callback: async () => {
        this.cachedIndex = await rebuildIndex(this.app, this.settings)
        this.lastDiagnostics = this.cachedIndex.diagnostics
        const result = await regenerateDashboard(this.app, this.settings, this.cachedIndex)
        new Notice(`Dashboard rebuilt: ${result.sectionCount} section(s) at ${result.path}.`)
      },
    })

    this.addCommand({
      id: 'restore-hidden-sections',
      name: 'Restore hidden sections in current dashboard',
      callback: async () => {
        const path = normalizePath(dashboardPath(this.settings))
        if (this.settings.hiddenDashboardSectionsByPath[path]) {
          delete this.settings.hiddenDashboardSectionsByPath[path]
          await this.saveSettings()
        }
        if (!this.cachedIndex) {
          this.cachedIndex = await rebuildIndex(this.app, this.settings)
        }
        const result = await regenerateDashboard(this.app, this.settings, this.cachedIndex)
        new Notice(`Restored hidden sections; ${result.sectionCount} section(s) now in dashboard.`)
      },
    })

    this.addCommand({
      id: 'show-parse-diagnostics',
      name: 'Show parse diagnostics',
      callback: () => {
        if (this.lastDiagnostics.length === 0) {
          new Notice('No diagnostics from the last index build.')
          return
        }
        new ParseDiagnosticsModal(this.app, this.lastDiagnostics).open()
      },
    })

    this.registerView(VIEW_TYPE_FITKIT_WORKOUT_EDITOR, (leaf) => new WorkoutEditorView(leaf, this))

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

    this.addCommand({
      id: 'import-journal-active-file',
      name: 'Import workout from journal note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile()
        if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') {
          return false
        }
        if (!checking) {
          void this.openImporterForActiveFile(file)
        }
        return true
      },
    })

    this.addCommand({
      id: 'import-journal-paste',
      name: 'Import workout from pasted text',
      callback: () => {
        new ImportModal(this, {
          initialInput: '',
          readOnly: false,
          defaultFilenameDate: formatTodayIsoDate(),
        }).open()
      },
    })
  }

  private async openWorkoutEditor(file: TFile): Promise<void> {
    /** Prefer a rootSplit leaf so both commands open in the main area on mobile, not in a drawer. */
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_FITKIT_WORKOUT_EDITOR)
    const existing = leaves.find((l) => l.getRoot() === this.app.workspace.rootSplit) ?? leaves[0]
    const leaf = existing ?? this.app.workspace.getLeaf('tab')
    await leaf.setViewState({ type: VIEW_TYPE_FITKIT_WORKOUT_EDITOR, active: true })
    await this.app.workspace.revealLeaf(leaf)
    const view = leaf.view
    if (view instanceof WorkoutEditorView) {
      await view.loadFile(file)
    }
  }

  private async openImporterForActiveFile(file: TFile): Promise<void> {
    const text = await this.app.vault.read(file)
    const parsed = parseWorkoutNote(text, file.path)
    if (parsed.isWorkout && parsed.model) {
      new CreateMissingExercisesModal(this, parsed.model).open()
      return
    }
    const stem = file.basename
    const defaultDate = /^\d{4}-\d{2}-\d{2}$/.test(stem) ? stem : formatTodayIsoDate()
    new ImportModal(this, {
      initialInput: text,
      readOnly: false,
      defaultFilenameDate: defaultDate,
    }).open()
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<FitKitSettings> | null
    if (stored && stored.schemaVersion !== DEFAULT_SETTINGS.schemaVersion) {
      this.settings = { ...DEFAULT_SETTINGS }
      await this.saveSettings()
      return
    }
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }
}
