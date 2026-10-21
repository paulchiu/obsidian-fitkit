import { App, Notice, PluginSettingTab, Setting, TFile, normalizePath } from 'obsidian'
import type {
  SettingControl,
  SettingDefinition,
  SettingDefinitionGroup,
  SettingDefinitionItem,
} from 'obsidian'

import { formatErrorMessage } from './domain/error'
import type { ExerciseRegistryEntry } from './domain/exercise-registry'
import {
  createRegistry,
  intervalMarker,
  normalize,
  removeEntry,
  uniqueNormalizedKeys,
} from './domain/exercise-registry'
import { parseExerciseKind } from './domain/exercise-kind'
import { exerciseTypeOf } from './domain/exercise-type'
import {
  DEFAULT_INTERVAL_PRESETS,
  parseIntervalPresets,
  upgradeIntervalPresets,
} from './domain/interval-presets'
import { parseWeightUnit } from './domain/weight-unit'
import type FitKitPlugin from './main'
import { DeleteRegistryEntryModal } from './ui/obsidian/delete-registry-entry-modal'
import { ExerciseRegistryEntryModal } from './ui/obsidian/exercise-registry-entry-modal'
import { ExerciseRenameModal } from './ui/obsidian/exercise-rename-modal'
import { ImportExercisesModal } from './ui/obsidian/import-exercises-modal'
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
  intervalBeepsEnabled: boolean
  /** The plan form's presets, one `Label: plan` per line. */
  intervalPresets: string
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
  intervalBeepsEnabled: true,
  intervalPresets: DEFAULT_INTERVAL_PRESETS,
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
  return uniqueNormalizedKeys(deletedExercises)
}

export function addDeletedExerciseTombstone(
  deletedExercises: readonly string[] | undefined,
  name: string,
): string[] {
  return normalizeDeletedExerciseTombstones([...(deletedExercises ?? []), name])
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
    intervalBeepsEnabled: stored.intervalBeepsEnabled ?? DEFAULT_SETTINGS.intervalBeepsEnabled,
    intervalPresets: upgradeIntervalPresets(
      stored.intervalPresets ?? DEFAULT_SETTINGS.intervalPresets,
    ),
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
  return entries.map((entry) => {
    const kind = parseExerciseKind(entry.kind) ?? 'strength'
    return {
      name: entry.name,
      kind,
      unit: parseWeightUnit(entry.unit) ?? undefined,
      levels: normalizeStoredLevels(entry.levels),
      ...intervalMarker({ kind, interval: entry.interval }),
      aliases: [...entry.aliases],
    }
  })
}

/**
 * Stored ladders arrive as unknown JSON, so only a usable string list
 * survives the load; anything else reads as no ladder rather than throwing.
 */
function normalizeStoredLevels(levels: unknown): string[] | undefined {
  if (!Array.isArray(levels)) {
    return undefined
  }
  const rungs = levels.filter((rung): rung is string => typeof rung === 'string')
  return rungs.length > 0 ? rungs : undefined
}

const AUTOSAVE_DEBOUNCE_MIN = 0
const CHART_WINDOW_MIN = 5
const CHART_WINDOW_MAX = 365

/**
 * Bounds are enforced here rather than as `min`/`max` on the control, because
 * those become HTML constraints that reject the change before `validate` runs,
 * leaving a browser tooltip where the setting's own message should be.
 */
function validateNumber(value: number, min: number, max?: number): string | void {
  if (!Number.isFinite(value)) {
    return 'Enter a number.'
  }
  if (max === undefined) {
    return value < min ? `Enter ${min} or more.` : undefined
  }
  return value < min || value > max ? `Enter a number between ${min} and ${max}.` : undefined
}

/** Settings the tab exposes as controls, and so as `setControlValue` keys. */
type FitKitSettingKey =
  | 'fitnessRoot'
  | 'autoOpenWorkoutEditor'
  | 'strengthRestTimerEnabled'
  | 'intervalBeepsEnabled'
  | 'intervalPresets'
  | 'autosaveDebounceMs'
  | 'chartSessionsWindow'

