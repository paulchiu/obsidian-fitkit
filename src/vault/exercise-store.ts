import type { App } from 'obsidian'
import { TFile, normalizePath } from 'obsidian'

import { formatErrorMessage } from '../domain/error'
import {
  createRegistry,
  intervalMarker,
  kindForName,
  levelsForName,
  normalize,
  upsertEntry,
  type ExerciseKind,
  type ExerciseRegistry,
  type ExerciseRegistryEntry,
} from '../domain/exercise-registry'
import {
  setExerciseNoteLevels,
  setExerciseNoteType,
  type ExerciseNoteKindUpdateResult,
  type ExerciseNoteLevelsUpdateResult,
} from '../domain/exercise-note-migrate'
import { kindOfType, type ExerciseType } from '../domain/exercise-type'
import type { FitKitSettings } from '../settings'
import { exercisesFolder, workoutsFolder } from '../settings-paths'
import { findExerciseNotePath } from './exercise-catalog'
import { composeExerciseNote } from './exercise-note'
import {
  applyLadderOverrides,
  bodyweightLevelsFor,
  exerciseRegistryWithVaultNotes,
  sameLevels,
} from './exercise-registry-vault'
import { ensureParentFolder } from './vault-utils'

/** The plugin's settings object and the call that persists it. */
export interface SettingsHolder {
  settings: FitKitSettings
  saveSettings(): Promise<void>
}

/**
 * Where a write landed. `note-unchanged` means a note owns the exercise but
 * its frontmatter could not be rewritten, so nothing was written anywhere.
 */
export type ExerciseWriteTarget = 'note' | 'registry' | 'note-unchanged'

export interface TypeRecordResult {
  name: string
  /** `note` also mirrors the type into the registry entry. */
  wrote: ExerciseWriteTarget
  /** The note's Recent sessions query looked customised, so it was left reading the old kind. */
  customRecentSessions: boolean
}

export interface LadderRecordResult {
  name: string
  wrote: ExerciseWriteTarget
}

export type EnsureKnownResult =
  | { outcome: 'note-created' }
  | { outcome: 'note-reused'; restored: boolean }
  | { outcome: 'registry-added' }
  | { outcome: 'already-known' }
  | { outcome: 'note-failed'; message: string }

export interface ExerciseStore {
  /** Merged registry snapshot, with ladders this store wrote overlaid until the cache reports them. */
  registry(): ExerciseRegistry
  /** Freshest ladder for an exercise, preferring one this store wrote over the snapshot. */
  levelsFor(name: string): string[] | undefined
  /** Records an exercise's type; null when the name is blank. */
  recordType(name: string, type: ExerciseType): Promise<TypeRecordResult | null>
  /** Records a bodyweight ladder; null when the name is blank. */
  recordLadder(name: string, levels: string[]): Promise<LadderRecordResult | null>
  /** Makes a newly added exercise durable as a note or a no-note registry entry, clearing any tombstone. */
  ensureKnown(
    name: string,
    kind: ExerciseKind,
    options: { createNote: boolean },
  ): Promise<EnsureKnownResult>
  /** Removes the exercise's deletion tombstone; false when there was none. */
  undelete(name: string): Promise<boolean>
}

/**
 * Writes an exercise's durable state to whichever store wins on read: its note if one exists, else its registry entry.
 * Ladder writes are remembered because the metadata cache reports a note write only after it lands.
 */
