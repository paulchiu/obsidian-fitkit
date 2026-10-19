import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', async () =>
  (await import('../fixtures/obsidian-editor-mock')).createObsidianMock(),
)

import {
  button,
  card,
  createEditor,
  openEditor,
  typeInto,
  useEditorEnvironment,
  WORKOUT_PATH,
  workoutNote,
} from '../fixtures/workout-editor'
import { outline } from '../harness/outline'
import { findUnstyledClasses } from '../harness/stylesheet'

useEditorEnvironment()

const part = (root: Element, selector: string): Element => {
  const found = root.querySelector(selector)
  if (!found) {
    throw new Error(`${selector} not rendered`)
  }
  return found
}

describe('WorkoutEditorView structure', () => {
  it('draws the empty state before a workout is loaded', async () => {
    const { view } = createEditor({ body: [] })

    await view.onOpen()

    const empty = part(view.contentEl, '.fitkit-empty')
    expect(outline(empty)).toMatchSnapshot()
    expect(findUnstyledClasses(empty)).toEqual([])
  })

  it('draws the loading skeleton while the workout is read', async () => {
    const { view, releaseRead } = createEditor({ body: [], deferRead: true })
    await view.onOpen()

    const loading = view.setState({ file: WORKOUT_PATH }, { history: false })

    const skeleton = part(view.contentEl, '.fitkit-skeleton')
    expect(outline(skeleton)).toMatchSnapshot()
    expect(findUnstyledClasses(skeleton)).toEqual([])
    releaseRead()
    await loading
  })

  it('draws the header with the workout name and meta line', async () => {
    const { view } = await openEditor({ body: STRENGTH })

    const header = part(view.contentEl, '.fitkit-header')
    expect(outline(header)).toMatchSnapshot()
    expect(findUnstyledClasses(header)).toEqual([])
  })

  it('draws the footer with the last rest beside the rest button', async () => {
    const { view } = await openEditor({ body: STRENGTH })
    button(view.contentEl, 'Start rest timer').click()
    vi.setSystemTime(Date.now() + 75_000)
    button(view.contentEl, 'Stop rest timer').click()

    const footer = part(view.contentEl, '.fitkit-footer')
    expect(outline(footer)).toMatchSnapshot()
    expect(findUnstyledClasses(footer)).toEqual([])
  })

  it('draws the conflict banner when the note changed on disk under an edit', async () => {
    const { view, contents } = await openEditor({ body: STRENGTH })
    contents.set(WORKOUT_PATH, workoutNote(['## [[Deadlift]]']))

    const reps = part(card(view), 'input[aria-label="Reps"]') as HTMLInputElement
    typeInto(reps, '7')

    const banner = await vi.waitFor(() => part(view.contentEl, '.fitkit-conflict'))
    expect(outline(banner)).toMatchSnapshot()
    expect(findUnstyledClasses(banner)).toEqual([])
  })

  it.each([
    { article: 'a', kind: 'strength', options: { body: STRENGTH, history: STRENGTH_HISTORY } },
    {
      article: 'a',
      kind: 'bodyweight',
      options: { body: BODYWEIGHT, exerciseNotes: PUSH_UP_NOTE },
    },
    { article: 'a', kind: 'duration', options: { body: DURATION } },
    { article: 'an', kind: 'interval plan', options: { body: INTERVAL } },
  ])('draws $article $kind card', async ({ options }) => {
    const { view } = await openEditor(options)

    expect(outline(card(view))).toMatchSnapshot()
    expect(findUnstyledClasses(card(view))).toEqual([])
  })
})

/** A strength card carrying every optional part: note, plan, history badges and a set note. */
const STRENGTH = [
  '## [[Squat]]',
  '',
  '- [exercise:: [[Squat]]] [notes:: Belt on from set 2] [next:: up 2.5]',
  '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5] [notes:: Felt heavy]',
  '- [exercise:: [[Squat]]] [set:: 2] [weight:: 100] [reps:: 5]',
]

const STRENGTH_HISTORY = [
  {
    path: 'Fitness/Workouts/2026-06-01.md',
    mtime: 1,
    date: '2026-06-01',
    name: 'Leg day',
    exercises: [
      { exerciseName: 'Squat', kind: 'strength' as const, maxWeightSet: { weight: 100, reps: 5 } },
    ],
  },
]

/** A loaded row beside an unloaded one, so the card draws its load column. */
const BODYWEIGHT = [
  '## [[Push-up]]',
  '',
  '- [exercise:: [[Push-up]]] [set:: 1] [level:: 2] [reps:: 10] [load:: 10]',
  '- [exercise:: [[Push-up]]] [set:: 2] [level:: 3] [reps:: 8]',
]

const PUSH_UP_NOTE = {
  'Push-up': {
    type: 'exercise',
    kind: 'bodyweight',
    levels: ['Wall push-up', 'Incline push-up', 'Knee push-up'],
  },
}

const DURATION = [
  '## [[Plank]]',
  '',
  '- [exercise:: [[Plank]]] [set:: 1] [duration:: 90]',
  '- [exercise:: [[Plank]]] [set:: 2] [duration:: 45]',
]

const INTERVAL = [
  '## [[Exercise Bike]]',
  '',
  '- [exercise:: [[Exercise Bike]]] [plan:: 3 x 30s @ 300W, 90s rest]',
  '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 30] [watts:: 305] [rest:: 90]',
]
