import type { ComponentChildren, JSX, TargetedEvent } from 'preact'

import {
  formatBodyweightLevelLabel,
  formatBodyweightLevelShort,
  type BodyweightLadder,
} from '../../domain/bodyweight-levels'
import {
  formatDurationInput,
  parseDurationInput,
  ZERO_DURATION_DISPLAY,
} from '../../domain/duration-input'
import { CAUGHT_UP_NOTE, isCaughtUp } from '../../domain/interval-run'
import { shouldShortenLevelLabel } from '../model/level-label-fit'
import {
  INTENSITY_LABELS,
  durationRowClasses,
  parseNumberInput,
  type EditableBodyweightSet,
  type EditableDurationEntry,
  type EditableStrengthSet,
  type IntervalColumns,
} from '../model/set-rows'
import { useDomEffect } from './dom-effect'
import { useIcon } from './host'
import { useResize } from './layout'

/** A row's name for labels, its note, and the dialogs the view opens for it. */
export interface RowControls {
  /** Names the row in labels, such as `set 2`. */
  label: string
  note: string | undefined
  openNote: () => void
  /** Opens the row's options menu under `trigger`. */
  openMenu: (trigger: HTMLElement) => void
}

/** Applies a typed value to a row; the view owns every model write and redraws nothing. */
export type RowEdit<T> = (row: T, patch: Partial<T>) => void

export interface StrengthRowsProps {
  sets: readonly EditableStrengthSet[]
  /** Whether the set's weight came from the plan and has not been typed over. */
  isSeeded: (set: EditableStrengthSet) => boolean
  controls: (set: EditableStrengthSet, index: number) => RowControls
  onEdit: RowEdit<EditableStrengthSet>
}

export interface BodyweightRowsProps {
  sets: readonly EditableBodyweightSet[]
  levels: BodyweightLadder | undefined
  showLoad: boolean
  controls: (set: EditableBodyweightSet, index: number) => RowControls
  onEdit: RowEdit<EditableBodyweightSet>
  setLevel: (set: EditableBodyweightSet, level: number) => void
  /** Opens the set's level menu under `trigger`. */
  openLevelMenu: (set: EditableBodyweightSet, trigger: HTMLElement) => void
}

export interface DurationRowsProps {
  entries: readonly EditableDurationEntry[]
  exerciseIndex: number
  columns: IntervalColumns
  markCaughtUp: boolean
  controls: (entry: EditableDurationEntry, index: number) => RowControls
  onEdit: RowEdit<EditableDurationEntry>
}

export type SetBarEnd =
  | { kind: 'run'; text: string; disabled: boolean; onClick: () => void }
  | { kind: 'timer'; onClick: () => void }

export interface SetBarProps {
  repeatDisabled: boolean
  onAdd: () => void
  onRepeat: () => void
  /** The button after Repeat that starts the card's timer or interval plan. */
  end?: SetBarEnd
}

export function StrengthRows({ sets, isSeeded, controls, onEdit }: StrengthRowsProps): JSX.Element {
  return (
    <>
      {sets.map((set, i) => (
        <StrengthRow
          key={set}
          set={set}
          index={i}
          live={i === sets.length - 1}
          seeded={isSeeded(set)}
          controls={controls(set, i)}
          onEdit={onEdit}
        />
      ))}
    </>
  )
}

function StrengthRow({
  set,
  index,
  live,
  seeded,
  controls,
  onEdit,
}: {
  set: EditableStrengthSet
  index: number
  /** The logging loop only touches the bottom row; the ones above it are session history. */
  live: boolean
  seeded: boolean
  controls: RowControls
  onEdit: RowEdit<EditableStrengthSet>
}): JSX.Element {
  return (
    <Row cls={live ? 'fitkit-row fitkit-row--live' : 'fitkit-row'} controls={controls}>
      <div class="fitkit-set-row">
        <Cell label="Set" cls="fitkit-set-figure">
          {String(set.set ?? index + 1)}
        </Cell>
        <Cell label="Weight">
          <Field
            model={set}
            text={set.weight !== undefined ? String(set.weight) : ''}
            label="Weight"
            cls={seeded ? 'fitkit-input fitkit-input--unconfirmed' : 'fitkit-input'}
            numeric
            step="0.1"
            inputmode="decimal"
            onInput={(input) => onEdit(set, { weight: parseNumberInput(input.value) })}
          />
        </Cell>
        <Cell label="Reps">
          <Field
            model={set}
            text={set.reps !== undefined ? String(set.reps) : ''}
            label="Reps"
            numeric
            inputmode="numeric"
            onInput={(input) => onEdit(set, { reps: parseNumberInput(input.value) })}
          />
        </Cell>
      </div>
    </Row>
  )
}

