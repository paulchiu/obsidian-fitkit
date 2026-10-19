import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', async () =>
  (await import('../../fixtures/obsidian-editor-mock')).createObsidianMock(),
)

import type { WorkoutEditorView } from '../../../src/ui/obsidian/workout-editor-view'
import {
  advance,
  blur,
  button,
  card,
  cellInput,
  choose,
  chooseMenuItem,
  deleteRow,
  firstRow,
  headLabels,
  noteBody,
  openedModal,
  openEditor,
  openRowMenu,
  rows,
  savedBody,
  settle,
  typeInto,
  useEditorEnvironment,
  WORKOUT_PATH,
  workoutNote,
} from '../../fixtures/workout-editor'
import { harnessDocument } from '../../harness/obsidian-dom'

useEditorEnvironment()

const OTHER_PATH = 'Fitness/Workouts/2026-06-16.md'

/** One exercise card logging `lines` (set fields after the exercise link). */
const exercise = (name: string, lines: string[]): string[] => [
  `## [[${name}]]`,
  '',
  ...lines.map((line) => `- [exercise:: [[${name}]]] ${line}`),
]

const SQUAT = exercise('Squat', ['[set:: 1] [weight:: 80] [reps:: 5]'])

const PLANK_30 = exercise('Plank', ['[set:: 1] [duration:: 30]'])

const text = (root: Element, cls: string): string | null =>
  root.querySelector(`.${cls}`)?.textContent ?? null

const runner = (root: Element): Element | null => root.querySelector('.fitkit-runner')

describe('WorkoutEditorView strength rows', () => {
  it('keeps strength rows to Set, Weight, and Reps without per-row rest controls', async () => {
    const { view } = await openEditor({ body: SQUAT })

    expect(headLabels(card(view))).toEqual(['', 'Weight', 'Reps'])
    expect(card(view).querySelector('.fitkit-rest-timer-button')).toBeNull()
    expect(card(view).querySelector('.fitkit-set-row-with-rest')).toBeNull()
  })

  it('inherits the previous weight when a set is added and focuses it, with no duplicate button', async () => {
    const { view, contents } = await openEditor({ body: SQUAT })
    const actions = [...(card(view).querySelector('.fitkit-row-actions')?.children ?? [])]

    button(card(view), 'Add set').click()

    expect(actions.map((action) => action.textContent)).not.toContain('Duplicate last set')
    expect(harnessDocument.activeElement).toBe(cellInput(rows(card(view))[1] as Element, 'Weight'))
    await savedBody(contents, [...SQUAT, '- [exercise:: [[Squat]]] [set:: 2] [weight:: 80]'])
  })

  it('shows the weight and reps the note logs', async () => {
    const { view } = await openEditor({
      body: exercise('Squat', ['[set:: 1] [weight:: 100] [reps:: 5]']),
    })

    expect([
      cellInput(firstRow(view), 'Weight')?.value,
      cellInput(firstRow(view), 'Reps')?.value,
    ]).toEqual(['100', '5'])
  })

  it('saves typed weight and reps into the note', async () => {
    const { view, contents } = await openEditor({ body: SQUAT })

    typeInto(cellInput(firstRow(view), 'Weight') as HTMLInputElement, '82.5')
    typeInto(cellInput(firstRow(view), 'Reps') as HTMLInputElement, '6')

    await savedBody(contents, exercise('Squat', ['[set:: 1] [weight:: 82.5] [reps:: 6]']))
  })

  it('keeps the row when deleting it is cancelled', async () => {
    const { view, contents } = await openEditor({ body: SQUAT })

    openRowMenu(firstRow(view))
    chooseMenuItem('Delete row')
    await choose('Remove row?', 'Cancel')
    await settle()

    expect(rows(card(view))).toHaveLength(1)
    expect(noteBody(contents)).toEqual(SQUAT)
  })

  it('saves a set note written in its note form, and shows it under the row', async () => {
    const { view, contents } = await openEditor({ body: SQUAT })

    openRowMenu(firstRow(view))
    chooseMenuItem('Edit note')
    const form = await openedModal('Note for set 1')
    const textarea = form.contentEl.querySelector('textarea')
    if (!textarea) throw new Error('no note box drawn')
    textarea.value = 'Belt on'
    button(form.contentEl, 'Save').click()

    await savedBody(
      contents,
      exercise('Squat', ['[set:: 1] [weight:: 80] [reps:: 5] [notes:: Belt on]']),
    )
    expect(text(firstRow(view), 'fitkit-note-line')).toBe('Belt on')
  })

  it('never starts the rest timer from reps entry, since rest is started by hand', async () => {
    const { view } = await openEditor({ body: exercise('Squat', ['[set:: 1] [weight:: 80]']) })
    const reps = cellInput(firstRow(view), 'Reps') as HTMLInputElement

    typeInto(reps, '5')
    blur(reps)

    expect(runner(view.contentEl)).toBeNull()
  })

  it('marks only the last strength row as the live row', async () => {
    const { view } = await openEditor({
      body: exercise('Squat', [
        '[set:: 1] [weight:: 80] [reps:: 5]',
        '[set:: 2] [weight:: 85] [reps:: 5]',
        '[set:: 3] [weight:: 90]',
      ]),
    })

    expect(rows(card(view)).map((row) => row.classList.contains('fitkit-row--live'))).toEqual([
      false,
      false,
      true,
    ])
  })
})

