import { Modal, type App } from 'obsidian'
import { render } from 'preact'

import type { ExerciseType } from '../../domain/exercise-type'
import { KindSwitchChoiceBody, type KindSwitchChoice } from '../components/kind-switch-choice'

export type { KindSwitchChoice }

export interface KindSwitchChoiceModalOptions {
  exerciseName: string
  currentType: ExerciseType
  nextType: ExerciseType
  /** True when the switch changes the stored kind and the card has rows to lose. */
  clearsRows: boolean
  registryType: ExerciseType | null
}

export class KindSwitchChoiceModal extends Modal {
  private settled = false

  constructor(
    app: App,
    private options: KindSwitchChoiceModalOptions,
    private resolveChoice: (choice: KindSwitchChoice) => void,
  ) {
    super(app)
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.addClass('fitkit-kind-confirm-modal')
    this.setTitle(`Switch ${this.options.exerciseName} to ${this.options.nextType}?`)
    render(<KindSwitchChoiceBody {...this.options} onChoose={this.finish} />, contentEl)
  }

  onClose(): void {
    this.resolve('cancel')
    render(null, this.contentEl)
  }

  private finish = (choice: KindSwitchChoice): void => {
    this.resolve(choice)
    this.close()
  }

  private resolve(choice: KindSwitchChoice): void {
    if (this.settled) {
      return
    }
    this.settled = true
    this.resolveChoice(choice)
  }
}
