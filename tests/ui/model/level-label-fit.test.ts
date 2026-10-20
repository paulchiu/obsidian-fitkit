import { describe, expect, it } from 'vitest'

import { shouldShortenLevelLabel } from '../../../src/ui/model/level-label-fit'

describe('level label fit', () => {
  it.each([
    { label: 120, available: 100, shortens: true },
    { label: 100, available: 100, shortens: false },
    { label: 120, available: 200, shortens: false },
  ])('gives $shortens for a $label wide name in $available', ({ label, available, shortens }) => {
    expect(shouldShortenLevelLabel(label, available)).toBe(shortens)
  })
})
