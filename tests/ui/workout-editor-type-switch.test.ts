import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', async () =>
  (await import('../fixtures/obsidian-editor-mock')).createObsidianMock(),
)

import type { IndexEntry } from '../../src/domain/types'
import { obsidianRecord } from '../fixtures/obsidian-editor-mock'
import {
  button,
  card,
  cellInput,
  choose,
  modalTitles,
  noteBody,
  openEditor,
  pickerModal,
  pressKey,
  renameCard,
  rows,
  savedBody,
  settle,
  switchCardType,
  typeInto,
  useEditorEnvironment,
} from '../fixtures/workout-editor'

useEditorEnvironment()

describe('WorkoutEditorView unknown exercise', () => {
  it('creates the note through the store, clears its tombstone and notices it', async () => {
    const { view, plugin, saved, created } = await openEditor({
      body: [],
      settings: { deletedExercises: ['squat'] },
    })

    button(view.contentEl, 'Add exercise').click()
    const picker = await pickerModal()
    picker.inputEl.value = 'Squat'
    pressKey(picker.inputEl, 'Enter')
    await choose('Add exercise', 'Add exercise')
    await vi.waitFor(() => expect(saved).toHaveLength(1))

    expect(created).toEqual(['Fitness/Exercises/Squat.md'])
    expect(plugin.settings.exerciseRegistry).toEqual([
      { name: 'Squat', kind: 'strength', aliases: [] },
    ])
    expect(plugin.settings.deletedExercises).toEqual([])
    expect(saved[0]?.exerciseRegistry).toEqual(plugin.settings.exerciseRegistry)
    expect(obsidianRecord.notices).toEqual(["Created exercise note for 'Squat'."])
  })
})

describe('WorkoutEditorView type switch persistence', () => {
  it('writes the switched type into the exercise note and records it in the registry', async () => {
    const { view, plugin, saved, contents } = await openEditor({
      body: ['## [[Squat]]', '', '- [exercise:: [[Squat]]] [set:: 1] [duration:: 60]'],
      exerciseNotes: { Squat: { type: 'exercise', kind: 'duration' } },
    })

    switchCardType(view, 'strength')
    await choose('Switch Squat to strength?', 'Update registry too')
    await vi.waitFor(() => expect(saved).toHaveLength(1))

    expect(contents.get('Fitness/Exercises/Squat.md')).toContain('kind: strength')
    expect(plugin.settings.exerciseRegistry).toMatchObject([
      { name: 'Squat', kind: 'strength', aliases: [] },
    ])
    expect(obsidianRecord.notices).toEqual([
      'Switched to strength. Previous duration rows were cleared.',
      'Exercise note now records Squat as strength.',
      'Registry now records Squat as strength.',
    ])
  })
})

describe('WorkoutEditorView rename onto a registry type', () => {
  it('switches a strength card renamed onto an interval name and opens the plan form', async () => {
    const { view, saved, contents } = await openEditor({
      body: ['## [[Squat]]', '', '- [exercise:: [[Squat]]] [set:: 1] [weight:: 10] [reps:: 8]'],
      settings: {
        exerciseRegistry: [{ name: 'Rower', kind: 'duration', interval: true, aliases: [] }],
      },
    })

    await renameCard(view, 'Rower')
    await choose('Switch exercise type?', 'Switch and discard')
    await settle()

    expect(modalTitles()).toContain('Interval plan for Rower')
    expect(card(view).querySelector('.fitkit-duration-row')).not.toBeNull()
    expect(rows(card(view))).toHaveLength(1)
    await savedBody(contents, ['## [[Rower]]', '', '- [exercise:: [[Rower]]] [duration:: 0]'])
    expect(saved).toEqual([])
    expect(obsidianRecord.notices).toEqual([
      'Switched to interval. Previous strength rows were cleared.',
    ])
  })

  it('drops the plan when an interval card takes a plain duration name', async () => {
    const { view, contents } = await openEditor({
      body: ['## [[Bike]]', '', '- [exercise:: [[Bike]]] [plan:: 8 x 30s, 90s rest]'],
      settings: { exerciseRegistry: [{ name: 'Rower', kind: 'duration', aliases: [] }] },
    })

    await renameCard(view, 'Rower')
    await settle()

    expect(card(view).querySelector('.fitkit-plan-line')).toBeNull()
    expect(modalTitles()).not.toContain('Interval plan for Rower')
    await savedBody(contents, ['## [[Rower]]', ''])
  })

  it('opens the plan form on a plain duration card that takes an interval name', async () => {
    const { view, contents } = await openEditor({
      body: ['## [[Bike]]', '', '- [exercise:: [[Bike]]] [set:: 1] [duration:: 60]'],
      settings: {
        exerciseRegistry: [{ name: 'Rower', kind: 'duration', interval: true, aliases: [] }],
      },
    })

    await renameCard(view, 'Rower')
    await settle()

    expect(modalTitles()).toContain('Interval plan for Rower')
    await savedBody(contents, [
      '## [[Rower]]',
      '',
      '- [exercise:: [[Rower]]] [set:: 1] [duration:: 60]',
    ])
    expect(obsidianRecord.notices).toEqual([])
  })
})

