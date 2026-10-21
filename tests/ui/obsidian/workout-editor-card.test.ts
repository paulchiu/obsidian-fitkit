import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', async () =>
  (await import('../../fixtures/obsidian-editor-mock')).createObsidianMock(),
)

import type { IndexEntry } from '../../../src/domain/types'
import type { WorkoutEditorView } from '../../../src/ui/obsidian/workout-editor-view'
import { obsidianRecord, type MockMenuPosition } from '../../fixtures/obsidian-editor-mock'
import {
  button,
  card,
  cellInput,
  choose,
  chooseMenuItem,
  firstRow,
  lastMenu,
  menuItem,
  menuTitles,
  modalTitles,
  noteBody,
  openCardMenu,
  openEditor,
  openRowMenu,
  pickerModal,
  pressKey,
  rows,
  savedBody,
  settle,
  typeInto,
  useEditorEnvironment,
  WORKOUT_PATH,
  workoutNote,
} from '../../fixtures/workout-editor'
import { harnessWindow } from '../../harness/obsidian-dom'

useEditorEnvironment()

const SQUAT = ['## [[Squat]]', '', '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]']

/** A prior session of one exercise, as the plugin index records it. */
const session = (date: string, row: IndexEntry['exercises'][number]): IndexEntry => ({
  path: `Fitness/Workouts/${date}.md`,
  mtime: 1,
  date,
  name: 'Leg day',
  exercises: [row],
})

