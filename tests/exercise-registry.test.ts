import { describe, expect, it } from 'vitest'

import type { ExerciseRegistry, ExerciseRegistryEntry } from '../src/exercise-registry'
import {
  bootstrapFromStems,
  createRegistry,
  mergeRegistries,
  removeEntry,
  resolve,
  upsertEntry,
} from '../src/exercise-registry'

const squat: ExerciseRegistryEntry = {
  name: 'Squat',
  kind: 'strength',
  aliases: ['squats', 'back squat'],
}

const plank: ExerciseRegistryEntry = {
  name: 'Plank',
  kind: 'duration',
  aliases: [],
}

function expectMatch(registry: ExerciseRegistry, rawName: string): ExerciseRegistryEntry {
  const result = resolve(registry, rawName)
  expect(result.kind).toBe('match')
  if (result.kind !== 'match') {
    throw new Error(`${rawName} did not resolve`)
  }
  return result.entry
}

describe('exercise registry', () => {
  it('resolves canonical names, aliases, and case-folded names', () => {
    const registry = createRegistry([squat, plank])

    expect(expectMatch(registry, 'Squat').name).toBe('Squat')
    expect(expectMatch(registry, 'squats').name).toBe('Squat')
    expect(expectMatch(registry, 'plank').name).toBe('Plank')
    expect(resolve(registry, 'unknown').kind).toBe('unknown')
  })

  it('bootstraps entries from filename stems', () => {
    const registry = bootstrapFromStems(['Squat', 'Bench Press'])

    expect(registry.entries.map((entry) => entry.name)).toEqual(['Bench Press', 'Squat'])
    expect(registry.entries.every((entry) => entry.kind === 'strength')).toBe(true)
  })

  it('upserts entries without mutating the input registry', () => {
    const original = createRegistry([squat])
    const next = upsertEntry(original, plank)

    expect(original.entries).toHaveLength(1)
    expect(next.entries).toHaveLength(2)
    expect(next).not.toBe(original)
    expect(next.entries).not.toBe(original.entries)
  })

  it('removes entries without mutating the input registry', () => {
    const original = createRegistry([squat, plank])
    const next = removeEntry(original, 'Squat')

    expect(original.entries).toHaveLength(2)
    expect(next.entries).toHaveLength(1)
    expect(next.entries.map((entry) => entry.name)).toEqual(['Plank'])
    expect(next.entries).not.toBe(original.entries)
  })

  it('merges fresh entries without replacing existing aliases', () => {
    const existing: ExerciseRegistryEntry[] = [
      { name: 'Squat', kind: 'strength', aliases: ['squats'] },
    ]
    const fresh: ExerciseRegistryEntry[] = [
      { name: 'Squat', kind: 'strength', aliases: [] },
      { name: 'Bench Press', kind: 'strength', aliases: [] },
    ]

    expect(mergeRegistries(existing, fresh)).toEqual([
      { name: 'Squat', kind: 'strength', aliases: ['squats'] },
      { name: 'Bench Press', kind: 'strength', aliases: [] },
    ])
  })

  it('merges fresh entries case-insensitively', () => {
    const existing: ExerciseRegistryEntry[] = [
      { name: 'squat', kind: 'strength', aliases: ['squats'] },
    ]
    const fresh: ExerciseRegistryEntry[] = [{ name: 'Squat', kind: 'strength', aliases: [] }]

    expect(mergeRegistries(existing, fresh)).toEqual([
      { name: 'squat', kind: 'strength', aliases: ['squats'] },
    ])
  })
})
