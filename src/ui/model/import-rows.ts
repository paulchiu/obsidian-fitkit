import type { ExerciseType } from '../../domain/exercise-type'

/** The parts of an import row the modal draws and edits; the planner's own row satisfies it. */
export interface ImportRow {
  name: string
  type: ExerciseType
  status: 'known' | 'missing' | 'ignored'
  registryName: string | null
  noteExists: boolean
  createNote: boolean
  createNoNoteEntry: boolean
  restoreIgnored: boolean
}

/** Ticking Restore on an ignored exercise offers a note when it has neither; unticking clears both choices. */
export function withRestore(row: ImportRow, checked: boolean): ImportRow {
  if (checked) {
    return {
      ...row,
      restoreIgnored: true,
      createNote: !row.noteExists && !row.registryName ? true : row.createNote,
    }
  }
  return { ...row, restoreIgnored: false, createNote: false, createNoNoteEntry: false }
}

/** Creating a note and creating a no-note entry exclude each other. */
export function withCreateNote(row: ImportRow, checked: boolean): ImportRow {
  return { ...row, createNote: checked, createNoNoteEntry: checked ? false : row.createNoNoteEntry }
}

export function withNoNoteEntry(row: ImportRow, checked: boolean): ImportRow {
  return { ...row, createNoNoteEntry: checked, createNote: checked ? false : row.createNote }
}

export type RowChoice = 'restore' | 'create-note' | 'no-note-entry'

/** The checkboxes a row offers, in order, or null when it needs no action. */
export function rowChoices(row: ImportRow): RowChoice[] | null {
  if (row.status === 'known' && row.noteExists) {
    return null
  }
  const choices: RowChoice[] = []
  if (row.status === 'ignored') {
    choices.push('restore')
    if (!row.restoreIgnored) {
      return choices
    }
  }
  if (!row.noteExists) {
    choices.push('create-note')
  }
  if (!row.registryName) {
    choices.push('no-note-entry')
  }
  return choices
}