describe('WorkoutEditorView card chrome', () => {
  it('draws the row kebab on mobile and opens the row menu from it', async () => {
    obsidianRecord.platform.isMobile = true
    const { view } = await openEditor({ body: SQUAT })

    const kebab = button(card(view), 'Options for set 1')
    kebab.click()

    expect(kebab.getAttribute('data-icon')).toBe('more-vertical')
    expect(view.contentEl.querySelector('.fitkit-row-track, .fitkit-row-reveal')).toBeNull()
    expect(lastMenu().items).toMatchObject([
      { title: 'Edit note', icon: 'pencil' },
      { title: 'Renumber sets', icon: 'list-ordered' },
      { title: 'Delete row', icon: 'trash-2', warning: true },
    ])
    expect(menuTitles()).not.toContain('Open exercise file')
  })

  it('installs no swipe on mobile, so dragging a row body reveals nothing', async () => {
    obsidianRecord.platform.isMobile = true
    const { view, contents } = await openEditor({ body: SQUAT })
    const before = card(view)
    const body = before.querySelector('.fitkit-row-body')
    if (!body) throw new Error('no row body drawn')
    const pointer = (type: string, clientX: number): Event =>
      new harnessWindow.MouseEvent(type, { clientX, clientY: 20, bubbles: true })

    body.dispatchEvent(pointer('pointerdown', 240))
    body.dispatchEvent(pointer('pointermove', 160))
    body.dispatchEvent(pointer('pointermove', 60))
    body.dispatchEvent(pointer('pointerup', 60))
    await settle()

    expect(card(view)).toBe(before)
    expect(before.querySelector('.fitkit-row-track, .fitkit-row-reveal')).toBeNull()
    expect(body.getAttribute('style')).toBeNull()
    expect(obsidianRecord.menus).toEqual([])
    expect(noteBody(contents)).toEqual(SQUAT)
  })

  it('lists the card actions, leaving opening the file to the name and moving to the drag handle', async () => {
    const { view } = await openEditor({ body: SQUAT })

    openCardMenu(view)

    expect(menuTitles()).toEqual([
      'Rename exercise',
      'Add exercise note',
      'Plan: increase',
      'Plan: keep',
      'Plan: decrease',
      'Set plan step...',
      'Change type...',
      'Remove exercise',
    ])
  })

  it.each([
    { type: 'strength', body: SQUAT },
    {
      type: 'duration',
      body: ['## [[Plank]]', '', '- [exercise:: [[Plank]]] [set:: 1] [duration:: 60]'],
    },
    {
      type: 'interval',
      body: ['## [[Bike]]', '', '- [exercise:: [[Bike]]] [plan:: 3 x 30s @ 300W, 90s rest]'],
    },
    {
      type: 'bodyweight',
      body: ['## [[Push-up]]', '', '- [exercise:: [[Push-up]]] [set:: 1] [level:: 1] [reps:: 8]'],
    },
  ])(
    'offers every type but $type behind Change type..., where the card menu was',
    async ({ type, body }) => {
      const { view } = await openEditor({ body })
      const cardMenu = openCardMenu(view)

      chooseMenuItem('Change type...')

      const expected = ['strength', 'duration', 'interval', 'bodyweight']
        .filter((other) => other !== type)
        .map((other) => `Switch to ${other}`)
      const typeMenu = lastMenu()
      expect(typeMenu).not.toBe(cardMenu)
      expect({
        titles: menuTitles(typeMenu),
        icons: typeMenu.items.map((item) => item.icon),
        position: typeMenu.position,
      }).toEqual({
        titles: expected,
        icons: expected.map(() => 'repeat'),
        position: cardMenu.position,
      })
    },
  )

  it('draws the exercise name as an open-file link, with rename left to the card menu', async () => {
    const { view } = await openEditor({ body: SQUAT })

    const nameButton = button(card(view), 'Open exercise file for Squat')

    expect(nameButton.querySelector('.fitkit-name-button-text')?.textContent).toBe('Squat')
    expect(nameButton.querySelector('.fitkit-name-button-icon')?.getAttribute('data-icon')).toBe(
      'arrow-up-right',
    )
    expect(card(view).querySelector('.fitkit-rename-button')).toBeNull()
    expect(card(view).querySelector('.fitkit-card-top')?.children).toHaveLength(3)
  })

  it('removes the exercise from the card menu once the removal is confirmed', async () => {
    const { view, contents } = await openEditor({
      body: [
        ...SQUAT,
        '',
        '## [[Plank]]',
        '',
        '- [exercise:: [[Plank]]] [set:: 1] [duration:: 60]',
      ],
    })

    openCardMenu(view)
    chooseMenuItem('Remove exercise')
    await choose('Remove exercise?', 'Remove')

    expect(view.contentEl.querySelectorAll('.fitkit-exercise-list > .fitkit-card')).toHaveLength(1)
    await savedBody(contents, [
      '## [[Plank]]',
      '',
      '- [exercise:: [[Plank]]] [set:: 1] [duration:: 60]',
    ])
  })

  it('reloads the note from disk from the conflict banner', async () => {
    const { view, contents } = await openEditor({ body: SQUAT })
    const deadlift = [
      '## [[Deadlift]]',
      '',
      '- [exercise:: [[Deadlift]]] [set:: 1] [weight:: 140] [reps:: 3]',
    ]
    contents.set(WORKOUT_PATH, workoutNote(deadlift))
    typeInto(cellInput(firstRow(view), 'Reps') as HTMLInputElement, '7')
    await vi.waitFor(() => expect(view.contentEl.querySelector('.fitkit-conflict')).not.toBeNull())

    button(view.contentEl, 'Reload from disk').click()

    await vi.waitFor(() => expect(view.contentEl.querySelector('.fitkit-conflict')).toBeNull())
    expect(card(view).querySelector('.fitkit-name-button-text')?.textContent).toBe('Deadlift')
    expect(obsidianRecord.notices).toContain('Reloaded from disk.')
    expect(noteBody(contents)).toEqual(deadlift)
  })

  it('renames the exercise through the card menu, starting from its current name', async () => {
    const { view, contents } = await openEditor({ body: SQUAT })
    openCardMenu(view)
    expect(menuItem('Rename exercise').icon).toBe('pencil')

    chooseMenuItem('Rename exercise')
    const picker = await pickerModal()
    const prefilled = picker.inputEl.value
    picker.inputEl.value = 'Front squat'
    pressKey(picker.inputEl, 'Enter')

    expect(prefilled).toBe('Squat')
    await savedBody(contents, [
      '## [[Front squat]]',
      '',
      '- [exercise:: [[Front squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
    ])
    expect(card(view).querySelector('.fitkit-name-button-text')?.textContent).toBe('Front squat')
  })
})