describe('WorkoutEditorView rest timer', () => {
  const footer = (view: WorkoutEditorView): Element => {
    const found = view.contentEl.querySelector('.fitkit-footer')
    if (!found) throw new Error('no footer drawn')
    return found
  }

  it('draws the footer rest button only when the rest timer is enabled', async () => {
    const enabled = await openEditor({ body: SQUAT })
    const disabled = await openEditor({
      body: SQUAT,
      settings: { strengthRestTimerEnabled: false },
    })

    const rest = button(footer(enabled.view), 'Start rest timer')
    expect(
      [...footer(enabled.view).children]
        .filter((child) => child.tagName === 'BUTTON')
        .map((child) => child.textContent),
    ).toEqual(['Add exercise'])
    expect(rest.getAttribute('data-icon')).toBe('timer')
    expect(text(rest, 'fitkit-rest-timer-label')).toBe('Start rest')
    expect(footer(disabled.view).querySelector('.fitkit-rest-timer-button')).toBeNull()
  })

  it('does not start the rest timer once the setting is turned off', async () => {
    const { view, plugin } = await openEditor({ body: SQUAT })
    const rest = button(footer(view), 'Start rest timer')

    plugin.settings.strengthRestTimerEnabled = false
    rest.click()

    expect(runner(view.contentEl)).toBeNull()
  })

  it('counts the rest from zero without touching the workout', async () => {
    const { view, contents } = await openEditor({ body: SQUAT })
    const note = contents.get(WORKOUT_PATH)

    button(footer(view), 'Start rest timer').click()
    await settle()

    expect(view.contentEl.querySelector('.fitkit-runner.is-rest')).not.toBeNull()
    expect(text(view.contentEl, 'fitkit-runner-clock')).toBe('0:00')
    expect(contents.get(WORKOUT_PATH)).toBe(note)
  })

  it('shows the stopped rest beside the footer button, without touching the workout', async () => {
    const { view, contents } = await openEditor({ body: SQUAT })
    const note = contents.get(WORKOUT_PATH)

    button(footer(view), 'Start rest timer').click()
    advance(12)
    button(view.contentEl, 'Stop rest timer').click()
    await settle()

    expect(runner(view.contentEl)).toBeNull()
    expect(text(footer(view), 'fitkit-rest-timer-label')).toBe('Start rest')
    expect(text(footer(view), 'fitkit-rest-timer-last')).toBe('Last rest 12s')
    expect(contents.get(WORKOUT_PATH)).toBe(note)
  })

  it('replaces the last rest with the next one when that rest stops', async () => {
    const { view } = await openEditor({ body: SQUAT })
    button(footer(view), 'Start rest timer').click()
    advance(9)
    button(view.contentEl, 'Stop rest timer').click()

    button(footer(view), 'Start rest timer').click()
    advance(3)
    button(view.contentEl, 'Stop rest timer').click()

    expect(text(footer(view), 'fitkit-rest-timer-last')).toBe('Last rest 3s')
  })

  /** Stop rest always writes a new last rest, so only a reload shows the start cleared it. */
  it('clears the last rest when another rest starts, even if a reload ends that rest', async () => {
    const { view } = await openEditor({ body: SQUAT })
    button(footer(view), 'Start rest timer').click()
    advance(9)
    button(view.contentEl, 'Stop rest timer').click()

    button(footer(view), 'Start rest timer').click()
    await view.reloadFromDisk()

    expect(footer(view).querySelector('.fitkit-rest-timer-last')).toBeNull()
  })

  it('clears the running and last rest when the setting is turned off', async () => {
    const { view, plugin } = await openEditor({ body: SQUAT })
    button(footer(view), 'Start rest timer').click()
    advance(5)
    button(view.contentEl, 'Stop rest timer').click()
    const before = text(footer(view), 'fitkit-rest-timer-last')

    plugin.settings.strengthRestTimerEnabled = false
    view.refreshSettingsDrivenUi()
    const offFooter = footer(view).querySelector('.fitkit-rest-timer-control')
    plugin.settings.strengthRestTimerEnabled = true
    view.refreshSettingsDrivenUi()
    const backOn = footer(view).querySelector('.fitkit-rest-timer-last')
    button(footer(view), 'Start rest timer').click()
    plugin.settings.strengthRestTimerEnabled = false
    view.refreshSettingsDrivenUi()

    expect(before).toBe('Last rest 5s')
    expect(offFooter).toBeNull()
    expect(backOn).toBeNull()
    expect(runner(view.contentEl)).toBeNull()
  })

  it('clears the last rest when another workout loads, and the running rest when the tab closes', async () => {
    const { view, contents } = await openEditor({
      body: SQUAT,
      workouts: { [OTHER_PATH]: workoutNote(SQUAT, '2026-06-16') },
    })
    const note = contents.get(WORKOUT_PATH)
    button(footer(view), 'Start rest timer').click()
    advance(4)
    button(view.contentEl, 'Stop rest timer').click()

    await view.setState({ file: OTHER_PATH }, { history: false })
    const afterLoad = footer(view).querySelector('.fitkit-rest-timer-last')
    button(footer(view), 'Start rest timer').click()
    await view.onClose()
    const afterClose = view.contentEl.childNodes.length
    await view.onOpen()
    await view.setState({ file: WORKOUT_PATH }, { history: false })

    expect(afterLoad).toBeNull()
    expect(afterClose).toBe(0)
    expect(footer(view).querySelector('.fitkit-rest-timer-last')).toBeNull()
    expect(contents.get(WORKOUT_PATH)).toBe(note)
  })

  it('keeps the last rest when the workout reloads from disk', async () => {
    const { view, contents } = await openEditor({ body: SQUAT })
    button(footer(view), 'Start rest timer').click()
    advance(12)
    button(view.contentEl, 'Stop rest timer').click()
    contents.set(
      WORKOUT_PATH,
      workoutNote(exercise('Squat', ['[set:: 1] [weight:: 90] [reps:: 3]'])),
    )

    await view.reloadFromDisk()

    expect(text(footer(view), 'fitkit-rest-timer-last')).toBe('Last rest 12s')
    expect(cellInput(firstRow(view), 'Weight')?.value).toBe('90')
  })

  it('ends a running rest when the workout reloads from disk', async () => {
    const { view } = await openEditor({ body: SQUAT })
    button(footer(view), 'Start rest timer').click()

    await view.reloadFromDisk()

    expect(runner(view.contentEl)).toBeNull()
  })

  /** The set screen covers the footer, so this reaches the button drawn before it opened. */
  it('saves a running set before a rest started from behind the set screen', async () => {
    const { view, contents } = await openEditor({ body: PLANK_30 })
    const rest = button(footer(view), 'Start rest timer')
    button(card(view), 'Start timer').click()
    advance(8)

    rest.click()

    expect(view.contentEl.querySelector('.fitkit-runner.is-rest')).not.toBeNull()
    await savedBody(contents, exercise('Plank', ['[set:: 1] [duration:: 38]']))
  })
})

