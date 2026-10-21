import type { App, TFile } from 'obsidian'
import { normalizePath } from 'obsidian'

import { formatErrorMessage } from '../domain/error'
import {
  migrateExerciseNote,
  type ExerciseNoteMigrationWarning,
} from '../domain/exercise-note-migrate'
import { createRegistry, normalize, removeEntry, upsertEntry } from '../domain/exercise-registry'
import {
  buildExerciseRenamePlan,
  rewriteWorkoutNoteOccurrences,
  type ExerciseRenameCatalogEntry,
  type ExerciseRenameOperation,
  type ExerciseRenamePlan,
} from '../domain/exercise-rename-planner'
import { parseWorkoutNote } from '../domain/workout-note-model'
import type { FitKitSettings } from '../settings'
import { dirnameOf, exercisesFolder, normalizeFolder, workoutsFolder } from '../settings-paths'
import { findExerciseNoteFile, readExerciseCatalog } from './exercise-catalog'
import { markdownFilesInFolder } from './folder-scan'
import { isMarkdownFile } from './vault-utils'

/**
 * Gathers the vault state a rename plan needs and builds it via the pure `buildExerciseRenamePlan`.
 * Reads with `vault.read` (not `cachedRead`) so the preview reflects current on-disk text.
 */
export async function buildExerciseRenamePlanFromVault(
  app: App,
  settings: FitKitSettings,
  oldName: string,
  newName: string,
): Promise<ExerciseRenamePlan> {
  const catalogSnapshot = readExerciseCatalog(app, settings)
  const catalog: ExerciseRenameCatalogEntry[] = catalogSnapshot.entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    kind: entry.kind,
  }))

  const oldKey = normalize(oldName)
  const sourceNote = catalog.find((entry) => normalize(entry.name) === oldKey) ?? null
  const sourceNoteUnreadable =
    sourceNote === null && findExerciseNoteFile(app, settings, oldName) !== null
  const sourceNoteText = sourceNote ? await readFileText(app, sourceNote.path) : undefined

  const workoutNotes = await collectWorkoutNoteTexts(app, settings)

  const trimmedNewName = newName.trim()
  const targetPathOccupiedByUnrelatedFile =
    trimmedNewName.length > 0
      ? isTargetPathOccupiedByUnrelatedFile(app, settings, catalog, sourceNote, trimmedNewName)
      : false

  return buildExerciseRenamePlan({
    oldName,
    newName,
    registry: settings.exerciseRegistry,
    catalog,
    deletedExercises: settings.deletedExercises ?? [],
    workoutNotes,
    sourceNoteText,
    sourceNoteUnreadable,
    targetPathOccupiedByUnrelatedFile,
  })
}

export interface ExerciseRenameApplyFailure {
  path: string
  stage: 'note-rename' | 'workout-note-rewrite' | 'note-migrate' | 'note-remove'
  message: string
}

export interface ExerciseRenameApplyResult {
  operation: ExerciseRenameOperation
  noteRenamed: boolean
  finalNotePath: string | null
  workoutNotesRewritten: number
  headingOccurrencesRewritten: number
  fieldOccurrencesRewritten: number
  proseCarried: boolean
  loserNoteRemoved: boolean
  tombstonesReconciled: number
  /**
   * Warnings from regenerating the surviving note's Dataview blocks, e.g. a customised query that
   * didn't follow the rename. Surface these to the user.
   */
  noteMigrationWarnings: ExerciseNoteMigrationWarning[]
  /**
   * Workout notes actually rewritten, for the caller to refresh in its cached index.
   * Left to the plugin because only its `refreshIndexEntry` queue can update the index safely.
   */
  touchedWorkoutPaths: string[]
  failures: ExerciseRenameApplyFailure[]
}

/**
 * Executes a confirmed rename/merge plan in a re-runnable order: rename the note (failure aborts), update
 * registry and tombstones, rewrite each workout note (per-file failures recorded, not fatal), regenerate
 * Dataview blocks, then fold in and remove the losing note on a two-file merge.
 */
