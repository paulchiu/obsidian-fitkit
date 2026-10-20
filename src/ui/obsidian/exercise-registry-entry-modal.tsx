import { Modal, Notice } from 'obsidian'
import { render } from 'preact'

import type {
  ExerciseKind,
  ExerciseRegistryEntry,
  RegistryEntryDraft,
  ValidationError,
} from '../../domain/exercise-registry'
import {
  createRegistry,
  intervalMarker,
  normalize,
  renameEntry,
  sanitizeEntryDraft,
  upsertEntry,
  validateEntryDraft,
} from '../../domain/exercise-registry'
import { DEFAULT_WEIGHT_UNIT, type WeightUnit } from '../../domain/weight-unit'
import {
  exerciseTypeOf,
  kindOfType,
  parseExerciseType,
  type ExerciseType,
} from '../../domain/exercise-type'
import type FitKitPlugin from '../../main'
import { RegistryEntryForm } from '../components/registry-entry-form'

export type RegistryEntryModalMode =
  | { kind: 'create'; initial?: { name: string; kind: ExerciseKind } }
  | { kind: 'edit'; original: ExerciseRegistryEntry }

export class ExerciseRegistryEntryModal extends Modal {
  private name: string
  private exerciseType: ExerciseType
  private weightUnit: WeightUnit
  /** True once the user interacts with the unit dropdown; gates whether buildDraft() may record a unit at all. */
  private unitTouched: boolean
  private aliasesText: string
  private levels: string[] | undefined
  /** What the last validation found; only a change or a failed save refreshes it. */
  private errors: ValidationError[] = []

  constructor(
    private plugin: FitKitPlugin,
    private mode: RegistryEntryModalMode,
    private onSaved: () => void,
  ) {
    super(plugin.app)
    if (mode.kind === 'edit') {
      this.name = mode.original.name
      this.exerciseType = exerciseTypeOf(mode.original)
      this.weightUnit = mode.original.unit ?? DEFAULT_WEIGHT_UNIT
      this.aliasesText = mode.original.aliases.join('\n')
      this.levels = mode.original.levels ? [...mode.original.levels] : undefined
    } else {
      this.name = mode.initial?.name ?? ''
      this.exerciseType = mode.initial?.kind ?? 'strength'
      this.weightUnit = DEFAULT_WEIGHT_UNIT
      this.aliasesText = ''
      this.levels = undefined
    }
    this.unitTouched = false
  }

  onOpen(): void {
    this.contentEl.addClass('fitkit-registry-entry-modal')
    this.setTitle(this.mode.kind === 'edit' ? 'Edit registry entry' : 'Add registry entry')
    this.refreshValidation()
  }

  onClose(): void {
    render(null, this.contentEl)
  }

  private draw(): void {
    const messages = (field: ValidationError['field']): string =>
      this.errors
        .filter((error) => error.field === field)
        .map((error) => error.message)
        .join(' ')
    render(
      <RegistryEntryForm
        name={this.name}
        exerciseType={this.exerciseType}
        weightUnit={this.weightUnit}
        aliasesText={this.aliasesText}
        nameError={messages('name')}
        aliasError={messages('alias')}
        unitHidden={kindOfType(this.exerciseType) === 'duration'}
        unitWarning={this.unitWarning()}
        saveDisabled={this.errors.length > 0}
        onName={this.setName}
        onKind={this.setKind}
        onUnit={this.setUnit}
        onAliases={this.setAliases}
        onCancel={this.cancel}
        onSave={this.save}
      />,
      this.contentEl,
    )
  }

  private setName = (value: string): void => {
    this.name = value
    this.refreshValidation()
  }

  private setKind = (value: string): void => {
    this.exerciseType = parseExerciseType(value) ?? this.exerciseType
    this.draw()
  }

  private setUnit = (value: string): void => {
    this.weightUnit = value === 'lbs' ? 'lbs' : 'kg'
    this.unitTouched = true
    this.draw()
  }

  private setAliases = (value: string): void => {
    this.aliasesText = value
    this.refreshValidation()
  }

  private cancel = (): void => this.close()

  private save = (): void => void this.handleSave()

  private buildDraft(): RegistryEntryDraft {
    return sanitizeEntryDraft({
      name: this.name,
      kind: kindOfType(this.exerciseType),
      ...intervalMarker({
        kind: kindOfType(this.exerciseType),
        interval: this.exerciseType === 'interval',
      }),
      unit: this.resolveDraftUnit(),
      levels: this.levels ? [...this.levels] : undefined,
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

  /**
   * Weights and next-time steps are already written into workout notes as bare
   * numbers, so switching unit reinterprets rather than converts them.
   */
  private unitWarning(): string {
    const changed =
      this.mode.kind === 'edit' &&
      this.weightUnit !== (this.mode.original.unit ?? DEFAULT_WEIGHT_UNIT)
    return changed
      ? 'Weights and next-time steps already recorded stay as written. Update them yourself if they need converting.'
      : ''
  }

  private refreshValidation(): void {
    const draft = this.buildDraft()
    this.errors = validateEntryDraft(this.currentRegistry(), draft, {
      excludeOriginalName: this.excludeOriginalName(),
    })
    this.draw()
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
      this.errors = errors
      this.draw()
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
