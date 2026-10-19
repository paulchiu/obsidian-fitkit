import { describe, expect, it } from 'vitest'

import { parseIntervalProgram } from '../../../src/domain/interval-program'
import {
  dotStates,
  formatIntensity,
  primaryLabel,
  roundsLabel,
  statsLabel,
  stepperValue,
} from '../../../src/ui/model/interval-runner'

const program = (plan: string) => {
  const parsed = parseIntervalProgram(plan)
  if (!parsed.ok) {
    throw new Error(parsed.reason)
  }
  return parsed.program
}

describe('formatIntensity', () => {
  it.each([
    ['watts', 300, '300 W'],
    ['load', 22.5, '22.5 kg'],
    ['level', 4, 'L4'],
  ] as const)('shows %s %s as %s', (kind, value, text) => {
    expect(formatIntensity(kind, value)).toBe(text)
  })
})

describe('roundsLabel', () => {
  it.each([
    ['(x 3 (work 30s 300W))', 0, null],
    ['(x 2 (on 30s 350W) (off 30s 150W))', 0, 'Round 1 of 2'],
    ['(x 2 (x 2 (over 1m 300W) (under 1m 220W)) (rest 2m))', 0, 'Set 1 of 2 · round 1 of 2'],
  ])('labels %s step %s', (plan, index, label) => {
    const parsed = program(plan)
    expect(roundsLabel(parsed.steps[index]!, parsed)).toBe(label)
  })
})

describe('primaryLabel', () => {
  it('skips during rest, finishes on the last step and otherwise rests or moves on', () => {
    const parsed = program('(x 2 (on 30s 350W) (off 30s 150W))')
    const [first, , , last] = parsed.steps
    expect([
      primaryLabel(true, first!, parsed.steps[1]),
      primaryLabel(false, last!, undefined),
      primaryLabel(false, first!, parsed.steps[1]),
    ]).toEqual(['Skip', 'Finish', 'Next'])
  })
})

describe('run progress', () => {
  const timeline = (plan: string, rows: object[]) => ({
    program: program(plan),
    rows,
    now: Date.parse('2026-10-12T07:15:10+10:00'),
  })

  it('marks done reps by target and the open one as current', () => {
    const t = timeline('(x 3 (work 30s 300W) (rest 90s))', [
      { durationSeconds: 30, watts: 300, restSeconds: 90 },
      { durationSeconds: 30, watts: 250, restSeconds: 90 },
      { durationSeconds: 0, startedAt: '2026-10-12T07:15:00+10:00' },
    ])
    expect(dotStates(t)).toEqual(['is-hit', 'is-miss', 'is-current'])
  })

  it('averages the finished reps and quotes the last', () => {
    const t = timeline('(x 3 (work 30s 300W) (rest 90s))', [
      { durationSeconds: 30, watts: 300, restSeconds: 90 },
      { durationSeconds: 30, watts: 255, restSeconds: 90 },
    ])
    expect([statsLabel(t), stepperValue(t)]).toEqual(['Last 255 W · avg 277.5 W', 'Rep 2: 255 W'])
  })

  it('has no stats or stepper value before a rep is done', () => {
    const t = timeline('(x 3 (work 30s 300W) (rest 90s))', [])
    expect([statsLabel(t), stepperValue(t)]).toEqual([null, ''])
  })
})