export async function applyExerciseRenamePlan(
  app: App,
  settings: FitKitSettings,
  plan: ExerciseRenamePlan,
): Promise<ExerciseRenameApplyResult> {
  if (plan.refusal || plan.operation === null) {
    throw new Error(
      `Cannot apply a refused rename plan: ${plan.refusal?.message ?? 'no operation to apply'}.`,
    )
  }
  const operation = plan.operation

  const failures: ExerciseRenameApplyFailure[] = []
  const willRenameFile = plan.sourceNotePath !== null && !plan.targetNoteExists
  const willRemoveSourceNote =
    operation === 'merge' && plan.sourceNotePath !== null && plan.targetNoteExists

  let noteRenamed = false
  if (willRenameFile && plan.sourceNotePath && plan.targetNotePath) {
    const sourceFile = getMarkdownFile(app, plan.sourceNotePath)
    if (!sourceFile) {
      failures.push({
        path: plan.sourceNotePath,
        stage: 'note-rename',
        message: 'Exercise note file not found.',
      })
      return emptyResult(operation, failures)
    }
    try {
      await app.fileManager.renameFile(sourceFile, plan.targetNotePath)
      noteRenamed = true
    } catch (error) {
      failures.push({
        path: plan.sourceNotePath,
        stage: 'note-rename',
        message: formatErrorMessage(error),
      })
      return emptyResult(operation, failures)
    }
  }

  const finalNotePath = plan.targetNotePath
  updateRegistryOverlay(settings, plan)
  const tombstonesReconciled = reconcileTombstones(settings, plan)

  let workoutNotesRewritten = 0
  let headingOccurrencesRewritten = 0
  let fieldOccurrencesRewritten = 0
  const touchedWorkoutPaths: string[] = []
  for (const notePlan of plan.workoutNotes) {
    const file = getMarkdownFile(app, notePlan.path)
    if (!file) {
      failures.push({
        path: notePlan.path,
        stage: 'workout-note-rewrite',
        message: 'Workout note file not found.',
      })
      continue
    }
    let headingRewrites = 0
    let fieldRewrites = 0
    try {
      await app.vault.process(file, (live) => {
        const result = rewriteWorkoutNoteOccurrences(live, plan.oldName, plan.newName)
        headingRewrites = result.headingRewrites
        fieldRewrites = result.fieldRewrites
        return result.text
      })
    } catch (error) {
      failures.push({
        path: notePlan.path,
        stage: 'workout-note-rewrite',
        message: formatErrorMessage(error),
      })
      continue
    }
    if (headingRewrites > 0 || fieldRewrites > 0) {
      workoutNotesRewritten += 1
      headingOccurrencesRewritten += headingRewrites
      fieldOccurrencesRewritten += fieldRewrites
      touchedWorkoutPaths.push(notePlan.path)
    }
  }

  let noteMigrationWarnings: ExerciseNoteMigrationWarning[] = []
  if (finalNotePath) {
    const file = getMarkdownFile(app, finalNotePath)
    if (file) {
      try {
        const registry = createRegistry(settings.exerciseRegistry)
        const migrateInput = { name: plan.newName, registry, fitnessRoot: settings.fitnessRoot }
        await app.vault.process(file, (live) => {
          const migrated = migrateExerciseNote(live, migrateInput)
          noteMigrationWarnings = migrated.warnings
          return migrated.markdown
        })
      } catch (error) {
        failures.push({
          path: finalNotePath,
          stage: 'note-migrate',
          message: formatErrorMessage(error),
        })
      }
    }
  }

  let proseCarried = false
  let loserNoteRemoved = false
  if (willRemoveSourceNote && plan.sourceNotePath && finalNotePath) {
    const sourceFile = getMarkdownFile(app, plan.sourceNotePath)
    if (sourceFile) {
      try {
        const sourceText = await app.vault.read(sourceFile)
        const prose = extractNotesProse(sourceText)
        if (prose.length > 0) {
          const targetFile = getMarkdownFile(app, finalNotePath)
          if (targetFile) {
            await app.vault.process(targetFile, (live) =>
              mergeProseIntoNotesSection(live, prose, plan.oldName),
            )
            proseCarried = true
          }
        }
        await app.fileManager.trashFile(sourceFile)
        loserNoteRemoved = true
      } catch (error) {
        failures.push({
          path: plan.sourceNotePath,
          stage: 'note-remove',
          message: formatErrorMessage(error),
        })
      }
    }
  }

  return {
    operation,
    noteRenamed,
    finalNotePath,
    workoutNotesRewritten,
    headingOccurrencesRewritten,
    fieldOccurrencesRewritten,
    proseCarried,
    loserNoteRemoved,
    tombstonesReconciled,
    noteMigrationWarnings,
    touchedWorkoutPaths,
    failures,
  }
}

function emptyResult(
  operation: ExerciseRenameOperation,
  failures: ExerciseRenameApplyFailure[],
): ExerciseRenameApplyResult {
  return {
    operation,
    noteRenamed: false,
    finalNotePath: null,
    workoutNotesRewritten: 0,
    headingOccurrencesRewritten: 0,
    fieldOccurrencesRewritten: 0,
    proseCarried: false,
    loserNoteRemoved: false,
    tombstonesReconciled: 0,
    noteMigrationWarnings: [],
    touchedWorkoutPaths: [],
    failures,
  }
}

