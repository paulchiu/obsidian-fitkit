import { Modal, type App } from 'obsidian'

import type { ExerciseType } from '../../domain/exercise-type'

export type KindSwitchChoice = 'cancel' | 'workout' | 'workout-and-registry'

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
    const { exerciseName, currentType, nextType, clearsRows, registryType } = this.options
    contentEl.empty()
    contentEl.addClass('fitkit-kind-confirm-modal')
    this.setTitle(`Switch ${exerciseName} to ${nextType}?`)

    if (clearsRows) {
      contentEl.createEl('p', {
        text: `Existing ${currentType} rows in this workout will be cleared.`,
      })
    }

    const registryLine =
      registryType === nextType
        ? `The exercise registry already records ${exerciseName} as ${nextType}.`
        : registryType === null
          ? `${exerciseName} is not yet in the exercise registry.`
          : `The exercise registry currently records ${exerciseName} as ${registryType}.`
    contentEl.createEl('p', {
      text: `${registryLine} New cards default their type from the registry.`,
    })

    const actions = contentEl.createDiv({ cls: 'fitkit-confirm-actions' })

    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Cancel' })
    cancel.addEventListener('click', () => this.finish('cancel'))

    const workoutOnly = actions.createEl('button', {
      cls: 'fitkit-btn',
      text: 'Just this workout',
    })
    workoutOnly.addEventListener('click', () => this.finish('workout'))

    if (registryType !== nextType) {
      const both = actions.createEl('button', {
        cls: 'fitkit-btn fitkit-btn-primary',
        text: 'Update registry too',
      })
      both.addEventListener('click', () => this.finish('workout-and-registry'))
    }
  }

  onClose(): void {
    this.resolve('cancel')
    this.contentEl.empty()
  }

  private finish(choice: KindSwitchChoice): void {
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