type FitKitSettingControl = SettingControl<FitKitSettingKey>

interface SettingSection {
  heading: string
  rows: SettingRow[]
}

/**
 * A row in renderer-agnostic form. `control` rows persist through
 * `setControlValue`; `action` rows are a button; `block` rows own their markup
 * and are given a bare element to fill.
 */
type SettingRow =
  | {
      kind: 'control'
      name: string
      desc: string
      control: FitKitSettingControl
      /**
       * Input constraints for the display() fallback only, which clamps on
       * change rather than validating. See {@link validateNumber} for why the
       * declarative control cannot carry them.
       */
      fallbackBounds?: { min: number; max?: number }
    }
  | { kind: 'action'; name: string; desc: string; buttonText: string; onClick: () => void }
  | { kind: 'block'; name: string; render: (containerEl: HTMLElement) => void }

function validateIntervalPresets(value: string): string | undefined {
  const { invalid } = parseIntervalPresets(value)
  return invalid.length === 0 ? undefined : `Cannot read: ${invalid.join('; ')}`
}

export function coerceAutosaveDebounceMs(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.trunc(parsed)
    : DEFAULT_SETTINGS.autosaveDebounceMs
}

export function coerceChartSessionsWindow(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.trunc(parsed), CHART_WINDOW_MIN), CHART_WINDOW_MAX)
    : DEFAULT_SETTINGS.chartSessionsWindow
}

function toSettingDefinition(row: SettingRow): SettingDefinition<FitKitSettingKey> {
  switch (row.kind) {
    case 'control':
      return { name: row.name, desc: row.desc, control: row.control }
    case 'action':
      return {
        name: row.name,
        desc: row.desc,
        render: (setting) => {
          setting.addButton((button) => button.setButtonText(row.buttonText).onClick(row.onClick))
        },
      }
    case 'block':
      return {
        name: row.name,
        searchable: false,
        render: (setting) => {
          setting.settingEl.empty()
          setting.settingEl.addClass('fitkit-setting-block')
          row.render(setting.settingEl)
        },
      }
  }
}

export class FitKitSettingTab extends PluginSettingTab {
  plugin: FitKitPlugin

  private derivedPathValues: {
    workouts: HTMLElement
    exercises: HTMLElement
    dashboard: HTMLElement
  } | null = null

  constructor(app: App, plugin: FitKitPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    for (const section of this.sections()) {
      new Setting(containerEl).setName(section.heading).setHeading()
      for (const row of section.rows) {
        this.renderRowImperatively(containerEl, row)
      }
    }
  }

