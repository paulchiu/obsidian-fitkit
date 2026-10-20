import type { JSX } from 'preact'

import { EXERCISE_TYPES, EXERCISE_TYPE_LABELS, type ExerciseType } from '../../domain/exercise-type'
import { WEIGHT_UNITS } from '../../domain/weight-unit'
import { ImportActions } from './action-bar'
import { Choice, SelectField, TextAreaField, TextField } from './fields'

export interface RegistryEntryFormProps {
  name: string
  exerciseType: ExerciseType
  weightUnit: string
  aliasesText: string
  nameError: string
  aliasError: string
  unitHidden: boolean
  unitWarning: string
  saveDisabled: boolean
  onName: (value: string) => void
  onKind: (value: string) => void
  onUnit: (value: string) => void
  onAliases: (value: string) => void
  onCancel: () => void
  onSave: () => void
}

/** The registry entry form: name, kind, unit and aliases over Cancel and Save. */
export function RegistryEntryForm(props: RegistryEntryFormProps): JSX.Element {
  return (
    <>
      <div class="fitkit-registry-field">
        <label class="fitkit-registry-field-label">Name</label>
        <TextField
          class="fitkit-registry-input"
          value={props.name}
          onValueInput={props.onName}
          focusOnMount
        />
        <div class="fitkit-registry-field-error">{props.nameError}</div>
      </div>
      <div class="fitkit-registry-field">
        <label class="fitkit-registry-field-label">Kind</label>
        <SelectField
          class="fitkit-registry-select"
          value={props.exerciseType}
          onValueChange={props.onKind}
        >
          {EXERCISE_TYPES.map((type) => (
            <Choice key={type} value={type} label={EXERCISE_TYPE_LABELS[type]} />
          ))}
        </SelectField>
      </div>
      <div class="fitkit-registry-field" hidden={props.unitHidden}>
        <label class="fitkit-registry-field-label">Unit</label>
        <SelectField
          class="fitkit-registry-select"
          value={props.weightUnit}
          onValueChange={props.onUnit}
        >
          {WEIGHT_UNITS.map((unit) => (
            <Choice key={unit} value={unit} label={unit} />
          ))}
        </SelectField>
        <div class="fitkit-registry-field-warning">{props.unitWarning}</div>
      </div>
      <div class="fitkit-registry-field">
        <label class="fitkit-registry-field-label">Aliases (one per line)</label>
        <TextAreaField
          class="fitkit-registry-textarea"
          rows={5}
          value={props.aliasesText}
          onValueInput={props.onAliases}
        />
        <div class="fitkit-registry-field-error">{props.aliasError}</div>
      </div>
      <ImportActions>
        <button class="fitkit-btn" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          class="fitkit-btn fitkit-btn-primary"
          disabled={props.saveDisabled}
          onClick={props.onSave}
        >
          Save
        </button>
      </ImportActions>
    </>
  )
}
