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
export function withRestore<R extends ImportRow>(row: R, checked: boolean): R {
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
export function withCreateNote<R extends ImportRow>(row: R, checked: boolean): R {
  return { ...row, createNote: checked, createNoNoteEntry: checked ? false : row.createNoNoteEntry }
}

export function withNoNoteEntry<R extends ImportRow>(row: R, checked: boolean): R {
  return { ...row, createNoNoteEntry: checked, createNote: checked ? false : row.createNote }
}

/** The checkboxes a row offers, in order, or null when it needs no action. */
export type RowChoice = 'restore' | 'create-note' | 'no-note-entry'

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
