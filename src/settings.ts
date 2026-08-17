import { App, Notice, PluginSettingTab, Setting, TFile, normalizePath } from 'obsidian'

import { formatErrorMessage } from './domain/error'
import type { ExerciseRegistryEntry } from './domain/exercise-registry'
import { createRegistry, normalize, removeEntry } from './domain/exercise-registry'
import { DEFAULT_WEIGHT_UNIT, parseWeightUnit } from './domain/weight-unit'
import type FitKitPlugin from './main'
import { DeleteRegistryEntryModal } from './ui/delete-registry-entry-modal'
import { ExerciseRegistryEntryModal } from './ui/exercise-registry-entry-modal'
import { ImportExercisesModal } from './ui/import-exercises-modal'
import { dashboardPath, exercisesFolder, workoutsFolder } from './settings-paths'

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
    unit: parseWeightUnit(entry.unit) ?? DEFAULT_WEIGHT_UNIT,
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

    new Setting(containerEl).setName('Registry').setHeading()

    containerEl.createEl('div', {
      text: 'Curate no-note exercise entries and aliases. Exercise notes in your exercises folder count at runtime even when they are not listed here; use import exercises to create missing notes or no-note entries from workout history.',
      cls: 'setting-item-description',
    })

    let searchQuery = ''
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

        const entries = settings.exerciseRegistry
          .slice()
          .sort((left, right) => left.name.localeCompare(right.name))
        if (entries.length === 0) {
          empty.setText('No registry overlays yet. Add one or import from workouts.')
          return
        }

        const queryKey = normalize(searchQuery)
        const visible = queryKey
          ? entries.filter((entry) => {
              if (normalize(entry.name).includes(queryKey)) {
                return true
              }
              return entry.aliases.some((alias) => normalize(alias).includes(queryKey))
            })
          : entries

        if (visible.length === 0) {
          empty.setText(`No matches for '${searchQuery}'.`)
          return
        }

        const table = tableWrap.createEl('table', { cls: 'fitkit-import-table' })
        const head = table.createEl('tr')
        head.createEl('th', { text: 'Name' })
        head.createEl('th', { text: 'Kind' })
        head.createEl('th', { text: 'Unit' })
        head.createEl('th', { text: 'Aliases' })
        head.createEl('th', { text: '' })

        for (const entry of visible) {
          this.renderRegistryRow(table, entry, renderRegistrySection)
        }
      }

      renderTable()
    }

    renderRegistrySection()
  }

  private renderRegistryRow(
    table: HTMLElement,
    entry: ExerciseRegistryEntry,
    rerender: () => void,
  ): void {
    const tr = table.createEl('tr')
    tr.createEl('td', { text: entry.name })
    tr.createEl('td', { text: entry.kind })
    tr.createEl('td', { text: entry.kind === 'strength' ? entry.unit : '' })

    const aliasCell = tr.createEl('td')
    if (entry.aliases.length === 0) {
      aliasCell.setText('None')
      aliasCell.addClass('fitkit-registry-aliases-muted')
    } else {
      const joined = entry.aliases.join(', ')
      aliasCell.setText(joined)
      aliasCell.setAttr('title', joined)
    }

    const actions = tr.createEl('td', { cls: 'fitkit-registry-action-cell' })
    const editBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Edit' })
    editBtn.addEventListener('click', () => {
      new ExerciseRegistryEntryModal(
        this.plugin,
        { kind: 'edit', original: entry },
        rerender,
      ).open()
    })
    const deleteBtn = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-destructive-button',
      text: 'Delete',
    })
    deleteBtn.addEventListener('click', () => {
      const notePath = this.lookupExerciseNotePath(entry.name)
      new DeleteRegistryEntryModal(
        this.plugin.app,
        { entryName: entry.name, notePath },
        ({ confirmed, alsoDeleteFile }) => {
          if (!confirmed) {
            return
          }
          void this.deleteRegistryEntry(entry.name, alsoDeleteFile, rerender)
        },
      ).open()
    })
  }

  private lookupExerciseNotePath(name: string): string | null {
    const path = normalizePath(`${exercisesFolder(this.plugin.settings)}/${name}.md`)
    const file = this.plugin.app.vault.getAbstractFileByPath(path)
    return file instanceof TFile ? path : null
  }

  private async deleteRegistryEntry(
    name: string,
    alsoDeleteFile: boolean,
    rerender: () => void,
  ): Promise<void> {
    const fresh = createRegistry(this.plugin.settings.exerciseRegistry)
    const targetKey = normalize(name)
    const target = fresh.entries.find((entry) => normalize(entry.name) === targetKey)
    if (!target) {
      new Notice('That entry was already removed.')
      rerender()
      return
    }

    if (alsoDeleteFile) {
      const notePath = normalizePath(`${exercisesFolder(this.plugin.settings)}/${target.name}.md`)
      const file = this.plugin.app.vault.getAbstractFileByPath(notePath)
      if (file instanceof TFile) {
        try {
          await this.plugin.app.fileManager.trashFile(file)
        } catch (error) {
          new Notice(
            `Could not delete '${target.name}' because the note file could not be trashed: ${formatErrorMessage(error)}.`,
          )
          rerender()
          return
        }
      }
      const next = removeEntry(fresh, target.name)
      this.plugin.settings.exerciseRegistry = next.entries
      this.plugin.settings.deletedExercises = addDeletedExerciseTombstone(
        this.plugin.settings.deletedExercises,
        target.name,
      )
      await this.plugin.saveSettings()
      new Notice(
        file instanceof TFile
          ? `Deleted '${target.name}' and recorded it as ignored.`
          : `Removed '${target.name}' and recorded the already-missing note as ignored.`,
      )
      rerender()
      return
    }

    const next = removeEntry(fresh, target.name)
    this.plugin.settings.exerciseRegistry = next.entries
    await this.plugin.saveSettings()
    new Notice(`Removed registry overlay for '${target.name}'.`)
    rerender()
  }
}
