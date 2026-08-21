import { App, Notice, PluginSettingTab, Setting, TFile, normalizePath } from 'obsidian'

import { formatErrorMessage } from './domain/error'
import type { ExerciseRegistryEntry } from './domain/exercise-registry'
import { createRegistry, normalize, removeEntry } from './domain/exercise-registry'
import { parseWeightUnit } from './domain/weight-unit'
import type FitKitPlugin from './main'
import { DeleteRegistryEntryModal } from './ui/delete-registry-entry-modal'
import { ExerciseRegistryEntryModal } from './ui/exercise-registry-entry-modal'
import { ExerciseRenameModal } from './ui/exercise-rename-modal'
import { ImportExercisesModal } from './ui/import-exercises-modal'
import { dashboardPath, exercisesFolder, workoutsFolder } from './settings-paths'
import {
  buildRegistryTableRows,
  filterRegistryTableRows,
  type RegistryTableRow,
} from './vault/exercise-registry-table'

export { dashboardPath, exercisesFolder, workoutFilename, workoutsFolder } from './settings-paths'

export interface FitKitSettings {
  fitnessRoot: string
  autoOpenWorkoutEditor: boolean
  strengthRestTimerEnabled: boolean
  autosaveDebounceMs: number
  chartSessionsWindow: number
  exerciseRegistry: ExerciseRegistryEntry[]
  deletedExercises?: string[]
  hiddenDashboardSectionsByPath: Record<string, string[]>
  schemaVersion: 1
}

export const DEFAULT_SETTINGS: FitKitSettings = {
  fitnessRoot: 'Fitness',
  autoOpenWorkoutEditor: true,
  strengthRestTimerEnabled: true,
  autosaveDebounceMs: 600,
  chartSessionsWindow: 30,
  exerciseRegistry: [],
  deletedExercises: [],
  hiddenDashboardSectionsByPath: {},
  schemaVersion: 1,
}

export function normalizeDeletedExerciseTombstones(
  deletedExercises: readonly string[] = [],
): string[] {
  const tombstones: string[] = []
  const seen = new Set<string>()
  for (const name of deletedExercises) {
    const key = normalize(name)
    if (key.length === 0 || seen.has(key)) {
      continue
    }
    seen.add(key)
    tombstones.push(key)
  }
  return tombstones
}

export function addDeletedExerciseTombstone(
  deletedExercises: readonly string[] | undefined,
  name: string,
): string[] {
  return normalizeDeletedExerciseTombstones([...(deletedExercises ?? []), name])
}

export function removeDeletedExerciseTombstone(
  deletedExercises: readonly string[] | undefined,
  name: string,
): string[] {
  const targetKey = normalize(name)
  return normalizeDeletedExerciseTombstones(deletedExercises).filter((key) => key !== targetKey)
}

export function settingsFromStored(stored: Partial<FitKitSettings> | null): FitKitSettings {
  if (!stored) {
    return { ...DEFAULT_SETTINGS }
  }
  return {
    fitnessRoot: stored.fitnessRoot ?? DEFAULT_SETTINGS.fitnessRoot,
    autoOpenWorkoutEditor: stored.autoOpenWorkoutEditor ?? DEFAULT_SETTINGS.autoOpenWorkoutEditor,
    strengthRestTimerEnabled:
      stored.strengthRestTimerEnabled ?? DEFAULT_SETTINGS.strengthRestTimerEnabled,
    autosaveDebounceMs: stored.autosaveDebounceMs ?? DEFAULT_SETTINGS.autosaveDebounceMs,
    chartSessionsWindow: stored.chartSessionsWindow ?? DEFAULT_SETTINGS.chartSessionsWindow,
    exerciseRegistry: normalizeStoredExerciseRegistry(
      stored.exerciseRegistry ?? DEFAULT_SETTINGS.exerciseRegistry,
    ),
    deletedExercises: normalizeDeletedExerciseTombstones(
      stored.deletedExercises ?? DEFAULT_SETTINGS.deletedExercises,
    ),
    hiddenDashboardSectionsByPath:
      stored.hiddenDashboardSectionsByPath ?? DEFAULT_SETTINGS.hiddenDashboardSectionsByPath,
    schemaVersion: DEFAULT_SETTINGS.schemaVersion,
  }
}

