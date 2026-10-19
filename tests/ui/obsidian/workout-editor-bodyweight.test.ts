import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', async () =>
  (await import('../../fixtures/obsidian-editor-mock')).createObsidianMock(),
)

import type { ExerciseRegistryEntry } from '../../../src/domain/exercise-registry'
import { obsidianRecord } from '../../fixtures/obsidian-editor-mock'
import type { WorkoutEditorView } from '../../../src/ui/obsidian/workout-editor-view'
import {
  button,
  card,
  cellInput,
  choose,
  chooseMenuItem,
  deleteRow,
  headLabels,
  lastMenu,
  menuTitles,
  modalTitles,
  noteBody,
  openCardMenu,
  openedModal,
  openEditor,
  openRowMenu,
  renameCard,
  resize,
  rows,
  savedBody,
  settle,
  switchCardType,
  useEditorEnvironment,
  workoutNote,
  type EditorOptions,
} from '../../fixtures/workout-editor'
import { harnessDocument, harnessWindow } from '../../harness/obsidian-dom'
import { findUnstyledClasses } from '../../harness/stylesheet'

useEditorEnvironment()

const LADDER = ['Wall push-up', 'Incline push-up', 'Knee push-up']

const ladderEntry = (levels: string[]): ExerciseRegistryEntry => ({
  name: 'Push-up',
  kind: 'bodyweight',
  levels: [...levels],
  aliases: [],
})

/** A Push-up card logging `lines` (set fields after the exercise link), on a registry ladder. */
const pushUps = (lines: string[], levels: string[] | null = LADDER): EditorOptions => ({
  body: ['## [[Push-up]]', '', ...lines.map((line) => `- [exercise:: [[Push-up]]] ${line}`)],
  settings: levels ? { exerciseRegistry: [ladderEntry(levels)] } : {},
})

const levelLabel = (row: Element | undefined): HTMLButtonElement => {
  const found = row?.querySelector<HTMLButtonElement>('.fitkit-bodyweight-level-label')
  if (!found) {
    throw new Error('row has no level label')
  }
  return found
}

const levelText = (row: Element | undefined): string | null | undefined =>
  row?.querySelector('.fitkit-bodyweight-level-full')?.textContent

/** Saves `levels` through the card menu's Edit levels form. */
const editLevels = async (view: WorkoutEditorView, levels: string[]): Promise<void> => {
  openCardMenu(view)
  chooseMenuItem('Edit levels')
  const form = await openedModal('Edit levels for Push-up')
  const textarea = form.contentEl.querySelector('textarea')
  if (!textarea) {
    throw new Error('no levels box drawn')
  }
  textarea.value = levels.join('\n')
  button(form.contentEl, 'Save').click()
  await settle()
}

const LADDER_WARNING = 'Change what logged levels mean for Push-up?'

