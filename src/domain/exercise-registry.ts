/**
 * Exercise registry with deterministic alias resolution. Normalization:
 * NFC, lower, trim, strip edge punctuation, collapse internal whitespace.
 */

import { DEFAULT_WEIGHT_UNIT, type WeightUnit } from './weight-unit'

export type ExerciseKind = 'strength' | 'duration'

/**
 * `unit` is only present when explicitly recorded (via the registry editor or
 * import). Absence means "no unit on file", distinct from an explicit 'kg';
 * callers fall back to `DEFAULT_WEIGHT_UNIT` themselves rather than have this
 * type silently synthesize one.
 */
export type ExerciseRegistryEntry = {
  name: string
  kind: ExerciseKind
  unit?: WeightUnit
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

/**
 * Normalized keys already covered by an overlay entry: its name and every
 * alias. A name that only matches an alias is "known" and must not be
 * treated as missing by registry backfill or the comprehensive table.
 */
export function overlayKnownKeys(entries: readonly ExerciseRegistryEntry[]): Set<string> {
  const keys = new Set<string>()
  for (const entry of entries) {
    keys.add(normalize(entry.name))
    for (const alias of entry.aliases) {
      keys.add(normalize(alias))
    }
  }
  return keys
}

export function createRegistry(entries: ExerciseRegistryEntry[] = []): ExerciseRegistry {
  return { entries: entries.map(cloneEntry) }
}

function cloneEntry(entry: ExerciseRegistryEntry): ExerciseRegistryEntry {
  return {
    name: entry.name,
    kind: entry.kind,
    unit: entry.unit,
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

/**
 * Return the kind of the registry entry matching `rawName` exactly. Returns
 * null when the name is unknown or resolves ambiguously across multiple
 * entries; callers pick their own default.
 */
export function kindForName(registry: ExerciseRegistry, rawName: string): ExerciseKind | null {
  const result = resolve(registry, rawName)
  return result.kind === 'match' ? result.entry.kind : null
}

export function unitForName(registry: ExerciseRegistry, rawName: string): WeightUnit | null {
  const result = resolve(registry, rawName)
  return result.kind === 'match' ? (result.entry.unit ?? null) : null
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

/**
 * Replace the entry matching `entry.name` (case/whitespace-insensitive) or
 * append it as new. Keying on `normalize()` keeps a case or whitespace variant
 * from producing a second, ambiguous entry alongside the existing one.
 */
export function upsertEntry(
  registry: ExerciseRegistry,
  entry: ExerciseRegistryEntry,
): ExerciseRegistry {
  const key = normalize(entry.name)
  const next = registry.entries.filter((existing) => normalize(existing.name) !== key)
  next.push(cloneEntry(entry))
  next.sort((left, right) => left.name.localeCompare(right.name))
  return { entries: next }
}

export function removeEntry(registry: ExerciseRegistry, name: string): ExerciseRegistry {
  const key = normalize(name)
  return { entries: registry.entries.filter((entry) => normalize(entry.name) !== key) }
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
    unit: DEFAULT_WEIGHT_UNIT,
    aliases: [],
  }))
  entries.sort((left, right) => left.name.localeCompare(right.name))
  return { entries }
}

export type RegistryEntryDraft = {
  name: string
  kind: ExerciseKind
  unit?: WeightUnit
  aliases: string[]
}

export type ValidationError = {
  field: 'name' | 'alias'
  index?: number
  message: string
}

/**
 * Trim and dedupe a raw form draft. Drops empty aliases, dedupes aliases
 * by normalized form (first occurrence wins, original casing kept). Self
 * aliases (those that normalize to the draft's own canonical) are dropped.
 * Idempotent.
 */
export function sanitizeEntryDraft(draft: RegistryEntryDraft): RegistryEntryDraft {
  const name = draft.name.trim()
  const canonicalKey = normalize(name)
  const seen = new Set<string>()
  const aliases: string[] = []
  for (const raw of draft.aliases) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      continue
    }
    const key = normalize(trimmed)
    if (key.length === 0) {
      continue
    }
    if (key === canonicalKey) {
      continue
    }
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    aliases.push(trimmed)
  }
  return { name, kind: draft.kind, unit: draft.unit, aliases }
}

