import type { ExerciseKind } from './workout-note-model'
import type { FitKitIndex, IndexEntry, WeightSet } from './types'

export interface ExerciseHistoryAnchor {
  sourcePath: string
  date?: string
  today?: string
}

export interface StrengthExerciseHistory {
  personalBest?: WeightSet
  lastSessionMax?: WeightSet
}

export interface DurationExerciseHistory {
  personalBestSeconds?: number
  lastSessionMaxSeconds?: number
}

export interface ExerciseHistorySummary {
  strength?: StrengthExerciseHistory
  duration?: DurationExerciseHistory
}

export interface ExerciseHistoryBadge {
  text: string
  title: string
}

export type ExerciseHistoryByName = Map<string, ExerciseHistorySummary>

interface SessionMetric<T> {
  date: string
  path: string
  value: T
}

interface ExerciseHistoryDraft {
  strengthPersonalBest?: WeightSet
  strengthLastSessionMax?: SessionMetric<WeightSet>
  durationPersonalBestSeconds?: number
  durationLastSessionMaxSeconds?: SessionMetric<number>
}

const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/

export function buildExerciseHistoryMap(
  index: FitKitIndex,
  anchor: ExerciseHistoryAnchor,
): ExerciseHistoryByName {
  const anchorDate = resolveWorkoutAnchorDate(anchor)
  const sourcePath = normalizePathKey(anchor.sourcePath)
  const drafts = new Map<string, ExerciseHistoryDraft>()

  for (const entry of index.entries) {
    const entryPath = normalizePathKey(entry.path)
    if (entryPath === sourcePath) {
      continue
    }
    const entryDate = resolveWorkoutAnchorDate({
      sourcePath: entry.path,
      date: entry.date,
      today: anchor.today,
    })
    if (entryDate >= anchorDate) {
      continue
    }
    addEntryToDrafts(drafts, entry, entryDate)
  }

  return finalizeDrafts(drafts)
}

export function formatExerciseHistoryBadges(
  summary: ExerciseHistorySummary | undefined,
  kind: ExerciseKind,
): ExerciseHistoryBadge[] {
  if (!summary) {
    return []
  }

  if (kind === 'duration') {
    const history = summary.duration
    return [
      history?.personalBestSeconds !== undefined
        ? {
            text: `PB ${formatSeconds(history.personalBestSeconds)}`,
            title: 'Longest session total duration',
          }
        : null,
      history?.lastSessionMaxSeconds !== undefined
        ? {
            text: `Last ${formatSeconds(history.lastSessionMaxSeconds)}`,
            title: 'Latest prior session total duration',
          }
        : null,
    ].filter((badge): badge is ExerciseHistoryBadge => badge !== null)
  }

  const history = summary.strength
  return [
    history?.personalBest
      ? {
          text: `PB ${formatWeightSet(history.personalBest)}`,
          title: 'Heaviest weight lifted (not 1RM)',
        }
      : null,
    history?.lastSessionMax
      ? {
          text: `Last ${formatWeightSet(history.lastSessionMax)}`,
          title: 'Heaviest weight in latest prior session',
        }
      : null,
  ].filter((badge): badge is ExerciseHistoryBadge => badge !== null)
}

export function pickMaxWeightSet(
  sets: ReadonlyArray<{ weight?: number; reps?: number }>,
): WeightSet | null {
  const candidates = sets.filter(isWeightedSetCandidate)
  const first = candidates[0]
  if (!first) {
    return null
  }

  return candidates.slice(1).reduce(pickHeavierWeightSet, first)
}

export function resolveWorkoutAnchorDate(anchor: ExerciseHistoryAnchor): string {
  const date = isoDatePrefix(anchor.date ?? '')
  if (date) {
    return date
  }

  const filenameDate = isoDatePrefix(anchor.sourcePath.split('/').pop() ?? '')
  if (filenameDate) {
    return filenameDate
  }

  return anchor.today ?? formatTodayIsoDate()
}

