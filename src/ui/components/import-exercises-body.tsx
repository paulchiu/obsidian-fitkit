import type { ComponentChildren, JSX } from 'preact'

import { EXERCISE_TYPES, EXERCISE_TYPE_LABELS, parseExerciseType } from '../../domain/exercise-type'
import {
  rowChoices,
  withCreateNote,
  withNoNoteEntry,
  withRestore,
  type ImportRow,
  type RowChoice,
} from '../model/import-rows'
import { ImportActions } from './action-bar'
import { Choice, SelectField } from './fields'

export type ImportPhase = 'loading' | 'ready' | 'error'

export interface ImportExercisesBodyProps {
  phase: ImportPhase
  description: string
  errorMessage: string
  warning: string | null
  rows: readonly ImportRow[]
  /** Reports the row at `index` replaced by `next`. */
  onRowChange: (index: number, next: ImportRow) => void
  onApply: () => void
  onCancel: () => void
}

/** The import modal's body: the exercises found, each with what to create, or why there are none. */
export function ImportExercisesBody(props: ImportExercisesBodyProps): JSX.Element {
  const { phase, description, errorMessage, warning, rows, onApply, onCancel } = props
  if (phase === 'error') {
    return (
      <>
        <div class="fitkit-warn">{errorMessage}</div>
        <ImportActions>
          <button class="fitkit-btn" onClick={onCancel}>
            Close
          </button>
        </ImportActions>
      </>
    )
  }
  return (
    <>
      <p class="fitkit-import-muted">{description}</p>
      {phase === 'loading' ? <div class="fitkit-import-muted">Loading exercises...</div> : null}
      {phase === 'ready' && warning ? <div class="fitkit-warn">{warning}</div> : null}
      {phase === 'ready' ? (
        rows.length === 0 ? (
          <div class="fitkit-import-muted">No exercises found.</div>
        ) : (
          <table class="fitkit-import-table">
            <thead>
              <tr>
                <th>Exercise</th>
                <th>Kind</th>
                <th>Registry</th>
                <th>Note file</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <ImportRowView
                  key={row.name}
                  row={row}
                  onChange={(next) => props.onRowChange(index, next)}
                />
              ))}
            </tbody>
          </table>
        )
      ) : null}
      {phase === 'ready' ? (
        <ImportActions>
          <button class="fitkit-btn" onClick={onCancel}>
            Cancel
          </button>
          <button class="fitkit-btn fitkit-btn-primary" onClick={onApply}>
            Apply
          </button>
        </ImportActions>
      ) : null}
    </>
  )
}

function Cell({
  label,
  cls,
  children,
}: {
  label: string
  cls?: string
  children: ComponentChildren
}): JSX.Element {
  return (
    <td class={cls} data-label={label}>
      <span class="fitkit-import-cell-label">{label}</span>
      {children}
    </td>
  )
}

function ImportRowView({
  row,
  onChange,
}: {
  row: ImportRow
  onChange: (next: ImportRow) => void
}): JSX.Element {
  const registry =
    row.status === 'ignored'
      ? { text: 'Ignored', cls: 'fitkit-import-status-unknown' }
      : row.registryName
        ? {
            text: row.registryName === row.name ? 'Matched' : `Matched ${row.registryName}`,
            cls: 'fitkit-import-status-match',
          }
        : { text: 'Missing', cls: 'fitkit-import-status-unknown' }
  const note = row.noteExists
    ? { text: 'Exists', cls: 'fitkit-import-status-match' }
    : { text: 'Missing', cls: 'fitkit-import-status-unknown' }
  return (
    <tr>
      <Cell label="Exercise">
        <span>{row.name}</span>
      </Cell>
      <Cell label="Kind">
        {row.status === 'known' && !row.createNoNoteEntry ? (
          <span>{row.type}</span>
        ) : (
          <SelectField
            class="fitkit-import-select"
            aria-label={`Kind for ${row.name}`}
            value={row.type}
            onValueChange={(value) =>
              onChange({ ...row, type: parseExerciseType(value) ?? row.type })
            }
          >
            {EXERCISE_TYPES.map((type) => (
              <Choice key={type} value={type} label={EXERCISE_TYPE_LABELS[type]} />
            ))}
          </SelectField>
        )}
      </Cell>
      <Cell label="Registry" cls={registry.cls}>
        <span>{registry.text}</span>
      </Cell>
      <Cell label="Note file" cls={note.cls}>
        <span>{note.text}</span>
      </Cell>
      <Cell label="Actions">
        <RowActions row={row} onChange={onChange} />
      </Cell>
    </tr>
  )
}

const CHOICE_LABELS: Record<RowChoice, string> = {
  restore: 'Restore',
  'create-note': 'Create note',
  'no-note-entry': 'No-note entry',
}

function RowActions({
  row,
  onChange,
}: {
  row: ImportRow
  onChange: (next: ImportRow) => void
}): JSX.Element {
  const choices = rowChoices(row)
  if (!choices) {
    return <span>No action</span>
  }
  const checked: Record<RowChoice, boolean> = {
    restore: row.restoreIgnored,
    'create-note': row.createNote,
    'no-note-entry': row.createNoNoteEntry,
  }
  const apply: Record<RowChoice, (value: boolean) => ImportRow> = {
    restore: (value) => withRestore(row, value),
    'create-note': (value) => withCreateNote(row, value),
    'no-note-entry': (value) => withNoNoteEntry(row, value),
  }
  return (
    <>
      {choices.map((choice) => (
        <label key={choice} class="fitkit-import-checkbox-row">
          <input
            type="checkbox"
            checked={checked[choice]}
            onChange={(event) => onChange(apply[choice](event.currentTarget.checked))}
          />
          <span>{CHOICE_LABELS[choice]}</span>
        </label>
      ))}
    </>
  )
}