/**
 * Validate a sanitized draft against an existing registry. `excludeOriginalName`
 * lets edit mode ignore self collisions. Returns [] when valid.
 */
export function validateEntryDraft(
  registry: ExerciseRegistry,
  draft: RegistryEntryDraft,
  options: { excludeOriginalName?: string } = {},
): ValidationError[] {
  const errors: ValidationError[] = []
  const name = draft.name.trim()
  if (name.length === 0) {
    errors.push({ field: 'name', message: 'Name cannot be empty.' })
    return errors
  }
  const nameKey = normalize(name)
  if (nameKey.length === 0) {
    errors.push({ field: 'name', message: 'Name must contain a letter or number.' })
    return errors
  }

  const excludeKey =
    options.excludeOriginalName !== undefined ? normalize(options.excludeOriginalName) : null
  type Owner = { entry: ExerciseRegistryEntry; source: 'name' | 'alias' }
  const ownerByKey = new Map<string, Owner>()
  for (const entry of registry.entries) {
    if (excludeKey !== null && normalize(entry.name) === excludeKey) {
      continue
    }
    const canonicalKey = normalize(entry.name)
    if (canonicalKey.length > 0 && !ownerByKey.has(canonicalKey)) {
      ownerByKey.set(canonicalKey, { entry, source: 'name' })
    }
    for (const alias of entry.aliases) {
      const aliasKey = normalize(alias)
      if (aliasKey.length === 0 || ownerByKey.has(aliasKey)) {
        continue
      }
      ownerByKey.set(aliasKey, { entry, source: 'alias' })
    }
  }

  const nameOwner = ownerByKey.get(nameKey)
  if (nameOwner) {
    const subject = nameOwner.source === 'name' ? 'entry' : 'alias on entry'
    errors.push({
      field: 'name',
      message: `Name '${name}' conflicts with ${subject} '${nameOwner.entry.name}'.`,
    })
  }

  draft.aliases.forEach((alias, index) => {
    const key = normalize(alias)
    if (key.length === 0) {
      return
    }
    if (key === nameKey) {
      return
    }
    const owner = ownerByKey.get(key)
    if (owner) {
      const subject = owner.source === 'name' ? 'entry' : 'alias on entry'
      errors.push({
        field: 'alias',
        index,
        message: `Alias '${alias}' conflicts with ${subject} '${owner.entry.name}'.`,
      })
    }
  })

  return errors
}

/**
 * Return an updated registry with the entry under `oldName` replaced by `next`.
 * If the canonical name changes (under normalize), the old name is prepended to
 * `next.aliases` (deduped on normalized form). Aliases that normalize to the
 * new canonical are dropped. Caller passes a sanitized draft.
 */
export function renameEntry(
  registry: ExerciseRegistry,
  oldName: string,
  next: RegistryEntryDraft,
): ExerciseRegistry {
  const oldKey = normalize(oldName)
  const newKey = normalize(next.name)
  const aliasesWithOld = oldKey === newKey ? [...next.aliases] : [oldName, ...next.aliases]
  const seen = new Set<string>()
  const dedupedAliases: string[] = []
  for (const alias of aliasesWithOld) {
    const trimmed = alias.trim()
    if (trimmed.length === 0) {
      continue
    }
    const key = normalize(trimmed)
    if (key.length === 0 || key === newKey || seen.has(key)) {
      continue
    }
    seen.add(key)
    dedupedAliases.push(trimmed)
  }
  const without = removeEntry(registry, oldName)
  return upsertEntry(without, {
    name: next.name,
    kind: next.kind,
    unit: next.unit,
    aliases: dedupedAliases,
  })
}
