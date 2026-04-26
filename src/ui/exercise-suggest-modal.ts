import { SuggestModal, type App } from 'obsidian'

export type ExerciseChoice = {
  type: 'existing' | 'new'
  name: string
}

export class ExerciseSuggestModal extends SuggestModal<ExerciseChoice> {
  private handleEnterKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') {
      return
    }
    const first = this.getSuggestions(this.inputEl.value)[0]
    if (!first) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    this.onPick(first.name)
    this.close()
  }

  constructor(
    app: App,
    private names: string[],
    private onPick: (name: string) => void,
  ) {
    super(app)
    this.setPlaceholder('Type an exercise name (or a new one) then press enter')
    this.emptyStateText = 'Type an exercise name to add it'
    this.limit = 20
  }

  async onOpen(): Promise<void> {
    await super.onOpen()
    this.inputEl.addEventListener('keydown', this.handleEnterKeydown, true)
  }

  onClose(): void {
    this.inputEl.removeEventListener('keydown', this.handleEnterKeydown, true)
    super.onClose()
  }

  getSuggestions(query: string): ExerciseChoice[] {
    const trimmed = query.trim()
    const normalized = trimmed.toLocaleLowerCase()
    const exact = this.names.some((name) => name.toLocaleLowerCase() === normalized)
    const matches: ExerciseChoice[] = this.names
      .filter((name) => {
        if (!normalized) {
          return true
        }
        return name.toLocaleLowerCase().includes(normalized)
      })
      .map((name) => ({ type: 'existing' as const, name }))
    if (trimmed && !exact) {
      matches.unshift({ type: 'new', name: trimmed })
    }
    return matches.slice(0, this.limit)
  }

  renderSuggestion(item: ExerciseChoice, el: HTMLElement): void {
    el.empty()
    el.createDiv({
      cls: item.type === 'new' ? 'fitkit-suggest-title is-new' : 'fitkit-suggest-title',
      text: item.type === 'new' ? `Add "${item.name}"` : item.name,
    })
    if (item.type === 'new') {
      el.createDiv({
        cls: 'fitkit-suggest-note',
        text: 'Creates a card only; no exercise note file is created.',
      })
    }
  }

  onChooseSuggestion(item: ExerciseChoice): void {
    this.onPick(item.name)
  }
}
