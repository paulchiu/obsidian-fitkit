import { describe, expect, it } from 'vitest'

import type { ExerciseRegistry, ExerciseRegistryEntry } from '../../src/domain/exercise-registry'
import {
  bootstrapFromStems,
  createRegistry,
  kindForName,
  mergeRegistries,
  removeEntry,
  renameEntry,
  resolve,
  sanitizeEntryDraft,
  upsertEntry,
  validateEntryDraft,
} from '../../src/domain/exercise-registry'

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

  it('returns the kind for an exact match and aliases', () => {
    const registry = createRegistry([squat, plank])

    expect(kindForName(registry, 'Squat')).toBe('strength')
    expect(kindForName(registry, 'back squat')).toBe('strength')
    expect(kindForName(registry, 'plank')).toBe('duration')
  })

  it('returns null for unknown or ambiguous names', () => {
    const otherSquat: ExerciseRegistryEntry = {
      name: 'Front Squat',
      kind: 'strength',
      aliases: ['squats'],
    }
    const registry = createRegistry([squat, otherSquat])

    expect(kindForName(registry, 'unknown exercise')).toBeNull()
    expect(kindForName(registry, 'squats')).toBeNull()
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

describe('sanitizeEntryDraft', () => {
  it('trims canonical name and aliases', () => {
    const result = sanitizeEntryDraft({
      name: '  Squat  ',
      kind: 'strength',
      aliases: ['  Back Squat  ', ' BB Squat '],
    })

    expect(result.name).toBe('Squat')
    expect(result.aliases).toEqual(['Back Squat', 'BB Squat'])
  })

  it('drops empty-after-trim aliases', () => {
    const result = sanitizeEntryDraft({
      name: 'Squat',
      kind: 'strength',
      aliases: ['Back Squat', '   ', '', 'BB Squat'],
    })

    expect(result.aliases).toEqual(['Back Squat', 'BB Squat'])
  })

  it('dedupes aliases by normalized form, keeping first occurrence original casing', () => {
    const result = sanitizeEntryDraft({
      name: 'Squat',
      kind: 'strength',
      aliases: ['Back Squat', 'back squat', 'BACK SQUAT'],
    })

    expect(result.aliases).toEqual(['Back Squat'])
  })

  it('drops self-aliases that normalize to the canonical', () => {
    const result = sanitizeEntryDraft({
      name: 'Squat',
      kind: 'strength',
      aliases: ['squat', '  Squat ', 'Back Squat'],
    })

    expect(result.aliases).toEqual(['Back Squat'])
  })

  it('is idempotent', () => {
    const draft = {
      name: '  Squat  ',
      kind: 'strength' as const,
      aliases: ['Back Squat', 'back squat', '', 'BB Squat'],
    }
    const once = sanitizeEntryDraft(draft)
    const twice = sanitizeEntryDraft(once)

    expect(twice).toEqual(once)
  })
})

describe('validateEntryDraft', () => {
  const registry = createRegistry([
    { name: 'Squat', kind: 'strength', aliases: ['Back Squat', 'BB Squat'] },
    { name: 'Plank', kind: 'duration', aliases: [] },
  ])

  it('returns [] for a valid draft', () => {
    const errors = validateEntryDraft(registry, {
      name: 'Bench Press',
      kind: 'strength',
      aliases: ['Bench'],
    })
    expect(errors).toEqual([])
  })

  it('rejects empty trimmed names', () => {
    const errors = validateEntryDraft(registry, {
      name: '   ',
      kind: 'strength',
      aliases: [],
    })
    expect(errors).toEqual([{ field: 'name', message: 'Name cannot be empty.' }])
  })

  it('reports collision with another entry canonical name', () => {
    const errors = validateEntryDraft(registry, {
      name: 'plank',
      kind: 'duration',
      aliases: [],
    })
    expect(errors).toEqual([
      { field: 'name', message: "Name 'plank' conflicts with entry 'Plank'." },
    ])
  })

  it('reports collision with another entry alias and labels it as alias', () => {
    const errors = validateEntryDraft(registry, {
      name: 'back squat',
      kind: 'strength',
      aliases: [],
    })
    expect(errors).toEqual([
      { field: 'name', message: "Name 'back squat' conflicts with alias on entry 'Squat'." },
    ])
  })

  it('reports alias colliding with another entry canonical', () => {
    const errors = validateEntryDraft(registry, {
      name: 'Front Squat',
      kind: 'strength',
      aliases: ['plank'],
    })
    expect(errors).toEqual([
      { field: 'alias', index: 0, message: "Alias 'plank' conflicts with entry 'Plank'." },
    ])
  })

  it('reports alias colliding with another entry alias and labels it as alias', () => {
    const errors = validateEntryDraft(registry, {
      name: 'Front Squat',
      kind: 'strength',
      aliases: ['BB Squat'],
    })
    expect(errors).toEqual([
      {
        field: 'alias',
        index: 0,
        message: "Alias 'BB Squat' conflicts with alias on entry 'Squat'.",
      },
    ])
  })

  it('rejects names that normalize to empty (punctuation-only)', () => {
    const errors = validateEntryDraft(registry, {
      name: '!!!',
      kind: 'strength',
      aliases: [],
    })
    expect(errors).toEqual([
      { field: 'name', message: 'Name must contain a letter or number.' },
    ])
  })

  it('allows self-collision in edit mode via excludeOriginalName', () => {
    const errors = validateEntryDraft(
      registry,
      { name: 'Squat', kind: 'strength', aliases: ['Back Squat'] },
      { excludeOriginalName: 'Squat' },
    )
    expect(errors).toEqual([])
  })

  it('allows alias that normalizes to draft own canonical', () => {
    const errors = validateEntryDraft(registry, {
      name: 'Front Squat',
      kind: 'strength',
      aliases: ['front squat'],
    })
    expect(errors).toEqual([])
  })

  it('treats punctuation- or case-only collisions as conflicts', () => {
    const errors = validateEntryDraft(registry, {
      name: 'squat!',
      kind: 'strength',
      aliases: [],
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]?.field).toBe('name')
  })
})

describe('renameEntry', () => {
  const baseRegistry = (): ExerciseRegistry =>
    createRegistry([
      { name: 'Squat', kind: 'strength', aliases: ['Back Squat'] },
      { name: 'Plank', kind: 'duration', aliases: [] },
    ])

  it('updates kind and aliases without renaming', () => {
    const next = renameEntry(baseRegistry(), 'Plank', {
      name: 'Plank',
      kind: 'strength',
      aliases: ['Forearm Plank'],
    })
    const entry = next.entries.find((row) => row.name === 'Plank')
    expect(entry?.kind).toBe('strength')
    expect(entry?.aliases).toEqual(['Forearm Plank'])
    expect(next.entries.find((row) => row.name === 'Squat')?.aliases).toEqual(['Back Squat'])
  })

  it('does not add a self-alias when the rename is normalize-equivalent', () => {
    const next = renameEntry(baseRegistry(), 'Squat ', {
      name: 'Squat',
      kind: 'strength',
      aliases: ['Back Squat'],
    })
    const entry = next.entries.find((row) => row.name === 'Squat')
    expect(entry?.aliases).toEqual(['Back Squat'])
  })

  it('prepends the old name as an alias on a true rename', () => {
    const next = renameEntry(baseRegistry(), 'Squat', {
      name: 'Back Squat',
      kind: 'strength',
      aliases: [],
    })
    const entry = next.entries.find((row) => row.name === 'Back Squat')
    expect(entry?.aliases).toEqual(['Squat'])
    expect(next.entries.find((row) => row.name === 'Squat')).toBeUndefined()
  })

  it('dedupes when the supplied draft already lists the old name as an alias', () => {
    const next = renameEntry(baseRegistry(), 'Squat', {
      name: 'Front Squat',
      kind: 'strength',
      aliases: ['Squat', 'Back Squat'],
    })
    const entry = next.entries.find((row) => row.name === 'Front Squat')
    expect(entry?.aliases).toEqual(['Squat', 'Back Squat'])
  })

  it('dedupes when the supplied draft has a normalize-equal-but-raw-different alias of the old name', () => {
    const next = renameEntry(baseRegistry(), 'Back Squat', {
      name: 'Front Squat',
      kind: 'strength',
      aliases: ['back squat ', 'Low Bar'],
    })
    const entry = next.entries.find((row) => row.name === 'Front Squat')
    expect(entry?.aliases).toEqual(['Back Squat', 'Low Bar'])
  })

  it('drops aliases that normalize to the new canonical', () => {
    const next = renameEntry(baseRegistry(), 'Squat', {
      name: 'Front Squat',
      kind: 'strength',
      aliases: ['front squat', 'Low Bar'],
    })
    const entry = next.entries.find((row) => row.name === 'Front Squat')
    expect(entry?.aliases).toEqual(['Squat', 'Low Bar'])
  })

  it('keeps resolution intact for the old name through aliasing', () => {
    const next = renameEntry(baseRegistry(), 'Squat', {
      name: 'Back Squat',
      kind: 'strength',
      aliases: [],
    })
    const result = resolve(next, 'Squat')
    expect(result.kind).toBe('match')
    if (result.kind === 'match') {
      expect(result.entry.name).toBe('Back Squat')
    }
  })
})
