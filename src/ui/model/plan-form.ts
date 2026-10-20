import { formatDurationInput } from '../../domain/duration-input'
import { formatIntervalPlan, parseIntervalPlan } from '../../domain/interval-plan'
import { parseIntervalProgram, programSeconds } from '../../domain/interval-program'

export const DEFAULT_PLAN = '(x 8 (work 30s 300W) (rest 90s))'

export const DOCS_URL =
  'https://github.com/paulchiu/obsidian-fitkit/blob/main/docs/interval-training.md#plan-syntax'

/** What the info button shows: each example with the one rule it teaches. */
export const PLAN_EXAMPLES: ReadonlyArray<{ plan: string; about: string }> = [
  {
    plan: '(x 8 (work 20s 400W) (rest 10s))',
    about: 'Eight reps of 20s at 400W. A rest at the end of an x goes between rounds.',
  },
  {
    plan: '(x 3 (over 1m 300W) (under 2m 220W))',
    about: 'The first word names the step. Steps with no rest between them run straight on.',
  },
  {
    plan: '(warmup 10m 150W) (x 3 (x 3 (over 1m 300W) (under 2m 220W)) (rest 4m)) (cooldown 5m 120W)',
    about:
      'Nest x for sets of rounds. A step with no target, like (spin 5m), is timed but not scored.',
  },
  {
    plan: '(x 6 (climb 1m (L8 L10 L12 L14 L12 L10)) (rest 1m))',
    about: 'A list of targets takes the next one each round.',
  },
  {
    plan: '(x 6 (every 2m (push open 120kg)))',
    about: 'Open work ends when you tap Rest. Every starts each rep on the clock.',
  },
  {
    plan: '("big gear" 2m 260W)',
    about: 'Quote a name with spaces. Targets are watts (300W), load (120kg) or a level (L12).',
  },
  {
    plan: '8 x 30s @ 300W, 90s rest',
    about: 'The one-line form still works for a single repeat.',
  },
]

/** What the plan comes to as a line under the form, or why it cannot run. */
export type PlanPreview = { ok: true; summary: string } | { ok: false; reason: string }

/** `problem` is a blank row field the step editor names, which holds the plan back whatever `text` says. */
export function planPreview(text: string, problem: string | null): PlanPreview {
  if (problem !== null) {
    return { ok: false, reason: problem }
  }
  const parsed = parseIntervalProgram(text)
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason }
  }
  const reps = parsed.program.steps.length
  return {
    ok: true,
    summary: `${reps} ${reps === 1 ? 'rep' : 'reps'} · ${formatDurationInput(programSeconds(parsed.program))}`,
  }
}

/** One line for the note: a one-line plan in its usual spelling, lists with spacing collapsed outside quoted names. */
export function tidyPlan(raw: string): string {
  const line = raw
    .trim()
    .split('"')
    .map((part, index) => (index % 2 === 0 ? part.replace(/\s+/g, ' ') : part))
    .join('"')
  const plan = parseIntervalPlan(line)
  return plan.ok ? formatIntervalPlan(plan.plan) : line
}
