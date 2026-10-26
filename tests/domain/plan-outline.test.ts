import { describe, expect, it } from 'vitest'

import {
  outlineFromPlan,
  outlineProblem,
  planFromOutline,
  type OutlineItem,
} from '../../src/domain/plan-outline'

const step = (name: string, work: string, target = ''): OutlineItem => ({
  kind: 'step',
  name,
  work,
  target,
})

describe('outlineFromPlan', () => {
  it('reads named steps, rests and nested repeats as rows', () => {
    expect(
      outlineFromPlan(
        '(warmup 10m 150W) (x 3 (x 2 (over 1m 300W) (under 2m 220W)) (rest 4m)) (spin 5m)',
      ),
    ).toEqual([
      step('warmup', '10m', '150W'),
      {
        kind: 'repeat',
        count: '3',
        every: '',
        items: [
          {
            kind: 'repeat',
            count: '2',
            every: '',
            items: [step('over', '1m', '300W'), step('under', '2m', '220W')],
          },
          { kind: 'rest', time: '4m' },
        ],
      },
      step('spin', '5m'),
    ])
  })

  it('reads a repeat whose body is one every as a repeat that starts on the clock', () => {
    expect(outlineFromPlan('(x 6 (every 2m (push open 120kg) (rest 10s)))')).toEqual([
      {
        kind: 'repeat',
        count: '6',
        every: '2m',
        items: [step('push', 'open', '120kg'), { kind: 'rest', time: '10s' }],
      },
    ])
  })

  it('reads a list of targets and a quoted name', () => {
    expect(outlineFromPlan('(x 3 ("big gear" 1m (L8 L10 L12)))')).toEqual([
      { kind: 'repeat', count: '3', every: '', items: [step('big gear', '1m', 'L8 L10 L12')] },
    ])
  })

  it('reads a one-line plan as a repeat of one work step', () => {
    expect([
      outlineFromPlan('8 x 30s @ 300W, 90s rest'),
      outlineFromPlan('10 x open @ 120kg, every 1m30s'),
    ]).toEqual([
      [
        {
          kind: 'repeat',
          count: '8',
          every: '',
          items: [step('work', '30s', '300W'), { kind: 'rest', time: '90s' }],
        },
      ],
      [{ kind: 'repeat', count: '10', every: '90s', items: [step('work', 'open', '120kg')] }],
    ])
  })

  it('reads an empty plan as no rows', () => {
    expect(outlineFromPlan('  ')).toEqual([])
  })

  it('gives up on a plan that cannot run or that rows cannot show', () => {
    expect([
      outlineFromPlan('(x 3 (over 1m 300W)'),
      outlineFromPlan('(every 1m (work 40s 300W))'),
      outlineFromPlan('(x 3 (every 1m (work 40s 300W)) (rest 1m))'),
    ]).toEqual([null, null, null])
  })
})

describe('planFromOutline', () => {
  it('writes rows back as the plan they were read from', () => {
    const plans = [
      '(warmup 10m 150W) (x 3 (x 2 (over 1m 300W) (under 2m 220W)) (rest 4m)) (spin 5m)',
      '(x 6 (every 2m (push open 120kg) (rest 10s)))',
      '(x 3 ("big gear" 1m (L8 L10 L12)))',
    ]

    expect(plans.map((plan) => planFromOutline(outlineFromPlan(plan) ?? []))).toEqual(plans)
  })

  it('quotes a name that has a space or would read as a keyword, and tidies what was typed', () => {
    expect(
      planFromOutline([
        step('easy spin', ' 5 m ', ' 120W '),
        step('Rest', '1m', 'L8, L10'),
        step('every', '30s'),
        step('Adjust', '20s'),
      ]),
    ).toBe('("easy spin" 5m 120W) ("Rest" 1m (L8 L10)) ("every" 30s) ("Adjust" 20s)')
  })
})

describe('planFromOutline with a stepper step', () => {
  it('leads the plan with its adjust, tidying what was typed, and leaves it out when blank', () => {
    expect([
      planFromOutline([step('over', '1m', '300W')], ' 20 % '),
      planFromOutline([], '5'),
      planFromOutline([step('over', '1m')], ' '),
    ]).toEqual(['(adjust 20%) (over 1m 300W)', '(adjust 5)', '(over 1m)'])
  })
})

describe('outlineProblem', () => {
  it('names the first blank field', () => {
    expect([
      outlineProblem([]),
      outlineProblem([step('', '1m')]),
      outlineProblem([step('over', ' ')]),
      outlineProblem([step('over', '1m'), { kind: 'rest', time: '' }]),
      outlineProblem([{ kind: 'repeat', count: '', every: '', items: [step('over', '1m')] }]),
      outlineProblem([{ kind: 'repeat', count: '3', every: '', items: [] }]),
      outlineProblem([step('over', '1m')]),
    ]).toEqual([
      'Add a step to start the plan.',
      'Give each step a name, like over.',
      'Give over a time, like 1m, or open.',
      'Give each rest a time, like 90s.',
      'Give each repeat a number of rounds.',
      'Add a step to each repeat.',
      null,
    ])
  })
})