describe('WorkoutEditorView bodyweight card', () => {
  it('draws level and reps columns, rung names and the badges row', async () => {
    const { view } = await openEditor({
      ...pushUps(['[set:: 1] [level:: 3] [reps:: 10]', '[set:: 2] [level:: 2] [reps:: 12]']),
      history: [
        {
          path: 'Fitness/Workouts/2026-06-01.md',
          mtime: 1,
          date: '2026-06-01',
          name: 'Push day',
          exercises: [
            {
              exerciseName: 'Push-up',
              kind: 'bodyweight',
              maxBodyweightSet: { level: 3, reps: 10, load: 0 },
            },
          ],
        },
      ],
    })

    const pushUp = card(view)
    expect(pushUp.classList.contains('fitkit-bodyweight-card')).toBe(true)
    expect(
      [...pushUp.querySelectorAll('.fitkit-card-history .fitkit-card-badge')].map(
        (badge) => badge.textContent,
      ),
    ).toEqual(['PB Knee push-up x 10', 'last Knee push-up x 10'])
    expect(
      pushUp.querySelector('.fitkit-set-head')?.classList.contains('fitkit-bodyweight-row'),
    ).toBe(true)
    expect(headLabels(pushUp)).toEqual(['', 'Level', 'Reps', ''])
    expect(pushUp.querySelector('.fitkit-set-head .fitkit-bodyweight-head-spacer')).not.toBeNull()
    expect(rows(pushUp)).toHaveLength(2)
    expect(levelText(rows(pushUp)[0])).toBe('3 · Knee push-up')
    expect(cellInput(rows(pushUp)[0] as Element, 'Reps')?.value).toBe('10')
  })

  it('shows the load column only when a row on the card carries a load', async () => {
    const { view } = await openEditor(
      pushUps([
        '[set:: 1] [level:: 3] [reps:: 10] [load:: 20]',
        '[set:: 2] [level:: 3] [reps:: 8]',
      ]),
    )

    const pushUp = card(view)
    expect(headLabels(pushUp)).toEqual(['', 'Level', 'Reps', 'Load', ''])
    expect(
      rows(pushUp).map((row) => row.querySelector('.fitkit-bodyweight-row.has-load') !== null),
    ).toEqual([true, true])
    expect(rows(pushUp).map((row) => cellInput(row, 'Load')?.value)).toEqual(['20', undefined])
  })

  it('finds no unstyled class on bodyweight cards with and without a load column', async () => {
    const { view } = await openEditor({
      body: [
        '## [[Push-up]]',
        '',
        '- [exercise:: [[Push-up]]] [set:: 1] [level:: 1] [reps:: 10]',
        '',
        '## [[Weighted push-up]]',
        '',
        '- [exercise:: [[Weighted push-up]]] [set:: 1] [level:: 1] [reps:: 8] [load:: 10]',
      ],
    })

    expect(view.contentEl.querySelector('.fitkit-set-head:not(.has-load)')).not.toBeNull()
    expect(view.contentEl.querySelector('.fitkit-set-head.has-load')).not.toBeNull()
    expect(findUnstyledClasses(view.contentEl)).toEqual([])
  })

  it('disables the level stepper at the ends of the ladder without wrapping', async () => {
    const { view } = await openEditor(
      pushUps(['[set:: 1] [level:: 1] [reps:: 10]', '[set:: 2] [level:: 3] [reps:: 8]']),
    )

    const steps = (set: number): boolean[] =>
      [`Lower level for set ${set}`, `Raise level for set ${set}`].map(
        (label) => button(card(view), label).disabled,
      )
    expect([steps(1), steps(2)]).toEqual([
      [true, false],
      [false, true],
    ])
  })

  it.each([
    { ladder: 'a one-rung ladder', levels: ['Push-up'] },
    { ladder: 'an empty ladder', levels: [] },
  ])('disables both steps on $ladder', async ({ levels }) => {
    const { view } = await openEditor(pushUps(['[set:: 1] [level:: 1] [reps:: 10]'], levels))

    expect(button(card(view), 'Lower level for set 1').disabled).toBe(true)
    expect(button(card(view), 'Raise level for set 1').disabled).toBe(true)
  })

  it('ignores the raise step on an empty ladder', async () => {
    const { view, contents } = await openEditor(pushUps(['[set:: 1] [level:: 1] [reps:: 10]'], []))
    const before = card(view)
    const note = contents.get(view.file?.path ?? '')

    button(before, 'Raise level for set 1').dispatchEvent(new harnessWindow.MouseEvent('click'))
    await settle()

    expect(card(view)).toBe(before)
    expect(levelText(rows(before)[0])).toBe('1 · Level 1')
    expect(contents.get(view.file?.path ?? '')).toBe(note)
  })

  it.each([
    { step: 'Raise', level: 3, rung: 'Knee push-up' },
    { step: 'Lower', level: 1, rung: 'Wall push-up' },
  ])('saves the next rung when $step level is pressed', async ({ step, level, rung }) => {
    const { view, contents } = await openEditor(pushUps(['[set:: 1] [level:: 2] [reps:: 10]']))

    button(card(view), `${step} level for set 1`).click()

    expect(levelText(rows(card(view))[0])).toBe(`${level} · ${rung}`)
    await savedBody(contents, [
      '## [[Push-up]]',
      '',
      `- [exercise:: [[Push-up]]] [set:: 1] [level:: ${level}] [reps:: 10]`,
    ])
  })

  it('lists every rung in the level menu and sets only the chosen row', async () => {
    const { view, contents } = await openEditor(
      pushUps(['[set:: 1] [level:: 2] [reps:: 10]', '[set:: 2] [level:: 3] [reps:: 8]']),
    )

    levelLabel(rows(card(view))[0]).click()
    const menu = lastMenu()
    chooseMenuItem('1 · Wall push-up')

    expect(menuTitles(menu)).toEqual([
      '1 · Wall push-up',
      '2 · Incline push-up',
      '3 · Knee push-up',
    ])
    expect(menu.items.map((item) => item.checked)).toEqual([false, true, false])
    expect(rows(card(view)).map(levelText)).toEqual(['1 · Wall push-up', '3 · Knee push-up'])
    await savedBody(contents, [
      '## [[Push-up]]',
      '',
      '- [exercise:: [[Push-up]]] [set:: 1] [level:: 1] [reps:: 10]',
      '- [exercise:: [[Push-up]]] [set:: 2] [level:: 3] [reps:: 8]',
    ])
  })

  it('keeps a logged rung past a shrunken ladder selectable in the level menu', async () => {
    const { view } = await openEditor(pushUps(['[set:: 1] [level:: 5] [reps:: 8]']))

    levelLabel(rows(card(view))[0]).click()

    expect(menuTitles()).toEqual([
      '1 · Wall push-up',
      '2 · Incline push-up',
      '3 · Knee push-up',
      '4 · Level 4',
      '5 · Level 5',
    ])
    expect(lastMenu().items.map((item) => item.checked)).toEqual([false, false, false, false, true])
  })

  it('copies the previous row level when a set is added and focuses its reps', async () => {
    const { view, contents } = await openEditor(pushUps(['[set:: 1] [level:: 3] [reps:: 10]']))

    button(card(view), 'Add set').click()

    const added = rows(card(view))[1]
    expect(levelText(added)).toBe('3 · Knee push-up')
    expect(harnessDocument.activeElement).toBe(cellInput(added as Element, 'Reps'))
    await savedBody(contents, [
      '## [[Push-up]]',
      '',
      '- [exercise:: [[Push-up]]] [set:: 1] [level:: 3] [reps:: 10]',
      '- [exercise:: [[Push-up]]] [set:: 2] [level:: 3]',
    ])
  })

  it('starts the first row of an emptied card at level 1, focusing its reps', async () => {
    const { view, contents } = await openEditor(pushUps(['[set:: 1] [level:: 3] [reps:: 10]']))
    await deleteRow(rows(card(view))[0] as Element)

    button(card(view), 'Add set').click()

    const [first] = rows(card(view))
    expect(rows(card(view))).toHaveLength(1)
    expect(levelText(first)).toBe('1 · Wall push-up')
    expect(harnessDocument.activeElement).toBe(cellInput(first as Element, 'Reps'))
    await savedBody(contents, [
      '## [[Push-up]]',
      '',
      '- [exercise:: [[Push-up]]] [set:: 1] [level:: 1]',
    ])
  })

  it('adds and removes the load cell from the row kebab', async () => {
    const { view, contents } = await openEditor(
      pushUps([
        '[set:: 1] [level:: 3] [reps:: 10] [load:: 20]',
        '[set:: 2] [level:: 3] [reps:: 8]',
      ]),
    )

    openRowMenu(rows(card(view))[1] as Element)
    const unloadedMenu = menuTitles()
    chooseMenuItem('Add load')
    const carried = rows(card(view)).map((row) => cellInput(row, 'Load')?.value)
    openRowMenu(rows(card(view))[0] as Element)
    const loadedMenu = menuTitles()
    chooseMenuItem('Remove load')
    openRowMenu(rows(card(view))[0] as Element)
    chooseMenuItem('Add load')
    const firstRowLoad = cellInput(rows(card(view))[0] as Element, 'Load')?.value

    expect(unloadedMenu).toEqual(['Edit note', 'Add load', 'Renumber sets', 'Delete row'])
    expect(carried).toEqual(['20', '20'])
    expect(loadedMenu.filter((title) => title?.endsWith('load'))).toEqual(['Remove load'])
    expect(firstRowLoad).toBe('0')
    await savedBody(contents, [
      '## [[Push-up]]',
      '',
      '- [exercise:: [[Push-up]]] [set:: 1] [level:: 3] [reps:: 10] [load:: 0]',
      '- [exercise:: [[Push-up]]] [set:: 2] [level:: 3] [reps:: 8] [load:: 20]',
    ])

    for (const row of [0, 1]) {
      openRowMenu(rows(card(view))[row] as Element)
      chooseMenuItem('Remove load')
    }

    expect(headLabels(card(view))).not.toContain('Load')
  })
})