  /**
   * Obsidian 1.13+ renders the tab from these definitions and skips `display()`,
   * so a row is only searchable once its name and description live here.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.sections().map((section): SettingDefinitionGroup<FitKitSettingKey> => ({
      type: 'group',
      heading: section.heading,
      items: section.rows.map(toSettingDefinition),
    }))
  }

  /**
   * The single description of the tab. display() walks it for Obsidian below
   * 1.13 and getSettingDefinitions() maps it for 1.13 and later, so the two
   * renderings cannot drift.
   */
  private sections(): SettingSection[] {
    return [
      {
        heading: 'Paths',
        rows: [
          {
            kind: 'control',
            name: 'Fitness root',
            desc: 'Folder under the vault root where workouts, exercises, and the dashboard live.',
            control: { type: 'folder', key: 'fitnessRoot', includeRoot: true },
          },
          {
            kind: 'block',
            name: 'Derived paths',
            render: (el) => this.renderDerivedPaths(el),
          },
        ],
      },
      {
        heading: 'Behavior',
        rows: [
          {
            kind: 'control',
            name: 'Auto-open workout editor',
            desc: 'When opening a workout note, switch it into the editor automatically; turn this off to use normal Markdown reading mode by default.',
            control: { type: 'toggle', key: 'autoOpenWorkoutEditor' },
          },
          {
            kind: 'control',
            name: 'Rest timer',
            desc: 'Show a rest timer in the workout editor footer that remembers your last rest after stopping.',
            control: { type: 'toggle', key: 'strengthRestTimerEnabled' },
          },
          {
            kind: 'control',
            name: 'Interval beeps',
            desc: 'Beep through the last three seconds of each interval and when it changes, and vibrate where the device can.',
            control: { type: 'toggle', key: 'intervalBeepsEnabled' },
          },
          {
            kind: 'control',
            name: 'Interval presets',
            desc: 'The plans the interval plan form offers to start from, one per line as "Label: plan", for example "Tabata: 8 x 20s @ 400W, 10s rest".',
            control: {
              type: 'textarea',
              key: 'intervalPresets',
              rows: 4,
              validate: validateIntervalPresets,
            },
          },
          {
            kind: 'control',
            name: 'Autosave debounce (ms)',
            desc: 'How long to wait after the last edit before persisting changes in the workout editor view.',
            control: {
              type: 'number',
              key: 'autosaveDebounceMs',
              /** A number input reports an unparseable entry as empty, and Obsidian stores this in its place. */
              defaultValue: DEFAULT_SETTINGS.autosaveDebounceMs,
              validate: (value) => validateNumber(value, AUTOSAVE_DEBOUNCE_MIN),
            },
            fallbackBounds: { min: AUTOSAVE_DEBOUNCE_MIN },
          },
        ],
      },
      {
        heading: 'Charts',
        rows: [
          {
            kind: 'control',
            name: 'Chart sessions',
            desc: "How many recent workout dates to plot on the exercise progression chart. Each chart block can override this with 'window: <N>'.",
            control: {
              type: 'number',
              key: 'chartSessionsWindow',
              defaultValue: DEFAULT_SETTINGS.chartSessionsWindow,
              validate: (value) => validateNumber(value, CHART_WINDOW_MIN, CHART_WINDOW_MAX),
            },
            fallbackBounds: { min: CHART_WINDOW_MIN, max: CHART_WINDOW_MAX },
          },
        ],
      },
      {
        heading: 'Setup and maintenance',
        rows: [
          {
            kind: 'block',
            name: 'About sync and repair',
            render: (el) => {
              el.createDiv({
                text: 'Run this after setting up the plugin, importing workouts, or editing notes outside FitKit. It brings the registry, exercise notes and dashboard up to date, and shows any notes FitKit could not read.',
                cls: 'setting-item-description',
              })
            },
          },
          {
            kind: 'action',
            name: 'Sync and repair everything',
            desc: 'Scan the registry, exercise notes and dashboard, see what each step would change, then apply the ones you tick.',
            buttonText: 'Check',
            onClick: () => {
              this.plugin.openSyncRepair()
            },
          },
        ],
      },
      {
        heading: 'Registry',
        rows: [
          {
            kind: 'block',
            name: 'About the registry',
            render: (el) => {
              el.createDiv({
                text: 'Every exercise the plugin knows about: notes in your exercises folder, no-note registry entries, and names logged only in workout history. This is the central place to fix wording, casing, or splitting; use Sync and repair everything above to pull in anything missing.',
                cls: 'setting-item-description',
              })
            },
          },
          {
            kind: 'block',
            name: 'Exercises',
            render: (el) => this.renderRegistry(el),
          },
        ],
      },
    ]
  }