describe('WorkoutEditorView exercise file link', () => {
  it('opens the existing exercise note when the name is clicked', async () => {
    const { view, leaf, workspace, created } = await openEditor({
      body: SQUAT,
      exerciseNotes: { Squat: { type: 'exercise', kind: 'strength' } },
    })

    button(card(view), 'Open exercise file for Squat').click()
    await settle()

    expect(workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, { focus: true })
    expect(workspace.openLinkText).toHaveBeenCalledWith(
      'Fitness/Exercises/Squat.md',
      WORKOUT_PATH,
      false,
    )
    expect(created).toEqual([])
  })

  it('clears and saves a deleted exercise tombstone when opening an existing note', async () => {
    const { view, plugin, saved, created, workspace } = await openEditor({
      body: SQUAT,
      settings: { deletedExercises: ['squat', 'bench'] },
      exerciseNotes: { Squat: { type: 'exercise', kind: 'strength' } },
    })

    button(card(view), 'Open exercise file for Squat').click()

    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(created).toEqual([])
    expect(plugin.settings.deletedExercises).toEqual(['bench'])
    expect(saved[0]?.deletedExercises).toEqual(['bench'])
    expect(workspace.openLinkText).toHaveBeenCalledWith(
      'Fitness/Exercises/Squat.md',
      WORKOUT_PATH,
      false,
    )
  })

  it('opens the canonical exercise note when the name is an alias', async () => {
    const { view, workspace, created } = await openEditor({
      body: SQUAT,
      settings: {
        exerciseRegistry: [
          { name: 'Back squat', kind: 'strength', unit: 'lbs', aliases: ['Squat'] },
        ],
      },
      exerciseNotes: { 'Back squat': { type: 'exercise', kind: 'strength', unit: 'lbs' } },
    })

    button(card(view), 'Open exercise file for Squat').click()
    await settle()

    expect(workspace.openLinkText).toHaveBeenCalledWith(
      'Fitness/Exercises/Back squat.md',
      WORKOUT_PATH,
      false,
    )
    expect(created).toEqual([])
  })

  it('creates and opens a missing exercise note when the name is clicked', async () => {
    const { view, contents, created, folders, workspace } = await openEditor({
      body: SQUAT,
      settings: {
        exerciseRegistry: [{ name: 'Squat', kind: 'strength', unit: 'lbs', aliases: [] }],
      },
    })

    button(card(view), 'Open exercise file for Squat').click()

    await vi.waitFor(() => expect(workspace.openLinkText).toHaveBeenCalled())
    expect(folders).toEqual(['Fitness', 'Fitness/Exercises'])
    expect(created).toEqual(['Fitness/Exercises/Squat.md'])
    expect(contents.get('Fitness/Exercises/Squat.md')).toContain('unit: lbs')
    expect(obsidianRecord.notices).toContain("Created exercise note for 'Squat'.")
    expect(workspace.openLinkText).toHaveBeenCalledWith(
      'Fitness/Exercises/Squat.md',
      WORKOUT_PATH,
      false,
    )
  })

  it('clears and saves a deleted exercise tombstone when creating from the name', async () => {
    const { view, plugin, saved, workspace } = await openEditor({
      body: SQUAT,
      settings: {
        deletedExercises: ['squat', 'bench'],
        exerciseRegistry: [{ name: 'Squat', kind: 'strength', unit: 'lbs', aliases: [] }],
      },
    })

    button(card(view), 'Open exercise file for Squat').click()

    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(plugin.settings.deletedExercises).toEqual(['bench'])
    expect(saved[0]?.deletedExercises).toEqual(['bench'])
    expect(workspace.openLinkText).toHaveBeenCalledWith(
      'Fitness/Exercises/Squat.md',
      WORKOUT_PATH,
      false,
    )
  })
})

