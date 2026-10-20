import type { OutlineItem } from '../../domain/plan-outline'

/** Rows of the plan form's step editor, each with an id that survives edits so its inputs keep focus. */
export interface DraftStep {
  kind: 'step'
  id: number
  name: string
  work: string
  target: string
}

export interface DraftRest {
  kind: 'rest'
  id: number
  time: string
}

export interface DraftRepeat {
  kind: 'repeat'
  id: number
  count: string
  every: string
  items: DraftItem[]
}

export type DraftItem = DraftStep | DraftRest | DraftRepeat

/** The text fields a row can edit. */
export type DraftField = 'name' | 'work' | 'target' | 'time' | 'count' | 'every'

export type NewId = () => number

/** A change to the draft: the whole list in, the whole list out. */
export type DraftChange = (items: DraftItem[]) => DraftItem[]

export interface RowAction {
  title: string
  icon: string
  change: DraftChange
}

export type NewItemKind = 'step' | 'rest' | 'repeat'

/** `items` as draft rows, each given a fresh id. */
export function withIds(items: readonly OutlineItem[], newId: NewId): DraftItem[] {
  return items.map((item): DraftItem => {
    if (item.kind === 'repeat') {
      const id = newId()
      return { ...item, id, items: withIds(item.items, newId) }
    }
    return { ...item, id: newId() }
  })
}

/** A starting row of the given kind, as the Add menu offers. */
export function newItem(kind: NewItemKind, newId: NewId): DraftItem {
  if (kind === 'rest') {
    return { kind: 'rest', id: newId(), time: '1m' }
  }
  if (kind === 'repeat') {
    const id = newId()
    return { kind: 'repeat', id, count: '3', every: '', items: [newItem('step', newId)] }
  }
  return { kind: 'step', id: newId(), name: 'work', work: '1m', target: '' }
}

/** Replaces the list holding row `id` with what `edit` makes of it and the row's place in it. */
function editList(
  items: DraftItem[],
  id: number,
  edit: (list: DraftItem[], index: number) => DraftItem[],
): DraftItem[] {
  const index = items.findIndex((item) => item.id === id)
  if (index >= 0) {
    return edit(items, index)
  }
  return items.map((item) =>
    item.kind === 'repeat' ? { ...item, items: editList(item.items, id, edit) } : item,
  )
}

/** Sets one text field of row `id`. */
export function setField(
  items: DraftItem[],
  id: number,
  field: DraftField,
  value: string,
): DraftItem[] {
  return editList(items, id, (list, index) =>
    list.map((item, at) => (at === index ? { ...item, [field]: value } : item)),
  )
}

/** Adds `item` to the end of repeat `parentId`, or of the plan when there is no parent. */
export function append(items: DraftItem[], parentId: number | null, item: DraftItem): DraftItem[] {
  if (parentId === null) {
    return [...items, item]
  }
  return items.map((existing) =>
    existing.kind !== 'repeat'
      ? existing
      : existing.id === parentId
        ? { ...existing, items: [...existing.items, item] }
        : { ...existing, items: append(existing.items, parentId, item) },
  )
}

const swap = (list: DraftItem[], first: number): DraftItem[] =>
  list.map((item, at) =>
    at === first ? (list[first + 1] ?? item) : at === first + 1 ? (list[first] ?? item) : item,
  )

/** The list holding row `id` and the row's place in it. */
function locate(items: DraftItem[], id: number): { list: DraftItem[]; index: number } | null {
  const index = items.findIndex((item) => item.id === id)
  if (index >= 0) {
    return { list: items, index }
  }
  for (const item of items) {
    const found = item.kind === 'repeat' ? locate(item.items, id) : null
    if (found) {
      return found
    }
  }
  return null
}

/** The menu for row `id`: reorder, copy, group into a repeat, ungroup a repeat, or remove. */
export function rowActions(items: DraftItem[], id: number, newId: NewId): RowAction[] {
  const found = locate(items, id)
  const item = found?.list[found.index]
  if (!found || !item) {
    return []
  }
  const { list, index } = found
  const act = (
    title: string,
    icon: string,
    change: (siblings: DraftItem[], at: number) => DraftItem[],
  ): RowAction => ({ title, icon, change: (all) => editList(all, id, change) })
  return [
    ...(index > 0 ? [act('Move up', 'arrow-up', (l, at) => swap(l, at - 1))] : []),
    ...(index < list.length - 1 ? [act('Move down', 'arrow-down', (l, at) => swap(l, at))] : []),
    act('Duplicate', 'copy', (l, at) => [
      ...l.slice(0, at + 1),
      ...withIds([item], newId),
      ...l.slice(at + 1),
    ]),
    act('Put in a repeat', 'repeat', (l, at) => [
      ...l.slice(0, at),
      { kind: 'repeat', id: newId(), count: '3', every: '', items: [item] },
      ...l.slice(at + 1),
    ]),
    ...(item.kind === 'repeat'
      ? [
          act('Ungroup', 'ungroup', (l, at) => [
            ...l.slice(0, at),
            ...item.items,
            ...l.slice(at + 1),
          ]),
        ]
      : []),
    act('Delete', 'trash-2', (l, at) => [...l.slice(0, at), ...l.slice(at + 1)]),
  ]
}
