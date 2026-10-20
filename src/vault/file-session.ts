import type { App, TFile } from 'obsidian'

import { parseWorkoutNote, type WorkoutNoteModel } from '../domain/workout-note-model'

export interface LoadResult {
  text: string
  model: WorkoutNoteModel | null
  isWorkout: boolean
  warnings: string[]
  mtime: number
}

export type SaveResult = { ok: true; mtime: number } | { ok: false; reason: 'conflict' }

/**
 * Tracks the last-known text and mtime of a TFile. A save is blocked when the text
 * changed since it was last read or written, whatever the mtime says.
 */
export class FileSession {
  private lastText: string | null = null
  private lastMtime: number | null = null

  constructor(
    private app: App,
    public file: TFile,
  ) {}

  async load(): Promise<LoadResult> {
    const text = await this.app.vault.read(this.file)
    const result = parseWorkoutNote(text, this.file.path)
    const mtime = this.file.stat.mtime
    this.lastText = text
    this.lastMtime = mtime
    return {
      text,
      model: result.model,
      isWorkout: result.isWorkout,
      warnings: result.warnings,
      mtime,
    }
  }

  async saveIfUnchanged(nextText: string): Promise<SaveResult> {
    const currentText = await this.app.vault.read(this.file)
    if (this.lastText !== null && currentText !== this.lastText) {
      return { ok: false, reason: 'conflict' }
    }

    let conflict = false
    await this.app.vault.process(this.file, (text) => {
      if (this.lastText !== null && text !== this.lastText) {
        conflict = true
        return text
      }
      return nextText
    })
    if (conflict) return { ok: false, reason: 'conflict' }
    const newMtime = this.file.stat.mtime
    this.lastText = nextText
    this.lastMtime = newMtime
    return { ok: true, mtime: newMtime }
  }

  get snapshotMtime(): number | null {
    return this.lastMtime
  }
}
