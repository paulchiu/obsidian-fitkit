import { Modal, type App } from 'obsidian'
import { render } from 'preact'

import { UnknownExerciseBody } from '../components/unknown-exercise-body'

/** Asks whether to add an exercise missing from the registry; reports null for Skip, else whether to create its note. */
export class UnknownExerciseModal extends Modal {
  private choice: boolean | null = null
  private createNote = true

  constructor(
    app: App,
    private name: string,
    private wasDeleted: boolean,
    private onChoice: (createNote: boolean | null) => void,
  ) {
    super(app)
  }

  onOpen(): void {
    this.setTitle('Add exercise')
    render(
      <UnknownExerciseBody
        message={
          this.wasDeleted
            ? `"${this.name}" was previously deleted and ignored. Add it again?`
            : `"${this.name}" is not in your exercise registry yet.`
        }
        createNote={this.createNote}
        onToggle={(createNote) => {
          this.createNote = createNote
        }}
        onChoose={(add) => {
          this.choice = add ? this.createNote : null
          this.close()
        }}
      />,
      this.contentEl,
    )
  }

  onClose(): void {
    render(null, this.contentEl)
    this.onChoice(this.choice)
  }
}