describe('WorkoutEditorView card history and notes', () => {
  it.each([
    {
      kind: 'strength',
      body: SQUAT,
      history: [
        session('2026-04-10', {
          exerciseName: 'Squat',
          kind: 'strength',
          maxWeightSet: { weight: 95, reps: 8 },
        }),
        session('2026-04-20', {
          exerciseName: 'Squat',
          kind: 'strength',
          maxWeightSet: { weight: 90, reps: 8 },
        }),
      ],
      texts: ['PB 95', 'last 90x8'],
      date: '2026-04-20',
    },
    {
      kind: 'duration',
      body: ['## [[Squat]]', '', '- [exercise:: [[Squat]]] [set:: 1] [duration:: 60]'],
      history: [
        session('2026-04-10', {
          exerciseName: 'Squat',
          kind: 'duration',
          totalDurationSeconds: 270,
        }),
        session('2026-04-20', {
          exerciseName: 'Squat',
          kind: 'duration',
          totalDurationSeconds: 240,
        }),
      ],
      texts: ['PB 4m30s', 'last 4m'],
      date: '2026-04-20',
    },
  ])(
    'draws $kind PB and last badges under the card top',
    async ({ body, history, texts, date }) => {
      const { view } = await openEditor({ body, history })

      const top = card(view).querySelector('.fitkit-card-top')
      const historyRow = top?.nextElementSibling
      expect(historyRow?.classList.contains('fitkit-card-history')).toBe(true)
      const badges = [...(historyRow?.querySelectorAll('.fitkit-card-badge') ?? [])]
      expect(badges.map((badge) => badge.textContent)).toEqual(texts)
      expect(badges.map((badge) => badge.getAttribute('title')?.endsWith(`(${date})`))).toEqual([
        false,
        true,
      ])
    },
  )

  it('draws no history row when the exercise has no history', async () => {
    const { view } = await openEditor({ body: SQUAT })

    expect(card(view).querySelector('.fitkit-card-history')).toBeNull()
  })

  it('draws no note editor and no note line when the exercise has no note', async () => {
    const { view } = await openEditor({ body: SQUAT })

    expect(card(view).querySelector('textarea')).toBeNull()
    expect(card(view).querySelector('.fitkit-exercise-note-line')).toBeNull()
  })

  it('draws the exercise note as a line that opens the note editor by click or Enter', async () => {
    const { view } = await openEditor({
      body: [
        '## [[Squat]]',
        '',
        '- [exercise:: [[Squat]]] [notes:: Belt on from set 2]',
        SQUAT[2] ?? '',
      ],
    })
    const line = card(view).querySelector<HTMLElement>('.fitkit-exercise-note-line')

    line?.click()
    const afterClick = modalTitles()
    if (line) pressKey(line, 'Enter')

    expect(card(view).querySelector('textarea')).toBeNull()
    expect(line?.textContent).toBe('Belt on from set 2')
    expect(line?.getAttribute('role')).toBe('button')
    expect(line?.getAttribute('tabindex')).toBe('0')
    expect(afterClick).toEqual(['Note for Squat'])
    expect(modalTitles()).toEqual(['Note for Squat', 'Note for Squat'])
  })

  it('titles the card menu note item by whether a note already exists', async () => {
    const { view } = await openEditor({
      body: [
        '## [[Squat]]',
        '',
        '- [exercise:: [[Squat]]] [notes:: Belt on from set 2]',
        SQUAT[2] ?? '',
      ],
    })

    openCardMenu(view)

    expect(menuTitles()).toContain('Edit exercise note')
  })

  it('offers Edit levels on a bodyweight card, after the exercise note item', async () => {
    const { view } = await openEditor({
      body: ['## [[Push-up]]', '', '- [exercise:: [[Push-up]]] [set:: 1] [level:: 1] [reps:: 8]'],
    })

    const titles = menuTitles(openCardMenu(view))

    expect(titles).toContain('Edit levels')
    expect(titles.indexOf('Edit levels')).toBe(titles.indexOf('Add exercise note') + 1)
  })

  it('offers no Edit levels item on a strength card', async () => {
    const { view } = await openEditor({ body: SQUAT })

    expect(menuTitles(openCardMenu(view))).not.toContain('Edit levels')
  })
})