describe('WorkoutEditorView duration rows', () => {
  it('draws Start timer after Add set and Repeat when no timer runs', async () => {
    const { view } = await openEditor({ body: PLANK_30 })

    const actions = [...(card(view).querySelector('.fitkit-row-actions')?.children ?? [])]

    expect(actions.map((action) => action.textContent)).toEqual([
      'Add set',
      'Repeat',
      'Start timer',
    ])
    expect(actions[2]?.getAttribute('data-icon')).toBe('play')
  })

  it('shows the duration set number as a figure rather than an editable field', async () => {
    const { view } = await openEditor({
      body: exercise('Plank', ['[duration:: 60]', '[set:: 7] [duration:: 30]']),
    })

    const figures = rows(card(view)).map((row) => row.querySelector('[data-label="Set"]'))

    expect(headLabels(card(view))).toEqual(['', 'Duration'])
    expect(figures.map((cell) => cell?.textContent)).toEqual(['1', '7'])
    expect(figures.map((cell) => cell?.children.length)).toEqual([0, 0])
  })

  it('renumbers duration rows from the row menu', async () => {
    const { view, contents } = await openEditor({
      body: exercise('Plank', ['[set:: 4] [duration:: 60]', '[set:: 9] [duration:: 30]']),
    })

    openRowMenu(firstRow(view))
    chooseMenuItem('Renumber sets')

    await savedBody(
      contents,
      exercise('Plank', ['[set:: 1] [duration:: 60]', '[set:: 2] [duration:: 30]']),
    )
  })

  it('draws stored seconds in one formatted duration text input', async () => {
    const { view } = await openEditor({ body: exercise('Plank', ['[set:: 1] [duration:: 90]']) })

    const input = card(view).querySelector<HTMLInputElement>(
      '[data-label="Duration"] .fitkit-duration-input',
    )

    expect({
      label: input?.getAttribute('aria-label'),
      type: input?.getAttribute('type'),
      placeholder: input?.getAttribute('placeholder'),
      focus: input?.getAttribute('data-fitkit-default-focus'),
      value: input?.value,
    }).toEqual({
      label: 'Duration',
      type: 'text',
      placeholder: '0s',
      focus: 'true',
      value: '1m30s',
    })
  })

  it.each([
    { typed: '5:30', seconds: 330, shown: '5m30s' },
    { typed: '5m', seconds: 300, shown: '5m' },
  ])(
    'saves "$typed" as $seconds seconds and shows it as "$shown" on blur',
    async ({ typed, seconds, shown }) => {
      const { view, contents } = await openEditor({
        body: exercise('Plank', ['[set:: 1] [duration:: 0]']),
      })
      const input = cellInput(firstRow(view), 'Duration') as HTMLInputElement

      typeInto(input, typed)
      await savedBody(contents, exercise('Plank', [`[set:: 1] [duration:: ${seconds}]`]))
      const invalid = input.hasAttribute('aria-invalid')
      blur(input)

      expect(invalid).toBe(false)
      expect(input.value).toBe(shown)
    },
  )

  it.each(['1.', '90'])(
    'leaves "%s" as typed in the duration input once the autosave completes',
    async (typed) => {
      const { view } = await openEditor({
        body: exercise('Plank', ['[set:: 1] [duration:: 0]']),
      })
      const input = cellInput(firstRow(view), 'Duration') as HTMLInputElement

      typeInto(input, typed)
      await settle()

      expect([input.value, cellInput(firstRow(view), 'Duration')]).toEqual([typed, input])
    },
  )

  it('keeps the stored seconds while the duration text is invalid', async () => {
    const { view, contents } = await openEditor({
      body: exercise('Plank', ['[set:: 1] [duration:: 90]']),
    })
    const note = contents.get(WORKOUT_PATH)
    const input = cellInput(firstRow(view), 'Duration') as HTMLInputElement

    typeInto(input, 'soon')
    await settle()
    const invalid = input.getAttribute('aria-invalid')
    blur(input)

    expect(invalid).toBe('true')
    expect(contents.get(WORKOUT_PATH)).toBe(note)
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    expect(input.value).toBe('1m30s')
  })

  it('leaves focus alone when a duration set is added, since the timer fills it', async () => {
    const { view } = await openEditor({ body: exercise('Plank', ['[set:: 1] [duration:: 60]']) })

    button(card(view), 'Add set').click()

    expect(rows(card(view))).toHaveLength(2)
    expect(harnessDocument.activeElement).toBe(harnessDocument.body)
  })
})

