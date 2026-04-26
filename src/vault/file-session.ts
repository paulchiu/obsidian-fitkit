import type { App, TFile } from 'obsidian'

import { fnv1a32 } from '../domain/hash'
import { parseWorkoutNote, type WorkoutNoteModel } from '../domain/workout-note-model'

export interface LoadResult {
  text: string
  model: WorkoutNoteModel | null
  isWorkout: boolean
  warnings: string[]
  hash: string
  mtime: number
}

export type SaveResult =
  | { ok: true; hash: string; mtime: number }
  | { ok: false; reason: 'mtime' | 'hash' }

/**
 * Tracks the last-known text hash and mtime of a TFile so stale writes can be blocked.
 */
export class FileSession {
  private lastHash: string | null = null
  private lastMtime: number | null = null

  constructor(
    private app: App,
    public file: TFile,
  ) {}

  async load(): Promise<LoadResult> {
    const text = await this.app.vault.read(this.file)
    const result = parseWorkoutNote(text, this.file.path)
    const hash = fnv1a32(text)
    const mtime = this.file.stat.mtime
    this.lastHash = hash
    this.lastMtime = mtime
    return {
      text,
      model: result.model,
      isWorkout: result.isWorkout,
      warnings: result.warnings,
      hash,
      mtime,
    }
  }

  async saveIfUnchanged(nextText: string): Promise<SaveResult> {
    const currentText = await this.app.vault.read(this.file)
    const currentMtime = this.file.stat.mtime
    if (this.lastMtime !== null && currentMtime !== this.lastMtime) {
      const currentHash = fnv1a32(currentText)
      if (this.lastHash !== null && currentHash !== this.lastHash) {
        return { ok: false, reason: 'hash' }
      }
    } else {
      const currentHash = fnv1a32(currentText)
      if (this.lastHash !== null && currentHash !== this.lastHash) {
        return { ok: false, reason: 'hash' }
      }
    }

    await this.app.vault.process(this.file, () => nextText)
    const newHash = fnv1a32(nextText)
    const newMtime = this.file.stat.mtime
    this.lastHash = newHash
    this.lastMtime = newMtime
    return { ok: true, hash: newHash, mtime: newMtime }
  }

  get snapshotHash(): string | null {
    return this.lastHash
  }

  get snapshotMtime(): number | null {
    return this.lastMtime
  }
}
