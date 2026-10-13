import { describe, expect, it } from 'vitest'

import {
  DEFAULT_INTERVAL_PRESETS,
  parseIntervalPresets,
  upgradeIntervalPresets,
} from '../../src/domain/interval-presets'

describe('interval presets', () => {
  it('ships starter plans for each shape of session as the defaults', () => {
    expect(parseIntervalPresets(DEFAULT_INTERVAL_PRESETS)).toEqual({
      presets: [
        { label: 'Tabata', plan: '(x 8 (work 20s 400W) (rest 10s))' },
        { label: 'EMOM', plan: '(x 10 (every 1m (work 40s 300W)))' },
        {
          label: 'Over-unders',
          plan: '(warmup 10m 150W) (x 3 (x 3 (over 1m 300W) (under 2m 220W)) (rest 4m)) (cooldown 5m 120W)',
        },
        { label: 'Pyramid', plan: '(x 6 (climb 1m (L8 L10 L12 L14 L12 L10)) (rest 1m))' },
        { label: '30/30', plan: '(x 10 (on 30s 350W) (off 30s 150W))' },
        { label: 'Norwegian 4x4', plan: '(warmup 10m 150W) (x 4 (hard 4m 280W) (rest 3m))' },
      ],
      invalid: [],
    })
  })

  it('reads a preset written as lists, and still reports one that cannot run', () => {
    expect(parseIntervalPresets('Bike: (x 3 (over 1m 300W))\nBroken: (x 3 (over 1m 300W)')).toEqual(
      {
        presets: [{ label: 'Bike', plan: '(x 3 (over 1m 300W))' }],
        invalid: ['Broken: (x 3 (over 1m 300W)'],
      },
    )
  })

  it('reads one preset per line, naming a line without a label by its plan', () => {
    expect(
      parseIntervalPresets('Bike 4s: 10 x 4m @ 300W, 1:00 rest\n\n  6 x open @ 120kg, every 2m  '),
    ).toEqual({
      presets: [
        { label: 'Bike 4s', plan: '10 x 4m @ 300W, 1:00 rest' },
        { label: '6 x open @ 120kg, every 2m', plan: '6 x open @ 120kg, every 2m' },
      ],
      invalid: [],
    })
  })

  it('leaves out and reports lines whose plan cannot run', () => {
    expect(parseIntervalPresets('Tabata: 8 x 20s @ 400W, 10s rest\nOops: lots of reps')).toEqual({
      presets: [{ label: 'Tabata', plan: '8 x 20s @ 400W, 10s rest' }],
      invalid: ['Oops: lots of reps'],
    })
  })

  it('swaps the old untouched defaults for the new ones, and keeps presets someone wrote', () => {
    const old = 'Tabata: 8 x 20s @ 400W, 10s rest\nEMOM: 10 x 40s @ 300W, every 1m'
    const own = 'Bike: 10 x 4m @ 300W, 1m rest'

    expect([upgradeIntervalPresets(old), upgradeIntervalPresets(own)]).toEqual([
      DEFAULT_INTERVAL_PRESETS,
      own,
    ])
  })
})
