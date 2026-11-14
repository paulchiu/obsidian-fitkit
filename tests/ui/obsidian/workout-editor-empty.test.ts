import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', async () =>
  (await import('../../fixtures/obsidian-editor-mock')).createObsidianMock(),
)

import {
  button,
  createEditor,
  openEditor,
  pickerModal,
  pressKey,
  savedBody,
  useEditorEnvironment,
  WORKOUT_PATH,
} from '../../fixtures/workout-editor'

useEditorEnvironment()

describe('WorkoutEditorView with no exercises', () => {
  it('shows a No exercises yet card with a hint in the exercise list', async () => {
    const { view } = await openEditor({ body: [] })

    const empty = view.contentEl.querySelector('.fitkit-exercise-list .fitkit-empty-card')
    expect([
      empty?.querySelector('.fitkit-empty-card-title')?.textContent,
      empty?.querySelector('.fitkit-empty-card-hint')?.textContent,
    ]).toEqual(['No exercises yet', 'Add an exercise to start logging sets.'])
  })

  it("adds what is picked from the card's Add exercise, as the footer's would", async () => {
    const { view, contents } = await openEditor({
      body: [],
      settings: { exerciseRegistry: [{ name: 'Squat', kind: 'strength', aliases: [] }] },
    })

    await pickFromCard(view.contentEl, 'Squat')

    await savedBody(contents, ['## [[Squat]]', '', '- [exercise:: [[Squat]]] [set:: 1]'])
  })

  it('drops the card and brings back the footer Add exercise once an exercise is added', async () => {
    const { view, contents } = await openEditor({
      body: [],
      settings: { exerciseRegistry: [{ name: 'Squat', kind: 'strength', aliases: [] }] },
    })

    await pickFromCard(view.contentEl, 'Squat')
    await savedBody(contents, ['## [[Squat]]', '', '- [exercise:: [[Squat]]] [set:: 1]'])

    expect([
      view.contentEl.querySelector('.fitkit-empty-card'),
      footerButtons(view.contentEl),
    ]).toEqual([null, ['Add exercise', 'Start rest']])
  })

  it('keeps Start rest in the footer but no second Add exercise while the card shows', async () => {
    const { view } = await openEditor({ body: [] })

    expect(footerButtons(view.contentEl)).toEqual(['Start rest'])
  })

  it('keeps the warning and shows no card in a note that is not a workout', async () => {
    const { view, contents } = createEditor({ body: [] })
    contents.set(WORKOUT_PATH, '# Just a note\n')
    await view.onOpen()
    await view.setState({ file: WORKOUT_PATH }, { history: false })

    expect([
      view.contentEl.querySelector('.fitkit-warn')?.textContent,
      view.contentEl.querySelector('.fitkit-empty-card'),
    ]).toEqual([
      'This note has no `type: workout` frontmatter. The editor will not save changes here.',
      null,
    ])
  })

  it('draws no empty footer while the card shows and the rest timer is off', async () => {
    const { view } = await openEditor({ body: [], settings: { strengthRestTimerEnabled: false } })

    expect(view.contentEl.querySelector('.fitkit-footer')).toBeNull()
  })
})

const footerButtons = (root: Element): string[] =>
  [...root.querySelectorAll('.fitkit-footer button')].map((found) => found.textContent ?? '')

/** Picks `name` through the empty card's Add exercise. */
const pickFromCard = async (root: Element, name: string): Promise<void> => {
  button(emptyCard(root), 'Add exercise').click()
  const picker = await pickerModal()
  picker.inputEl.value = name
  pressKey(picker.inputEl, 'Enter')
}

const emptyCard = (root: Element): Element => {
  const found = root.querySelector('.fitkit-empty-card')
  if (!found) {
    throw new Error('no empty card drawn')
  }
  return found
}