describe('WorkoutEditorView duration timer', () => {
  it('adds a row to time when the card has none', async () => {
    const { view, contents } = await openEditor({ body: PLANK_30 })
    await deleteRow(firstRow(view))

    button(card(view), 'Start timer').click()

    expect(text(view.contentEl, 'fitkit-runner-phase')).toBe('Set 1')
    await savedBody(
      contents,
      exercise('Plank', ['[duration:: 0] [started:: 2026-06-15T07:15:00+10:00]']),
    )
  })

  it('counts on from the duration the set already has', async () => {
    const { view } = await openEditor({ body: PLANK_30 })

    button(card(view), 'Start timer').click()
    const start = text(view.contentEl, 'fitkit-runner-clock')
    advance(5)

    expect([start, text(view.contentEl, 'fitkit-runner-clock')]).toEqual(['0:30', '0:35'])
  })

  it('saves the duration plus the time timed when it stops', async () => {
    const { view, contents } = await openEditor({ body: PLANK_30 })

    button(card(view), 'Start timer').click()
    advance(12)
    button(view.contentEl, 'Stop timer').click()

    await savedBody(contents, exercise('Plank', ['[set:: 1] [duration:: 42]']))
  })

  it.each([
    {
      leaving: 'switching to another workout',
      leave: (view: WorkoutEditorView) => view.setState({ file: OTHER_PATH }, { history: false }),
    },
    { leaving: 'closing the tab', leave: (view: WorkoutEditorView) => view.onClose() },
  ])('saves the time timed on $leaving', async ({ leave }) => {
    const { view, contents } = await openEditor({
      body: PLANK_30,
      workouts: { [OTHER_PATH]: workoutNote(SQUAT, '2026-06-16') },
    })
    button(card(view), 'Start timer').click()
    advance(12)

    await leave(view)

    await savedBody(contents, exercise('Plank', ['[set:: 1] [duration:: 42]']))
  })

  /** The set screen covers the card, so these reach the controls drawn before it opened. */
  describe('from behind the set screen', () => {
    it('saves the timed set, then appends one, when Add set fires', async () => {
      const { view, contents } = await openEditor({
        body: exercise('Plank', ['[set:: 1] [duration:: 0]']),
      })
      const addSet = button(card(view), 'Add set')
      button(card(view), 'Start timer').click()
      advance(8)

      addSet.click()

      await savedBody(contents, exercise('Plank', ['[set:: 1] [duration:: 8]', '[duration:: 0]']))
    })

    it('saves the timed set, then copies its duration, when Repeat fires', async () => {
      const { view, contents } = await openEditor({
        body: exercise('Plank', ['[set:: 1] [duration:: 0]']),
      })
      const repeat = button(card(view), 'Repeat')
      button(card(view), 'Start timer').click()
      advance(8)

      repeat.click()

      await savedBody(
        contents,
        exercise('Plank', ['[set:: 1] [duration:: 8]', '[set:: 2] [duration:: 8]']),
      )
    })

    it('stops the timer without saving it when its row is deleted', async () => {
      const { view, contents } = await openEditor({ body: PLANK_30 })
      const row = firstRow(view)
      button(card(view), 'Start timer').click()
      advance(5)

      await deleteRow(row)

      expect(button(view.contentEl, 'Resume timer')).toBeDefined()
      await savedBody(contents, ['## [[Plank]]', ''])
    })
  })
})