describe('WorkoutEditorView next-time plan', () => {
  const planItems = (view: WorkoutEditorView) =>
    openCardMenu(view).items.filter((item) => item.title?.startsWith('Plan') === true)

  const squatWith = (next: string): string[] => [
    '## [[Squat]]',
    '',
    `- [exercise:: [[Squat]]] [next:: ${next}]`,
    SQUAT[2] ?? '',
  ]

  it('offers increase, keep, and decrease on strength cards', async () => {
    const { view } = await openEditor({ body: SQUAT })

    const items = planItems(view)

    expect(items.map((item) => item.title)).toEqual([
      'Plan: increase',
      'Plan: keep',
      'Plan: decrease',
    ])
    expect(items.map((item) => item.icon)).toEqual(['arrow-up', 'minus', 'arrow-down'])
    expect(items.every((item) => item.checked === false)).toBe(true)
  })

  it('omits the plan items on duration cards', async () => {
    const { view } = await openEditor({
      body: ['## [[Plank]]', '', '- [exercise:: [[Plank]]] [set:: 1] [duration:: 60]'],
    })

    expect(planItems(view)).toEqual([])
  })

  it('offers increase, keep, and decrease without a step on interval cards, and records the direction', async () => {
    const { view, contents } = await openEditor({
      body: [
        '## [[Exercise Bike]]',
        '',
        '- [exercise:: [[Exercise Bike]]] [plan:: 3 x 1m @ 300W]',
        '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 60]',
      ],
    })

    const titles = menuTitles(openCardMenu(view))
    chooseMenuItem('Plan: increase')

    expect(titles.filter((title) => title?.startsWith('Plan') === true)).toEqual([
      'Plan: increase',
      'Plan: keep',
      'Plan: decrease',
    ])
    expect(titles).not.toContain('Set plan step...')
    await savedBody(contents, [
      '## [[Exercise Bike]]',
      '',
      '- [exercise:: [[Exercise Bike]]] [next:: up] [plan:: 3 x 1m @ 300W]',
      '- [exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 60]',
    ])
  })

  it('checks the recorded direction', async () => {
    const { view } = await openEditor({ body: squatWith('up 2.5') })

    const checked = planItems(view).filter((item) => item.checked)

    expect(checked.map((item) => item.title)).toEqual(['Plan: increase'])
  })

  it('records a direction when one is chosen, and shows it on the card', async () => {
    const { view, contents } = await openEditor({ body: SQUAT })

    openCardMenu(view)
    chooseMenuItem('Plan: increase')

    await savedBody(contents, [
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [next:: up]',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
    ])
    expect(card(view).querySelector('.fitkit-plan-badge')).not.toBeNull()
  })

  it('clears the plan when the active direction is chosen again', async () => {
    const { view, contents } = await openEditor({ body: squatWith('up 2.5') })

    openCardMenu(view)
    chooseMenuItem('Plan: increase')

    await savedBody(contents, SQUAT)
  })

  it('carries the step across a direction change', async () => {
    const { view, contents } = await openEditor({ body: squatWith('up 2.5') })

    openCardMenu(view)
    chooseMenuItem('Plan: decrease')

    await savedBody(contents, squatWith('down 2.5'))
  })

  it.each([
    { label: 'no plan', body: SQUAT, disabled: true },
    { label: 'a stay plan', body: squatWith('stay'), disabled: true },
    { label: 'an up plan', body: squatWith('up'), disabled: false },
  ])('disables the step item for $label', async ({ body, disabled }) => {
    const { view } = await openEditor({ body })

    openCardMenu(view)

    expect(menuItem('Set plan step...').disabled).toBe(disabled)
  })

  it('shows the plan set on this card, so the menu choice has a readout', async () => {
    const { view } = await openEditor({ body: squatWith('up 2.5') })

    const badge = card(view).querySelector('.fitkit-plan-badge')

    expect(badge?.getAttribute('title')).toBe('Planned for next time: up 2.5 kg from 100 kg')
    expect(badge?.textContent).toContain('Next: 102.5 kg')
  })

  it('reads a pounds exercise plan in pounds on the card', async () => {
    const { view } = await openEditor({
      body: squatWith('up 2.5'),
      settings: {
        exerciseRegistry: [{ name: 'Squat', kind: 'strength', unit: 'lbs', aliases: [] }],
      },
    })

    const badge = card(view).querySelector('.fitkit-plan-badge')

    expect(badge?.getAttribute('title')).toBe('Planned for next time: up 2.5 lbs from 100 lbs')
    expect(badge?.textContent).toContain('Next: 102.5 lbs')
  })

  it('reads a pounds exercise history badge tooltips in pounds on the card', async () => {
    const { view } = await openEditor({
      body: SQUAT,
      settings: {
        exerciseRegistry: [{ name: 'Squat', kind: 'strength', unit: 'lbs', aliases: [] }],
      },
      history: [
        session('2026-04-10', {
          exerciseName: 'Squat',
          kind: 'strength',
          maxWeightSet: { weight: 100, reps: 1 },
        }),
        session('2026-04-23', {
          exerciseName: 'Squat',
          kind: 'strength',
          maxWeightSet: { weight: 95, reps: 8 },
        }),
      ],
    })

    const titles = [...card(view).querySelectorAll('.fitkit-card-history .fitkit-card-badge')].map(
      (badge) => badge.getAttribute('title'),
    )

    expect(titles).toEqual([
      'Heaviest weight lifted (not 1RM): 100 lbs x 1',
      'Heaviest weight in latest prior session: 95 lbs x 8 (2026-04-23)',
    ])
  })

  it('shows the plan recorded last session as a badge', async () => {
    const { view } = await openEditor({
      body: ['## [[Squat]]', '', '- [exercise:: [[Squat]]]'],
      history: [
        session('2026-06-10', {
          exerciseName: 'Squat',
          kind: 'strength',
          maxWeightSet: { weight: 100, reps: 5 },
          next: { direction: 'up', step: 2.5 },
        }),
      ],
    })

    const badge = card(view).querySelector('.fitkit-plan-badge')

    expect(badge?.getAttribute('title')).toBe('Planned on 2026-06-10: up 2.5 kg from 100 kg')
    expect(badge?.querySelector('.fitkit-plan-badge-icon')?.getAttribute('data-icon')).toBe(
      'arrow-up',
    )
    expect(badge?.textContent).toContain('Next: 102.5 kg')
  })
})

