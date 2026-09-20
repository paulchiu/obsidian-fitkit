import type { ExerciseKind } from './workout-note-model'
import {
  bodyweightLevelName,
  formatBodyweightLevelShort,
  formatRungUnit,
  pickBestBodyweightSet,
  type BodyweightLadder,
} from './bodyweight-levels'
import { formatDurationInput } from './duration-input'
import { pickHeaviestSet } from './epley'
import {
  formatNextPlanLabel,
  nextPlanTargetLevel,
  nextPlanTargetWeight,
  planStepUnit,
  type NextPlan,
} from './next-plan'
import type { BodyweightBestSet, FitKitIndex, IndexEntry, LastSessionMax, WeightSet } from './types'
import { DEFAULT_WEIGHT_UNIT, type WeightUnit } from './weight-unit'

export interface ExerciseHistoryAnchor {
  sourcePath: string
  date?: string
  today?: string
}

export interface StrengthExerciseHistory {
  personalBest?: WeightSet
  lastSessionMax?: LastSessionMax<WeightSet>
}

export interface DurationExerciseHistory {
  personalBestSeconds?: number
  lastSessionMaxSeconds?: LastSessionMax<number>
}

export interface BodyweightExerciseHistory {
  personalBest?: BodyweightBestSet
  lastSessionMax?: LastSessionMax<BodyweightBestSet>
}

export interface ExerciseHistorySummary {
  strength?: StrengthExerciseHistory
  duration?: DurationExerciseHistory
  bodyweight?: BodyweightExerciseHistory
  /** Most recent plan the user recorded for this exercise, at any point in the past. */
  nextPlan?: LastSessionMax<NextPlan>
}

export interface ExerciseHistoryBadge {
  text: string
  title: string
}

export interface NextPlanBadge extends ExerciseHistoryBadge {
  icon: string
}

export type ExerciseHistoryByName = Map<string, ExerciseHistorySummary>

/** Plan and completed sets on the card being edited, which the note has not been indexed for yet. */
export interface CurrentExercisePlan {
  plan?: NextPlan
  sessionMax?: WeightSet | null
  sessionBodyweightMax?: BodyweightBestSet | null
}

interface SessionMetric<T> {
  date: string
  mtime: number
  path: string
  value: T
}

interface ExerciseHistoryDraft {
  strengthPersonalBest?: WeightSet
  strengthLastSessionMax?: SessionMetric<WeightSet>
  durationPersonalBestSeconds?: number
  durationLastSessionMaxSeconds?: SessionMetric<number>
  bodyweightPersonalBest?: BodyweightBestSet
  bodyweightLastSessionMax?: SessionMetric<BodyweightBestSet>
  nextPlan?: SessionMetric<NextPlan>
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
  levels?: BodyweightLadder,
): ExerciseHistoryBadge[] {
  if (!summary) {
    return []
  }

  switch (kind) {
    case 'bodyweight': {
      const history = summary.bodyweight
      return [
        history?.personalBest
          ? {
              text: `PB ${formatBodyweightSet(history.personalBest, levels)}`,
              title: `Highest level reached: ${formatBodyweightSet(history.personalBest, levels)}`,
            }
          : null,
        history?.lastSessionMax
          ? {
              text: `last ${formatBodyweightSet(history.lastSessionMax.value, levels)}`,
              title: `Highest level in latest prior session: ${formatBodyweightSet(history.lastSessionMax.value, levels)} (${history.lastSessionMax.date})`,
            }
          : null,
      ].filter((badge): badge is ExerciseHistoryBadge => badge !== null)
    }
    case 'duration': {
      const history = summary.duration
      return [
        history?.personalBestSeconds !== undefined
          ? {
              text: `PB ${formatDurationInput(history.personalBestSeconds)}`,
              title: `Longest session total duration: ${formatDurationInput(history.personalBestSeconds)}`,
            }
          : null,
        history?.lastSessionMaxSeconds !== undefined
          ? {
              text: `last ${formatDurationInput(history.lastSessionMaxSeconds.value)}`,
              title: `Latest prior session total duration: ${formatDurationInput(history.lastSessionMaxSeconds.value)} (${history.lastSessionMaxSeconds.date})`,
            }
          : null,
      ].filter((badge): badge is ExerciseHistoryBadge => badge !== null)
    }
    case 'strength': {
      const history = summary.strength
      return [
        history?.personalBest
          ? {
              text: `PB ${formatWeightSetShort(history.personalBest, { weightOnly: true })}`,
              title: `Heaviest weight lifted (not 1RM): ${formatWeightSet(history.personalBest)}`,
            }
          : null,
        history?.lastSessionMax
          ? {
              text: `last ${formatWeightSetShort(history.lastSessionMax.value)}`,
              title: `Heaviest weight in latest prior session: ${formatWeightSet(history.lastSessionMax.value)} (${history.lastSessionMax.date})`,
            }
          : null,
      ].filter((badge): badge is ExerciseHistoryBadge => badge !== null)
    }
  }
}