describe('WorkoutEditorView repeat set', () => {
  const repeat = (view: WorkoutEditorView): HTMLButtonElement => button(card(view), 'Repeat')

  it.each([
    {
      kind: 'strength',
      body: exercise('Squat', ['[set:: 1] [weight:: 60] [reps:: 8]']),
      empty: false,
    },
    {
      kind: 'bodyweight',
      body: exercise('Push-up', ['[set:: 1] [level:: 1] [reps:: 8]']),
      empty: false,
    },
    {
      kind: 'strength',
      body: exercise('Squat', ['[set:: 1] [weight:: 60] [reps:: 8]']),
      empty: true,
    },
    {
      kind: 'bodyweight',
      body: exercise('Push-up', ['[set:: 1] [level:: 1] [reps:: 8]']),
      empty: true,
    },
  ])(
    'places Repeat right after Add set on a $kind card (emptied: $empty)',
    async ({ body, empty }) => {
      const { view } = await openEditor({ body })
      if (empty) {
        await deleteRow(firstRow(view))
      }

      const actions = [...(card(view).querySelector('.fitkit-row-actions')?.children ?? [])]

      expect(actions.map((action) => action.textContent)).toEqual(['Add set', 'Repeat'])
    },
  )

  it('appends a strength set with the last weight and reps, leaving its note behind', async () => {
    const body = exercise('Squat', [
      '[set:: 1] [weight:: 60] [reps:: 8]',
      '[set:: 2] [weight:: 80] [reps:: 5] [notes:: grindy]',
    ])
    const { view, contents } = await openEditor({ body })

    repeat(view).click()

    await savedBody(contents, [
      ...body,
      '- [exercise:: [[Squat]]] [set:: 3] [weight:: 80] [reps:: 5]',
    ])
  })

  it('appends a bodyweight set with the last level, reps and load', async () => {
    const body = exercise('Push-up', [
      '[set:: 1] [level:: 2] [reps:: 12]',
      '[set:: 2] [level:: 3] [reps:: 8] [load:: 10] [notes:: last one]',
    ])
    const { view, contents } = await openEditor({ body })

    repeat(view).click()

    await savedBody(contents, [
      ...body,
      '- [exercise:: [[Push-up]]] [set:: 3] [level:: 3] [reps:: 8] [load:: 10]',
    ])
  })

  /** The first stamped row opens its timer on load; Done closes it, leaving the last row's stamp. */
  it('appends a duration entry with the last duration, leaving its start stamp and note behind', async () => {
    const { view, contents } = await openEditor({
      body: exercise('Plank', [
        '[set:: 1] [duration:: 30] [started:: 2026-06-15T07:15:00+10:00]',
        '[set:: 2] [duration:: 45] [started:: 2026-06-15T07:00:00+10:00] [notes:: shaky]',
      ]),
    })
    button(view.contentEl, 'Close timer').click()

    repeat(view).click()

    await vi.waitFor(() =>
      expect(noteBody(contents).at(-1)).toBe('- [exercise:: [[Plank]]] [set:: 3] [duration:: 45]'),
    )
  })

  it.each([
    {
      button: 'Add set',
      name: 'Squat',
      lines: ['[set:: 1] [weight:: 10]', '[set:: 3] [weight:: 10]'],
    },
    {
      button: 'Repeat',
      name: 'Squat',
      lines: ['[set:: 1] [weight:: 10]', '[set:: 3] [weight:: 10]'],
    },
    {
      button: 'Add set',
      name: 'Push-up',
      lines: ['[set:: 1] [level:: 1]', '[set:: 3] [level:: 1]'],
    },
    {
      button: 'Repeat',
      name: 'Push-up',
      lines: ['[set:: 1] [level:: 1]', '[set:: 3] [level:: 1]'],
    },
    {
      button: 'Repeat',
      name: 'Plank',
      lines: ['[set:: 1] [duration:: 10]', '[set:: 3] [duration:: 10]'],
    },
  ])(
    'numbers a set made by $button on $name after the highest, so a deleted set is not reused',
    async ({ button: label, name, lines }) => {
      const { view } = await openEditor({ body: exercise(name, lines) })

      button(card(view), label).click()

      expect(
        rows(card(view)).map((row) => row.querySelector('[data-label="Set"]')?.textContent),
      ).toEqual(['1', '3', '4'])
    },
  )

  it.each([
    { kind: 'strength', body: exercise('Squat', ['[set:: 1] [weight:: 10]']) },
    { kind: 'bodyweight', body: exercise('Push-up', ['[set:: 1] [level:: 1]']) },
    { kind: 'duration', body: PLANK_30 },
  ])(
    'disables Repeat on an emptied $kind card, and enables it while a set exists',
    async ({ body }) => {
      const { view } = await openEditor({ body })
      const withSet = repeat(view).disabled

      await deleteRow(firstRow(view))

      expect([withSet, repeat(view).disabled]).toEqual([false, true])
    },
  )
})