function addEntryToDrafts(
  drafts: Map<string, ExerciseHistoryDraft>,
  entry: IndexEntry,
  entryDate: string,
): void {
  for (const row of entry.exercises) {
    const draft = drafts.get(row.exerciseName) ?? {}
    let hasMetric = false

    if (row.kind === 'strength' && row.maxWeightSet) {
      hasMetric = true
      draft.strengthPersonalBest = draft.strengthPersonalBest
        ? pickHeavierWeightSet(draft.strengthPersonalBest, row.maxWeightSet)
        : row.maxWeightSet
      const candidate = {
        date: entryDate,
        path: entry.path,
        value: row.maxWeightSet,
      }
      if (
        !draft.strengthLastSessionMax ||
        isLaterSession(candidate, draft.strengthLastSessionMax)
      ) {
        draft.strengthLastSessionMax = candidate
      }
    }

    if (
      row.kind === 'duration' &&
      row.totalDurationSeconds !== undefined &&
      row.totalDurationSeconds > 0
    ) {
      hasMetric = true
      draft.durationPersonalBestSeconds =
        draft.durationPersonalBestSeconds !== undefined
          ? Math.max(draft.durationPersonalBestSeconds, row.totalDurationSeconds)
          : row.totalDurationSeconds
      const candidate = {
        date: entryDate,
        path: entry.path,
        value: row.totalDurationSeconds,
      }
      if (
        !draft.durationLastSessionMaxSeconds ||
        isLaterSession(candidate, draft.durationLastSessionMaxSeconds)
      ) {
        draft.durationLastSessionMaxSeconds = candidate
      }
    }

    if (hasMetric) {
      drafts.set(row.exerciseName, draft)
    }
  }
}

function finalizeDrafts(drafts: Map<string, ExerciseHistoryDraft>): ExerciseHistoryByName {
  const history = new Map<string, ExerciseHistorySummary>()

  for (const [exerciseName, draft] of drafts.entries()) {
    const summary: ExerciseHistorySummary = {}
    if (draft.strengthPersonalBest || draft.strengthLastSessionMax) {
      summary.strength = {
        personalBest: draft.strengthPersonalBest,
        lastSessionMax: draft.strengthLastSessionMax?.value,
      }
    }
    if (
      draft.durationPersonalBestSeconds !== undefined ||
      draft.durationLastSessionMaxSeconds !== undefined
    ) {
      summary.duration = {
        personalBestSeconds: draft.durationPersonalBestSeconds,
        lastSessionMaxSeconds: draft.durationLastSessionMaxSeconds?.value,
      }
    }
    history.set(exerciseName, summary)
  }

  return history
}

function isWeightedSetCandidate(set: { weight?: number; reps?: number }): set is WeightSet {
  return (
    set.weight !== undefined &&
    set.reps !== undefined &&
    Number.isFinite(set.weight) &&
    Number.isFinite(set.reps) &&
    set.weight > 0 &&
    set.reps > 0
  )
}

function pickHeavierWeightSet(left: WeightSet, right: WeightSet): WeightSet {
  if (right.weight > left.weight) {
    return right
  }
  if (right.weight === left.weight && right.reps > left.reps) {
    return right
  }
  return left
}

function isLaterSession<T>(candidate: SessionMetric<T>, current: SessionMetric<T>): boolean {
  if (candidate.date !== current.date) {
    return candidate.date > current.date
  }
  return candidate.path > current.path
}

function formatWeightSet(set: WeightSet): string {
  return `${formatNumber(set.weight)} kg x ${formatNumber(set.reps)}`
}

function formatSeconds(seconds: number): string {
  return `${formatNumber(seconds)}s`
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)))
}

function isoDatePrefix(value: string): string | null {
  return value.match(ISO_DATE_PREFIX)?.[1] ?? null
}

function normalizePathKey(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+/g, '/')
}

function formatTodayIsoDate(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
