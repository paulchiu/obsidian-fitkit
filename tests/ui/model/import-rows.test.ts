import { describe, expect, it } from 'vitest'

import {
  rowChoices,
  withCreateNote,
  withNoNoteEntry,
  withRestore,
  type ImportRow,
} from '../../../src/ui/model/import-rows'

const row = (overrides: Partial<ImportRow> = {}): ImportRow => ({
  name: 'Plank',
  type: 'duration',
  status: 'missing',
  registryName: null,
  noteExists: false,
  createNote: false,
  createNoNoteEntry: false,
  restoreIgnored: false,
  ...overrides,
})

describe('rowChoices', () => {
  it('offers nothing for a known exercise with a note', () => {
    expect(rowChoices(row({ status: 'known', registryName: 'Plank', noteExists: true }))).toBeNull()
  })

  it('offers what is missing: a note, a no-note entry, or both', () => {
    expect([
      rowChoices(row()),
      rowChoices(row({ status: 'known', registryName: 'Plank' })),
      rowChoices(row({ noteExists: true })),
    ]).toEqual([['create-note', 'no-note-entry'], ['create-note'], ['no-note-entry']])
  })

  it('offers only Restore for an ignored exercise until it is restored', () => {
    const ignored = row({ status: 'ignored' })

    expect([rowChoices(ignored), rowChoices({ ...ignored, restoreIgnored: true })]).toEqual([
      ['restore'],
      ['restore', 'create-note', 'no-note-entry'],
    ])
  })
})

describe('withRestore', () => {
  it('picks a note for an exercise with neither a note nor an entry', () => {
    expect(withRestore(row({ status: 'ignored' }), true)).toMatchObject({
      restoreIgnored: true,
      createNote: true,
    })
  })

  it('leaves the choice alone for one that has a note or an entry', () => {
    expect([
      withRestore(row({ status: 'ignored', noteExists: true }), true).createNote,
      withRestore(row({ status: 'ignored', registryName: 'Plank' }), true).createNote,
    ]).toEqual([false, false])
  })

  it('clears both choices when unticked', () => {
    const chosen = row({ status: 'ignored', restoreIgnored: true, createNote: true })

    expect([
      withRestore(chosen, false),
      withRestore({ ...chosen, createNote: false, createNoNoteEntry: true }, false),
    ]).toEqual([
      { ...chosen, restoreIgnored: false, createNote: false, createNoNoteEntry: false },
      { ...chosen, restoreIgnored: false, createNote: false, createNoNoteEntry: false },
    ])
  })
})

describe('note and no-note entry', () => {
  it('exclude each other when ticked', () => {
    expect([
      withCreateNote(row({ createNoNoteEntry: true }), true),
      withNoNoteEntry(row({ createNote: true }), true),
    ]).toEqual([
      row({ createNote: true, createNoNoteEntry: false }),
      row({ createNote: false, createNoNoteEntry: true }),
    ])
  })

  it('leave the other alone when unticked', () => {
    expect([
      withCreateNote(row({ createNote: true }), false),
      withNoNoteEntry(row({ createNoNoteEntry: true, createNote: false }), false),
    ]).toEqual([row(), row()])
  })
})
