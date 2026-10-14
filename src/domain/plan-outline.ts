/**
 * An interval plan as the rows the plan form's step editor shows. Fields hold the text as
 * typed, so a half-written row survives until it is fixed; the plan text stays the source of truth.
 */

import { formatPlanSeconds, formatTarget, parseIntervalPlan } from './interval-plan'
import { parseIntervalProgram, readPlanLists, type PlanNode } from './interval-program'

export interface OutlineStep {
  kind: 'step'
  name: string
  /** A time like `1m`, or `open`. */
  work: string
  /** Blank for no target; several, space-separated, take one per round. */
  target: string
}

export interface OutlineRest {
  kind: 'rest'
  time: string
}

export interface OutlineRepeat {
  kind: 'repeat'
  count: string
  /** Blank unless each round starts on the clock. */
  every: string
  items: OutlineItem[]
}

export type OutlineItem = OutlineStep | OutlineRest | OutlineRepeat

/** The rows for a plan, or null when it cannot run or uses a shape rows cannot show. */
export function outlineFromPlan(raw: string): OutlineItem[] | null {
  const text = raw.trim()
  if (text === '') {
    return []
  }
  if (!text.startsWith('(')) {
    return outlineFromOneLine(text)
  }
  if (!parseIntervalProgram(text).ok) {
    return null
  }
  return itemsOf(readPlanLists(text))
}

function outlineFromOneLine(text: string): OutlineItem[] | null {
  const parsed = parseIntervalPlan(text)
  if (!parsed.ok) {
    return null
  }
  const { plan } = parsed
  const work: OutlineStep = {
    kind: 'step',
    name: 'work',
    work: plan.workSeconds === null ? 'open' : formatPlanSeconds(plan.workSeconds),
    target: formatTarget(plan.intensity),
  }
  const rest: OutlineItem[] =
    plan.pace.kind === 'rest' && plan.pace.seconds > 0
      ? [{ kind: 'rest', time: formatPlanSeconds(plan.pace.seconds) }]
      : []
  const every = plan.pace.kind === 'every' ? formatPlanSeconds(plan.pace.seconds) : ''
  return [{ kind: 'repeat', count: String(plan.reps), every, items: [work, ...rest] }]
}

function itemsOf(nodes: readonly PlanNode[]): OutlineItem[] | null {
  const items: OutlineItem[] = []
  for (const node of nodes) {
    const item = itemOf(node)
    if (!item) {
      return null
    }
    items.push(item)
  }
  return items
}

/** One row, or null for an `every` outside a repeat's whole body, which rows cannot show. */
function itemOf(node: PlanNode): OutlineItem | null {
  if (node.kind === 'word') {
    return null
  }
  const [head, ...args] = node.items
  if (head?.kind !== 'word') {
    return null
  }
  const keyword = head.quoted ? null : head.text.toLowerCase()
  if (keyword === 'x') {
    return repeatOf(args)
  }
  if (keyword === 'rest') {
    const [time] = args
    return time?.kind === 'word' ? { kind: 'rest', time: time.text } : null
  }
  if (keyword === 'every') {
    return null
  }
  const [work, target] = args
  const targetText = target === undefined ? '' : targetTextOf(target)
  if (work?.kind !== 'word' || targetText === null) {
    return null
  }
  return { kind: 'step', name: head.text, work: work.text, target: targetText }
}

function repeatOf(args: readonly PlanNode[]): OutlineRepeat | null {
  const [count, ...body] = args
  if (count?.kind !== 'word') {
    return null
  }
  const [only] = body
  const clocked =
    body.length === 1 &&
    only?.kind === 'list' &&
    only.items[0]?.kind === 'word' &&
    !only.items[0].quoted &&
    only.items[0].text.toLowerCase() === 'every'
  const [, period, ...clockedBody] = clocked ? only.items : []
  if (clocked && period?.kind !== 'word') {
    return null
  }
  const items = itemsOf(clocked ? clockedBody : body)
  const every = clocked && period?.kind === 'word' ? period.text : ''
  return items ? { kind: 'repeat', count: count.text, every, items } : null
}

function targetTextOf(node: PlanNode): string | null {
  if (node.kind === 'word') {
    return node.text
  }
  const words = node.items.map((item) => (item.kind === 'word' ? item.text : null))
  return words.includes(null) ? null : words.join(' ')
}

/** The plan text for the rows, on one line. */
export function planFromOutline(items: readonly OutlineItem[]): string {
  return items.map(itemText).join(' ')
}

function itemText(item: OutlineItem): string {
  switch (item.kind) {
    case 'step': {
      const target = item.target
        .replace(/[()"]/g, '')
        .split(/[\s,]+/)
        .filter((word) => word !== '')
      const targetText =
        target.length === 0 ? '' : ` ${target.length === 1 ? target[0] : `(${target.join(' ')})`}`
      return `(${nameText(item.name)} ${word(item.work)}${targetText})`
    }
    case 'rest':
      return `(rest ${word(item.time)})`
    case 'repeat': {
      const body = planFromOutline(item.items)
      const every = word(item.every)
      return `(x ${word(item.count)} ${every === '' ? body : `(every ${every} ${body})`})`
    }
  }
}

/** A name as one word, quoted when it has a space or would read as a keyword. */
function nameText(name: string): string {
  const text = name.replace(/"/g, '').trim()
  return /^[^\s()]+$/.test(text) && !/^(x|rest|every)$/i.test(text) ? text : `"${text}"`
}

/** A typed time or count as one word, with anything that would break the plan taken out. */
function word(text: string): string {
  return text.replace(/[\s()"]/g, '')
}

/** What to fill in before the rows make a plan, or null when nothing is blank. */
export function outlineProblem(items: readonly OutlineItem[]): string | null {
  return items.length === 0 ? 'Add a step to start the plan.' : blankIn(items)
}

function blankIn(items: readonly OutlineItem[]): string | null {
  for (const item of items) {
    const problem = blankField(item)
    if (problem) {
      return problem
    }
  }
  return null
}

function blankField(item: OutlineItem): string | null {
  switch (item.kind) {
    case 'step':
      if (nameText(item.name) === '""') {
        return 'Give each step a name, like over.'
      }
      return word(item.work) === '' ? `Give ${item.name.trim()} a time, like 1m, or open.` : null
    case 'rest':
      return word(item.time) === '' ? 'Give each rest a time, like 90s.' : null
    case 'repeat':
      if (word(item.count) === '') {
        return 'Give each repeat a number of rounds.'
      }
      return item.items.length === 0 ? 'Add a step to each repeat.' : blankIn(item.items)
  }
}