  /**
   * Coerces and persists a control value, then runs the side effects the
   * fields used to run inline. Both rendering paths write through here, so a
   * value cannot be validated one way on 1.13 and another way below it.
   */
  override async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings
    switch (key) {
      case 'fitnessRoot':
        settings.fitnessRoot = normalizePath(String(value))
        break
      case 'autoOpenWorkoutEditor':
        settings.autoOpenWorkoutEditor = Boolean(value)
        break
      case 'strengthRestTimerEnabled':
        settings.strengthRestTimerEnabled = Boolean(value)
        break
      case 'intervalBeepsEnabled':
        settings.intervalBeepsEnabled = Boolean(value)
        break
      case 'intervalPresets':
        settings.intervalPresets = String(value)
        break
      case 'autosaveDebounceMs':
        settings.autosaveDebounceMs = coerceAutosaveDebounceMs(value)
        break
      case 'chartSessionsWindow':
        settings.chartSessionsWindow = coerceChartSessionsWindow(value)
        break
      default:
        return
    }
    await this.plugin.saveSettings()
    if (key === 'fitnessRoot') {
      this.refreshDerivedPaths()
    }
    if (key === 'strengthRestTimerEnabled') {
      this.plugin.refreshWorkoutEditorViews()
    }
  }

  private renderRowImperatively(containerEl: HTMLElement, row: SettingRow): void {
    if (row.kind === 'block') {
      row.render(containerEl)
      return
    }
    const setting = new Setting(containerEl).setName(row.name).setDesc(row.desc)
    if (row.kind === 'action') {
      setting.addButton((button) => button.setButtonText(row.buttonText).onClick(row.onClick))
      return
    }
    this.addControlComponent(setting, row.control, row.fallbackBounds)
  }

  private addControlComponent(
    setting: Setting,
    control: FitKitSettingControl,
    bounds?: { min: number; max?: number },
  ): void {
    const key = control.key
    const current = this.plugin.settings[key]

    if (control.type === 'toggle') {
      setting.addToggle((toggle) =>
        toggle.setValue(Boolean(current)).onChange((value) => {
          void this.setControlValue(key, value)
        }),
      )
      return
    }

    if (control.type === 'number') {
      setting.addText((text) => {
        text.inputEl.type = 'number'
        text.inputEl.min = String(bounds?.min ?? 0)
        if (bounds?.max !== undefined) {
          text.inputEl.max = String(bounds.max)
        }
        text.setValue(String(current)).onChange(async (value) => {
          await this.setControlValue(key, value)
          text.setValue(String(this.plugin.settings[key]))
        })
      })
      return
    }

    if (control.type === 'textarea') {
      setting.addTextArea((area) => {
        area.inputEl.rows = control.rows ?? 4
        area.setValue(String(current)).onChange((value) => {
          void this.setControlValue(key, value)
        })
      })
      return
    }

    setting.addText((text) =>
      text.setValue(String(current)).onChange((value) => {
        void this.setControlValue(key, value)
      }),
    )
  }

  private renderDerivedPaths(containerEl: HTMLElement): void {
    containerEl.createDiv({ text: 'Derived paths:', cls: 'setting-item-name' })
    const workoutsLine = containerEl.createDiv({ cls: 'setting-item-description' })
    workoutsLine.createSpan({ text: 'Workouts folder: ' })
    const workouts = workoutsLine.createSpan()
    const exercisesLine = containerEl.createDiv({ cls: 'setting-item-description' })
    exercisesLine.createSpan({ text: 'Exercises folder: ' })
    const exercises = exercisesLine.createSpan()
    const dashboardLine = containerEl.createDiv({ cls: 'setting-item-description' })
    dashboardLine.createSpan({ text: 'Dashboard: ' })
    const dashboard = dashboardLine.createSpan()
    this.derivedPathValues = { workouts, exercises, dashboard }
    this.refreshDerivedPaths()
  }

  private refreshDerivedPaths(): void {
    const values = this.derivedPathValues
    if (!values) {
      return
    }
    const settings = this.plugin.settings
    values.workouts.setText(workoutsFolder(settings))
    values.exercises.setText(exercisesFolder(settings))
    values.dashboard.setText(dashboardPath(settings))
  }

  private renderRegistry(containerEl: HTMLElement): void {
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

    tr.createEl('td', { text: exerciseTypeOf(row) })
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
            original: {
              name: row.name,
              kind: row.kind,
              unit: row.unit,
              levels: row.levels ? [...row.levels] : undefined,
              ...intervalMarker(row),
              aliases: row.aliases,
            },
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
   * Removes the overlay row if present; `alsoDeleteFile` also trashes the note and tombstones the name.
   * Otherwise a note-backed row is left alone and a history-only row is tombstoned.
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
