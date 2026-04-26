import { describe, expect, it } from 'vitest'

import { reorderArray } from '../../src/domain/array-utils'

describe('reorderArray', () => {
  it('moves an element forward', () => {
    expect(reorderArray(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves an element backward', () => {
    expect(reorderArray(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('returns a copy unchanged when from equals to', () => {
    const input = ['a', 'b', 'c']
    const result = reorderArray(input, 1, 1)
    expect(result).toEqual(['a', 'b', 'c'])
    expect(result).not.toBe(input)
  })

  it('moves the head element to the tail', () => {
    expect(reorderArray(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })

  it('moves the tail element to the head', () => {
    expect(reorderArray(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('returns a copy unchanged when from is out of range', () => {
    expect(reorderArray(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
    expect(reorderArray(['a', 'b'], -1, 0)).toEqual(['a', 'b'])
  })

  it('returns a copy unchanged when to is out of range', () => {
    expect(reorderArray(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
    expect(reorderArray(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
  })

  it('returns a copy unchanged when input is empty', () => {
    const input: number[] = []
    const result = reorderArray(input, 0, 0)
    expect(result).toEqual([])
    expect(result).not.toBe(input)
  })

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c']
    reorderArray(input, 0, 2)
    expect(input).toEqual(['a', 'b', 'c'])
  })
})
