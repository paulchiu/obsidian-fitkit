import { Menu, Modal, type App } from 'obsidian'
import { render } from 'preact'

import type { IntervalPreset } from '../../domain/interval-presets'
import { outlineFromPlan, outlineProblem, planFromOutline } from '../../domain/plan-outline'
import { PlanForm, type PlanFormActions } from '../components/plan-form'
import { HostContext } from '../components/host'
import {
  append,
  newItem,
  rowActions,
  setField,
  withIds,
  type DraftItem,
  type NewItemKind,
} from '../model/plan-draft'
import { DEFAULT_PLAN, planPreview, tidyPlan } from '../model/plan-form'
import { obsidianHost } from './host'
import { keepInViewOverKeyboard } from './keyboard-sheet'
import { menuAnchorForTrigger } from './menu-anchor'

export interface IntervalPlanModalOptions {
  exerciseName: string
  initial: string | undefined
  /** What the form starts from when there is no plan yet, before the built-in default. */
  suggested?: string
  /** Plans offered under "Start from"; the row is left out when there are none. */
  presets: readonly IntervalPreset[]
  onSave: (plan: string | undefined) => void
}

const ADD_CHOICES: ReadonlyArray<[string, string, NewItemKind]> = [
  ['Step', 'activity', 'step'],
  ['Rest', 'pause', 'rest'],
  ['Repeat', 'repeat', 'repeat'],
]

/**
 * Edits the `[plan::]` on a duration card as rows of steps, or as text for plans rows cannot
 * show, previewing what the plan comes to as it is edited. The plan text is the source of truth;
 * the rows are a draft of it that every edit replaces rather than changes.
 */
export class IntervalPlanModal extends Modal {
  private text = ''
  /** The step editor's rows, or null while the plan is edited as text. */
  private rows: DraftItem[] | null = null
  private showNote = false
  private examplesOpen = false
  private lastId = 0
  private stopKeepingPlanInView?: () => void

  constructor(
    app: App,
    private options: IntervalPlanModalOptions,
  ) {
    super(app)
  }

  onOpen(): void {
    const { contentEl } = this
    this.modalEl.addClass('fitkit-set-note-modal-shell')
    contentEl.addClass('fitkit-set-note-modal')
    this.setTitle(`Interval plan for ${this.options.exerciseName}`)

    this.text = this.options.initial ?? this.options.suggested ?? DEFAULT_PLAN
    this.show(true)
    this.stopKeepingPlanInView = keepInViewOverKeyboard(contentEl, {
      top: this.part('.fitkit-plan-heading'),
      field: this.part('textarea.fitkit-plan-text'),
      bar: this.part('.fitkit-set-note-actions'),
      sheet: this.modalEl,
      area: this.containerEl,
    })
  }

  onClose(): void {
    this.stopKeepingPlanInView?.()
    this.modalEl.removeClass('fitkit-set-note-modal-shell')
    render(null, this.contentEl)
  }

  private draw(): void {
    const { rows, text } = this
    const preview = planPreview(text, rows ? outlineProblem(rows) : null)
    render(
      <HostContext.Provider value={obsidianHost}>
        <PlanForm
          presets={this.options.presets}
          rows={rows}
          showNote={this.showNote}
          text={text}
          examplesOpen={this.examplesOpen}
          preview={preview}
          canClear={this.options.initial !== undefined}
          actions={this.actions}
        />
      </HostContext.Provider>,
      this.contentEl,
    )
  }

  private part(selector: string): HTMLElement {
    const found = this.contentEl.querySelector<HTMLElement>(selector)
    if (!found) {
      throw new Error(`The plan form did not draw ${selector}.`)
    }
    return found
  }

  private newId = (): number => ++this.lastId

  /** Shows the plan as rows when asked and they can show it, else as text. */
  private show(steps: boolean): void {
    const outline = steps ? outlineFromPlan(this.text) : null
    this.rows = outline ? withIds(outline, this.newId) : null
    this.showNote = steps && this.rows === null
    if (this.rows) {
      this.examplesOpen = false
    }
    this.draw()
  }

  private fill = (plan: string): void => {
    this.text = plan
    this.show(this.rows !== null)
  }

  /** Replaces the rows with what `change` makes of them and rewrites the plan text to match. */
  private edit(change: (rows: DraftItem[]) => DraftItem[]): void {
    if (!this.rows) {
      return
    }
    this.rows = change(this.rows)
    this.text = planFromOutline(this.rows)
    this.draw()
  }

  private showMenu(
    trigger: HTMLElement,
    choices: ReadonlyArray<{
      title: string
      icon: string
      change: (rows: DraftItem[]) => DraftItem[]
    }>,
  ): void {
    const menu = new Menu()
    for (const { title, icon, change } of choices) {
      menu.addItem((entry) =>
        entry
          .setTitle(title)
          .setIcon(icon)
          .onClick(() => this.edit(change)),
      )
    }
    menu.showAtPosition(menuAnchorForTrigger(trigger.getBoundingClientRect()))
  }

  private actions: PlanFormActions = {
    onPreset: this.fill,
    onSteps: () => this.show(true),
    onText: () => this.show(false),
    onTextInput: (text) => {
      this.text = text
      this.draw()
    },
    onToggleExamples: () => {
      this.examplesOpen = !this.examplesOpen
      this.draw()
    },
    onEdit: (id, field, value) => this.edit((rows) => setField(rows, id, field, value)),
    onAdd: (parentId, trigger) =>
      this.showMenu(
        trigger,
        ADD_CHOICES.map(([title, icon, kind]) => ({
          title,
          icon,
          change: (rows) => append(rows, parentId, newItem(kind, this.newId)),
        })),
      ),
    onOptions: (id, trigger) => {
      if (this.rows) {
        this.showMenu(trigger, rowActions(this.rows, id, this.newId))
      }
    },
    onClear: () => {
      this.options.onSave(undefined)
      this.close()
    },
    onCancel: () => this.close(),
    onSave: () => {
      if (planPreview(this.text, this.rows ? outlineProblem(this.rows) : null).ok) {
        this.options.onSave(tidyPlan(this.text))
        this.close()
      }
    },
  }
}
