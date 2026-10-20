import type { JSX } from 'preact'
import { useCallback } from 'preact/hooks'

import type { BodyweightLadder } from '../../domain/bodyweight-levels'
import type { ExerciseHistoryBadge, NextPlanBadge } from '../../domain/exercise-history'
import { assertUnreachableKind } from '../../domain/exercise-kind'
import { CAUGHT_UP_NOTE, loggedReps, marksCaughtUpReps } from '../../domain/interval-run'
import type { IntervalProgram } from '../../domain/interval-program'
import { summarisePlan } from '../../domain/plan-summary'
import { intervalColumns, type ExerciseCard } from '../model/editor-card'
import {
  INTENSITY_LABELS,
  durationRowClasses,
  type EditableBodyweightSet,
  type EditableDurationEntry,
  type EditableStrengthSet,
} from '../model/set-rows'
import { useDomEffect } from './dom-effect'
import { useIcon } from './host'
import { memo } from './memo'
import { PlanSummary } from './plan-summary'
import { SetList } from './set-list'
import {
  BodyweightRows,
  DurationRows,
  SetBar,
  StrengthRows,
  type RowControls,
  type RowEdit,
} from './set-rows'

/** A bodyweight row's load entries in its options menu. */
export interface LoadMenu {
  hasLoad: boolean
  onAddLoad: () => void
  onRemoveLoad: () => void
}

/** What the view does for a card; created once, each reading the view's state when called. */
export interface CardHandlers {
  openFile: (ex: ExerciseCard) => void
  openMenu: (evt: MouseEvent, ex: ExerciseCard) => void
  openNote: (ex: ExerciseCard) => void
  openPlan: (ex: ExerciseCard) => void
  /** Wires dragging to `handle`; the result takes it down. */
  attachDrag: (handle: HTMLElement) => () => void
  isExpanded: (ex: ExerciseCard) => boolean
  setExpanded: (ex: ExerciseCard, expanded: boolean) => void
  isSeeded: (set: EditableStrengthSet) => boolean
  editStrength: RowEdit<EditableStrengthSet>
  editBodyweight: RowEdit<EditableBodyweightSet>
  editDuration: RowEdit<EditableDurationEntry>
  rowControls: <T extends { set?: number; note?: string }>(
    rows: T[],
    row: T,
    index: number,
    label: string,
    loadMenu?: LoadMenu,
  ) => RowControls
  addLoad: (ex: ExerciseCard, index: number) => void
  removeLoad: (ex: ExerciseCard, index: number) => void
  setLevel: (set: EditableBodyweightSet, level: number) => void
  openLevelMenu: (
    set: EditableBodyweightSet,
    levels: BodyweightLadder | undefined,
    trigger: HTMLElement,
  ) => void
  addSet: (ex: ExerciseCard) => void
  repeatSet: (ex: ExerciseCard) => void
  startRun: (ex: ExerciseCard, program: IntervalProgram) => void
  openTimer: (ex: ExerciseCard) => void
}

/** The history badges a card shows above its sets. */
export interface CardHistory {
  badges: ExerciseHistoryBadge[]
  plan: NextPlanBadge | null
}

export interface CardProps {
  ex: ExerciseCard
  index: number
  history: CardHistory
  levels: BodyweightLadder | undefined
  /**
   * Everything the card draws, as text. The card is edited in place, so identity says nothing about
   * whether it changed; this does.
   */
  signature: string
  handlers: CardHandlers
}

export function ExerciseCardBody({ ex, index, history, levels, handlers }: CardProps): JSX.Element {
  return (
    <div
      class={ex.kind === 'bodyweight' ? 'fitkit-card fitkit-bodyweight-card' : 'fitkit-card'}
      data-exercise-index={String(index)}
    >
      <div class="fitkit-card-top">
        <DragHandle attach={handlers.attachDrag} />
        <NameButton ex={ex} open={handlers.openFile} />
        <GearButton ex={ex} open={handlers.openMenu} />
      </div>
      <History history={history} />
      {ex.exerciseNotes && ex.exerciseNotes.length > 0 && (
        <NoteLine text={ex.exerciseNotes} open={() => handlers.openNote(ex)} />
      )}
      <Sets ex={ex} index={index} levels={levels} handlers={handlers} />
    </div>
  )
}

/** A card is redrawn only when its position or anything it draws changed. */
export const ExerciseCardView = memo(
  ExerciseCardBody,
  (a, b) => a.ex === b.ex && a.index === b.index && a.signature === b.signature,
)