describe('WorkoutEditorView bodyweight level labels', () => {
  /** Widths the rung name's text slot and content report, since jsdom lays nothing out. */
  let widths = { available: 0, content: 0 }

  beforeEach(() => {
    const prototype = harnessWindow.HTMLElement.prototype
    /** A shortened label hides its full name, which then measures nothing. */
    const measured = (el: HTMLElement, key: 'available' | 'content'): number =>
      el.classList.contains('fitkit-bodyweight-level-full') &&
      !el.parentElement?.classList.contains('is-label-short')
        ? widths[key]
        : 0
    Object.defineProperty(prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return measured(this, 'available')
      },
    })
    Object.defineProperty(prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return measured(this, 'content')
      },
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(harnessWindow.HTMLElement.prototype, 'clientWidth')
    Reflect.deleteProperty(harnessWindow.HTMLElement.prototype, 'scrollWidth')
  })

  const OVERRUNS = { available: 50, content: 120 }
  const FITS = { available: 200, content: 120 }

  const shortened = (view: WorkoutEditorView): boolean[] =>
    rows(card(view)).map((row) => levelLabel(row).classList.contains('is-label-short'))

  const TWO_ROWS = pushUps([
    '[set:: 1] [level:: 1] [reps:: 10]',
    '[set:: 2] [level:: 3] [reps:: 8]',
  ])

  it('shortens a rung name whose text overruns its own slot', async () => {
    widths = OVERRUNS

    const { view } = await openEditor(TWO_ROWS)

    expect(shortened(view)).toEqual([true, true])
  })

  it('leaves a fitting rung name alone', async () => {
    widths = FITS

    const { view } = await openEditor(TWO_ROWS)

    expect(shortened(view)).toEqual([false, false])
  })

  it('keeps a shortened label short across a resize while its name still overruns', async () => {
    widths = OVERRUNS
    const { view } = await openEditor(TWO_ROWS)

    resize()

    expect(shortened(view)).toEqual([true, true])
  })

  it('refits every rung label after a resize', async () => {
    widths = FITS
    const { view } = await openEditor(TWO_ROWS)

    widths = OVERRUNS
    resize()

    expect(shortened(view)).toEqual([true, true])
  })

  it('restores the full rung name when a resize leaves room for it', async () => {
    widths = OVERRUNS
    const { view } = await openEditor(TWO_ROWS)

    widths = FITS
    resize()

    expect(shortened(view)).toEqual([false, false])
  })

  it('marks narrow content compact so the stepper shrinks, and clears it once wide again', async () => {
    const { view } = await openEditor(TWO_ROWS)
    const setWidth = (width: number): void => {
      Object.defineProperty(view.contentEl, 'clientWidth', { configurable: true, value: width })
      resize()
    }
    const marks = (): boolean[] =>
      ['is-compact', 'is-narrow'].map((cls) => view.contentEl.classList.contains(cls))

    setWidth(300)
    const narrow = marks()
    setWidth(800)

    expect(narrow).toEqual([true, true])
    expect(marks()).toEqual([false, false])
  })
})

