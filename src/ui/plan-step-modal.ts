import { Modal, type App } from 'obsidian'

import type { ExerciseKind } from '../domain/exercise-kind'
import { DEFAULT_WEIGHT_UNIT } from '../domain/weight-unit'

export interface PlanStepModalOptions {
  exerciseName: string
  kind: ExerciseKind
  initial: string
  onSave: (next: number | undefined) => void
}

/**
 * Prompt for the step on a `[next:: ...]` plan: kilograms of weight change,
 * or a count of rungs on a bodyweight exercise. A blank or unusable entry
 * clears the step, leaving the direction on its own.
 */
export class PlanStepModal extends Modal {
  private settled = false

  constructor(
    app: App,
    private options: PlanStepModalOptions,
  ) {
    super(app)
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    this.modalEl.addClass('fitkit-set-note-modal-shell')
    contentEl.addClass('fitkit-set-note-modal')
    this.setTitle(planStepTitle(this.options.exerciseName, this.options.kind))

    const field = contentEl.createDiv({ cls: 'fitkit-set-note-field' })
    field.createEl('label', {
      cls: 'fitkit-label',
      text: planStepLabel(this.options.kind),
      attr: { for: 'fitkit-plan-step-input' },
    })
    const input = field.createEl('input', {
      cls: 'fitkit-input',
      attr: {
        id: 'fitkit-plan-step-input',
        type: 'text',
        inputmode: 'decimal',
        placeholder: this.options.kind === 'bodyweight' ? 'rungs' : DEFAULT_WEIGHT_UNIT,
      },
    })
    input.value = this.options.initial

    const actions = contentEl.createDiv({ cls: 'fitkit-confirm-actions fitkit-set-note-actions' })
    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Cancel' })
    cancel.addEventListener('click', () => this.close())
    const save = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-primary',
      text: 'Save',
    })
    save.addEventListener('click', () => this.commit(input.value))
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') {
        evt.preventDefault()
        this.commit(input.value)
      }
    })

    window.setTimeout(() => {
      input.focus()
      input.select()
    }, 0)
  }

  onClose(): void {
    this.modalEl.removeClass('fitkit-set-note-modal-shell')
    this.contentEl.empty()
    this.settled = true
  }

  private commit(raw: string): void {
    if (this.settled) {
      return
    }
    this.settled = true
    const step = Number(raw.trim())
    this.options.onSave(Number.isFinite(step) && step > 0 ? step : undefined)
    this.close()
  }
}

/** Modal heading naming the plan step for this exercise. */
function planStepTitle(exerciseName: string, kind: ExerciseKind): string {
  return kind === 'bodyweight'
    ? `Rung change for ${exerciseName}`
    : `Weight change for ${exerciseName}`
}

/** Field label naming the plan step unit. */
function planStepLabel(kind: ExerciseKind): string {
  return kind === 'bodyweight' ? 'Rung change' : 'Weight change'
}