/** The handle carries its icon and the view's drag wiring, so one element feeds both refs. */
function DragHandle({ attach }: { attach: CardHandlers['attachDrag'] }): JSX.Element {
  const icon = useIcon<HTMLButtonElement>('grip-vertical')
  const drag = useDomEffect<HTMLButtonElement>((handle) => attach(handle), [attach])
  const ref = useCallback((el: HTMLButtonElement | null) => {
    icon.current = el
    drag.current = el
  }, [])
  return (
    <button
      ref={ref}
      type="button"
      class="fitkit-drag-handle"
      aria-label="Drag to reorder"
      tabIndex={0}
    />
  )
}

function NameButton({
  ex,
  open,
}: {
  ex: ExerciseCard
  open: CardHandlers['openFile']
}): JSX.Element {
  const icon = useIcon<HTMLSpanElement>('arrow-up-right')
  return (
    <button
      type="button"
      class="fitkit-name-button"
      aria-label={`Open exercise file for ${ex.name}`}
      onClick={() => open(ex)}
    >
      <span class="fitkit-name-button-text">{ex.name}</span>
      <span ref={icon} class="fitkit-name-button-icon" aria-hidden="true" />
    </button>
  )
}

function GearButton({
  ex,
  open,
}: {
  ex: ExerciseCard
  open: CardHandlers['openMenu']
}): JSX.Element {
  const icon = useIcon<HTMLButtonElement>('settings')
  return (
    <button
      ref={icon}
      type="button"
      class="fitkit-btn fitkit-btn-muted fitkit-card-icon-button fitkit-gear-button"
      aria-label="Exercise options"
      onClick={(evt) => open(evt, ex)}
    />
  )
}

function History({ history }: { history: CardHistory }): JSX.Element | null {
  if (history.badges.length === 0 && !history.plan) {
    return null
  }
  return (
    <div class="fitkit-card-history">
      {history.badges.map((badge) => (
        <span
          class="fitkit-card-badge"
          title={badge.title}
          aria-label={`${badge.text}: ${badge.title}`}
        >
          {badge.text}
        </span>
      ))}
      {history.plan && <PlanBadge badge={history.plan} />}
    </div>
  )
}

function PlanBadge({ badge }: { badge: NextPlanBadge }): JSX.Element {
  const icon = useIcon<HTMLSpanElement>(badge.icon)
  return (
    <span
      class="fitkit-card-badge fitkit-plan-badge"
      title={badge.title}
      aria-label={`${badge.text}: ${badge.title}`}
    >
      <span ref={icon} class="fitkit-plan-badge-icon" aria-hidden="true" />
      <span>{badge.text}</span>
    </span>
  )
}

function NoteLine({ text, open }: { text: string; open: () => void }): JSX.Element {
  return (
    <div
      class="fitkit-note-line fitkit-exercise-note-line"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault()
          open()
        }
      }}
    >
      {text}
    </div>
  )
}

function Sets({
  ex,
  index,
  levels,
  handlers,
}: {
  ex: ExerciseCard
  index: number
  levels: BodyweightLadder | undefined
  handlers: CardHandlers
}): JSX.Element {
  switch (ex.kind) {
    case 'strength':
      return <StrengthSets ex={ex} handlers={handlers} />
    case 'bodyweight':
      return <BodyweightSets ex={ex} levels={levels} handlers={handlers} />
    case 'duration':
      return <DurationSets ex={ex} index={index} handlers={handlers} />
    default:
      return assertUnreachableKind(ex.kind)
  }
}

function Capped({
  ex,
  handlers,
  children,
}: {
  ex: ExerciseCard
  handlers: CardHandlers
  children: JSX.Element
}): JSX.Element {
  return (
    <SetList
      expanded={() => handlers.isExpanded(ex)}
      setExpanded={(next) => handlers.setExpanded(ex, next)}
    >
      {children}
    </SetList>
  )
}

function StrengthSets({ ex, handlers }: { ex: ExerciseCard; handlers: CardHandlers }): JSX.Element {
  const sets = ex.strengthSets
  return (
    <div class="fitkit-set-area">
      <div class="fitkit-set-row fitkit-set-head">
        <span class="fitkit-set-label fitkit-set-figure" />
        <span class="fitkit-set-label">Weight</span>
        <span class="fitkit-set-label">Reps</span>
      </div>
      <Capped ex={ex} handlers={handlers}>
        <StrengthRows
          sets={sets}
          isSeeded={handlers.isSeeded}
          controls={(set, i) => handlers.rowControls(sets, set, i, `set ${i + 1}`)}
          onEdit={handlers.editStrength}
        />
      </Capped>
      <div class="fitkit-row-actions">
        <SetBar
          repeatDisabled={sets.length === 0}
          onAdd={() => handlers.addSet(ex)}
          onRepeat={() => handlers.repeatSet(ex)}
        />
      </div>
    </div>
  )
}

