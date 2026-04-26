import { describe, expect, it } from 'vitest'

import { createRegistry, normalize } from '../src/exercise-registry'
import {
  mappingWithParsedExercises,
  mappingWithSelection,
  registryWithImportMappingChanges,
} from '../src/import-mapping'
import type { ImportMappingState } from '../src/import-mapping'
import { parseJournal } from '../src/journal-grammar'

const squat = { name: 'Squat', kind: 'strength' as const, aliases: [] }

describe('import mapping', () => {
  it('resolves existing exercises and leaves create-new selections in memory until import persists', () => {
    const registry = createRegistry([squat])
    const parsed = parseJournal(['2026-04-26', 'Squat 100 x 5', 'Plank 60s'].join('\n'))

    const initial = mappingWithParsedExercises(new Map(), registry, parsed.exercises)
    expect(initial.get(normalize('Squat'))).toEqual({ kind: 'resolved', canonicalName: 'Squat' })
    expect(initial.get(normalize('Plank'))).toEqual({ kind: 'unresolved' })

    const selected = mappingWithSelection(initial, 'Plank', 'create-duration')

    expect(registry.entries).toEqual([squat])
    expect(selected.get(normalize('Plank'))).toEqual({
      kind: 'create-new',
      canonicalName: 'Plank',
      exerciseKind: 'duration',
    })

    const update = registryWithImportMappingChanges(registry, parsed.exercises, selected)
    expect(update.changed).toBe(true)
    expect(update.registry.entries).toEqual([
      { name: 'Plank', kind: 'duration', aliases: [] },
      squat,
    ])
  })

  it('does not change the registry for unresolved mappings', () => {
    const registry = createRegistry([squat])
    const parsed = parseJournal('Plank 60s')
    const mapping = mappingWithParsedExercises(new Map(), registry, parsed.exercises)

    const update = registryWithImportMappingChanges(registry, parsed.exercises, mapping)

    expect(update.changed).toBe(false)
    expect(update.registry).toBe(registry)
  })

  it('drops stale mapping rows when the pasted input changes', () => {
    const registry = createRegistry([squat])
    const previous = mappingWithSelection(new Map(), 'Plank', 'create-duration')
    const parsed = parseJournal('Squat 100 x 5')

    const next = mappingWithParsedExercises(previous, registry, parsed.exercises)

    expect(next.get(normalize('Squat'))).toEqual({ kind: 'resolved', canonicalName: 'Squat' })
    expect(next.has(normalize('Plank'))).toBe(false)
  })

  it('persists a raw alias only after an existing exercise mapping is confirmed', () => {
    const registry = createRegistry([squat])
    const parsed = parseJournal('Back Squat 100 x 5')
    const mapping: ImportMappingState = mappingWithSelection(
      new Map(),
      'Back Squat',
      'existing:Squat',
    )

    const update = registryWithImportMappingChanges(registry, parsed.exercises, mapping)

    expect(update.changed).toBe(true)
    expect(update.registry.entries).toEqual([
      { name: 'Squat', kind: 'strength', aliases: ['Back Squat'] },
    ])
  })
})