export function BodyweightRows(props: BodyweightRowsProps): JSX.Element {
  return (
    <>
      {props.sets.map((set, i) => (
        <BodyweightRow
          key={set}
          set={set}
          index={i}
          levels={props.levels}
          showLoad={props.showLoad}
          controls={props.controls(set, i)}
          onEdit={props.onEdit}
          setLevel={(level) => props.setLevel(set, level)}
          openLevelMenu={(trigger) => props.openLevelMenu(set, trigger)}
        />
      ))}
    </>
  )
}

function BodyweightRow({
  set,
  index,
  levels,
  showLoad,
  controls,
  onEdit,
  setLevel,
  openLevelMenu,
}: {
  set: EditableBodyweightSet
  index: number
  levels: BodyweightLadder | undefined
  showLoad: boolean
  controls: RowControls
  onEdit: RowEdit<EditableBodyweightSet>
  setLevel: (level: number) => void
  openLevelMenu: (trigger: HTMLElement) => void
}): JSX.Element {
  return (
    <Row cls="fitkit-row" controls={controls}>
      <div class={showLoad ? 'fitkit-bodyweight-row has-load' : 'fitkit-bodyweight-row'}>
        <Cell label="Set" cls="fitkit-set-figure">
          {String(set.set ?? index + 1)}
        </Cell>
        <Cell label="Level">
          <LevelStepper
            position={index + 1}
            levels={levels}
            level={set.level ?? 1}
            showLoad={showLoad}
            setLevel={setLevel}
            openMenu={openLevelMenu}
          />
        </Cell>
        <Cell label="Reps">
          <Field
            model={set}
            text={set.reps !== undefined ? String(set.reps) : ''}
            label="Reps"
            numeric
            inputmode="numeric"
            onInput={(input) => onEdit(set, { reps: parseNumberInput(input.value) })}
          />
        </Cell>
        {showLoad && (
          <Cell label="Load" cls="fitkit-bodyweight-load">
            {set.load !== undefined && (
              <Field
                model={set}
                text={String(set.load)}
                label="Load"
                numeric
                step="0.1"
                inputmode="decimal"
                onInput={(input) => onEdit(set, { load: parseNumberInput(input.value) })}
              />
            )}
          </Cell>
        )}
      </div>
    </Row>
  )
}

function LevelStepper({
  position,
  levels,
  level,
  showLoad,
  setLevel,
  openMenu,
}: {
  position: number
  levels: BodyweightLadder | undefined
  level: number
  /** Whether the row also draws a load cell, which leaves the level cell less room. */
  showLoad: boolean
  setLevel: (level: number) => void
  openMenu: (trigger: HTMLElement) => void
}): JSX.Element {
  const rungCount = levels?.length ?? 0
  const name = formatBodyweightLevelLabel(levels, level)
  const minus = useIcon<HTMLButtonElement>('minus')
  const plus = useIcon<HTMLButtonElement>('plus')
  const chevron = useIcon<HTMLSpanElement>('chevron-down')
  /**
   * The label's classes are set here, not drawn, so the fit's `is-label-short` survives a render.
   * It refits when the name or the cell's width can change: a load column narrows the cell.
   */
  const label = useDomEffect<HTMLButtonElement>(
    (el) => {
      el.classList.add('fitkit-bodyweight-level-label')
      fitLevelLabel(el)
    },
    [name, showLoad],
  )
  useResize(() => {
    if (label.current) {
      fitLevelLabel(label.current)
    }
  })
  return (
    <div class="fitkit-bodyweight-stepper">
      <button
        ref={minus}
        type="button"
        class="fitkit-btn fitkit-bodyweight-step"
        aria-label={`Lower level for set ${position}`}
        disabled={level <= 1}
        onClick={() => {
          if (level > 1) {
            setLevel(level - 1)
          }
        }}
      />
      <button
        ref={label}
        type="button"
        aria-haspopup="menu"
        aria-label={`Level for set ${position}: ${name}`}
        onClick={(evt) => openMenu(evt.currentTarget)}
      >
        <span class="fitkit-bodyweight-level-full">{name}</span>
        <span class="fitkit-bodyweight-level-short">{formatBodyweightLevelShort(level)}</span>
        <span ref={chevron} class="fitkit-bodyweight-level-chevron" aria-hidden="true" />
      </button>
      <button
        ref={plus}
        type="button"
        class="fitkit-btn fitkit-bodyweight-step"
        aria-label={`Raise level for set ${position}`}
        disabled={rungCount === 0 || level >= rungCount}
        onClick={() => {
          if (rungCount > 0 && level < rungCount) {
            setLevel(level + 1)
          }
        }}
      />
    </div>
  )
}

