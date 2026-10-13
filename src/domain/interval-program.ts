/**
 * An interval plan compiled to the flat list of steps the runner walks. A plan is
 * either the one-line form (`8 x 30s @ 300W, 90s rest`) or Lisp-style lists, read
 * when the plan starts with a bracket: `(warmup 10m 150W) (x 3 (over 1m 300W) (rest 2m))`.
 */

import { formatDurationInput, parseDurationInput } from './duration-input'
import {
  formatPlanSeconds,
  formatTarget,
  parseIntervalPlan,
  parseTarget,
  type IntensityKind,
  type IntervalPlan,
} from './interval-plan'

export interface PlanTarget {
  kind: IntensityKind
  target: number
}

export interface PlanStep {
  /** The step's first word; absent for one-line plans, whose reps are just work. */
  name?: string
  /** Null for open work, which ends when the athlete taps Rest. */
  workSeconds: number | null
  target?: PlanTarget
  /** Fixed rest after the work; 0 when the next step follows at once. */
  restSeconds: number
  /** When set, the next step starts this long after this one began, plus any fixed rest. */
  everySeconds?: number
  /** This step's round in each enclosing repeat, outermost first. */
  rounds: Array<{ round: number; of: number }>
}

export interface IntervalProgram {
  steps: PlanStep[]
  /** The one kind of target the plan uses, or null when no step has one. */
  intensity: IntensityKind | null
}

export type IntervalProgramResult =
  { ok: true; program: IntervalProgram } | { ok: false; reason: string }

export function parseIntervalProgram(raw: string): IntervalProgramResult {
  const text = raw.trim()
  if (!text.startsWith('(')) {
    const parsed = parseIntervalPlan(text)
    return parsed.ok ? { ok: true, program: programFromPlan(parsed.plan) } : parsed
  }
  try {
    return { ok: true, program: compileProgram(readLists(text)) }
  } catch (error) {
    if (error instanceof PlanError) {
      return { ok: false, reason: error.message }
    }
    throw error
  }
}

/** A plan that cannot be read, thrown from deep in the compiler and returned as a reason. */
class PlanError extends Error {}

function fail(reason: string): never {
  throw new PlanError(reason)
}

type PlanNode =
  { kind: 'word'; text: string; quoted: boolean } | { kind: 'list'; items: PlanNode[] }

