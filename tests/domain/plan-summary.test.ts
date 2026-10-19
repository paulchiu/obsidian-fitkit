import { describe, expect, it } from 'vitest'

import { parseIntervalProgram, type IntervalProgram } from '../../src/domain/interval-program'
import type { RunRow } from '../../src/domain/interval-run'
import { summarisePlan, type LegendPart } from '../../src/domain/plan-summary'

const program = (plan: string): IntervalProgram => {
  const result = parseIntervalProgram(plan)
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return result.program
}

const summary = (plan: string, rows: RunRow[] = []): ReturnType<typeof summarisePlan> =>
  summarisePlan(plan, program(plan), rows)

/** The legend as it reads, with each step's colour key in brackets. */
const read = (legend: LegendPart[] | null): string | null =>
  legend
    ?.map((part) =>
      part.kind === 'step'
        ? `[${part.key}]${part.name} ${part.time}${part.target ? ` ${part.target}` : ''}`
        : part.text,
    )
    .join('') ?? null

describe('summarisePlan', () => {
  it('places each step as a bar in time, colours it by step name, and marks logged reps by hit', () => {
    const plan = '(x 2 (over 1m 300W) (under 2m 200W) (rest 1m))'

    expect(
      summary(plan, [
        { set: 1, durationSeconds: 60, watts: 300 },
        { set: 2, durationSeconds: 120, watts: 150, restSeconds: 60 },
      ]),
    ).toEqual({
      seconds: 420,
      reps: 4,
      done: 2,
      nextAt: 240,
      bars: [
        { start: 0, seconds: 60, height: 1, key: 1, state: 'hit' },
        { start: 60, seconds: 120, height: 200 / 300, key: 2, state: 'miss' },
        { start: 240, seconds: 60, height: 1, key: 1, state: 'todo' },
        { start: 300, seconds: 120, height: 200 / 300, key: 2, state: 'todo' },
      ],
      legend: [
        { kind: 'count', text: '2×' },
        { kind: 'text', text: ' ' },
        { kind: 'step', key: 1, name: 'over', time: '1m', target: '300W' },
        { kind: 'separator', text: ' · ' },
        { kind: 'step', key: 2, name: 'under', time: '2m', target: '200W' },
        { kind: 'separator', text: ' · ' },
        { kind: 'text', text: 'rest 1m' },
      ],
    })
  })

  it('keeps a step without a target grey and low, and brackets a repeat that sits among others', () => {
    const result = summary('(spin 5m) (x 2 (x 2 (a 30s 300W) (b 30s 150W)) (rest 1m)) (spin 2m)')

    expect({
      first: result.bars[0],
      legend: read(result.legend),
    }).toEqual({
      first: { start: 0, seconds: 300, height: 0.28, key: 0, state: 'todo' },
      legend: '[0]spin 5m · 2× (2× ([1]a 30s 300W · [2]b 30s 150W) · rest 1m) · [0]spin 2m',
    })
  })

  it('reads a one-line plan as a repeat of work, and a list of targets as one entry', () => {
    expect([
      read(summary('3 x 30s @ 300W, 90s rest').legend),
      read(summary('(x 3 (climb 1m (L8 L10 L12)) (rest 1m))').legend),
      summary('(x 3 (climb 1m (L8 L10 L12)) (rest 1m))').bars.map((bar) => bar.height),
    ]).toEqual([
      '3× [1]work 30s 300W · rest 90s',
      '3× [1]climb 1m L8 L10 L12 · rest 1m',
      [8 / 12, 10 / 12, 1],
    ])
  })

  it('draws open work across its period and has no legend for a plan the rows cannot show', () => {
    const result = summary('(every 1m (push open 120kg))')

    expect({ bars: result.bars, legend: result.legend, nextAt: result.nextAt }).toEqual({
      bars: [{ start: 0, seconds: 60, height: 1, key: 1, state: 'todo' }],
      legend: null,
      nextAt: undefined,
    })
  })
})
