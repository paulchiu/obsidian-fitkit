import { Modal, Notice } from 'obsidian'

import type {
  ExerciseKind,
  ExerciseRegistryEntry,
  RegistryEntryDraft,
  ValidationError,
} from '../domain/exercise-registry'
import {
  createRegistry,
  normalize,
  renameEntry,
  sanitizeEntryDraft,
  upsertEntry,
  validateEntryDraft,
} from '../domain/exercise-registry'
import { DEFAULT_WEIGHT_UNIT, type WeightUnit } from '../domain/weight-unit'
import type FitKitPlugin from '../main'

export type RegistryEntryModalMode =
  | { kind: 'create'; initial?: { name: string; kind: ExerciseKind } }
  | { kind: 'edit'; original: ExerciseRegistryEntry }

export class ExerciseRegistryEntryModal extends Modal {
  private name: string
  private exerciseKind: ExerciseKind
  private weightUnit: WeightUnit
  /** True once the user interacts with the unit dropdown; gates whether buildDraft() may record a unit at all. */
  private unitTouched: boolean
  private aliasesText: string
  private nameInput!: HTMLInputElement
  private kindSelect!: HTMLSelectElement
  private unitField!: HTMLDivElement
  private unitSelect!: HTMLSelectElement
  private unitWarning!: HTMLDivElement
  private aliasesTextarea!: HTMLTextAreaElement
  private saveButton!: HTMLButtonElement
  private nameError!: HTMLDivElement
  private aliasError!: HTMLDivElement

