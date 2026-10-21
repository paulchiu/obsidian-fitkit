import { describe, expect, it } from 'vitest'
import { dirnameOf } from '../src/settings-paths'

describe('dirnameOf', () => {
  it('returns an empty string when the path has no slash', () => {
    expect(dirnameOf('Note.md')).toBe('')
  })

  it('returns the parent folder of a nested path', () => {
    expect(dirnameOf('Fitness/Exercises/Squat.md')).toBe('Fitness/Exercises')
  })
})
