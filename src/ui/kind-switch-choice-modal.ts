import { Modal, type App } from 'obsidian'

import type { ExerciseKind } from '../domain/exercise-registry'

export type KindSwitchChoice = 'cancel' | 'workout' | 'workout-and-registry'

export interface KindSwitchChoiceModalOptions {
  exerciseName: string
  currentKind: ExerciseKind
  nextKind: ExerciseKind
  hasRows: boolean
  registryKind: ExerciseKind | null
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
    const { exerciseName, currentKind, nextKind, hasRows, registryKind } = this.options
    contentEl.empty()
    contentEl.addClass('fitkit-kind-confirm-modal')
    this.setTitle(`Switch ${exerciseName} to ${nextKind}?`)

    if (hasRows) {
      contentEl.createEl('p', {
        text: `Existing ${currentKind} rows in this workout will be cleared.`,
      })
    }

    const registryLine =
      registryKind === nextKind
        ? `The exercise registry already records ${exerciseName} as ${nextKind}.`
        : registryKind === null
          ? `${exerciseName} is not yet in the exercise registry.`
          : `The exercise registry currently records ${exerciseName} as ${registryKind}.`
    contentEl.createEl('p', {
      text: `${registryLine} New cards default their kind from the registry.`,
    })

    const actions = contentEl.createDiv({ cls: 'fitkit-confirm-actions' })

    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Cancel' })
    cancel.addEventListener('click', () => this.finish('cancel'))

    const workoutOnly = actions.createEl('button', {
      cls: 'fitkit-btn',
      text: 'Just this workout',
    })
    workoutOnly.addEventListener('click', () => this.finish('workout'))

    if (registryKind !== nextKind) {
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
