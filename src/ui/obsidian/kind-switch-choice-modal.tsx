import { Modal, type App } from 'obsidian'
import { render } from 'preact'

import {
  KindSwitchChoiceBody,
  type KindSwitchChoice,
  type KindSwitchChoiceProps,
} from '../components/kind-switch-choice-body'

export type { KindSwitchChoice }

export type KindSwitchChoiceModalOptions = Omit<KindSwitchChoiceProps, 'onChoose'>

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