/**
 * Shortens a rung name that overflows its own text slot. It unshortens first, since a
 * shortened label hides the span it measures, so every refit reads live widths and converges.
 */
function fitLevelLabel(label: HTMLElement): void {
  const full = label.querySelector<HTMLElement>('.fitkit-bodyweight-level-full')
  if (!full) {
    return
  }
  label.classList.remove('is-label-short')
  if (shouldShortenLevelLabel(full.scrollWidth, full.clientWidth)) {
    label.classList.add('is-label-short')
  }
}

export function DurationRows(props: DurationRowsProps): JSX.Element {
  return (
    <>
      {props.entries.map((entry, i) => (
        <DurationRow
          key={entry}
          entry={entry}
          index={i}
          exerciseIndex={props.exerciseIndex}
          columns={props.columns}
          marked={props.markCaughtUp && isCaughtUp(entry)}
          controls={props.controls(entry, i)}
          onEdit={props.onEdit}
        />
      ))}
    </>
  )
}

function DurationRow({
  entry,
  index,
  exerciseIndex,
  columns,
  marked,
  controls,
  onEdit,
}: {
  entry: EditableDurationEntry
  index: number
  exerciseIndex: number
  columns: IntervalColumns
  /** A caught-up rep in a card that explains the asterisk, so its note shows there instead. */
  marked: boolean
  controls: RowControls
  onEdit: RowEdit<EditableDurationEntry>
}): JSX.Element {
  const intensity = columns.intensity
  return (
    <Row
      cls="fitkit-row"
      controls={controls}
      hideNoteLine={marked}
      timerRow={`${exerciseIndex}:${index}`}
    >
      <div class={durationRowClasses(columns, 'fitkit-set-row fitkit-duration-row')}>
        <Cell label="Set" cls="fitkit-set-figure">
          {String(entry.set ?? index + 1)}
          {marked && (
            <span class="fitkit-set-mark" aria-label={CAUGHT_UP_NOTE}>
              *
            </span>
          )}
        </Cell>
        <Cell label="Duration">
          <DurationField
            entry={entry}
            field="durationSeconds"
            label="Duration"
            onEdit={onEdit}
            normalise
          />
        </Cell>
        {intensity && (
          <Cell label={INTENSITY_LABELS[intensity]}>
            <Field
              model={entry}
              text={entry[intensity] === undefined ? '' : String(entry[intensity])}
              label={INTENSITY_LABELS[intensity]}
              numeric
              step="0.1"
              inputmode="decimal"
              onInput={(input) => {
                const patch: EditableDurationEntry = {}
                patch[intensity] = parseNumberInput(input.value)
                onEdit(entry, patch)
              }}
            />
          </Cell>
        )}
        {columns.rest && (
          <Cell label="Rest">
            <DurationField entry={entry} field="restSeconds" label="Rest" onEdit={onEdit} />
          </Cell>
        )}
      </div>
    </Row>
  )
}

/**
 * A duration typed as text. Text that is not a duration is flagged and left unsaved; blur
 * shows the stored value again, in its typed form when `normalise` is set and the text parses.
 */
function DurationField({
  entry,
  field,
  label,
  onEdit,
  normalise = false,
}: {
  entry: EditableDurationEntry
  field: 'durationSeconds' | 'restSeconds'
  label: string
  onEdit: RowEdit<EditableDurationEntry>
  normalise?: boolean
}): JSX.Element {
  return (
    <Field
      model={entry}
      text={formatDurationInput(entry[field])}
      label={label}
      cls="fitkit-input fitkit-duration-input"
      inputmode={normalise ? 'text' : undefined}
      placeholder={ZERO_DURATION_DISPLAY}
      defaultFocus={normalise}
      onInput={(input) => {
        const parsed = parseDurationInput(input.value)
        flagInvalid(input, parsed === null)
        if (parsed !== null) {
          onEdit(entry, { [field]: parsed.seconds })
        }
      }}
      onBlur={(input) => {
        const parsed = normalise ? parseDurationInput(input.value) : null
        flagInvalid(input, false)
        input.value = parsed ? parsed.display : formatDurationInput(entry[field])
      }}
    />
  )
}