/** Splits the plan into its bracketed lists; a quoted run is one word, so names can have spaces. */
function readLists(text: string): PlanNode[] {
  const open: PlanNode[][] = [[]]
  let index = 0
  const add = (node: PlanNode): void => {
    open[open.length - 1]?.push(node)
  }
  while (index < text.length) {
    const char = text.charAt(index)
    if (/\s/.test(char)) {
      index++
    } else if (char === '(') {
      open.push([])
      index++
    } else if (char === ')') {
      const items = open.length > 1 ? open.pop() : fail('There is a ) with nothing to close.')
      add({ kind: 'list', items: items ?? [] })
      index++
    } else if (char === '"') {
      const end = text.indexOf('"', index + 1)
      if (end === -1) {
        fail('A quoted name needs its closing ".')
      }
      add({ kind: 'word', text: text.slice(index + 1, end), quoted: true })
      index = end + 1
    } else {
      const word = /^[^\s()"]+/.exec(text.slice(index))?.[0] ?? char
      add({ kind: 'word', text: word, quoted: false })
      index += word.length
    }
  }
  if (open.length > 1) {
    const unclosed = open[open.length - 1]?.[0]
    fail(
      unclosed?.kind === 'word'
        ? `Missing ) to close (${unclosed.text}.`
        : 'Missing ) at the end of the plan.',
    )
  }
  return open[0] ?? []
}

type PlanItem = { kind: 'work'; step: PlanStep } | { kind: 'rest'; seconds: number }

interface CompileContext {
  rounds: PlanStep['rounds']
  everySeconds?: number
}

/** Keeps a runaway `(x 100 (x 100 …))` from building a plan nobody could run. */
const MAX_STEPS = 500

function compileProgram(nodes: readonly PlanNode[]): IntervalProgram {
  const items = withoutTrailingRests(compileNodes(nodes, { rounds: [] }))
  if (items.length === 0) {
    fail('Write at least one step, like (over 1m 300W).')
  }
  if (items[0]?.kind === 'rest') {
    fail('A plan cannot start with a rest.')
  }
  const steps: PlanStep[] = []
  for (const item of items) {
    const previous = steps[steps.length - 1]
    if (item.kind === 'work') {
      steps.push(item.step)
    } else if (previous) {
      previous.restSeconds += item.seconds
    }
  }
  const last = steps[steps.length - 1]
  if (last) {
    delete last.everySeconds
  }
  const kinds = [...new Set(steps.flatMap((step) => (step.target ? [step.target.kind] : [])))]
  if (kinds.length > 1) {
    fail('Use one kind of target in a plan: watts (300W), load (120kg) or level (L12).')
  }
  return { steps, intensity: kinds[0] ?? null }
}

function compileNodes(nodes: readonly PlanNode[], context: CompileContext): PlanItem[] {
  return nodes.flatMap((node) => compileNode(node, context))
}

function compileNode(node: PlanNode, context: CompileContext): PlanItem[] {
  if (node.kind === 'word') {
    return fail(`Put each step in brackets, like (over 1m 300W), not "${node.text}" on its own.`)
  }
  const [head, ...args] = node.items
  if (!head) {
    return fail('Empty brackets: write a step like (over 1m 300W).')
  }
  if (head.kind === 'list') {
    return fail('A step starts with its name, like (over 1m 300W).')
  }
  const keyword = head.quoted ? null : head.text.toLowerCase()
  if (keyword === 'x') {
    return compileRepeat(args, context)
  }
  if (keyword === 'rest') {
    const seconds = args.length === 1 ? durationOf(args[0]) : undefined
    return seconds === undefined ? fail('Write a rest as (rest 90s).') : [{ kind: 'rest', seconds }]
  }
  if (keyword === 'every') {
    const [period, ...body] = args
    const everySeconds = durationOf(period)
    if (!everySeconds || body.length === 0) {
      fail('Write a period as (every 1m (step 40s 300W)).')
    }
    return compileNodes(body, { ...context, everySeconds })
  }
  return [{ kind: 'work', step: compileStep(head.text, args, context) }]
}

/** Rounds of the body in turn; a rest that ends the body goes between rounds, not after the last. */
function compileRepeat(args: readonly PlanNode[], context: CompileContext): PlanItem[] {
  const [count, ...body] = args
  const of = count?.kind === 'word' && /^\d+$/.test(count.text) ? Number(count.text) : 0
  if (of < 1 || body.length === 0) {
    fail('Write a repeat as (x 3 (step 1m 300W)), with a whole number of rounds.')
  }
  const items: PlanItem[] = []
  for (let round = 1; round <= of; round++) {
    const roundItems = compileNodes(body, {
      ...context,
      rounds: [...context.rounds, { round, of }],
    })
    items.push(...(round === of ? withoutTrailingRests(roundItems) : roundItems))
    if (items.filter((item) => item.kind === 'work').length > MAX_STEPS) {
      fail('That plan is too long to run. Keep it under 500 steps.')
    }
  }
  return items
}

function compileStep(name: string, args: readonly PlanNode[], context: CompileContext): PlanStep {
  const [work, target, ...extra] = args
  if (!work || extra.length > 0) {
    fail(`Write a step as (${name} 1m 300W): a name, a time or open, then an optional target.`)
  }
  const workSeconds = work.kind === 'word' && /^open$/i.test(work.text) ? null : durationOf(work)
  if (workSeconds === undefined || workSeconds === 0) {
    fail(`"${wordText(work)}" is not a work time like 30s, 2m or open.`)
  }
  const { everySeconds } = context
  if (workSeconds === null && everySeconds === undefined) {
    fail('Open work needs (every …) around it, so each rep has a start to rest against.')
  }
  if (workSeconds !== null && everySeconds !== undefined && workSeconds >= everySeconds) {
    fail(
      `Work (${formatDurationInput(workSeconds)}) has to be shorter than the period (${formatDurationInput(everySeconds)}).`,
    )
  }
  const step: PlanStep = { name, workSeconds, restSeconds: 0, rounds: context.rounds }
  if (target) {
    step.target = targetOf(target, context)
  }
  if (everySeconds !== undefined) {
    step.everySeconds = everySeconds
  }
  return step
}

/** A target, or a list of them taken one per round of the innermost repeat. */
function targetOf(node: PlanNode, context: CompileContext): PlanTarget {
  if (node.kind === 'list') {
    const round = context.rounds[context.rounds.length - 1]
    if (!round || node.items.length === 0) {
      fail('A list of targets needs (x …) around it, which takes the next one each round.')
    }
    const picked = node.items[(round.round - 1) % node.items.length]
    return targetOf(picked ?? node, context)
  }
  const target = parseTarget(node.text)
  if (!target) {
    fail(`"${node.text}" is not a target like 300W, 120kg or L12.`)
  }
  if (target.target <= 0) {
    fail('The target has to be more than zero.')
  }
  return target
}

function withoutTrailingRests(items: PlanItem[]): PlanItem[] {
  let end = items.length
  while (end > 0 && items[end - 1]?.kind === 'rest') {
    end--
  }
  return items.slice(0, end)
}

function durationOf(node: PlanNode | undefined): number | undefined {
  return node?.kind === 'word' && node.text !== ''
    ? parseDurationInput(node.text)?.seconds
    : undefined
}

function wordText(node: PlanNode): string {
  return node.kind === 'word' ? node.text : '(…)'
}

/** `under 2m @ 220W`, the way the runner names what comes next. */
export function formatStep(step: PlanStep): string {
  const work = step.workSeconds === null ? 'open' : formatPlanSeconds(step.workSeconds)
  const target = step.target ? ` @ ${formatTarget(step.target)}` : ''
  return `${step.name === undefined ? '' : `${step.name} `}${work}${target}`
}

/** How long the plan takes as written; open work counts as its whole period. */
export function programSeconds(program: IntervalProgram): number {
  return program.steps.reduce(
    (total, step) =>
      total + Math.max(step.everySeconds ?? 0, step.workSeconds ?? 0) + step.restSeconds,
    0,
  )
}

function programFromPlan(plan: IntervalPlan): IntervalProgram {
  const steps = Array.from({ length: plan.reps }, (_, index): PlanStep => {
    const last = index === plan.reps - 1
    const step: PlanStep = {
      workSeconds: plan.workSeconds,
      target: { ...plan.intensity },
      restSeconds: !last && plan.pace.kind === 'rest' ? plan.pace.seconds : 0,
      rounds: [{ round: index + 1, of: plan.reps }],
    }
    if (!last && plan.pace.kind === 'every') {
      step.everySeconds = plan.pace.seconds
    }
    return step
  })
  return { steps, intensity: plan.intensity.kind }
}
