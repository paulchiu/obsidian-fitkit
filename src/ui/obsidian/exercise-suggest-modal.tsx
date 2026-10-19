import { SuggestModal, type App } from 'obsidian'
import { render } from 'preact'

import { ExerciseSuggestion, type ExerciseChoice } from '../components/exercise-suggestion'

export class ExerciseSuggestModal extends SuggestModal<ExerciseChoice> {
  private rows = new Set<HTMLElement>()

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
    this.rows.forEach((row) => render(null, row))
    this.rows.clear()
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
    this.unmountDiscardedRows()
    render(null, el)
    el.empty()
    this.rows.add(el)
    render(<ExerciseSuggestion item={item} />, el)
  }

  /** Obsidian empties the results list before redrawing it, which leaves old rows parentless. */
  private unmountDiscardedRows(): void {
    for (const row of this.rows) {
      if (!row.parentElement) {
        render(null, row)
        this.rows.delete(row)
      }
    }
  }

  onChooseSuggestion(item: ExerciseChoice): void {
    this.onPick(item.name)
  }
}
