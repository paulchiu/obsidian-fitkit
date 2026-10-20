import { describe, expect, it } from 'vitest'

import { planFromOutline, outlineFromPlan } from '../../../src/domain/plan-outline'
import {
  append,
  newItem,
  rowActions,
  setField,
  withIds,
  type DraftItem,
} from '../../../src/ui/model/plan-draft'

/** Ids counting up from 1, so a test can name rows by id. */
const counter = (): (() => number) => {
  let last = 0
  return () => ++last
}

const draft = (plan: string, newId = counter()): DraftItem[] =>
  withIds(outlineFromPlan(plan) ?? [], newId)

const apply = (items: DraftItem[], id: number, title: string, newId = counter()): DraftItem[] => {
  const action = rowActions(items, id, newId).find((entry) => entry.title === title)
  if (!action) {
    throw new Error(`No ${title} for row ${id}`)
  }
  return action.change(items)
}

const ids = (items: DraftItem[]): unknown[] =>
  items.map((item) => (item.kind === 'repeat' ? [item.id, ids(item.items)] : item.id))

describe('withIds', () => {
  it('numbers every row, a repeat before its steps', () => {
    expect(ids(draft('(a 1m) (x 2 (b 2m) (rest 1m)) (c 3m)'))).toEqual([1, [2, [3, 4]], 5])
  })
})

describe('rowActions', () => {
  const titles = (items: DraftItem[], id: number): string[] =>
    rowActions(items, id, counter()).map((action) => `${action.title}:${action.icon}`)

  it('offers moves only where there is somewhere to move, and Ungroup only on a repeat', () => {
    const items = draft('(a 1m) (x 2 (b 2m)) (c 3m)')

    expect([titles(items, 1), titles(items, 2), titles(items, 3), titles(items, 4)]).toEqual([
      ['Move down:arrow-down', 'Duplicate:copy', 'Put in a repeat:repeat', 'Delete:trash-2'],
      [
        'Move up:arrow-up',
        'Move down:arrow-down',
        'Duplicate:copy',
        'Put in a repeat:repeat',
        'Ungroup:ungroup',
        'Delete:trash-2',
      ],
      ['Duplicate:copy', 'Put in a repeat:repeat', 'Delete:trash-2'],
      ['Move up:arrow-up', 'Duplicate:copy', 'Put in a repeat:repeat', 'Delete:trash-2'],
    ])
  })

  it('offers nothing for a row that is not there', () => {
    expect(rowActions(draft('(a 1m)'), 99, counter())).toEqual([])
  })

  it('moves a row up or down past its neighbour, keeping its id', () => {
    const items = draft('(a 1m) (b 2m) (c 3m)')

    expect([
      planFromOutline(apply(items, 1, 'Move down')),
      ids(apply(items, 1, 'Move down')),
      planFromOutline(apply(items, 3, 'Move up')),
    ]).toEqual(['(b 2m) (a 1m) (c 3m)', [2, 1, 3], '(a 1m) (c 3m) (b 2m)'])
  })

  it('moves a step within its repeat', () => {
    const items = draft('(x 2 (a 1m) (b 2m))')

    expect(planFromOutline(apply(items, 2, 'Move down'))).toBe('(x 2 (b 2m) (a 1m))')
  })

  it('puts the copy straight after the original, with fresh ids throughout', () => {
    const newId = counter()
    const items = draft('(a 1m) (x 2 (b 2m)) (c 3m)', newId)

    const copied = apply(items, 2, 'Duplicate', newId)

    expect([planFromOutline(copied), ids(copied)]).toEqual([
      '(a 1m) (x 2 (b 2m)) (x 2 (b 2m)) (c 3m)',
      [1, [2, [3]], [5, [6]], 4],
    ])
  })

  it('groups a row into a repeat of three and ungroups a repeat into its rows', () => {
    const items = draft('(a 1m) (x 2 (b 2m) (c 3m))')

    expect([
      planFromOutline(apply(items, 1, 'Put in a repeat')),
      planFromOutline(apply(items, 2, 'Ungroup')),
      planFromOutline(apply(items, 3, 'Delete')),
    ]).toEqual(['(x 3 (a 1m)) (x 2 (b 2m) (c 3m))', '(a 1m) (b 2m) (c 3m)', '(a 1m) (x 2 (c 3m))'])
  })

  it('leaves the draft it was given untouched', () => {
    const items = draft('(a 1m) (b 2m)')
    const before = structuredClone(items)

    apply(items, 1, 'Move down')
    apply(items, 2, 'Delete')

    expect(items).toEqual(before)
  })
})

describe('editing a draft', () => {
  it('sets one field of one row, wherever it sits', () => {
    const items = draft('(a 1m) (x 2 (b 2m))')

    expect(planFromOutline(setField(setField(items, 3, 'work', '90s'), 2, 'count', '4'))).toBe(
      '(a 1m) (x 4 (b 90s))',
    )
  })

  it('adds a new row to the plan or to the end of a repeat', () => {
    const newId = counter()
    const items = draft('(x 2 (b 2m))', newId)

    expect([
      planFromOutline(append(items, null, newItem('rest', newId))),
      planFromOutline(append(items, 1, newItem('step', newId))),
      planFromOutline(append(items, null, newItem('repeat', newId))),
    ]).toEqual(['(x 2 (b 2m)) (rest 1m)', '(x 2 (b 2m) (work 1m))', '(x 2 (b 2m)) (x 3 (work 1m))'])
  })
})
