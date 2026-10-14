import { Menu, setIcon } from 'obsidian'

import type { OutlineItem, OutlineStep } from '../domain/plan-outline'
import { menuAnchorForTrigger } from './menu-anchor'

/**
 * The plan form's step editor: a row per step and rest, and each repeat as an indented group.
 * Edits change `items` in place and call `changed`; adding, moving or removing a row redraws.
 */
export function renderPlanBuilder(
  parent: HTMLElement,
  items: OutlineItem[],
  changed: () => void,
): void {
  const draw = (): void => {
    parent.empty()
    renderList(parent, items, { changed, redraw })
    const add = parent.createEl('button', {
      cls: 'fitkit-plan-add-bar',
      attr: { type: 'button', 'aria-label': 'Add to plan' },
    })
    setIcon(add, 'plus')
    add.createSpan({ text: 'Add' })
    renderAddMenu(add, items, { changed, redraw })
  }
  const redraw = (): void => {
    draw()
    changed()
  }
  draw()
}

interface BuilderContext {
  changed: () => void
  redraw: () => void
}

function renderList(parent: HTMLElement, list: OutlineItem[], context: BuilderContext): void {
  const container = parent.createDiv({ cls: 'fitkit-plan-list' })
  list.forEach((item, index) => {
    if (item.kind === 'repeat') {
      const group = container.createDiv({ cls: 'fitkit-plan-repeat' })
      const head = group.createDiv({ cls: 'fitkit-plan-row' })
      head.createSpan({ cls: 'fitkit-plan-word', text: 'Repeat' })
      renderField(head, context, {
        cls: 'fitkit-plan-count',
        label: 'Rounds',
        placeholder: '3',
        value: item.count,
        set: (value) => (item.count = value),
      })
      head.createSpan({ cls: 'fitkit-plan-word', text: 'times, every' })
      renderField(head, context, {
        cls: 'fitkit-plan-time',
        label: 'Start every',
        placeholder: 'off',
        value: item.every,
        set: (value) => (item.every = value),
      })
      renderOptions(head, 'Repeat options', list, index, context)
      const body = group.createDiv({ cls: 'fitkit-plan-repeat-body' })
      renderList(body, item.items, context)
      /** Sits on the foot of the repeat's bracket, so it can only mean "add to this repeat". */
      const foot = body.createEl('button', {
        cls: 'fitkit-plan-add-foot',
        attr: { type: 'button', 'aria-label': 'Add to repeat' },
      })
      setIcon(foot, 'plus')
      renderAddMenu(foot, item.items, context)
    } else if (item.kind === 'rest') {
      const row = container.createDiv({ cls: 'fitkit-plan-row' })
      row.createSpan({ cls: 'fitkit-plan-word fitkit-plan-grow', text: 'Rest' })
      renderField(row, context, {
        cls: 'fitkit-plan-time',
        label: 'Rest time',
        placeholder: '90s',
        value: item.time,
        set: (value) => (item.time = value),
      })
      renderOptions(row, 'Rest options', list, index, context)
    } else {
      const row = container.createDiv({ cls: 'fitkit-plan-row' })
      renderField(row, context, {
        cls: 'fitkit-plan-grow',
        label: 'Step name',
        placeholder: 'name',
        value: item.name,
        set: (value) => (item.name = value),
      })
      renderField(row, context, {
        cls: 'fitkit-plan-time',
        label: 'Work time',
        placeholder: '1m',
        value: item.work,
        set: (value) => (item.work = value),
      })
      renderField(row, context, {
        cls: 'fitkit-plan-target',
        label: 'Target',
        placeholder: '300W',
        value: item.target,
        set: (value) => (item.target = value),
      })
      renderOptions(row, 'Step options', list, index, context)
    }
  })
}

/** Opens Step / Rest / Repeat from `button`, adding the choice to the end of `list`. */
function renderAddMenu(button: HTMLElement, list: OutlineItem[], context: BuilderContext): void {
  const choices: ReadonlyArray<[string, string, () => OutlineItem]> = [
    ['Step', 'activity', newStep],
    ['Rest', 'pause', () => ({ kind: 'rest', time: '1m' })],
    ['Repeat', 'repeat', () => ({ kind: 'repeat', count: '3', every: '', items: [newStep()] })],
  ]
  button.addEventListener('click', () => {
    const menu = new Menu()
    for (const [title, icon, create] of choices) {
      menu.addItem((entry) =>
        entry
          .setTitle(title)
          .setIcon(icon)
          .onClick(() => {
            list.push(create())
            context.redraw()
          }),
      )
    }
    menu.showAtPosition(menuAnchorForTrigger(button.getBoundingClientRect()))
  })
}

function newStep(): OutlineStep {
  return { kind: 'step', name: 'work', work: '1m', target: '' }
}

function renderField(
  row: HTMLElement,
  context: BuilderContext,
  field: {
    cls: string
    label: string
    placeholder: string
    value: string
    set: (value: string) => void
  },
): void {
  const input = row.createEl('input', {
    cls: `fitkit-input ${field.cls}`,
    attr: {
      type: 'text',
      'aria-label': field.label,
      placeholder: field.placeholder,
      spellcheck: 'false',
      autocapitalize: 'off',
      autocomplete: 'off',
    },
  })
  input.value = field.value
  input.addEventListener('input', () => {
    field.set(input.value)
    context.changed()
  })
}

/** The row's menu: reorder, copy, group into a repeat, ungroup a repeat, or remove. */
function renderOptions(
  row: HTMLElement,
  label: string,
  list: OutlineItem[],
  index: number,
  context: BuilderContext,
): void {
  const button = row.createEl('button', {
    cls: 'fitkit-plan-options',
    attr: { type: 'button', 'aria-label': label },
  })
  setIcon(button, 'more-vertical')
  button.addEventListener('click', () => {
    const item = list[index]
    if (!item) {
      return
    }
    const menu = new Menu()
    const add = (title: string, icon: string, change: () => void): void => {
      menu.addItem((entry) =>
        entry
          .setTitle(title)
          .setIcon(icon)
          .onClick(() => {
            change()
            context.redraw()
          }),
      )
    }
    if (index > 0) {
      add('Move up', 'arrow-up', () => list.splice(index - 1, 2, item, list[index - 1] ?? item))
    }
    if (index < list.length - 1) {
      add('Move down', 'arrow-down', () => list.splice(index, 2, list[index + 1] ?? item, item))
    }
    add('Duplicate', 'copy', () => list.splice(index + 1, 0, structuredClone(item)))
    add('Put in a repeat', 'repeat', () =>
      list.splice(index, 1, { kind: 'repeat', count: '3', every: '', items: [item] }),
    )
    if (item.kind === 'repeat') {
      add('Ungroup', 'ungroup', () => list.splice(index, 1, ...item.items))
    }
    add('Delete', 'trash-2', () => list.splice(index, 1))
    menu.showAtPosition(menuAnchorForTrigger(button.getBoundingClientRect()))
  })
}
