import { App, Notice, PluginSettingTab, Setting, TFile, normalizePath } from 'obsidian'

import type { ExerciseRegistryEntry } from './domain/exercise-registry'
import { createRegistry, normalize, removeEntry } from './domain/exercise-registry'
import type FitKitPlugin from './main'
import { DeleteRegistryEntryModal } from './ui/delete-registry-entry-modal'
import { ExerciseRegistryEntryModal } from './ui/exercise-registry-entry-modal'
import { dashboardPath, exercisesFolder, workoutsFolder } from './settings-paths'
import { exerciseRegistryWithVaultNotes } from './vault/exercise-registry-vault'

export { dashboardPath, exercisesFolder, workoutFilename, workoutsFolder } from './settings-paths'

export interface FitKitSettings {
  fitnessRoot: string
  autoOpenWorkoutEditor: boolean
  strengthRestTimerEnabled: boolean
  autoUpdateDashboard: boolean
  autosaveDebounceMs: number
  chartSessionsWindow: number
  exerciseRegistry: ExerciseRegistryEntry[]
  hiddenDashboardSectionsByPath: Record<string, string[]>
  schemaVersion: 1
}

export const DEFAULT_SETTINGS: FitKitSettings = {
  fitnessRoot: 'Fitness',
  autoOpenWorkoutEditor: true,
  strengthRestTimerEnabled: true,
  autoUpdateDashboard: true,
  autosaveDebounceMs: 600,
  chartSessionsWindow: 30,
  exerciseRegistry: [],
  hiddenDashboardSectionsByPath: {},
  schemaVersion: 1,
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
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Rest" means workout recovery here, not the REST API acronym.
      .setName('Rest timer')
      .setDesc(
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- "rest" means workout recovery here, not the REST API acronym.
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
      .setName('Auto-update dashboard on save')
      .setDesc(
        'When a workout note is saved, refresh the index entry and regenerate the dashboard.',
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.autoUpdateDashboard).onChange(async (value) => {
          settings.autoUpdateDashboard = value
          await this.plugin.saveSettings()
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

    new Setting(containerEl).setName('Registry').setHeading()

    containerEl.createEl('div', {
      text: 'Curate canonical exercise names, kinds, and aliases. The registry is consulted whenever you add or rename an exercise. Filenames in your exercises folder also count at runtime, even if they are not listed here; use the bootstrap action below to materialise them.',
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
      const bootstrapBtn = actions.createEl('button', {
        cls: 'fitkit-btn',
        text: 'Bootstrap from vault',
      })
      bootstrapBtn.addEventListener('click', () => {
        void (async () => {
          const merged = exerciseRegistryWithVaultNotes(this.plugin.app, settings)
          settings.exerciseRegistry = merged
          await this.plugin.saveSettings()
          new Notice(`Registry now has ${merged.length} entries.`)
          renderRegistrySection()
        })()
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
          empty.setText('No entries yet. Add one or bootstrap from your exercises folder.')
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
    const next = removeEntry(fresh, target.name)
    this.plugin.settings.exerciseRegistry = next.entries
    await this.plugin.saveSettings()

    if (alsoDeleteFile) {
      const notePath = normalizePath(`${exercisesFolder(this.plugin.settings)}/${target.name}.md`)
      const file = this.plugin.app.vault.getAbstractFileByPath(notePath)
      if (file instanceof TFile) {
        try {
          await this.plugin.app.fileManager.trashFile(file)
          new Notice(`Removed entry '${target.name}' and trashed note file.`)
        } catch (error) {
          console.error('FitKit: failed to trash exercise note file', error)
          new Notice(
            `Removed entry '${target.name}', but failed to trash the note file. See console for details.`,
          )
        }
      } else {
        new Notice(`Removed entry '${target.name}'. Note file was already missing.`)
      }
    }

    rerender()
  }
}
