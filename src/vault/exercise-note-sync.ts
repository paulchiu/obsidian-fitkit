import type { App, TFile } from 'obsidian'

import { formatErrorMessage } from '../domain/error'
import { createRegistry, type ExerciseRegistryEntry } from '../domain/exercise-registry'
import {
  migrateExerciseNote,
  type ExerciseNoteMigrationOptions,
} from '../domain/exercise-note-migrate'
import type { FitKitSettings } from '../settings'
import { exercisesFolder } from '../settings-paths'
import { buildExerciseRegistrySnapshot } from './exercise-registry-vault'
import { markdownFilesInFolder } from './folder-scan'

type NoteSyncOutcome =
  | { kind: 'skipped-non-exercise' }
  | { kind: 'skipped-malformed' }
  | { kind: 'unreadable'; path: string; message: string }
  | {
      kind: 'checked'
      file: TFile
      input: ExerciseNoteMigrationOptions
      changed: boolean
      needsValidation: boolean
      customRecentSessions: boolean
      customNotesSection: boolean
      kindConflict: boolean
      /** Set when writing the repaired note failed. */
      writeError?: string
    }

/** What syncing would do to each exercise note, read without writing anything. */
export interface ExerciseNoteSyncPlan {
  outcomes: NoteSyncOutcome[]
  snapshotConflictPaths: string[]
}

export interface ExerciseNoteSyncSummary {
  files: number
  updated: number
  already: number
  skipped: number
  skippedMalformedFrontmatter: number
  needsValidation: number
  failed: number
  failedPaths: string[]
  customisedRecentSessions: number
  customisedNotesSections: number
  conflicts: number
}

/** Plans the sync against `registryEntries`, so a preview can count against entries not yet saved. */
export async function planExerciseNoteSync(
  app: App,
  settings: FitKitSettings,
  registryEntries: ExerciseRegistryEntry[],
): Promise<ExerciseNoteSyncPlan> {
  const files = markdownFilesInFolder(app, exercisesFolder(settings))
  const snapshotConflictPaths = buildExerciseRegistrySnapshot(app, settings)
    .diagnostics.filter((diagnostic) => diagnostic.kind === 'registry-kind-conflict')
    .flatMap((diagnostic) => (diagnostic.path ? [diagnostic.path] : []))
  const registry = createRegistry(registryEntries)
  const outcomes: NoteSyncOutcome[] = []
  for (const file of files) {
    try {
      const source = await app.vault.read(file)
      const input = { name: file.basename, registry, fitnessRoot: settings.fitnessRoot }
      const result = migrateExerciseNote(source, input)
      if (result.status === 'skipped-non-exercise-type') {
        outcomes.push({ kind: 'skipped-non-exercise' })
        continue
      }
      if (result.status === 'skipped-malformed-frontmatter') {
        outcomes.push({ kind: 'skipped-malformed' })
        continue
      }
      const warned = (kind: string): boolean =>
        result.warnings.some((warning) => warning.kind === kind)
      outcomes.push({
        kind: 'checked',
        file,
        input,
        changed: result.changed,
        needsValidation: result.status === 'unknown',
        customRecentSessions: warned('custom-recent-sessions'),
        customNotesSection: warned('custom-notes-section'),
        kindConflict: warned('registry-kind-conflict'),
      })
    } catch (error) {
      outcomes.push({ kind: 'unreadable', path: file.path, message: formatErrorMessage(error) })
    }
  }
  return { outcomes, snapshotConflictPaths }
}

/** Writes every planned change, re-migrating the live text so an edit since the plan survives. */
export async function applyExerciseNoteSync(
  app: App,
  plan: ExerciseNoteSyncPlan,
): Promise<ExerciseNoteSyncPlan> {
  const outcomes: NoteSyncOutcome[] = []
  for (const outcome of plan.outcomes) {
    if (outcome.kind !== 'checked' || !outcome.changed) {
      outcomes.push(outcome)
      continue
    }
    try {
      await app.vault.process(
        outcome.file,
        (live) => migrateExerciseNote(live, outcome.input).markdown,
      )
      outcomes.push(outcome)
    } catch (error) {
      outcomes.push({ ...outcome, writeError: formatErrorMessage(error) })
    }
  }
  return { ...plan, outcomes }
}

export function summariseExerciseNoteSync(plan: ExerciseNoteSyncPlan): ExerciseNoteSyncSummary {
  const conflictPaths = new Set(plan.snapshotConflictPaths)
  const summary: ExerciseNoteSyncSummary = {
    files: plan.outcomes.length,
    updated: 0,
    already: 0,
    skipped: 0,
    skippedMalformedFrontmatter: 0,
    needsValidation: 0,
    failed: 0,
    failedPaths: [],
    customisedRecentSessions: 0,
    customisedNotesSections: 0,
    conflicts: 0,
  }
  for (const outcome of plan.outcomes) {
    switch (outcome.kind) {
      case 'skipped-non-exercise':
        summary.skipped += 1
        break
      case 'skipped-malformed':
        summary.skippedMalformedFrontmatter += 1
        break
      case 'unreadable':
        summary.failed += 1
        summary.failedPaths.push(`${outcome.path}: ${outcome.message}`)
        break
      case 'checked':
        summary.customisedRecentSessions += outcome.customRecentSessions ? 1 : 0
        summary.customisedNotesSections += outcome.customNotesSection ? 1 : 0
        if (outcome.kindConflict) {
          conflictPaths.add(outcome.file.path)
        }
        if (outcome.writeError !== undefined) {
          summary.failed += 1
          summary.failedPaths.push(`${outcome.file.path}: ${outcome.writeError}`)
          break
        }
        summary.needsValidation += outcome.needsValidation ? 1 : 0
        if (outcome.changed) {
          summary.updated += 1
        } else {
          summary.already += 1
        }
        break
    }
  }
  return { ...summary, conflicts: conflictPaths.size }
}

const plural = (count: number, word: string, suffix = 's'): string =>
  `${count} ${word}${count === 1 ? '' : suffix}`

export function formatExerciseNoteSyncSummary(summary: ExerciseNoteSyncSummary): string {
  const failedHint = summary.failedPaths[0] ? ` (first failure: ${summary.failedPaths[0]})` : ''
  const customisedWarnings = [
    summary.customisedRecentSessions > 0
      ? plural(summary.customisedRecentSessions, 'customised recent sessions block')
      : null,
    summary.customisedNotesSections > 0
      ? plural(summary.customisedNotesSections, 'customised notes section')
      : null,
  ].filter((warning): warning is string => warning !== null)
  const customisedSummary =
    customisedWarnings.length > 0 ? ` ${customisedWarnings.join(', ')} left alone.` : ''
  const validationSummary =
    summary.needsValidation > 0
      ? ` (${summary.needsValidation} ${
          summary.needsValidation === 1 ? 'needs' : 'need'
        } validation: kind inferred/defaulted without registry, review kind and metric)`
      : ''
  const conflictSummary =
    summary.conflicts > 0
      ? `, ${plural(summary.conflicts, 'registry kind conflict')} preserved`
      : ''
  return `Synced ${plural(summary.files, 'exercise note')}; ${summary.updated} updated${validationSummary}, ${summary.already} already current, ${summary.skipped} skipped (non-exercise type), ${summary.skippedMalformedFrontmatter} skipped (malformed frontmatter), ${summary.failed} failed${failedHint}${conflictSummary}.${customisedSummary}`
}
