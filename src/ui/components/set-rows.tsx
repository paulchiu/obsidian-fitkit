import { render, type ComponentChildren, type JSX, type TargetedEvent } from 'preact'

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
import { HostContext, useIcon, type Host } from './host'

/** What every row shares: its name for labels, its note, and the dialogs the view opens for it. */
export interface RowChrome {
  /** Names the row in labels, such as `set 2`. */
  label: string
  note: string | undefined
  openNote: () => void
  /** Opens the row's options menu under `trigger`. */
  openMenu: (trigger: HTMLElement) => void
}

export interface StrengthRowsProps {
  sets: readonly EditableStrengthSet[]
  /** Whether the set's weight came from the plan and has not been typed over. */
  isSeeded: (set: EditableStrengthSet) => boolean
  chrome: (index: number) => RowChrome
  /** The model changed; nothing is redrawn. */
  onEdit: () => void
  /** The weight was typed over. */
  onWeightEdit: (set: EditableStrengthSet) => void
}

export interface BodyweightRowsProps {
  sets: readonly EditableBodyweightSet[]
  levels: BodyweightLadder | undefined
  showLoad: boolean
  chrome: (index: number) => RowChrome
  onEdit: () => void
  setLevel: (index: number, level: number) => void
  /** Opens the level menu for the row at `index` under `trigger`. */
  openLevelMenu: (index: number, trigger: HTMLElement) => void
  /** Shortens `label` when `full` overflows its slot. */
  fitLabel: (label: HTMLElement, full: HTMLElement) => void
}

