import { describe, expect, it } from 'vitest'

import { findFencedBlockInRange } from '../../src/domain/markdown-lines'

function find(lines: string[], info: string, start = 0, end = lines.length) {
  return findFencedBlockInRange(lines, start, end, info)
}

describe('findFencedBlockInRange', () => {
  it('returns the opening and closing line of the first matching fence', () => {
    const lines = ['intro', '```dataview', 'TABLE a', '```', '```dataview', 'TABLE b', '```']
    expect(find(lines, 'dataview')).toEqual({ start: 1, end: 3 })
  })

  it('skips fences with another info string, even when they hold a matching opener', () => {
    const lines = ['```text', '```dataview', '```', '', '```dataview', 'TABLE a', '```']
    expect(find(lines, 'dataview')).toEqual({ start: 4, end: 6 })
  })

  it('compares the info string case-insensitively', () => {
    expect(find(['```DataView', 'TABLE a', '```'], 'dataview')).toEqual({ start: 0, end: 2 })
  })

  it('closes on a longer fence but not a shorter one', () => {
    const lines = ['````fitkit-chart', '```', 'body', '`````']
    expect(find(lines, 'fitkit-chart')).toEqual({ start: 0, end: 3 })
  })

  it('returns null when the matching fence is never closed', () => {
    expect(find(['```dataview', 'TABLE a'], 'dataview')).toBeNull()
  })

  it('returns null when only other fences are present', () => {
    expect(find(['```text', 'a', '```'], 'dataview')).toBeNull()
  })

  it('only looks between start and end', () => {
    const lines = ['```dataview', 'a', '```', '## Next', '```dataview', 'b', '```']
    expect(find(lines, 'dataview', 3, lines.length)).toEqual({ start: 4, end: 6 })
    expect(find(lines, 'dataview', 0, 2)).toBeNull()
  })
})
