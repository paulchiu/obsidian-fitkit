import type { JSX } from 'preact'

export interface ExerciseChoice {
  type: 'existing' | 'new'
  name: string
}

/** A suggestion row: the exercise name, or the add-new prompt with its note hint. */
export function ExerciseSuggestion({ item }: { item: ExerciseChoice }): JSX.Element {
  return item.type === 'new' ? (
    <>
      <div class="fitkit-suggest-title is-new">{`Add "${item.name}"`}</div>
      <div class="fitkit-suggest-note">You will choose whether to create an exercise note.</div>
    </>
  ) : (
    <div class="fitkit-suggest-title">{item.name}</div>
  )
}
