import { describe, expect, it } from 'vitest'

import { DEFAULT_INTERVAL_PRESETS, parseIntervalPresets } from '../../src/domain/interval-presets'

describe('interval presets', () => {
  it('ships Tabata and EMOM as the defaults', () => {
    expect(parseIntervalPresets(DEFAULT_INTERVAL_PRESETS)).toEqual({
      presets: [
        { label: 'Tabata', plan: '8 x 20s @ 400W, 10s rest' },
        { label: 'EMOM', plan: '10 x 40s @ 300W, every 1m' },
      ],
      invalid: [],
    })
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
})