describe('WorkoutEditorView menu placement', () => {
  /**
   * The left edge Obsidian gives a menu for a position def, mirroring `Menu.showAtPosition`:
   * right-aligned to the anchor's far edge if `left` is set and it fits, else left-aligned, clamped to the window.
   */
  const menuBox = (
    position: MockMenuPosition,
    menuWidth: number,
    windowWidth: number,
  ): { left: number; right: number } => {
    const { x, width, overlap, left } = position
    const anchorNear = width === undefined ? x + 2 : x
    const anchorFar = width === undefined ? x - 2 : x + width
    const near = overlap === true || width === undefined ? anchorNear : anchorFar
    const far = overlap === true || width === undefined ? anchorFar : anchorNear
    const rightAligns = near + menuWidth > windowWidth || (left === true && far - menuWidth >= 0)
    const edge = rightAligns ? Math.max(0, far - menuWidth) : near
    return { left: edge, right: edge + menuWidth }
  }

  const expectWithin = (box: { left: number; right: number }, windowWidth: number): void => {
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(windowWidth)
  }

  /** Gives `el` the box layout would, since jsdom lays nothing out. */
  const placeAt = (el: Element, box: { left: number; bottom: number; width: number }): void => {
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: (): DOMRect =>
        ({ ...box, right: box.left + box.width, top: box.bottom - 10, height: 10 }) as DOMRect,
    })
  }

  const shownAt = (): MockMenuPosition => {
    const { position } = lastMenu()
    if (position === undefined) {
      throw new Error('no menu was shown at a position')
    }
    return position
  }

  it('hangs the row menu off the kebab even where it would fit to the right', async () => {
    const { view } = await openEditor({ body: SQUAT })
    const row = rows(card(view))[0]
    const kebab = row?.querySelector('.fitkit-row-kebab')
    if (!row || !kebab) throw new Error('no kebab drawn')
    placeAt(kebab, { left: 600, bottom: 40, width: 28 })

    openRowMenu(row)

    const box = menuBox(shownAt(), 120, 760)
    expect(box.right).toBe(628)
    expectWithin(box, 760)
  })

  it('hangs the level menu off the level label rather than past it', async () => {
    const { view } = await openEditor({
      body: ['## [[Push-up]]', '', '- [exercise:: [[Push-up]]] [set:: 1] [level:: 1] [reps:: 10]'],
      settings: {
        exerciseRegistry: [
          {
            name: 'Push-up',
            kind: 'bodyweight',
            levels: ['Wall push-up', 'Incline push-up'],
            aliases: [],
          },
        ],
      },
    })
    const label = card(view).querySelector<HTMLElement>('.fitkit-bodyweight-level-label')
    if (!label) throw new Error('no level label drawn')
    placeAt(label, { left: 600, bottom: 96, width: 120 })

    label.click()

    const box = menuBox(shownAt(), 150, 760)
    expect(box.right).toBe(720)
    expectWithin(box, 760)
  })

  it('hangs the card menu off the gear inside a narrow window', async () => {
    const { view } = await openEditor({ body: SQUAT })
    placeAt(button(card(view), 'Exercise options'), { left: 220, bottom: 64, width: 32 })

    openCardMenu(view)

    const box = menuBox(shownAt(), 120, 360)
    expect(box.right).toBe(252)
    expectWithin(box, 360)
  })
})

