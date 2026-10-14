/**
 * What the interval card shows for its plan: a profile of the steps in time, each logged rep's
 * hit or miss, and a one-line legend whose step colours match the profile's bars.
 */

import type { IntervalProgram, PlanStep } from './interval-program'
import { isOnTarget, loggedReps, type RunRow } from './interval-run'
import { ONE_LINE_STEP_NAME, outlineFromPlan, type OutlineItem } from './plan-outline'

export type BarState = 'hit' | 'miss' | 'done' | 'todo'

export interface ProfileBar {
  start: number
  seconds: number
  /** The target against the plan's highest, from 0 to 1. */
  height: number
  /** 0 for a step without a target, else the step name's colour slot. */
  key: number
  state: BarState
}

export type LegendPart =
  | { kind: 'step'; key: number; name: string; time: string; target: string }
  | { kind: 'count' | 'text' | 'separator'; text: string }

export interface PlanSummary {
  seconds: number
  reps: number
  done: number
  /** Where the next rep starts, once some are logged and some are left. */
  nextAt?: number
  bars: ProfileBar[]
  /** Null when the plan uses a shape the legend cannot spell out. */
  legend: LegendPart[] | null
}

/** Colour slots step names cycle through. */
const KEY_COUNT = 5
/** Steps without a target sit this high, so they read as easy without vanishing. */
const UNTARGETED_HEIGHT = 0.28
/** The lowest a targeted step sits, so a light target still reads as work. */
const MIN_HEIGHT = 0.22

export function summarisePlan(
  plan: string,
  program: IntervalProgram,
  rows: readonly RunRow[],
): PlanSummary {
  const keys = stepKeys(program)
  const done = loggedReps(rows)
  const highest = Math.max(0, ...program.steps.map((step) => step.target?.target ?? 0))
  const bars: ProfileBar[] = []
  let at = 0
  program.steps.forEach((step, index) => {
    const seconds = step.workSeconds ?? step.everySeconds ?? 0
    bars.push({
      start: at,
      seconds,
      height: step.target ? Math.max(MIN_HEIGHT, step.target.target / highest) : UNTARGETED_HEIGHT,
      key: keyOf(keys, step),
      state: index < done ? stateOf(rows[index], step) : 'todo',
    })
    const last = index === program.steps.length - 1
    at += last ? seconds : Math.max(step.everySeconds ?? 0, seconds) + step.restSeconds
  })
  const summary: PlanSummary = {
    seconds: at,
    reps: program.steps.length,
    done,
    bars,
    legend: legendOf(plan, keys),
  }
  const next = bars[done]
  if (done > 0 && next) {
    summary.nextAt = next.start
  }
  return summary
}

/** A colour slot per targeted step name, in the order the names first run. */
function stepKeys(program: IntervalProgram): Map<string, number> {
  const keys = new Map<string, number>()
  for (const step of program.steps) {
    const name = step.name ?? ONE_LINE_STEP_NAME
    if (step.target && !keys.has(name)) {
      keys.set(name, (keys.size % KEY_COUNT) + 1)
    }
  }
  return keys
}

function keyOf(keys: Map<string, number>, step: PlanStep): number {
  return step.target ? (keys.get(step.name ?? ONE_LINE_STEP_NAME) ?? 0) : 0
}

function stateOf(row: RunRow | undefined, step: PlanStep): BarState {
  if (!step.target) {
    return 'done'
  }
  return row && isOnTarget(row, step) ? 'hit' : 'miss'
}

function legendOf(plan: string, keys: Map<string, number>): LegendPart[] | null {
  const items = outlineFromPlan(plan)
  return items ? partsOf(items, keys, false) : null
}

/** A repeat with several items is bracketed when anything sits beside it or around it. */
function partsOf(
  items: readonly OutlineItem[],
  keys: Map<string, number>,
  enclosed: boolean,
): LegendPart[] {
  const bracket = enclosed || items.length > 1
  return items.flatMap((item, index): LegendPart[] => {
    const separator: LegendPart[] = index > 0 ? [{ kind: 'separator', text: ' · ' }] : []
    switch (item.kind) {
      case 'step':
        return [
          ...separator,
          {
            kind: 'step',
            key: item.target.trim() === '' ? 0 : (keys.get(item.name) ?? 0),
            name: item.name,
            time: item.work,
            target: item.target.trim().split(/\s+/).join(' '),
          },
        ]
      case 'rest':
        return [...separator, { kind: 'text', text: `rest ${item.time}` }]
      case 'repeat': {
        const every = item.every === '' ? '' : ` every ${item.every}`
        const body = partsOf(item.items, keys, true)
        const wrapped: LegendPart[] =
          bracket && item.items.length > 1
            ? [{ kind: 'text', text: '(' }, ...body, { kind: 'text', text: ')' }]
            : body
        return [
          ...separator,
          { kind: 'count', text: `${item.count}×` },
          { kind: 'text', text: `${every} ` },
          ...wrapped,
        ]
      }
    }
  })
}