describe('WorkoutEditorView ladder edits', () => {
  const PUSH_UP_NOTE_PATH = 'Fitness/Exercises/Push-up.md'

  const noteLadder = (levels: string[]): EditorOptions['exerciseNotes'] => ({
    'Push-up': { type: 'exercise', kind: 'bodyweight', levels },
  })

  it('writes the ladder into the exercise note and draws the card from it', async () => {
    const { view, contents } = await openEditor({
      ...pushUps(['[set:: 1] [level:: 1] [reps:: 8]'], null),
      exerciseNotes: noteLadder(['Wall push-up']),
    })
    const raiseBefore = button(card(view), 'Raise level for set 1').disabled

    await editLevels(view, ['Wall push-up', 'Knee push-up'])

    expect(contents.get(PUSH_UP_NOTE_PATH)).toContain('  - Knee push-up\n')
    expect(obsidianRecord.notices).toEqual(['Exercise note now records levels for Push-up.'])
    expect([raiseBefore, button(card(view), 'Raise level for set 1').disabled]).toEqual([
      true,
      false,
    ])
  })

  it('writes the ladder to the registry when no exercise note exists', async () => {
    const { view, plugin, saved, created } = await openEditor(
      pushUps(['[set:: 1] [level:: 1] [reps:: 8]'], null),
    )

    await editLevels(view, ['Wall push-up', 'Knee push-up'])
    await choose(LADDER_WARNING, 'Apply edit')
    await settle()

    expect(created).toEqual([])
    expect(plugin.settings.exerciseRegistry).toMatchObject([
      { name: 'Push-up', kind: 'bodyweight', levels: ['Wall push-up', 'Knee push-up'] },
    ])
    expect(saved.at(-1)?.exerciseRegistry).toEqual(plugin.settings.exerciseRegistry)
    expect(obsidianRecord.notices).toEqual(['Registry now records levels for Push-up.'])
    expect(levelText(rows(card(view))[0])).toBe('1 · Wall push-up')
  })

  it('draws the ladder it just wrote while the cache still reports the old one', async () => {
    const { view, contents } = await openEditor({
      ...pushUps(['[set:: 1] [level:: 1] [reps:: 8]'], null),
      exerciseNotes: noteLadder(['Wall push-up']),
    })

    await editLevels(view, ['Incline push-up', 'Knee push-up'])
    await choose(LADDER_WARNING, 'Apply edit')
    await settle()

    expect(contents.get(PUSH_UP_NOTE_PATH)).toContain('  - Incline push-up\n')
    expect(levelText(rows(card(view))[0])).toBe('1 · Incline push-up')
  })

  it('applies an appended rung without warning', async () => {
    const { view, plugin } = await openEditor(
      pushUps(['[set:: 1] [level:: 1]', '[set:: 2] [level:: 2]'], ['Wall push-up', 'Knee push-up']),
    )

    await editLevels(view, ['Wall push-up', 'Knee push-up', 'Full push-up'])

    expect(modalTitles()).not.toContain(LADDER_WARNING)
    expect(plugin.settings.exerciseRegistry).toMatchObject([
      { name: 'Push-up', levels: ['Wall push-up', 'Knee push-up', 'Full push-up'] },
    ])
    expect(obsidianRecord.notices).toEqual(['Registry now records levels for Push-up.'])
  })

  it('lists the appended rung in the level menu while the cache still reports the old ladder', async () => {
    const { view } = await openEditor({
      ...pushUps(['[set:: 1] [level:: 1]'], null),
      exerciseNotes: noteLadder(['Wall push-up', 'Knee push-up']),
    })

    await editLevels(view, ['Wall push-up', 'Knee push-up', 'Full push-up'])
    levelLabel(rows(card(view))[0]).click()

    expect(modalTitles()).not.toContain(LADDER_WARNING)
    expect(menuTitles()).toEqual(['1 · Wall push-up', '2 · Knee push-up', '3 · Full push-up'])
  })

  it('warns before renaming an occupied rung and applies it on confirm', async () => {
    const { view, plugin } = await openEditor(
      pushUps(['[set:: 1] [level:: 2]'], ['Wall push-up', 'Knee push-up']),
    )

    await editLevels(view, ['Wall push-up', 'Full push-up'])
    const warning = (await openedModal(LADDER_WARNING)).contentEl.textContent
    await choose(LADDER_WARNING, 'Apply edit')
    await settle()

    expect(warning).toContain(
      "Level 2 currently means 'Knee push-up' and would come to mean 'Full push-up'.",
    )
    expect(plugin.settings.exerciseRegistry).toMatchObject([
      { name: 'Push-up', levels: ['Wall push-up', 'Full push-up'] },
    ])
    expect(obsidianRecord.notices).toEqual(['Registry now records levels for Push-up.'])
  })

  it('leaves the ladder untouched when the warning is declined', async () => {
    const { view, plugin, saved, contents } = await openEditor(
      pushUps(['[set:: 1] [level:: 2]'], ['Wall push-up', 'Knee push-up']),
    )
    const before = new Map(contents)

    await editLevels(view, ['Wall push-up', 'Full push-up'])
    await choose(LADDER_WARNING, 'Cancel')
    await settle()

    expect(plugin.settings.exerciseRegistry).toMatchObject([
      { name: 'Push-up', levels: ['Wall push-up', 'Knee push-up'] },
    ])
    expect(saved).toEqual([])
    expect(contents).toEqual(before)
    expect(obsidianRecord.notices).toEqual([])
  })

  it('treats levels logged in saved workout notes as occupied', async () => {
    const { view, plugin } = await openEditor({
      ...pushUps(['[set:: 1] [level:: 1]'], ['Wall push-up', 'Knee push-up']),
      workouts: {
        'Fitness/Workouts/2026-06-01.md': workoutNote(
          ['## [[Push-up]]', '', '- [exercise:: [[Push-up]]] [level:: 2] [reps:: 8]'],
          '2026-06-01',
        ),
      },
    })

    await editLevels(view, ['Wall push-up', 'Full push-up'])
    await choose(LADDER_WARNING, 'Apply edit')
    await settle()

    expect(plugin.settings.exerciseRegistry).toMatchObject([
      { name: 'Push-up', levels: ['Wall push-up', 'Full push-up'] },
    ])
  })
})

