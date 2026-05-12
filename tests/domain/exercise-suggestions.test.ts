import { describe, expect, it } from 'vitest'

import { filterSuggestableNames } from '../../src/domain/exercise-suggestions'

describe('filterSuggestableNames', () => {
  it('includes names that are not deleted', () => {
    expect(filterSuggestableNames(['Squat'], [], new Set())).toEqual(['Squat'])
  })

  it('excludes deleted names without a registry overlay', () => {
    expect(filterSuggestableNames(['Squat'], ['Squat'], new Set())).toEqual([])
  })

  it('includes deleted names with a registry overlay', () => {
    expect(filterSuggestableNames(['Squat'], ['Squat'], new Set(['squat']))).toEqual(['Squat'])
  })

  it('matches deleted names case-insensitively', () => {
    expect(filterSuggestableNames(['bench press'], ['Bench Press'], new Set())).toEqual([])
    expect(filterSuggestableNames(['Bench Press'], ['bench press'], new Set())).toEqual([])
  })

  it('deduplicates names by normalized key', () => {
    expect(filterSuggestableNames(['Squat', 'squat', '  Squat  '], [], new Set())).toEqual([
      'Squat',
    ])
  })
})
