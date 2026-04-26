/**
 * Exercise registry with deterministic alias resolution. Normalization:
 * NFC, lower, trim, strip edge punctuation, collapse internal whitespace.
 */

export type ExerciseKind = 'strength' | 'duration'

export type ExerciseRegistryEntry = {
  name: string
  kind: ExerciseKind
  aliases: string[]
}

export type ExerciseRegistry = {
  entries: ExerciseRegistryEntry[]
}

export type ResolutionMatch = {
  kind: 'match'
  entry: ExerciseRegistryEntry
}

export type ResolutionAmbiguous = {
  kind: 'ambiguous'
  candidates: ExerciseRegistryEntry[]
}

export type ResolutionUnknown = {
  kind: 'unknown'
}

export type ResolutionResult = ResolutionMatch | ResolutionAmbiguous | ResolutionUnknown

const EDGE_PUNCT = /^[\s.,;:!?'"`]+|[\s.,;:!?'"`]+$/g
const INNER_WS = /\s+/g

/**
 * Normalize a raw name to canonical comparison form.
 */
export function normalize(input: string): string {
  const base = (input ?? '').normalize('NFC').toLowerCase().trim()
  return base.replace(EDGE_PUNCT, '').replace(INNER_WS, ' ')
}

export function createRegistry(entries: ExerciseRegistryEntry[] = []): ExerciseRegistry {
  return { entries: entries.map(cloneEntry) }
}

function cloneEntry(entry: ExerciseRegistryEntry): ExerciseRegistryEntry {
  return {
    name: entry.name,
    kind: entry.kind,
    aliases: [...entry.aliases],
  }
}

/**
 * Build an index of normalized key -> list of entries. A canonical name and
 * every alias contribute a key. Collisions are allowed; resolution returns
 * them as ambiguous.
 */
function buildIndex(registry: ExerciseRegistry): Map<string, ExerciseRegistryEntry[]> {
  const index = new Map<string, ExerciseRegistryEntry[]>()
  for (const entry of registry.entries) {
    const keys = new Set<string>()
    keys.add(normalize(entry.name))
    for (const alias of entry.aliases) {
      keys.add(normalize(alias))
    }
    for (const key of keys) {
      if (key.length === 0) {
        continue
      }
      const bucket = index.get(key) ?? []
      bucket.push(entry)
      index.set(key, bucket)
    }
  }
  return index
}

export function resolve(registry: ExerciseRegistry, rawName: string): ResolutionResult {
  const key = normalize(rawName)
  if (key.length === 0) {
    return { kind: 'unknown' }
  }
  const index = buildIndex(registry)
  const bucket = index.get(key)
  if (!bucket || bucket.length === 0) {
    return { kind: 'unknown' }
  }
  /** Deduplicate by canonical name. */
  const seen = new Map<string, ExerciseRegistryEntry>()
  for (const entry of bucket) {
    seen.set(entry.name, entry)
  }
  const unique = [...seen.values()]
  if (unique.length === 1) {
    return { kind: 'match', entry: unique[0] as ExerciseRegistryEntry }
  }
  return { kind: 'ambiguous', candidates: unique }
}

export function upsertEntry(
  registry: ExerciseRegistry,
  entry: ExerciseRegistryEntry,
): ExerciseRegistry {
  const next = registry.entries.filter((existing) => existing.name !== entry.name)
  next.push(cloneEntry(entry))
  next.sort((left, right) => left.name.localeCompare(right.name))
  return { entries: next }
}

export function removeEntry(registry: ExerciseRegistry, name: string): ExerciseRegistry {
  return { entries: registry.entries.filter((entry) => entry.name !== name) }
}

export function mergeRegistries(
  existing: ExerciseRegistryEntry[],
  fresh: ExerciseRegistryEntry[],
): ExerciseRegistryEntry[] {
  const existingNames = new Set(existing.map((entry) => normalize(entry.name)))
  return [
    ...existing.map(cloneEntry),
    ...fresh
      .filter((entry) => !existingNames.has(normalize(entry.name)))
      .map((entry) => cloneEntry(entry)),
  ]
}

/**
 * Bootstrap a registry from exercise filename stems. Every stem becomes a
 * canonical entry with no aliases. Kind defaults to strength; duration
 * overrides can be supplied.
 */
export function bootstrapFromStems(
  stems: string[],
  durationNames: string[] = [],
): ExerciseRegistry {
  const durationSet = new Set(durationNames.map((value) => normalize(value)))
  const entries: ExerciseRegistryEntry[] = stems.map((stem) => ({
    name: stem,
    kind: durationSet.has(normalize(stem)) ? 'duration' : 'strength',
    aliases: [],
  }))
  entries.sort((left, right) => left.name.localeCompare(right.name))
  return { entries }
}