/**
 * Badge for the plan in force on the card. A plan recorded on the open card
 * wins over the one carried in from last session, since it is the more recent
 * statement of intent and is the only readout the card offers for it; it is
 * measured against that card's own heaviest set. Shows the resulting weight
 * when the plan carries a step and there is a base to apply it to, since that
 * is the number acted on at the rack; otherwise the direction alone.
 */
export function formatNextPlanBadge(
  summary: ExerciseHistorySummary | undefined,
  kind: ExerciseKind,
  current?: CurrentExercisePlan,
  levels?: BodyweightLadder,
  unit: WeightUnit = DEFAULT_WEIGHT_UNIT,
): NextPlanBadge | null {
  /** Plans are recorded for strength and bodyweight sets; duration has no plan badge. */
  if (kind !== 'strength' && kind !== 'bodyweight') {
    return null
  }
  if (kind === 'bodyweight') {
    return formatBodyweightNextPlanBadge(summary, current, levels)
  }

  const lastWeight = summary?.strength?.lastSessionMax?.value.weight
  const plan = current?.plan ?? summary?.nextPlan?.value
  if (!plan) {
    return null
  }

  const planned = current?.plan ? 'Planned for next time' : `Planned on ${summary?.nextPlan?.date}`
  const baseWeight = current?.plan ? (current.sessionMax?.weight ?? lastWeight) : lastWeight
  const base = baseWeight !== undefined && baseWeight > 0 ? baseWeight : null
  const target = base === null ? null : nextPlanTargetWeight(plan, base)
  const label = formatNextPlanLabel(plan, kind).toLowerCase()
  const change = plan.step === undefined ? label : `${label} ${planStepUnit(kind, plan.step, unit)}`
  const from =
    base !== null && plan.direction !== 'stay' ? ` from ${formatNumber(base)} ${unit}` : ''

  return {
    text: target !== null ? `Next: ${formatNumber(target)} ${unit}` : `Next: ${change}`,
    title: `${planned}: ${change}${from}`,
    icon: nextPlanIcon(plan),
  }
}

/**
 * Badge for a plan over the ladder. A plan recorded on the open card is
 * measured against that card's own best rung, else last session's; the step
 * counts rungs and the target clamps to the ends of the ladder.
 */
function formatBodyweightNextPlanBadge(
  summary: ExerciseHistorySummary | undefined,
  current: CurrentExercisePlan | undefined,
  levels: BodyweightLadder | undefined,
): NextPlanBadge | null {
  const plan = current?.plan ?? summary?.nextPlan?.value
  if (!plan) {
    return null
  }

  const planned = current?.plan ? 'Planned for next time' : `Planned on ${summary?.nextPlan?.date}`
  const lastLevel = summary?.bodyweight?.lastSessionMax?.value.level
  const base = current?.plan ? (current.sessionBodyweightMax?.level ?? lastLevel) : lastLevel
  const target =
    base === undefined || levels === undefined
      ? null
      : nextPlanTargetLevel(plan, base, levels.length)
  const label = formatNextPlanLabel(plan, 'bodyweight').toLowerCase()
  const change = plan.step === undefined ? label : `${label} ${formatRungUnit(plan.step)}`
  const from =
    base !== undefined && levels !== undefined && plan.direction !== 'stay'
      ? ` from ${formatBodyweightLevelShort(base)} ${bodyweightLevelName(levels, base)}`
      : ''

  return {
    text:
      target !== null && levels !== undefined
        ? `Next: ${formatBodyweightLevelShort(target)} ${bodyweightLevelName(levels, target)}`
        : `Next: ${change}`,
    title: `${planned}: ${change}${from}`,
    icon: nextPlanIcon(plan),
  }
}

