import { describe, expect, it } from 'vitest'

import { parseIntervalProgram } from '../../../src/domain/interval-program'
import type { RunRow } from '../../../src/domain/interval-run'
import type { StepperStep } from '../../../src/domain/interval-stepper'
import {
  cutOffLabels,
  dotStates,
  finishedScore,
  primaryLabel,
  repStepper,
  roundsLabel,
  statsLabel,
  targetLabel,
} from '../../../src/ui/model/interval-runner'

const program = (plan: string) => {
  const parsed = parseIntervalProgram(plan)
  if (!parsed.ok) {
    throw new Error(parsed.reason)
  }
  return parsed.program
}

const timeline = (plan: string, rows: RunRow[]) => ({
  program: program(plan),
  rows,
  now: Date.parse('2026-10-12T07:15:10+10:00'),
})

const TENTH: StepperStep = { kind: 'percent', percent: 10 }

const done = (fields: RunRow): RunRow => ({ durationSeconds: 30, restSeconds: 90, ...fields })

/** A rep in its rest, ten seconds in. */
const resting = (fields: RunRow): RunRow => ({
  durationSeconds: 30,
  restSeconds: 0,
  startedAt: '2026-10-12T07:15:00+10:00',
  ...fields,
})

describe('roundsLabel', () => {
  it.each([
    ['(x 3 (work 30s 300W))', null],
    ['(x 2 (on 30s 350W) (off 30s 150W))', 'Round 1 of 2'],
    ['(x 2 (x 2 (over 1m 300W) (under 1m 220W)) (rest 2m))', 'Set 1 of 2 · round 1 of 2'],
    ['(x 2 (x 3 (x 4 (sprint 10s 400W))))', '1/2 · 1/3 · 1/4'],
  ])('labels the first step of %s', (plan, label) => {
    const parsed = program(plan)
    expect(roundsLabel(parsed.steps[0]!, parsed)).toBe(label)
  })
})

describe('primaryLabel', () => {
  it('skips during rest, finishes on the last step and otherwise rests or moves on', () => {
    const parsed = program('(x 2 (on 30s 350W) (off 30s 150W))')
    const [first, second, , last] = parsed.steps
    expect([
      primaryLabel(true, first!, second),
      primaryLabel(false, last!, undefined),
      primaryLabel(false, first!, second),
    ]).toEqual(['Skip', 'Finish', 'Next'])
  })
})

describe('targetLabel', () => {
  it('names rest, the step target, or nothing for an untargeted step', () => {
    const [targeted, untargeted] = program('(hard 30s 300W) (easy 30s)').steps
    expect([
      targetLabel(true, targeted!),
      targetLabel(false, targeted!),
      targetLabel(false, untargeted!),
    ]).toEqual(['rest', '300W target', null])
  })
})

describe('dotStates', () => {
  it('marks done reps by target, the open one as current and the rest as pending', () => {
    const t = timeline(
      '(hard 30s 300W) (hard 30s 300W) (easy 30s) (hard 30s 300W) (hard 30s 300W)',
      [
        done({ watts: 300 }),
        done({ watts: 250 }),
        done({}),
        { durationSeconds: 0, startedAt: '2026-10-12T07:15:00+10:00' },
      ],
    )
    expect(dotStates(t)).toEqual(['hit', 'miss', 'done', 'current', 'pending'])
  })
})

describe('statsLabel', () => {
  it.each([
    ['3 x 30s @ 300W, 90s rest', 'watts', [300, 300, 301], 'Last 301 W · avg 300.3 W'],
    ['3 x 30s @ 100kg, 90s rest', 'load', [100, 102.5], 'Last 102.5 kg · avg 101.3 kg'],
    ['3 x 30s @ L4, 90s rest', 'level', [4, 5], 'Last L5 · avg L4.5'],
  ] as const)('quotes the last %s rep and the rounded average', (plan, kind, values, label) => {
    const t = timeline(
      plan,
      values.map((value) => done({ [kind]: value })),
    )
    expect(statsLabel(t)).toBe(label)
  })

  it('is null before a rep has a value, or with no intensity', () => {
    expect([
      statsLabel(timeline('3 x 30s @ 300W, 90s rest', [])),
      statsLabel(timeline('(x 2 (work 30s))', [done({})])),
    ]).toEqual([null, null])
  })
})

describe('repStepper', () => {
  it.each([
    ['3 x 30s @ 300W, 90s rest', { watts: 300 }, { step: 30, value: 'Rep 1: 300 W' }],
    ['3 x 30s @ 100kg, 90s rest', { load: 100 }, { step: 10, value: 'Rep 1: 100 kg' }],
    ['3 x 30s @ L4, 90s rest', { level: 4 }, { step: 1, value: 'Rep 1: L4' }],
    ['3 x 30s @ 300W, 90s rest', {}, { step: 30, value: '' }],
    ['3 x 30s @ 42.5kg, 90s rest', { load: 42.5 }, { step: 4.5, value: 'Rep 1: 42.5 kg' }],
    ['3 x 30s @ 255W, 90s rest', { watts: 255 }, { step: 26, value: 'Rep 1: 255 W' }],
  ])('steps %s by a tenth of its target', (plan, fields, stepper) => {
    expect(repStepper(timeline(plan, [resting(fields)]), TENTH)).toEqual(stepper)
  })

  it('steps a rep with no target by a tenth of what it logged', () => {
    expect(
      repStepper(timeline('(warmup 30s) (hard 30s 300W)', [resting({ watts: 200 })]), TENTH)?.step,
    ).toBe(20)
  })

  it.each([
    ['3 x 30s @ 300W, 90s rest', { watts: 300 }],
    ['3 x 30s @ 100kg, 90s rest', { load: 100 }],
    ['3 x 30s @ L4, 90s rest', { level: 4 }],
  ])('steps %s by a fixed amount in its own unit', (plan, fields) => {
    expect(repStepper(timeline(plan, [resting(fields)]), { kind: 'amount', amount: 5 })?.step).toBe(
      5,
    )
  })

  it('is null for a plan with no intensity', () => {
    expect(repStepper(timeline('(x 2 (work 30s))', [resting({})]), TENTH)).toBeNull()
  })
})

describe('finishedScore', () => {
  it('scores hits against targeted steps, or counts reps when none are targeted', () => {
    expect([
      finishedScore(timeline('3 x 30s @ 300W, 90s rest', []), 2),
      finishedScore(timeline('(x 2 (work 30s))', [done({}), done({})]), 0),
    ]).toEqual([
      { count: '2/3', caption: 'reps on target' },
      { count: '2', caption: 'reps done' },
    ])
  })
})

describe('cutOffLabels', () => {
  it('resumes the cut rep during work, and the next one during rest', () => {
    expect([
      cutOffLabels({ rep: 2, resting: false }, 'Bike').resume,
      cutOffLabels({ rep: 2, resting: true }, 'Bike'),
    ]).toEqual([
      'Resume rep 2',
      {
        phase: 'Run cut off at rep 2 rest',
        note: 'Obsidian closed during rep 2 rest of Bike, and the clock has since passed the end of the plan, so no reps were filled in.',
        resume: 'Resume rep 3',
      },
    ])
  })
})