export interface DurationRowsProps {
  entries: readonly EditableDurationEntry[]
  exerciseIndex: number
  columns: IntervalColumns
  markCaughtUp: boolean
  chrome: (index: number) => RowChrome
  onEdit: () => void
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

/** Draws a strength card's rows into `parent`; the returned function takes them down. */
export function renderStrengthRows(
  parent: HTMLElement,
  props: StrengthRowsProps,
  host: Host,
): () => void {
  return mount(parent, host, <StrengthRows {...props} />)
}

/** Draws a bodyweight card's rows into `parent`; the returned function takes them down. */
export function renderBodyweightRows(
  parent: HTMLElement,
  props: BodyweightRowsProps,
  host: Host,
): () => void {
  return mount(parent, host, <BodyweightRows {...props} />)
}

/** Draws a duration card's rows into `parent`; the returned function takes them down. */
export function renderDurationRows(
  parent: HTMLElement,
  props: DurationRowsProps,
  host: Host,
): () => void {
  return mount(parent, host, <DurationRows {...props} />)
}

/** Draws the Add set and Repeat bar into `parent`; the returned function takes it down. */
export function renderSetBar(parent: HTMLElement, props: SetBarProps, host: Host): () => void {
  return mount(parent, host, <SetBar {...props} />)
}

function mount(parent: HTMLElement, host: Host, tree: JSX.Element): () => void {
  render(<HostContext.Provider value={host}>{tree}</HostContext.Provider>, parent)
  return () => render(null, parent)
}

function StrengthRows(props: StrengthRowsProps): JSX.Element {
  const { sets } = props
  return (
    <>
      {sets.map((set, i) => (
        <StrengthRow
          key={set}
          set={set}
          index={i}
          live={i === sets.length - 1}
          seeded={props.isSeeded(set)}
          chrome={props.chrome(i)}
          onEdit={props.onEdit}
          onWeightEdit={props.onWeightEdit}
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
  chrome,
  onEdit,
  onWeightEdit,
}: {
  set: EditableStrengthSet
  index: number
  /** The logging loop only touches the bottom row; the ones above it are session history. */
  live: boolean
  seeded: boolean
  chrome: RowChrome
  onEdit: () => void
  onWeightEdit: (set: EditableStrengthSet) => void
}): JSX.Element {
  return (
    <Row cls={live ? 'fitkit-row fitkit-row--live' : 'fitkit-row'} chrome={chrome}>
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
            onInput={(input) => {
              onWeightEdit(set)
              input.classList.remove('fitkit-input--unconfirmed')
              set.weight = parseNumberInput(input.value)
              onEdit()
            }}
          />
        </Cell>
        <Cell label="Reps">
          <Field
            model={set}
            text={set.reps !== undefined ? String(set.reps) : ''}
            label="Reps"
            numeric
            inputmode="numeric"
            onInput={(input) => {
              set.reps = parseNumberInput(input.value)
              onEdit()
            }}
          />
        </Cell>
      </div>
    </Row>
  )
}

function BodyweightRows(props: BodyweightRowsProps): JSX.Element {
  return (
    <>
      {props.sets.map((set, i) => (
        <BodyweightRow
          key={set}
          set={set}
          index={i}
          levels={props.levels}
          showLoad={props.showLoad}
          chrome={props.chrome(i)}
          onEdit={props.onEdit}
          setLevel={(level) => props.setLevel(i, level)}
          openLevelMenu={(trigger) => props.openLevelMenu(i, trigger)}
          fitLabel={props.fitLabel}
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
  chrome,
  onEdit,
  setLevel,
  openLevelMenu,
  fitLabel,
}: {
  set: EditableBodyweightSet
  index: number
  levels: BodyweightLadder | undefined
  showLoad: boolean
  chrome: RowChrome
  onEdit: () => void
  setLevel: (level: number) => void
  openLevelMenu: (trigger: HTMLElement) => void
  fitLabel: (label: HTMLElement, full: HTMLElement) => void
}): JSX.Element {
  return (
    <Row cls="fitkit-row" chrome={chrome}>
      <div class={showLoad ? 'fitkit-bodyweight-row has-load' : 'fitkit-bodyweight-row'}>
        <Cell label="Set" cls="fitkit-set-figure">
          {String(set.set ?? index + 1)}
        </Cell>
        <Cell label="Level">
          <LevelStepper
            position={index + 1}
            levels={levels}
            level={set.level ?? 1}
            setLevel={setLevel}
            openMenu={openLevelMenu}
            fitLabel={fitLabel}
          />
        </Cell>
        <Cell label="Reps">
          <Field
            model={set}
            text={set.reps !== undefined ? String(set.reps) : ''}
            label="Reps"
            numeric
            inputmode="numeric"
            onInput={(input) => {
              set.reps = parseNumberInput(input.value)
              onEdit()
            }}
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
                onInput={(input) => {
                  set.load = parseNumberInput(input.value)
                  onEdit()
                }}
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
  setLevel,
  openMenu,
  fitLabel,
}: {
  position: number
  levels: BodyweightLadder | undefined
  level: number
  setLevel: (level: number) => void
  openMenu: (trigger: HTMLElement) => void
  fitLabel: (label: HTMLElement, full: HTMLElement) => void
}): JSX.Element {
  const rungCount = levels?.length ?? 0
  const name = formatBodyweightLevelLabel(levels, level)
  const minus = useIcon<HTMLButtonElement>('minus')
  const plus = useIcon<HTMLButtonElement>('plus')
  const chevron = useIcon<HTMLSpanElement>('chevron-down')
  const label = useDomEffect<HTMLButtonElement>(
    (el) => {
      const full = el.querySelector<HTMLElement>('.fitkit-bodyweight-level-full')
      if (full) {
        fitLabel(el, full)
      }
    },
    [level, name],
  )
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
        class="fitkit-bodyweight-level-label"
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

function DurationRows(props: DurationRowsProps): JSX.Element {
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
          chrome={props.chrome(i)}
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
  chrome,
  onEdit,
}: {
  entry: EditableDurationEntry
  index: number
  exerciseIndex: number
  columns: IntervalColumns
  /** A caught-up rep in a card that explains the asterisk, so its note shows there instead. */
  marked: boolean
  chrome: RowChrome
  onEdit: () => void
}): JSX.Element {
  const intensity = columns.intensity
  return (
    <Row
      cls="fitkit-row"
      chrome={chrome}
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
          <DurationField entry={entry} onEdit={onEdit} />
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
                entry[intensity] = parseNumberInput(input.value)
                onEdit()
              }}
            />
          </Cell>
        )}
        {columns.rest && (
          <Cell label="Rest">
            <RestField entry={entry} onEdit={onEdit} />
          </Cell>
        )}
      </div>
    </Row>
  )
}

/** Normalises its text on blur and flags text that is not a duration. */
function DurationField({
  entry,
  onEdit,
}: {
  entry: EditableDurationEntry
  onEdit: () => void
}): JSX.Element {
  return (
    <Field
      model={entry}
      text={formatDurationInput(entry.durationSeconds)}
      label="Duration"
      cls="fitkit-input fitkit-duration-input"
      inputmode="text"
      placeholder={ZERO_DURATION_DISPLAY}
      defaultFocus
      onInput={(input) => {
        const parsed = parseDurationInput(input.value)
        flagInvalid(input, parsed === null)
        if (parsed !== null) {
          entry.durationSeconds = parsed.seconds
          onEdit()
        }
      }}
      onBlur={(input) => {
        const parsed = parseDurationInput(input.value)
        flagInvalid(input, false)
        if (parsed === null) {
          input.value = formatDurationInput(entry.durationSeconds)
          return
        }
        entry.durationSeconds = parsed.seconds
        input.value = parsed.display
      }}
    />
  )
}

function RestField({
  entry,
  onEdit,
}: {
  entry: EditableDurationEntry
  onEdit: () => void
}): JSX.Element {
  return (
    <Field
      model={entry}
      text={formatDurationInput(entry.restSeconds)}
      label="Rest"
      cls="fitkit-input fitkit-duration-input"
      placeholder={ZERO_DURATION_DISPLAY}
      onInput={(input) => {
        const parsed = parseDurationInput(input.value)
        flagInvalid(input, parsed === null)
        if (parsed !== null) {
          entry.restSeconds = parsed.seconds
          onEdit()
        }
      }}
      onBlur={(input) => {
        flagInvalid(input, false)
        input.value = formatDurationInput(entry.restSeconds)
      }}
    />
  )
}

function SetBar({ repeatDisabled, onAdd, onRepeat, end }: SetBarProps): JSX.Element {
  const play = useIcon<HTMLButtonElement>('play')
  return (
    <>
      <button class="fitkit-btn" onClick={onAdd}>
        Add set
      </button>
      <button class="fitkit-btn" disabled={repeatDisabled} onClick={onRepeat}>
        Repeat
      </button>
      {end === undefined ? null : end.kind === 'run' ? (
        <button
          class="fitkit-btn fitkit-btn-primary fitkit-run-button"
          aria-label="Start interval plan"
          disabled={end.disabled}
          onClick={end.onClick}
        >
          {end.text}
        </button>
      ) : (
        <button
          ref={play}
          class="fitkit-btn fitkit-timer-button"
          aria-label="Start timer"
          onClick={end.onClick}
        >
          Start timer
        </button>
      )}
    </>
  )
}

/** A set row: its cells, the options button beside them, and the note line under them. */
function Row({
  cls,
  chrome,
  hideNoteLine = false,
  timerRow,
  children,
}: {
  cls: string
  chrome: RowChrome
  /** The note stays editable from the menu; the row shows it some other way. */
  hideNoteLine?: boolean
  timerRow?: string
  children: ComponentChildren
}): JSX.Element {
  const kebab = useIcon<HTMLButtonElement>('more-vertical')
  const { note, openNote } = chrome
  return (
    <div class={cls} data-fitkit-timer-row={timerRow}>
      <div class="fitkit-row-body">
        {children}
        <button
          ref={kebab}
          type="button"
          class="fitkit-btn fitkit-btn-muted fitkit-row-kebab"
          aria-label={`Options for ${chrome.label}`}
          onClick={(evt) => {
            evt.stopPropagation()
            chrome.openMenu(evt.currentTarget)
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