function normalizeStoredExerciseRegistry(
  entries: readonly ExerciseRegistryEntry[] = [],
): ExerciseRegistryEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    unit: parseWeightUnit(entry.unit) ?? undefined,
    aliases: [...entry.aliases],
  }))
}

const CHART_WINDOW_MIN = 5
const CHART_WINDOW_MAX = 365

export class FitKitSettingTab extends PluginSettingTab {
  plugin: FitKitPlugin

  constructor(app: App, plugin: FitKitPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    const settings = this.plugin.settings

    new Setting(containerEl).setName('Paths').setHeading()

    new Setting(containerEl)
      .setName('Fitness root')
      .setDesc('Folder under the vault root where workouts, exercises, and the dashboard live.')
      .addText((text) =>
        text.setValue(settings.fitnessRoot).onChange(async (value) => {
          settings.fitnessRoot = normalizePath(value)
          await this.plugin.saveSettings()
          refreshDerivedPaths()
        }),
      )

    containerEl.createEl('div', {
      text: 'Derived paths:',
      cls: 'setting-item-name',
    })
    const workoutsLine = containerEl.createEl('div', { cls: 'setting-item-description' })
    workoutsLine.createSpan({ text: 'Workouts folder: ' })
    const workoutsValue = workoutsLine.createSpan()
    const exercisesLine = containerEl.createEl('div', { cls: 'setting-item-description' })
    exercisesLine.createSpan({ text: 'Exercises folder: ' })
    const exercisesValue = exercisesLine.createSpan()
    const dashboardLine = containerEl.createEl('div', { cls: 'setting-item-description' })
    dashboardLine.createSpan({ text: 'Dashboard: ' })
    const dashboardValue = dashboardLine.createSpan()
    const refreshDerivedPaths = (): void => {
      workoutsValue.setText(workoutsFolder(settings))
      exercisesValue.setText(exercisesFolder(settings))
      dashboardValue.setText(dashboardPath(settings))
    }
    refreshDerivedPaths()

    new Setting(containerEl).setName('Behavior').setHeading()

    new Setting(containerEl)
      .setName('Auto-open workout editor')
      .setDesc(
        'When opening a workout note, switch it into the editor automatically; turn this off to use normal Markdown reading mode by default.',
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.autoOpenWorkoutEditor).onChange(async (value) => {
          settings.autoOpenWorkoutEditor = value
          await this.plugin.saveSettings()
        }),
      )