describe('WorkoutEditorView set seeding', () => {
  /** A prior Squat session on 2026-06-10, as the plugin index records it. */
  const lastSquat = (row: Partial<IndexEntry['exercises'][number]>): IndexEntry[] => [
    {
      path: 'Fitness/Workouts/2026-06-10.md',
      mtime: 1,
      date: '2026-06-10',
      name: 'Leg day',
      exercises: [{ exerciseName: 'Squat', kind: 'strength', ...row }],
    },
  ]

  /** Switches a duration Squat card to strength for this workout, seeding its first row. */
  const seedStrength = async (history: IndexEntry[]) => {
    const editor = await openEditor({
      body: ['## [[Squat]]', '', '- [exercise:: [[Squat]]] [set:: 1] [duration:: 60]'],
      history,
    })
    switchCardType(editor.view, 'strength')
    await choose('Switch Squat to strength?', 'Just this workout')
    return editor
  }

  const firstRow = (view: Parameters<typeof card>[0]): Element => {
    const [row] = rows(card(view))
    if (!row) throw new Error('no row seeded')
    return row
  }

  it('seeds the plan target as the first set weight, and never seeds reps', async () => {
    const { view, contents } = await seedStrength(
      lastSquat({
        maxWeightSet: { weight: 100, reps: 5 },
        next: { direction: 'up', step: 2.5 },
      }),
    )

    expect(cellInput(firstRow(view), 'Weight')?.value).toBe('102.5')
    expect(cellInput(firstRow(view), 'Reps')?.value).toBe('')
    await savedBody(contents, [
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 102.5]',
    ])
  })

  it.each([
    {
      history: 'a plan with no prior session',
      row: { next: { direction: 'up' as const, step: 2.5 } },
    },
    { history: 'a prior session but no plan', row: { maxWeightSet: { weight: 100, reps: 5 } } },
    {
      history: 'a plan with no step',
      row: { maxWeightSet: { weight: 100, reps: 5 }, next: { direction: 'up' as const } },
    },
  ])('seeds no weight from $history', async ({ row }) => {
    const { view } = await seedStrength(lastSquat(row))

    expect(cellInput(firstRow(view), 'Weight')?.value).toBe('')
  })

  it('marks a seeded weight unconfirmed until it is typed over', async () => {
    const { view } = await seedStrength(
      lastSquat({
        maxWeightSet: { weight: 100, reps: 5 },
        next: { direction: 'up', step: 2.5 },
      }),
    )
    const weight = (): HTMLInputElement | null => cellInput(firstRow(view), 'Weight')
    const unconfirmed = (): boolean | undefined =>
      weight()?.classList.contains('fitkit-input--unconfirmed')
    const seeded = unconfirmed()

    typeInto(weight() as HTMLInputElement, '105')
    const typed = unconfirmed()
    button(card(view), 'Add set').click()

    expect([seeded, typed, unconfirmed()]).toEqual([true, false, false])
  })

  it('seeds a bodyweight row shaped like the rows Add set appends', async () => {
    const { view, contents } = await openEditor({
      body: ['## [[Push-up]]', '', '- [exercise:: [[Push-up]]] [set:: 1] [weight:: 10] [reps:: 8]'],
    })

    switchCardType(view, 'bodyweight')
    await choose('Switch Push-up to bodyweight?', 'Just this workout')
    await choose('Mark logged sets as level 1?', 'Cancel')
    await settle()

    expect(noteBody(contents)).toEqual([
      '## [[Push-up]]',
      '',
      '- [exercise:: [[Push-up]]] [set:: 1] [level:: 1]',
    ])
  })
})