  constructor(
    private plugin: FitKitPlugin,
    private mode: RegistryEntryModalMode,
    private onSaved: () => void,
  ) {
    super(plugin.app)
    if (mode.kind === 'edit') {
      this.name = mode.original.name
      this.exerciseKind = mode.original.kind
      this.weightUnit = mode.original.unit ?? DEFAULT_WEIGHT_UNIT
      this.aliasesText = mode.original.aliases.join('\n')
    } else {
      this.name = mode.initial?.name ?? ''
      this.exerciseKind = mode.initial?.kind ?? 'strength'
      this.weightUnit = DEFAULT_WEIGHT_UNIT
      this.aliasesText = ''
    }
    this.unitTouched = false
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('fitkit-registry-entry-modal')
    this.setTitle(this.mode.kind === 'edit' ? 'Edit registry entry' : 'Add registry entry')

    const nameField = contentEl.createDiv({ cls: 'fitkit-registry-field' })
    nameField.createEl('label', { text: 'Name', cls: 'fitkit-registry-field-label' })
    this.nameInput = nameField.createEl('input', {
      type: 'text',
      cls: 'fitkit-registry-input',
    })
    this.nameInput.value = this.name
    this.nameInput.addEventListener('input', () => {
      this.name = this.nameInput.value
      this.refreshValidation()
    })
    this.nameError = nameField.createDiv({ cls: 'fitkit-registry-field-error' })

    const kindField = contentEl.createDiv({ cls: 'fitkit-registry-field' })
    kindField.createEl('label', { text: 'Kind', cls: 'fitkit-registry-field-label' })
    this.kindSelect = kindField.createEl('select', { cls: 'fitkit-registry-select' })
    this.kindSelect.createEl('option', { value: 'strength', text: 'Strength' })
    this.kindSelect.createEl('option', { value: 'duration', text: 'Duration' })
    this.kindSelect.value = this.exerciseKind
    this.kindSelect.addEventListener('change', () => {
      this.exerciseKind = this.kindSelect.value === 'duration' ? 'duration' : 'strength'
      this.refreshUnitVisibility()
    })

    this.unitField = contentEl.createDiv({ cls: 'fitkit-registry-field' })
    this.unitField.createEl('label', { text: 'Unit', cls: 'fitkit-registry-field-label' })
    this.unitSelect = this.unitField.createEl('select', { cls: 'fitkit-registry-select' })
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Unit symbols use lowercase labels.
    this.unitSelect.createEl('option', { value: 'kg', text: 'kg' })
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Unit symbols use lowercase labels.
    this.unitSelect.createEl('option', { value: 'lbs', text: 'lbs' })
    this.unitSelect.value = this.weightUnit
    this.unitWarning = this.unitField.createDiv({ cls: 'fitkit-registry-field-warning' })
    this.unitSelect.addEventListener('change', () => {
      this.weightUnit = this.unitSelect.value === 'lbs' ? 'lbs' : 'kg'
      this.unitTouched = true
      this.refreshUnitWarning()
    })
    this.refreshUnitVisibility()
    this.refreshUnitWarning()

    const aliasField = contentEl.createDiv({ cls: 'fitkit-registry-field' })
    aliasField.createEl('label', {
      text: 'Aliases (one per line)',
      cls: 'fitkit-registry-field-label',
    })
    this.aliasesTextarea = aliasField.createEl('textarea', { cls: 'fitkit-registry-textarea' })
    this.aliasesTextarea.value = this.aliasesText
    this.aliasesTextarea.rows = 5
    this.aliasesTextarea.addEventListener('input', () => {
      this.aliasesText = this.aliasesTextarea.value
      this.refreshValidation()
    })
    this.aliasError = aliasField.createDiv({ cls: 'fitkit-registry-field-error' })

    const actions = contentEl.createDiv({ cls: 'fitkit-import-actions' })
    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Cancel' })
    cancel.addEventListener('click', () => this.close())
    this.saveButton = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-primary',
      text: 'Save',
    })
    this.saveButton.addEventListener('click', () => void this.handleSave())

    this.nameInput.focus()
    this.refreshValidation()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private buildDraft(): RegistryEntryDraft {
    return sanitizeEntryDraft({
      name: this.name,
      kind: this.exerciseKind,
      unit: this.resolveDraftUnit(),
      aliases: this.aliasesText.split('\n'),
    })
  }

  /**
   * Only record a unit when the user actually specified one: creating a new
   * entry, editing one that already had an explicit unit, or having touched
   * the unit dropdown this session. Otherwise stay unrecorded rather than
   * synthesizing DEFAULT_WEIGHT_UNIT as if it were a deliberate choice.
   */
  private resolveDraftUnit(): WeightUnit | undefined {
    if (this.mode.kind === 'create') {
      return this.weightUnit
    }
    if (this.mode.original.unit !== undefined || this.unitTouched) {
      return this.weightUnit
    }
    return undefined
  }

  private currentRegistry(): ReturnType<typeof createRegistry> {
    return createRegistry(this.plugin.settings.exerciseRegistry)
  }

  private excludeOriginalName(): string | undefined {
    return this.mode.kind === 'edit' ? this.mode.original.name : undefined
  }

  private refreshUnitVisibility(): void {
    this.unitField.hidden = this.exerciseKind === 'duration'
  }

  /**
   * Weights and next-time steps are already written into workout notes as bare
   * numbers, so switching unit reinterprets rather than converts them.
   */
  private refreshUnitWarning(): void {
    const changed =
      this.mode.kind === 'edit' &&
      this.weightUnit !== (this.mode.original.unit ?? DEFAULT_WEIGHT_UNIT)
    this.unitWarning.setText(
      changed
        ? 'Weights and next-time steps already recorded stay as written. Update them yourself if they need converting.'
        : '',
    )
  }

  private refreshValidation(): void {
    const draft = this.buildDraft()
    const errors = validateEntryDraft(this.currentRegistry(), draft, {
      excludeOriginalName: this.excludeOriginalName(),
    })
    this.renderErrors(errors)
    this.saveButton.disabled = errors.length > 0
  }

  private renderErrors(errors: ValidationError[]): void {
    const nameMessages = errors
      .filter((error) => error.field === 'name')
      .map((error) => error.message)
    const aliasMessages = errors
      .filter((error) => error.field === 'alias')
      .map((error) => error.message)
    this.nameError.setText(nameMessages.join(' '))
    this.aliasError.setText(aliasMessages.join(' '))
  }

  private async handleSave(): Promise<void> {
    const draft = this.buildDraft()
    const fresh = this.currentRegistry()

    let freshOriginal: ExerciseRegistryEntry | undefined
    if (this.mode.kind === 'edit') {
      const originalKey = normalize(this.mode.original.name)
      freshOriginal = fresh.entries.find((entry) => normalize(entry.name) === originalKey)
      if (!freshOriginal) {
        new Notice(
          'That entry was removed elsewhere; close and reopen the registry editor to see the latest state.',
        )
        this.close()
        return
      }
    }

    const errors = validateEntryDraft(fresh, draft, {
      excludeOriginalName: freshOriginal?.name ?? this.excludeOriginalName(),
    })
    if (errors.length > 0) {
      this.renderErrors(errors)
      this.saveButton.disabled = true
      return
    }

    const next =
      this.mode.kind === 'edit' && freshOriginal
        ? renameEntry(fresh, freshOriginal.name, draft)
        : upsertEntry(fresh, draft)

    this.plugin.settings.exerciseRegistry = next.entries
    await this.plugin.saveSettings()

    if (this.mode.kind === 'edit') {
      const renamed = normalize(this.mode.original.name) !== normalize(draft.name)
      const kindChanged = this.mode.original.kind !== draft.kind
      if (renamed) {
        new Notice(
          `Renamed '${this.mode.original.name}' → '${draft.name}'. '${this.mode.original.name}' was kept as an alias so existing workout references still resolve.`,
        )
      }
      if (kindChanged) {
        new Notice(
          `Kind changed to ${draft.kind}. Recent-sessions queries on existing workouts may stop returning rows until they're re-recorded under the new kind.`,
        )
      }
    }

    this.onSaved()
    this.close()
  }
}
