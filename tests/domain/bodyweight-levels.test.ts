import { describe, expect, it } from 'vitest'

import {
  bodyweightLevelName,
  formatBodyweightLevelLabel,
  formatBodyweightLevelShort,
} from '../../src/domain/bodyweight-levels'

describe('bodyweight level labels', () => {
  it('names the first and last rungs of the ladder', () => {
    const levels = ['Wall push-up', 'Incline push-up', 'Knee push-up']
    expect(bodyweightLevelName(levels, 1)).toBe('Wall push-up')
    expect(bodyweightLevelName(levels, 3)).toBe('Knee push-up')
  })

  it('numbers the rung for the level menu', () => {
    expect(formatBodyweightLevelLabel(['Wall push-up', 'Knee push-up'], 2)).toBe('2 · Knee push-up')
  })

  it('shortens the rung to its level number', () => {
    expect(formatBodyweightLevelShort(3)).toBe('L3')
  })

  it('falls back to a bare level when the ladder does not name it', () => {
    expect(bodyweightLevelName(['Wall push-up'], 4)).toBe('Level 4')
    expect(bodyweightLevelName(undefined, 2)).toBe('Level 2')
  })
})