export function createExerciseStore(app: App, holder: SettingsHolder): ExerciseStore {
  const ladderOverrides = new Map<string, string[]>()

  const noteFileFor = (name: string): TFile | null => {
    const path = findExerciseNotePath(app, holder.settings, name)
    const file = path ? app.vault.getAbstractFileByPath(path) : null
    return file instanceof TFile ? file : null
  }

  const upsertRegistryEntry = async (
    name: string,
    build: (existing: ExerciseRegistryEntry | undefined) => ExerciseRegistryEntry,
  ): Promise<void> => {
    const settings = holder.settings
    const current = createRegistry(settings.exerciseRegistry)
    const key = normalize(name)
    const existing = current.entries.find((entry) => normalize(entry.name) === key)
    settings.exerciseRegistry = upsertEntry(current, build(existing)).entries
    await holder.saveSettings()
  }

  const recordRegistryType = (name: string, type: ExerciseType): Promise<void> => {
    const kind = kindOfType(type)
    const marker = intervalMarker({ kind, interval: type === 'interval' })
    return upsertRegistryEntry(name, (existing) =>
      existing
        ? { ...existing, aliases: [...existing.aliases], kind, interval: undefined, ...marker }
        : { name, kind, aliases: [], ...marker },
    )
  }

  /** Drops overrides the snapshot has caught up with, so a later outside edit is not hidden. */
  const pruneLadderOverrides = (snapshot: ExerciseRegistry): void => {
    for (const [key, levels] of ladderOverrides) {
      if (sameLevels(levelsForName(snapshot, key) ?? [], levels)) {
        ladderOverrides.delete(key)
      }
    }
  }

  return {
    registry() {
      const snapshot = createRegistry(exerciseRegistryWithVaultNotes(app, holder.settings))
      pruneLadderOverrides(snapshot)
      return createRegistry(applyLadderOverrides(snapshot.entries, ladderOverrides))
    },

    levelsFor(name) {
      const override = ladderOverrides.get(normalize(name))
      if (override !== undefined) {
        return [...override]
      }
      return bodyweightLevelsFor(app, holder.settings, name)
    },

    /**
     * A changed note also updates the registry entry: the settings table reads
     * the registry on its own, and a stale copy would conflict with the note.
     */
    async recordType(name, type) {
      const trimmed = name.trim()
      if (!trimmed) {
        return null
      }
      const noteFile = noteFileFor(trimmed)
      if (!noteFile) {
        await recordRegistryType(trimmed, type)
        return { name: trimmed, wrote: 'registry', customRecentSessions: false }
      }
      let result: ExerciseNoteKindUpdateResult | undefined
      await app.vault.process(noteFile, (text) => {
        result = setExerciseNoteType(text, type, {
          name: noteFile.basename,
          fitnessRoot: holder.settings.fitnessRoot,
        })
        return result.markdown
      })
      const customRecentSessions =
        result?.warnings.some((warning) => warning.kind === 'custom-recent-sessions') ?? false
      if (!result?.changed) {
        return { name: trimmed, wrote: 'note-unchanged', customRecentSessions }
      }
      await recordRegistryType(trimmed, type)
      return { name: trimmed, wrote: 'note', customRecentSessions }
    },

    async recordLadder(name, levels) {
      const trimmed = name.trim()
      if (!trimmed) {
        return null
      }
      const key = normalize(trimmed)
      const noteFile = noteFileFor(trimmed)
      if (noteFile) {
        let result: ExerciseNoteLevelsUpdateResult | undefined
        await app.vault.process(noteFile, (text) => {
          result = setExerciseNoteLevels(text, levels)
          return result.markdown
        })
        if (!result?.changed) {
          return { name: trimmed, wrote: 'note-unchanged' }
        }
        ladderOverrides.set(key, [...levels])
        return { name: trimmed, wrote: 'note' }
      }
      await upsertRegistryEntry(trimmed, (existing) =>
        existing
          ? { ...existing, aliases: [...existing.aliases], levels: [...levels] }
          : { name: trimmed, kind: 'bodyweight', aliases: [], levels: [...levels] },
      )
      ladderOverrides.set(key, [...levels])
      return { name: trimmed, wrote: 'registry' }
    },

    /**
     * A created note still gets a registry entry, because the settings
     * Registry table lists `settings.exerciseRegistry` rather than the
     * note-merged snapshot.
     */
    async ensureKnown(name, kind, options) {
      const settings = holder.settings
      const remainingTombstones = withoutTombstone(settings.deletedExercises, name)
      let settingsChanged = false
      let result: EnsureKnownResult = { outcome: 'already-known' }

      const addRegistryEntry = (): boolean => {
        const registry = createRegistry(settings.exerciseRegistry)
        if (kindForName(registry, name) !== null) {
          return false
        }
        settings.exerciseRegistry = upsertEntry(registry, { name, kind, aliases: [] }).entries
        settingsChanged = true
        return true
      }

      if (options.createNote) {
        const path = normalizePath(`${exercisesFolder(settings)}/${name}.md`)
        if (!app.vault.getAbstractFileByPath(path)) {
          try {
            await ensureParentFolder(app, path)
            await app.vault.create(path, composeExerciseNote(name, kind, workoutsFolder(settings)))
          } catch (error) {
            return { outcome: 'note-failed', message: formatErrorMessage(error) }
          }
          addRegistryEntry()
          result = { outcome: 'note-created' }
        } else {
          result = { outcome: 'note-reused', restored: remainingTombstones !== null }
        }
      } else if (addRegistryEntry()) {
        result = { outcome: 'registry-added' }
      }

      if (remainingTombstones !== null) {
        settings.deletedExercises = remainingTombstones
        settingsChanged = true
      }
      if (settingsChanged) {
        await holder.saveSettings()
      }
      return result
    },

    async undelete(name) {
      const remaining = withoutTombstone(holder.settings.deletedExercises, name)
      if (remaining === null) {
        return false
      }
      holder.settings.deletedExercises = remaining
      await holder.saveSettings()
      return true
    },
  }
}

/** Tombstones without `name`'s, or null when `name` has none. */
function withoutTombstone(
  deletedExercises: readonly string[] | undefined,
  name: string,
): string[] | null {
  const key = normalize(name)
  const tombstones = deletedExercises ?? []
  if (!tombstones.some((deletedName) => normalize(deletedName) === key)) {
    return null
  }
  return tombstones.filter((deletedName) => normalize(deletedName) !== key)
}