function BodyweightSets({
  ex,
  levels,
  handlers,
}: {
  ex: ExerciseCard
  levels: BodyweightLadder | undefined
  handlers: CardHandlers
}): JSX.Element {
  const sets = ex.bodyweightSets
  const showLoad = sets.some((entry) => entry.load !== undefined)
  return (
    <div class="fitkit-set-area">
      <div
        class={
          showLoad
            ? 'fitkit-bodyweight-row fitkit-set-head has-load'
            : 'fitkit-bodyweight-row fitkit-set-head'
        }
      >
        <span class="fitkit-set-label fitkit-set-figure" />
        <span class="fitkit-set-label">Level</span>
        <span class="fitkit-set-label">Reps</span>
        {showLoad && <span class="fitkit-set-label">Load</span>}
        <span class="fitkit-bodyweight-head-spacer" aria-hidden="true" />
      </div>
      <Capped ex={ex} handlers={handlers}>
        <BodyweightRows
          sets={sets}
          levels={levels}
          showLoad={showLoad}
          controls={(set, i) =>
            handlers.rowControls(sets, set, i, `bodyweight entry ${i + 1}`, {
              hasLoad: set.load !== undefined,
              onAddLoad: () => handlers.addLoad(ex, i),
              onRemoveLoad: () => handlers.removeLoad(ex, i),
            })
          }
          onEdit={handlers.editBodyweight}
          setLevel={handlers.setLevel}
          openLevelMenu={(set, trigger) => handlers.openLevelMenu(set, levels, trigger)}
        />
      </Capped>
      <div class="fitkit-row-actions">
        <SetBar
          repeatDisabled={sets.length === 0}
          onAdd={() => handlers.addSet(ex)}
          onRepeat={() => handlers.repeatSet(ex)}
        />
      </div>
    </div>
  )
}

function DurationSets({
  ex,
  index,
  handlers,
}: {
  ex: ExerciseCard
  index: number
  handlers: CardHandlers
}): JSX.Element {
  const entries = ex.durationEntries
  const columns = intervalColumns(ex)
  const program = columns.plan
  const markCaughtUp = marksCaughtUpReps(entries)
  const done = loggedReps(entries)
  return (
    <>
      {ex.plan !== undefined && (
        <div
          class="fitkit-plan-line"
          role="button"
          tabIndex={0}
          aria-label="Edit interval plan"
          onClick={() => handlers.openPlan(ex)}
        >
          {program ? (
            <PlanSummary summary={summarisePlan(ex.plan, program, entries)} plan={ex.plan} />
          ) : (
            <div class="fitkit-plan-legend">{ex.plan}</div>
          )}
        </div>
      )}
      <div class="fitkit-set-area">
        <div
          class={durationRowClasses(columns, 'fitkit-set-row fitkit-duration-row fitkit-set-head')}
        >
          <span class="fitkit-set-label fitkit-set-figure" />
          <span class="fitkit-set-label">Duration</span>
          {columns.intensity && (
            <span class="fitkit-set-label">{INTENSITY_LABELS[columns.intensity]}</span>
          )}
          {columns.rest && <span class="fitkit-set-label">Rest</span>}
        </div>
        <Capped ex={ex} handlers={handlers}>
          <DurationRows
            entries={entries}
            exerciseIndex={index}
            columns={columns}
            markCaughtUp={markCaughtUp}
            controls={(entry, i) =>
              handlers.rowControls(entries, entry, i, `duration entry ${i + 1}`)
            }
            onEdit={handlers.editDuration}
          />
        </Capped>
        {markCaughtUp && (
          <div class="fitkit-note-line fitkit-set-legend">{`* ${CAUGHT_UP_NOTE}`}</div>
        )}
        <div class="fitkit-row-actions">
          <SetBar
            repeatDisabled={entries.length === 0}
            onAdd={() => handlers.addSet(ex)}
            onRepeat={() => handlers.repeatSet(ex)}
            end={
              program
                ? {
                    kind: 'run',
                    text: done > 0 ? `Start from rep ${done + 1}` : 'Start',
                    disabled: done >= program.steps.length,
                    onClick: () => handlers.startRun(ex, program),
                  }
                : { kind: 'timer', onClick: () => handlers.openTimer(ex) }
            }
          />
        </div>
      </div>
    </>
  )
}