export function SetBar({ repeatDisabled, onAdd, onRepeat, end }: SetBarProps): JSX.Element {
  return (
    <>
      <button class="fitkit-btn" onClick={onAdd}>
        Add set
      </button>
      <button class="fitkit-btn" disabled={repeatDisabled} onClick={onRepeat}>
        Repeat
      </button>
      {end?.kind === 'run' && (
        <button
          class="fitkit-btn fitkit-btn-primary fitkit-run-button"
          aria-label="Start interval plan"
          disabled={end.disabled}
          onClick={end.onClick}
        >
          {end.text}
        </button>
      )}
      {end?.kind === 'timer' && <TimerButton onClick={end.onClick} />}
    </>
  )
}

/** Icon only, named by its label; the icon sits in a span of its own since `setIcon` replaces children. */
function TimerButton({ onClick }: { onClick: () => void }): JSX.Element {
  const icon = useIcon<HTMLSpanElement>('play')
  return (
    <button class="fitkit-btn fitkit-timer-button" aria-label="Start timer" onClick={onClick}>
      <span ref={icon} class="fitkit-timer-button-icon" />
    </button>
  )
}

/** A set row: its cells, the options button beside them, and the note line under them. */
function Row({
  cls,
  controls,
  hideNoteLine = false,
  timerRow,
  children,
}: {
  cls: string
  controls: RowControls
  /** The note stays editable from the menu; the row shows it some other way. */
  hideNoteLine?: boolean
  timerRow?: string
  children: ComponentChildren
}): JSX.Element {
  const kebab = useIcon<HTMLButtonElement>('more-vertical')
  const { note, openNote } = controls
  return (
    <div class={cls} data-fitkit-timer-row={timerRow}>
      <div class="fitkit-row-body">
        {children}
        <button
          ref={kebab}
          type="button"
          class="fitkit-btn fitkit-btn-muted fitkit-row-kebab"
          aria-label={`Options for ${controls.label}`}
          onClick={(evt) => {
            evt.stopPropagation()
            controls.openMenu(evt.currentTarget)
          }}
        />
      </div>
      {note && note.length > 0 && !hideNoteLine && (
        <div
          class="fitkit-note-line"
          role="button"
          tabindex={0}
          onClick={openNote}
          onKeyDown={(evt) => {
            if (evt.key === 'Enter' || evt.key === ' ') {
              evt.preventDefault()
              openNote()
            }
          }}
        >
          {note}
        </div>
      )}
    </div>
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
    <div class={cls ? `fitkit-cell ${cls}` : 'fitkit-cell'} data-label={label}>
      {children}
    </div>
  )
}

/**
 * An uncontrolled input: `text` is written once per `model`, never as a prop, so a render never
 * rewrites what the user is typing.
 */
function Field({
  model,
  text,
  label,
  cls = 'fitkit-input',
  numeric = false,
  step,
  inputmode,
  placeholder,
  defaultFocus = false,
  onInput,
  onBlur,
}: {
  model: object
  text: string
  label: string
  cls?: string
  /** A number input; otherwise a text one. */
  numeric?: boolean
  step?: string
  inputmode?: 'decimal' | 'numeric' | 'text'
  placeholder?: string
  /** Marks the input an added row focuses first. */
  defaultFocus?: boolean
  onInput: (input: HTMLInputElement) => void
  onBlur?: (input: HTMLInputElement) => void
}): JSX.Element {
  const ref = useDomEffect<HTMLInputElement>(
    (input) => {
      input.value = text
    },
    [model],
  )
  const shared = {
    ref,
    class: cls,
    step,
    inputmode,
    placeholder,
    'aria-label': label,
    'data-fitkit-default-focus': defaultFocus ? 'true' : undefined,
    onInput: (evt: TargetedEvent<HTMLInputElement>) => onInput(evt.currentTarget),
    onBlur: onBlur
      ? (evt: TargetedEvent<HTMLInputElement, FocusEvent>) => onBlur(evt.currentTarget)
      : undefined,
  }
  return numeric ? <input {...shared} type="number" /> : <input {...shared} type="text" />
}

function flagInvalid(input: HTMLInputElement, invalid: boolean): void {
  if (invalid) {
    input.setAttribute('aria-invalid', 'true')
  } else {
    input.removeAttribute('aria-invalid')
  }
}