/**
 * Removes the source entry (and, on a merge, the target's owner) and upserts one entry under
 * `plan.newName` with `plan.aliasesToKeep`, `plan.resultKind` and `plan.resultUnit`.
 * Never synthesizes a unit the folded-in entries lacked.
 */
function updateRegistryOverlay(settings: FitKitSettings, plan: ExerciseRenamePlan): void {
  let registry = createRegistry(settings.exerciseRegistry)
  registry = removeEntry(registry, plan.oldName)
  if (plan.operation === 'merge') {
    const newKey = normalize(plan.newName)
    const owner = registry.entries.find(
      (entry) =>
        normalize(entry.name) === newKey ||
        entry.aliases.some((alias) => normalize(alias) === newKey),
    )
    if (owner) {
      registry = removeEntry(registry, owner.name)
    }
  }
  registry = upsertEntry(registry, {
    name: plan.newName,
    kind: plan.resultKind,
    unit: plan.resultUnit,
    levels: plan.resultLevels ? [...plan.resultLevels] : undefined,
    ...(plan.resultInterval ? { interval: plan.resultInterval } : {}),
    aliases: plan.aliasesToKeep,
  })
  settings.exerciseRegistry = registry.entries
}

/**
 * Both names are now "in use" by the surviving entry (one canonical, one
 * folded in as an alias), so neither should keep suppressing reappearance
 * as an ignored name.
 */
function reconcileTombstones(settings: FitKitSettings, plan: ExerciseRenamePlan): number {
  const oldKey = normalize(plan.oldName)
  const newKey = normalize(plan.newName)
  const before = settings.deletedExercises ?? []
  const remaining = before.filter((name) => {
    const key = normalize(name)
    return key !== oldKey && key !== newKey
  })
  settings.deletedExercises = remaining
  return before.length - remaining.length
}

function extractNotesProse(noteText: string): string {
  const lines = noteText.split(/\r?\n/)
  const headingIndex = lines.findIndex((line) => /^##\s+Notes\s*$/i.test(line.trim()))
  if (headingIndex < 0) {
    return ''
  }
  let end = lines.length
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+\S/.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  const body: string[] = []
  let fenceToken: string | null = null
  for (const line of lines.slice(headingIndex + 1, end)) {
    if (fenceToken === null) {
      const match = line.match(/^(`{3,})/)
      if (match) {
        fenceToken = match[1] ?? '```'
        continue
      }
      body.push(line)
      continue
    }
    if (line.startsWith(fenceToken)) {
      fenceToken = null
    }
  }
  return body.join('\n').trim()
}

function mergeProseIntoNotesSection(targetText: string, prose: string, sourceName: string): string {
  const lines = targetText.split(/\r?\n/)
  const insertion = ['', `**Merged from ${sourceName}:**`, '', prose, '']
  const headingIndex = lines.findIndex((line) => /^##\s+Notes\s*$/i.test(line.trim()))
  if (headingIndex < 0) {
    return `${targetText.replace(/\n+$/, '')}\n\n## Notes\n${insertion.join('\n')}`
  }
  let end = lines.length
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+\S/.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  return [...lines.slice(0, end), ...insertion, ...lines.slice(end)].join('\n')
}

async function readFileText(app: App, path: string): Promise<string | undefined> {
  const file = getMarkdownFile(app, path)
  return file ? app.vault.read(file) : undefined
}

async function collectWorkoutNoteTexts(
  app: App,
  settings: FitKitSettings,
): Promise<{ path: string; text: string }[]> {
  const files = markdownFilesInFolder(app, workoutsFolder(settings))

  const notes: { path: string; text: string }[] = []
  for (const file of files) {
    const text = await app.vault.read(file)
    const result = parseWorkoutNote(text, file.path)
    if (!result.isWorkout) {
      continue
    }
    notes.push({ path: file.path, text })
  }
  return notes
}

function isTargetPathOccupiedByUnrelatedFile(
  app: App,
  settings: FitKitSettings,
  catalog: readonly ExerciseRenameCatalogEntry[],
  sourceNote: ExerciseRenameCatalogEntry | null,
  trimmedNewName: string,
): boolean {
  const newKey = normalize(trimmedNewName)
  const alreadyCatalogued = catalog.some((entry) => normalize(entry.name) === newKey)
  if (alreadyCatalogued) {
    /** A legitimate merge target, not a collision. */
    return false
  }
  const dir = sourceNote ? dirnameOf(sourceNote.path) : normalizeFolder(exercisesFolder(settings))
  const prospectivePath = normalizePath(`${dir}/${trimmedNewName}.md`)
  return app.vault.getAbstractFileByPath(prospectivePath) !== null
}

function getMarkdownFile(app: App, path: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(path)
  return isMarkdownFile(file) ? file : null
}