    new Setting(containerEl)
      .setName('Rest timer')
      .setDesc(
        'Show a rest timer in the workout editor footer that remembers your last rest after stopping.',
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.strengthRestTimerEnabled).onChange(async (value) => {
          settings.strengthRestTimerEnabled = value
          await this.plugin.saveSettings()
          this.plugin.refreshWorkoutEditorViews()
        }),
      )

    new Setting(containerEl)
      .setName('Autosave debounce (ms)')
      .setDesc(
        'How long to wait after the last edit before persisting changes in the workout editor view.',
      )
      .addText((text) => {
        text.inputEl.type = 'number'
        text.inputEl.min = '0'
        text.setValue(String(settings.autosaveDebounceMs)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10)
          settings.autosaveDebounceMs = Number.isNaN(parsed) || parsed < 0 ? 600 : parsed
          text.setValue(String(settings.autosaveDebounceMs))
          await this.plugin.saveSettings()
        })
      })

    new Setting(containerEl).setName('Charts').setHeading()

    new Setting(containerEl)
      .setName('Chart sessions')
      .setDesc(
        "How many recent workout dates to plot on the exercise progression chart. Each chart block can override this with 'window: <N>'.",
      )
      .addText((text) => {
        text.inputEl.type = 'number'
        text.inputEl.min = String(CHART_WINDOW_MIN)
        text.inputEl.max = String(CHART_WINDOW_MAX)
        text.setValue(String(settings.chartSessionsWindow)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10)
          const fallback = Number.isFinite(parsed)
            ? Math.min(Math.max(parsed, CHART_WINDOW_MIN), CHART_WINDOW_MAX)
            : DEFAULT_SETTINGS.chartSessionsWindow
          settings.chartSessionsWindow = fallback
          text.setValue(String(fallback))
          await this.plugin.saveSettings()
        })
      })

    new Setting(containerEl).setName('Setup and maintenance').setHeading()

    containerEl.createEl('div', {
      text: 'Use these actions when setting up the plugin, repairing generated exercise notes, or refreshing dashboard data.',
      cls: 'setting-item-description',
    })

    new Setting(containerEl)
      .setName('Rebuild index')
      .setDesc('Scan workout notes and cache the latest index plus parse diagnostics.')
      .addButton((button) =>
        button.setButtonText('Rebuild').onClick(() => this.plugin.rebuildWorkoutIndex()),
      )

    new Setting(containerEl)
      .setName('Rebuild dashboard')
      .setDesc('Rebuild the workout index, then regenerate the dashboard note.')
      .addButton((button) =>
        button.setButtonText('Rebuild').onClick(() => this.plugin.rebuildDashboard()),
      )

    new Setting(containerEl)
      .setName('Restore hidden dashboard sections')
      .setDesc('Clear hidden-section state for the dashboard and regenerate it.')
      .addButton((button) =>
        button.setButtonText('Restore').onClick(() => this.plugin.restoreHiddenDashboardSections()),
      )

    new Setting(containerEl)
      .setName('Show parse diagnostics')
      .setDesc('Open diagnostics from the last index build, or report that none exist.')
      .addButton((button) =>
        button.setButtonText('Show').onClick(() => this.plugin.showParseDiagnostics()),
      )

    new Setting(containerEl)
      .setName('Show exercise registry diagnostics')
      .setDesc('Open exercise catalog and registry diagnostics from the current vault state.')
      .addButton((button) =>
        button.setButtonText('Show').onClick(() => this.plugin.showExerciseRegistryDiagnostics()),
      )

    new Setting(containerEl)
      .setName('Sync and repair exercise notes')
      .setDesc(
        'Repair exercise note frontmatter, chart blocks, recent sessions, and note headings.',
      )
      .addButton((button) =>
        button.setButtonText('Sync').onClick(() => this.plugin.syncExerciseNotes()),
      )

    new Setting(containerEl)
      .setName('Rebuild registry')
      .setDesc(
        'Add every exercise note and workout-history-only name missing from the registry below. Never overwrites an existing entry or its unit.',
      )
      .addButton((button) =>
        button.setButtonText('Rebuild').onClick(() => this.plugin.rebuildExerciseRegistry()),
      )

    new Setting(containerEl).setName('Registry').setHeading()

    containerEl.createDiv({
      text: 'Every exercise the plugin knows about: notes in your exercises folder, no-note registry entries, and names logged only in workout history. This is the central place to fix wording, casing, or splitting; use the rebuild action above to pull in anything missing.',
      cls: 'setting-item-description',
    })

    let searchQuery = ''
    let rows: RegistryTableRow[] = []
    const registrySection = containerEl.createDiv({ cls: 'fitkit-registry-section' })

    const renderRegistrySection = (): void => {
      registrySection.empty()

      const actions = registrySection.createDiv({ cls: 'fitkit-registry-actions' })
      const addBtn = actions.createEl('button', {
        cls: 'fitkit-btn fitkit-btn-primary',
        text: 'Add entry',
      })
      addBtn.addEventListener('click', () => {
        new ExerciseRegistryEntryModal(this.plugin, { kind: 'create' }, () => {
          renderRegistrySection()
        }).open()
      })
      const importBtn = actions.createEl('button', {
        cls: 'fitkit-btn',
        text: 'Import exercises',
      })
      importBtn.addEventListener('click', () => {
        new ImportExercisesModal(this.plugin, {
          onApplied: renderRegistrySection,
        }).open()
      })

      const search = registrySection.createEl('input', {
        type: 'search',
        cls: 'fitkit-registry-search',
      })
      search.placeholder = 'Search by name or alias'
      search.value = searchQuery
      search.addEventListener('input', () => {
        searchQuery = search.value
        renderTable()
      })

      const tableWrap = registrySection.createDiv({ cls: 'fitkit-registry-table-wrap' })
      const empty = registrySection.createDiv({ cls: 'fitkit-registry-empty' })

      const renderTable = (): void => {
        tableWrap.empty()
        empty.empty()

        if (rows.length === 0) {
          empty.setText(
            'No exercises found. Add one, import from workouts, or log one in a workout.',
          )
          return
        }

        const visible = filterRegistryTableRows(rows, searchQuery)

        if (visible.length === 0) {
          empty.setText(`No matches for '${searchQuery}'.`)
          return
        }

        const table = tableWrap.createEl('table', { cls: 'fitkit-import-table' })
        const head = table.createEl('tr')
        head.createEl('th', { text: 'Name' })
        head.createEl('th', { text: 'Source' })
        head.createEl('th', { text: 'Kind' })
        head.createEl('th', { text: 'Unit' })
        head.createEl('th', { text: 'Aliases' })
        head.createEl('th', { text: '' })

        for (const row of visible) {
          this.renderRegistryRow(table, row, renderRegistrySection)
        }
      }

      empty.setText('Loading…')
      void buildRegistryTableRows(this.plugin.app, this.plugin.settings)
        .then((loaded) => {
          rows = loaded
          renderTable()
        })
        .catch((error: unknown) => {
          empty.setText(`Could not load exercises: ${formatErrorMessage(error)}.`)
        })
    }

    renderRegistrySection()
  }

  private renderRegistryRow(table: HTMLElement, row: RegistryTableRow, rerender: () => void): void {
    const tr = table.createEl('tr')
    tr.createEl('td', { text: row.name })

    const sourceCell = tr.createEl('td')
    const badge = sourceCell.createSpan({ cls: 'fitkit-registry-provenance' })
    if (row.provenance === 'note') {
      badge.addClass('is-note')
      badge.setText('Note')
      if (row.notePath) {
        badge.setAttr('title', row.notePath)
      }
    } else if (row.provenance === 'history') {
      badge.addClass('is-history')
      badge.setText('History only')
      badge.setAttr(
        'title',
        `Logged in ${row.sourcePaths.length} workout note(s); no exercise note or registry entry yet.`,
      )
    } else {
      badge.addClass('is-overlay')
      badge.setText('Registry')
    }

    tr.createEl('td', { text: row.kind })
    tr.createEl('td', { text: row.kind === 'strength' ? (row.unit ?? '') : '' })

    const aliasCell = tr.createEl('td', { cls: 'fitkit-registry-aliases-cell' })
    if (row.aliases.length === 0) {
      aliasCell.setText('None')
      aliasCell.addClass('fitkit-registry-aliases-muted')
    } else {
      const joined = row.aliases.join(', ')
      aliasCell.setText(joined)
      aliasCell.setAttr('title', joined)
    }

    const actions = tr.createEl('td', { cls: 'fitkit-registry-action-cell' })

    if (row.provenance === 'note') {
      const renameBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Rename' })
      renameBtn.setAttr(
        'title',
        'Rename or merge this exercise: renames the note file and rewrites references in workout notes.',
      )
      renameBtn.addEventListener('click', () => {
        new ExerciseRenameModal(this.plugin, { oldName: row.name, onApplied: rerender }).open()
      })
    } else if (row.provenance === 'history') {
      const addBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Add to registry' })
      addBtn.addEventListener('click', () => {
        new ExerciseRegistryEntryModal(
          this.plugin,
          { kind: 'create', initial: { name: row.name, kind: row.kind } },
          rerender,
        ).open()
      })
    } else {
      const editBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Edit' })
      editBtn.addEventListener('click', () => {
        new ExerciseRegistryEntryModal(
          this.plugin,
          {
            kind: 'edit',
            original: { name: row.name, kind: row.kind, unit: row.unit, aliases: row.aliases },
          },
          rerender,
        ).open()
      })
    }

    const deleteBtn = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-destructive-button',
      text: 'Delete',
    })
    deleteBtn.addEventListener('click', () => {
      new DeleteRegistryEntryModal(
        this.plugin.app,
        { entryName: row.name, notePath: row.notePath },
        ({ confirmed, alsoDeleteFile }) => {
          if (!confirmed) {
            return
          }
          void this.deleteRegistryEntry(row.name, alsoDeleteFile, rerender)
        },
      ).open()
    })
  }

  private lookupExerciseNotePath(name: string): string | null {
    const path = normalizePath(`${exercisesFolder(this.plugin.settings)}/${name}.md`)
    const file = this.plugin.app.vault.getAbstractFileByPath(path)
    return file instanceof TFile ? path : null
  }

  /**
   * Handles all three row provenances. An overlay entry (found in `fresh`)
   * always has its overlay row removed. `alsoDeleteFile` additionally trashes
   * a note and tombstones the name, whatever its provenance. Without an
   * overlay entry and without deleting the file, a note-backed row is left
   * alone (the note still drives it); a history-only row is tombstoned, since
   * that is the only way to make it stop reappearing.
   */
  private async deleteRegistryEntry(
    name: string,
    alsoDeleteFile: boolean,
    rerender: () => void,
  ): Promise<void> {
    const fresh = createRegistry(this.plugin.settings.exerciseRegistry)
    const targetKey = normalize(name)
    const target = fresh.entries.find((entry) => normalize(entry.name) === targetKey)
    const canonicalName = target?.name ?? name

    if (alsoDeleteFile) {
      const notePath = normalizePath(`${exercisesFolder(this.plugin.settings)}/${canonicalName}.md`)
      const file = this.plugin.app.vault.getAbstractFileByPath(notePath)
      if (file instanceof TFile) {
        try {
          await this.plugin.app.fileManager.trashFile(file)
        } catch (error) {
          new Notice(
            `Could not delete '${canonicalName}' because the note file could not be trashed: ${formatErrorMessage(error)}.`,
          )
          rerender()
          return
        }
      }
      const next = target ? removeEntry(fresh, target.name) : fresh
      this.plugin.settings.exerciseRegistry = next.entries
      this.plugin.settings.deletedExercises = addDeletedExerciseTombstone(
        this.plugin.settings.deletedExercises,
        canonicalName,
      )
      await this.plugin.saveSettings()
      new Notice(
        file instanceof TFile
          ? `Deleted '${canonicalName}' and recorded it as ignored.`
          : `Removed '${canonicalName}' and recorded the already-missing note as ignored.`,
      )
      rerender()
      return
    }

    if (target) {
      const next = removeEntry(fresh, target.name)
      this.plugin.settings.exerciseRegistry = next.entries
      await this.plugin.saveSettings()
      new Notice(`Removed registry overlay for '${target.name}'.`)
      rerender()
      return
    }

    if (this.lookupExerciseNotePath(canonicalName)) {
      new Notice(
        `'${canonicalName}' still has an exercise note, so it remains listed. Delete the note to remove it.`,
      )
      rerender()
      return
    }

    this.plugin.settings.deletedExercises = addDeletedExerciseTombstone(
      this.plugin.settings.deletedExercises,
      canonicalName,
    )
    await this.plugin.saveSettings()
    new Notice(`Ignored '${canonicalName}'; it will no longer appear in the registry.`)
    rerender()
  }
}