describe('WorkoutEditorView switch to bodyweight', () => {
  const RELABEL = 'Mark logged sets as level 1?'
  const CHOICE = 'Switch Push-up to bodyweight?'

  /** A strength Push-up card logging `lines` (set fields after the exercise link). */
  const strengthPushUps = (lines: string[]): string[] => [
    '## [[Push-up]]',
    '',
    ...lines.map((line) => `- [exercise:: [[Push-up]]] ${line}`),
  ]

  const THREE_SETS = strengthPushUps([
    '[set:: 1] [weight:: 10] [reps:: 8]',
    '[set:: 2] [weight:: 10] [reps:: 6]',
    '[set:: 3] [reps:: 5]',
  ])

  const relabelMessage = async (): Promise<string> =>
    (await openedModal(RELABEL)).contentEl.querySelector('p')?.textContent ?? ''

  it('seeds a single rung named after the exercise when no ladder exists', async () => {
    const { view, plugin, saved } = await openEditor({ body: THREE_SETS })

    switchCardType(view, 'bodyweight')
    await choose(CHOICE, 'Update registry too')
    await choose(RELABEL, 'Cancel')
    await settle()

    expect(plugin.settings.exerciseRegistry).toMatchObject([
      { name: 'Push-up', kind: 'bodyweight', levels: ['Push-up'] },
    ])
    expect(saved.at(-1)?.exerciseRegistry).toEqual(plugin.settings.exerciseRegistry)
    expect(levelText(rows(card(view))[0])).toBe('1 · Push-up')
  })

  it('leaves an existing ladder alone when seeding', async () => {
    const { view, plugin } = await openEditor({
      body: THREE_SETS,
      settings: {
        exerciseRegistry: [
          { name: 'Push-up', kind: 'strength', levels: ['Wall push-up'], aliases: [] },
        ],
      },
    })

    switchCardType(view, 'bodyweight')
    await choose(CHOICE, 'Update registry too')
    await choose(RELABEL, 'Cancel')
    await settle()

    expect(plugin.settings.exerciseRegistry).toMatchObject([
      { name: 'Push-up', kind: 'bodyweight', levels: ['Wall push-up'] },
    ])
    expect(obsidianRecord.notices.join('\n')).not.toContain('records levels')
  })

  it('states the real set count and marks the rows as level 1 on confirm', async () => {
    const { view, contents } = await openEditor({ body: THREE_SETS })

    switchCardType(view, 'bodyweight')
    await choose(CHOICE, 'Just this workout')
    const message = await relabelMessage()
    await choose(RELABEL, 'Mark as level 1')

    expect(message).toContain('3 already-logged sets')
    await savedBody(contents, [
      '## [[Push-up]]',
      '',
      '- [exercise:: [[Push-up]]] [set:: 1] [level:: 1] [reps:: 8] [load:: 10]',
      '- [exercise:: [[Push-up]]] [set:: 2] [level:: 1] [reps:: 6] [load:: 10]',
      '- [exercise:: [[Push-up]]] [set:: 3] [level:: 1] [reps:: 5]',
    ])
  })

  it('leaves the cleared card as the switch left it when declined', async () => {
    const { view, contents } = await openEditor({ body: THREE_SETS })

    switchCardType(view, 'bodyweight')
    await choose(CHOICE, 'Just this workout')
    await choose(RELABEL, 'Cancel')
    await settle()

    expect(rows(card(view))).toHaveLength(1)
    expect(cellInput(rows(card(view))[0] as Element, 'Reps')?.value).toBe('')
    expect(noteBody(contents)).toEqual(strengthPushUps(['[set:: 1] [level:: 1]']))
  })

  it('states a single set in the singular', async () => {
    const { view } = await openEditor({
      body: strengthPushUps(['[set:: 1] [weight:: 10] [reps:: 8]']),
    })

    switchCardType(view, 'bodyweight')
    await choose(CHOICE, 'Just this workout')
    const message = await relabelMessage()

    expect(message).toContain('1 already-logged set')
    expect(message).not.toContain('already-logged sets')
  })

  it('stays silent when there is nothing to mark', async () => {
    const { view } = await openEditor({
      body: ['## [[Push-up]]', '', '- [exercise:: [[Push-up]]]'],
    })

    switchCardType(view, 'bodyweight')
    await choose(CHOICE, 'Just this workout')
    await settle()

    expect(modalTitles()).not.toContain(RELABEL)
    expect(rows(card(view)).map(levelText)).toEqual(['1 · Level 1'])
  })

  it('switches end to end: clears rows, seeds a ladder, then offers the real count', async () => {
    const { view, plugin, contents } = await openEditor({
      body: strengthPushUps(['[set:: 1] [weight:: 10] [reps:: 8]', '[set:: 2] [reps:: 5]']),
    })

    switchCardType(view, 'bodyweight')
    await choose(CHOICE, 'Update registry too')
    const message = await relabelMessage()
    await choose(RELABEL, 'Mark as level 1')

    expect(message).toContain('2 already-logged sets')
    await savedBody(contents, [
      '## [[Push-up]]',
      '',
      '- [exercise:: [[Push-up]]] [set:: 1] [level:: 1] [reps:: 8] [load:: 10]',
      '- [exercise:: [[Push-up]]] [set:: 2] [level:: 1] [reps:: 5]',
    ])
    expect(plugin.settings.exerciseRegistry).toMatchObject([
      { name: 'Push-up', kind: 'bodyweight', levels: ['Push-up'] },
    ])
  })

  it('shows the seeded rung name on the card straight after the switch', async () => {
    const { view, contents } = await openEditor({
      body: strengthPushUps(['[set:: 1] [weight:: 10] [reps:: 8]']),
      exerciseNotes: { 'Push-up': { type: 'exercise', kind: 'strength' } },
    })

    switchCardType(view, 'bodyweight')
    await choose(CHOICE, 'Update registry too')
    await choose(RELABEL, 'Cancel')
    await settle()

    expect(contents.get('Fitness/Exercises/Push-up.md')).toContain('levels:\n  - Push-up\n')
    expect(levelText(rows(card(view))[0])).toBe('1 · Push-up')
  })

  it('writes no ladder anywhere on the workout-only choice', async () => {
    const { view, plugin, saved, contents } = await openEditor({
      body: strengthPushUps(['[set:: 1] [weight:: 10] [reps:: 8]']),
      exerciseNotes: { 'Push-up': { type: 'exercise', kind: 'strength' } },
    })
    const note = contents.get('Fitness/Exercises/Push-up.md')

    switchCardType(view, 'bodyweight')
    await choose(CHOICE, 'Just this workout')
    await choose(RELABEL, 'Cancel')
    await settle()

    expect(card(view).classList.contains('fitkit-bodyweight-card')).toBe(true)
    expect(contents.get('Fitness/Exercises/Push-up.md')).toBe(note)
    expect(plugin.settings.exerciseRegistry).toEqual([])
    expect(saved).toEqual([])
    expect(obsidianRecord.notices.join('\n')).not.toContain('records levels')
  })

  it('offers the relabel but seeds no ladder when renaming onto a bodyweight exercise', async () => {
    const registry = [{ name: 'Push-up', kind: 'bodyweight' as const, aliases: [] }]
    const { view, plugin, saved, contents } = await openEditor({
      body: ['## [[Squat]]', '', '- [exercise:: [[Squat]]] [set:: 1] [weight:: 10] [reps:: 8]'],
      settings: { exerciseRegistry: registry },
    })

    await renameCard(view, 'Push-up')
    await choose('Switch exercise type?', 'Switch and discard')
    const message = await relabelMessage()
    await choose(RELABEL, 'Mark as level 1')

    expect(message).toContain('1 already-logged set')
    await savedBody(contents, [
      '## [[Push-up]]',
      '',
      '- [exercise:: [[Push-up]]] [set:: 1] [level:: 1] [reps:: 8] [load:: 10]',
    ])
    expect(plugin.settings.exerciseRegistry).toEqual(registry)
    expect(saved).toEqual([])
  })
})