describe('WorkoutEditorView drag to reorder', () => {
  const THREE = [
    '## [[Squat]]',
    '',
    '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
    '',
    '## [[Deadlift]]',
    '',
    '- [exercise:: [[Deadlift]]] [set:: 1] [weight:: 140] [reps:: 3]',
    '',
    '## [[Press]]',
    '',
    '- [exercise:: [[Press]]] [set:: 1] [weight:: 50] [reps:: 8]',
  ]

  const names = (view: WorkoutEditorView): string[] =>
    [...view.contentEl.querySelectorAll('.fitkit-name-button-text')].map(
      (el) => el.textContent ?? '',
    )

  /** jsdom has no layout, so each card stands 100px tall from the top and the handle lacks pointer capture. */
  const layOut = (view: WorkoutEditorView): HTMLElement => {
    const cards = view.contentEl.querySelectorAll<HTMLElement>(
      '.fitkit-exercise-list > .fitkit-card',
    )
    cards.forEach((el, i) => {
      el.getBoundingClientRect = () => ({ top: i * 100, height: 100 }) as DOMRect
    })
    const handle = card(view, 0).querySelector<HTMLElement>('.fitkit-drag-handle')
    if (!handle) throw new Error('no drag handle drawn')
    Object.assign(handle, {
      setPointerCapture: () => {},
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
    })
    return handle
  }

  const fireOnWindow = (evt: Event): void => {
    ;(harnessWindow as unknown as EventTarget).dispatchEvent(evt)
  }

  const pointer = (type: string, clientY: number): Event => {
    const evt = new harnessWindow.MouseEvent(type, { clientY, bubbles: true })
    Object.defineProperty(evt, 'pointerId', { value: 1 })
    return evt
  }

  it('commits the new order once when the handle is released between two other cards', async () => {
    const { view, contents } = await openEditor({ body: THREE })
    const handle = layOut(view)

    handle.dispatchEvent(pointer('pointerdown', 50))
    handle.dispatchEvent(pointer('pointermove', 180))
    const dragging = card(view, 0).classList.contains('is-dragging')
    fireOnWindow(pointer('pointerup', 180))
    fireOnWindow(pointer('lostpointercapture', 180))

    expect([dragging, names(view)]).toEqual([true, ['Deadlift', 'Squat', 'Press']])
    expect(view.contentEl.querySelector('.fitkit-drop-indicator')).toBeNull()
    await savedBody(contents, [
      '## [[Deadlift]]',
      '',
      '- [exercise:: [[Deadlift]]] [set:: 1] [weight:: 140] [reps:: 3]',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
      '## [[Press]]',
      '',
      '- [exercise:: [[Press]]] [set:: 1] [weight:: 50] [reps:: 8]',
    ])
  })

  it('keeps a drag alive across a redraw and commits it once on release', async () => {
    const { view, contents } = await openEditor({ body: THREE })
    const handle = layOut(view)

    handle.dispatchEvent(pointer('pointerdown', 50))
    handle.dispatchEvent(pointer('pointermove', 180))
    view.refreshSettingsDrivenUi()
    fireOnWindow(pointer('pointerup', 180))
    fireOnWindow(pointer('lostpointercapture', 180))

    expect(names(view)).toEqual(['Deadlift', 'Squat', 'Press'])
    await savedBody(contents, [
      '## [[Deadlift]]',
      '',
      '- [exercise:: [[Deadlift]]] [set:: 1] [weight:: 140] [reps:: 3]',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
      '## [[Press]]',
      '',
      '- [exercise:: [[Press]]] [set:: 1] [weight:: 50] [reps:: 8]',
    ])
  })

  it('numbers the cards in their new order after each reorder', async () => {
    const { view } = await openEditor({ body: THREE })
    const indices = (): Array<string | undefined> =>
      [...view.contentEl.querySelectorAll<HTMLElement>('.fitkit-exercise-list > .fitkit-card')].map(
        (el) => el.dataset.exerciseIndex,
      )
    const dragFirstBetweenTheOthers = (): void => {
      const handle = layOut(view)
      handle.dispatchEvent(pointer('pointerdown', 50))
      handle.dispatchEvent(pointer('pointermove', 180))
      fireOnWindow(pointer('pointerup', 180))
    }

    dragFirstBetweenTheOthers()
    const once = [names(view), indices()]
    dragFirstBetweenTheOthers()

    expect([once, [names(view), indices()]]).toEqual([
      [
        ['Deadlift', 'Squat', 'Press'],
        ['0', '1', '2'],
      ],
      [
        ['Squat', 'Deadlift', 'Press'],
        ['0', '1', '2'],
      ],
    ])
  })

  it('leaves the order alone when the drag is cancelled', async () => {
    const { view } = await openEditor({ body: THREE })
    const handle = layOut(view)

    handle.dispatchEvent(pointer('pointerdown', 50))
    handle.dispatchEvent(pointer('pointermove', 180))
    fireOnWindow(pointer('pointercancel', 180))

    expect(names(view)).toEqual(['Squat', 'Deadlift', 'Press'])
    expect(view.contentEl.querySelector('.fitkit-drop-indicator')).toBeNull()
    expect(card(view, 0).classList.contains('is-dragging')).toBe(false)
  })
})
