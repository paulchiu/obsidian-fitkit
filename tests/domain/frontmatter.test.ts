import { describe, expect, it } from 'vitest'
import { frontmatterTypeIs, readFrontmatterField } from '../../src/domain/frontmatter'

describe('readFrontmatterField', () => {
  it('returns the value for a present key', () => {
    expect(readFrontmatterField({ kind: 'strength' }, 'kind')).toBe('strength')
  })

  it('returns undefined for a missing key or absent frontmatter', () => {
    expect(readFrontmatterField({ kind: 'strength' }, 'unit')).toBeUndefined()
    expect(readFrontmatterField(undefined, 'kind')).toBeUndefined()
    expect(readFrontmatterField(null, 'kind')).toBeUndefined()
  })
})

describe('frontmatterTypeIs', () => {
  it('matches the type ignoring case and surrounding whitespace', () => {
    expect(frontmatterTypeIs({ type: ' Workout ' }, 'workout')).toBe(true)
    expect(frontmatterTypeIs({ type: 'EXERCISE' }, 'exercise')).toBe(true)
  })

  it('rejects other types, non-string types and absent frontmatter', () => {
    expect(frontmatterTypeIs({ type: 'exercise' }, 'workout')).toBe(false)
    expect(frontmatterTypeIs({ type: 3 }, 'workout')).toBe(false)
    expect(frontmatterTypeIs({}, 'workout')).toBe(false)
    expect(frontmatterTypeIs(undefined, 'workout')).toBe(false)
    expect(frontmatterTypeIs(null, 'exercise')).toBe(false)
  })
})
