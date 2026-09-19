import { describe, expect, it } from 'vitest'

import {
  bodyweightLevelName,
  describeBodyweightLadderChanges,
  formatBodyweightLevelLabel,
  formatBodyweightLevelShort,
  parseBodyweightLadderText,
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

describe('parseBodyweightLadderText', () => {
  it('drops blank lines from a one-per-line edit', () => {
    expect(parseBodyweightLadderText('Wall push-up\n\n  \nKnee push-up\n')).toEqual([
      'Wall push-up',
      'Knee push-up',
    ])
  })
})

describe('describeBodyweightLadderChanges', () => {
  it('reports an occupied rung whose name changes', () => {
    expect(
      describeBodyweightLadderChanges(
        ['Wall push-up', 'Knee push-up'],
        ['Wall push-up', 'Full push-up'],
        [2],
      ),
    ).toEqual([{ level: 2, from: 'Knee push-up', to: 'Full push-up' }])
  })

  it('reports nothing when a rung is appended to the end', () => {
    expect(
      describeBodyweightLadderChanges(
        ['Wall push-up', 'Knee push-up'],
        ['Wall push-up', 'Knee push-up', 'Full push-up'],
        [1, 2],
      ),
    ).toEqual([])
  })

  it('reports only occupied levels when rungs are reordered', () => {
    expect(
      describeBodyweightLadderChanges(
        ['Wall push-up', 'Incline push-up', 'Knee push-up'],
        ['Knee push-up', 'Incline push-up', 'Wall push-up'],
        [1, 3],
      ),
    ).toEqual([
      { level: 1, from: 'Wall push-up', to: 'Knee push-up' },
      { level: 3, from: 'Knee push-up', to: 'Wall push-up' },
    ])
  })

  it('reports shifted levels when a middle rung is deleted', () => {
    expect(
      describeBodyweightLadderChanges(
        ['Wall push-up', 'Incline push-up', 'Knee push-up'],
        ['Wall push-up', 'Knee push-up'],
        [2, 3],
      ),
    ).toEqual([
      { level: 2, from: 'Incline push-up', to: 'Knee push-up' },
      { level: 3, from: 'Knee push-up', to: 'Level 3' },
    ])
  })

  it('reports nothing when the edit only touches unoccupied rungs', () => {
    expect(
      describeBodyweightLadderChanges(
        ['Wall push-up', 'Incline push-up', 'Knee push-up'],
        ['Wall push-up', 'Incline push-up', 'Diamond push-up'],
        [1, 2],
      ),
    ).toEqual([])
  })
})
