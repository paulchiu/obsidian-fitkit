import { Modal, type App } from 'obsidian'
import { render } from 'preact'

import type { ExerciseKind } from '../../domain/exercise-kind'
import { PlanStepForm } from '../components/plan-step-form'
import { parsePlanStep, planStepTitle } from '../model/plan-step'

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
    this.modalEl.addClass('fitkit-set-note-modal-shell')
    contentEl.addClass('fitkit-set-note-modal')
    this.setTitle(planStepTitle(this.options.exerciseName, this.options.kind))

    render(
      <PlanStepForm
        kind={this.options.kind}
        initial={this.options.initial}
        onSave={this.commit}
        onCancel={this.cancel}
        focusInput={focusAndSelect}
      />,
      contentEl,
    )
  }

  onClose(): void {
    this.modalEl.removeClass('fitkit-set-note-modal-shell')
    render(null, this.contentEl)
    this.settled = true
  }

  private cancel = (): void => this.close()

  private commit = (raw: string): void => {
    if (this.settled) {
      return
    }
    this.settled = true
    this.options.onSave(parsePlanStep(raw))
    this.close()
  }
}

/** Focuses `input` with its text selected, after the modal has settled on screen. */
function focusAndSelect(input: HTMLInputElement): void {
  window.setTimeout(() => {
    input.focus()
    input.select()
  }, 0)
}
