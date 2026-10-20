import type { JSX } from 'preact'

import type { DraftField, DraftItem } from '../model/plan-draft'
import { TextField } from './fields'
import { useIcon } from './host'

export interface PlanBuilderActions {
  onEdit: (id: number, field: DraftField, value: string) => void
  /** Opens the Add menu from `trigger`, adding to repeat `parentId` or, with null, to the plan. */
  onAdd: (parentId: number | null, trigger: HTMLElement) => void
  /** Opens the row menu from `trigger`. */
  onOptions: (id: number, trigger: HTMLElement) => void
}

const FIELD_ATTRIBUTES = { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' }

/**
 * The plan form's step editor: a row per step and rest, and each repeat as an indented group.
 * Rows are keyed by id, so a redraw keeps the input being typed in.
 */
export function PlanBuilder({
  items,
  actions,
}: {
  items: DraftItem[]
  actions: PlanBuilderActions
}): JSX.Element {
  const plus = useIcon<HTMLSpanElement>('plus')
  return (
    <>
      <PlanList items={items} actions={actions} />
      <button
        type="button"
        class="fitkit-plan-add-bar"
        aria-label="Add to plan"
        onClick={(event) => actions.onAdd(null, event.currentTarget)}
      >
        <span class="fitkit-plan-add-icon" ref={plus} />
        <span>Add</span>
      </button>
    </>
  )
}

function PlanList({
  items,
  actions,
}: {
  items: DraftItem[]
  actions: PlanBuilderActions
}): JSX.Element {
  return (
    <div class="fitkit-plan-list">
      {items.map((item) => (
        <PlanRow key={item.id} item={item} actions={actions} />
      ))}
    </div>
  )
}

function PlanRow({ item, actions }: { item: DraftItem; actions: PlanBuilderActions }): JSX.Element {
  const field = (
    cls: string,
    label: string,
    placeholder: string,
    name: DraftField,
    value: string,
  ): JSX.Element => (
    <TextField
      class={`fitkit-input ${cls}`}
      aria-label={label}
      placeholder={placeholder}
      attributes={FIELD_ATTRIBUTES}
      value={value}
      onValueInput={(next) => actions.onEdit(item.id, name, next)}
    />
  )
  const options = (label: string): JSX.Element => (
    <IconButton
      cls="fitkit-plan-options"
      label={label}
      icon="more-vertical"
      onClick={(trigger) => actions.onOptions(item.id, trigger)}
    />
  )
  if (item.kind === 'repeat') {
    return (
      <div class="fitkit-plan-repeat">
        <div class="fitkit-plan-row">
          <span class="fitkit-plan-word">Repeat</span>
          {field('fitkit-plan-count', 'Rounds', '3', 'count', item.count)}
          <span class="fitkit-plan-word">times, every</span>
          {field('fitkit-plan-time', 'Start every', 'off', 'every', item.every)}
          {options('Repeat options')}
        </div>
        <div class="fitkit-plan-repeat-body">
          <PlanList items={item.items} actions={actions} />
          <IconButton
            cls="fitkit-plan-add-foot"
            label="Add to repeat"
            icon="plus"
            onClick={(trigger) => actions.onAdd(item.id, trigger)}
          />
        </div>
      </div>
    )
  }
  if (item.kind === 'rest') {
    return (
      <div class="fitkit-plan-row">
        <span class="fitkit-plan-word fitkit-plan-grow">Rest</span>
        {field('fitkit-plan-time', 'Rest time', '90s', 'time', item.time)}
        {options('Rest options')}
      </div>
    )
  }
  return (
    <div class="fitkit-plan-row">
      {field('fitkit-plan-grow', 'Step name', 'name', 'name', item.name)}
      {field('fitkit-plan-time', 'Work time', '1m', 'work', item.work)}
      {field('fitkit-plan-target', 'Target', '300W', 'target', item.target)}
      {options('Step options')}
    </div>
  )
}

/** A button drawn as just an icon. */
export function IconButton({
  cls,
  label,
  icon,
  hidden,
  expanded,
  onClick,
}: {
  cls: string
  label: string
  icon: string
  hidden?: boolean
  /** Marks a button that opens something, by whether it is open. */
  expanded?: boolean
  onClick: (trigger: HTMLElement) => void
}): JSX.Element {
  const glyph = useIcon<HTMLButtonElement>(icon)
  return (
    <button
      type="button"
      class={cls}
      aria-label={label}
      aria-expanded={expanded}
      hidden={hidden}
      ref={glyph}
      onClick={(event) => onClick(event.currentTarget)}
    />
  )
}