export function pickMaxWeightSet(
  sets: ReadonlyArray<{ weight?: number; reps?: number }>,
): WeightSet | null {
  return pickHeaviestSet(sets)
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

    if (row.next) {
      hasMetric = true
      const candidate = {
        date: entryDate,
        mtime: entry.mtime,
        path: entry.path,
        value: row.next,
      }
      if (!draft.nextPlan || isLaterSession(candidate, draft.nextPlan)) {
        draft.nextPlan = candidate
      }
    }

    /** Strength-only rule: strength rows feed the weight statistics; other kinds contribute nothing here. */
    if (row.kind === 'strength' && row.maxWeightSet) {
      hasMetric = true
      draft.strengthPersonalBest = draft.strengthPersonalBest
        ? pickHeavierWeightSet(draft.strengthPersonalBest, row.maxWeightSet)
        : row.maxWeightSet
      const candidate = {
        date: entryDate,
        mtime: entry.mtime,
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

    /** Duration-only rule: duration rows feed the time statistics; other kinds contribute nothing here. */
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
        mtime: entry.mtime,
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

    /** Bodyweight-only rule: highest rung wins outright, then reps, then load. */
    if (row.kind === 'bodyweight' && row.maxBodyweightSet) {
      hasMetric = true
      draft.bodyweightPersonalBest = draft.bodyweightPersonalBest
        ? (pickBestBodyweightSet([draft.bodyweightPersonalBest, row.maxBodyweightSet]) ??
          row.maxBodyweightSet)
        : row.maxBodyweightSet
      const candidate = {
        date: entryDate,
        mtime: entry.mtime,
        path: entry.path,
        value: row.maxBodyweightSet,
      }
      if (
        !draft.bodyweightLastSessionMax ||
        isLaterSession(candidate, draft.bodyweightLastSessionMax)
      ) {
        draft.bodyweightLastSessionMax = candidate
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
        lastSessionMax: draft.strengthLastSessionMax
          ? {
              value: draft.strengthLastSessionMax.value,
              date: draft.strengthLastSessionMax.date,
            }
          : undefined,
      }
    }
    if (draft.nextPlan) {
      summary.nextPlan = { value: draft.nextPlan.value, date: draft.nextPlan.date }
    }
    if (
      draft.durationPersonalBestSeconds !== undefined ||
      draft.durationLastSessionMaxSeconds !== undefined
    ) {
      summary.duration = {
        personalBestSeconds: draft.durationPersonalBestSeconds,
        lastSessionMaxSeconds: draft.durationLastSessionMaxSeconds
          ? {
              value: draft.durationLastSessionMaxSeconds.value,
              date: draft.durationLastSessionMaxSeconds.date,
            }
          : undefined,
      }
    }
    if (draft.bodyweightPersonalBest || draft.bodyweightLastSessionMax) {
      summary.bodyweight = {
        personalBest: draft.bodyweightPersonalBest,
        lastSessionMax: draft.bodyweightLastSessionMax
          ? {
              value: draft.bodyweightLastSessionMax.value,
              date: draft.bodyweightLastSessionMax.date,
            }
          : undefined,
      }
    }
    history.set(exerciseName, summary)
  }

  return history
}

function nextPlanIcon(plan: NextPlan): string {
  if (plan.direction === 'up') {
    return 'arrow-up'
  }
  return plan.direction === 'down' ? 'arrow-down' : 'minus'
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

/**
 * Later wins, and within a single day the most recently written note wins:
 * two sessions of the same exercise on one date are ordered by mtime, with
 * path as a stable last resort.
 */
function isLaterSession<T>(candidate: SessionMetric<T>, current: SessionMetric<T>): boolean {
  if (candidate.date !== current.date) {
    return candidate.date > current.date
  }
  if (candidate.mtime !== current.mtime) {
    return candidate.mtime > current.mtime
  }
  return candidate.path > current.path
}

function formatWeightSet(set: WeightSet): string {
  if (set.weight === 0) {
    return formatReps(set.reps)
  }
  return `${formatNumber(set.weight)} kg x ${formatNumber(set.reps)}`
}

/**
 * Chip-sized form of a weight set: units and spaces dropped so several chips
 * fit one line on a narrow pane. The full sentence lives in the chip's title.
 * A personal best reads as the weight alone, since its rep count is incidental.
 */
function formatWeightSetShort(set: WeightSet, opts?: { weightOnly?: boolean }): string {
  if (set.weight === 0) {
    return formatReps(set.reps)
  }
  if (opts?.weightOnly) {
    return formatNumber(set.weight)
  }
  return `${formatNumber(set.weight)}x${formatNumber(set.reps)}`
}

function formatReps(reps: number): string {
  const formatted = formatNumber(reps)
  return `${formatted} rep${formatted === '1' ? '' : 's'}`
}

/** Badge-sized bodyweight set: rung name and rep count, never a weight. */
function formatBodyweightSet(set: BodyweightBestSet, levels?: BodyweightLadder): string {
  const name = bodyweightLevelName(levels, set.level)
  return set.reps > 0 ? `${name} x ${formatNumber(set.reps)}` : name
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
