import type { ExerciseKind, ExerciseRegistry } from './exercise-registry';
import { normalize, resolve, upsertEntry } from './exercise-registry';
import type { ParsedExercise } from './journal-grammar';

export type ImportMappingChoice =
  | { kind: 'resolved'; canonicalName: string }
  | { kind: 'create-new'; canonicalName: string; exerciseKind: ExerciseKind }
  | { kind: 'unresolved' };

export type ImportMappingState = Map<string, ImportMappingChoice>;

export function mappingWithSelection(
  mapping: ImportMappingState,
  rawName: string,
  value: string,
): ImportMappingState {
  const next = new Map(mapping);
  const key = normalize(rawName);
  if (value === '__unresolved__') {
    next.set(key, { kind: 'unresolved' });
  } else if (value === 'create-strength' || value === 'create-duration') {
    const exerciseKind: ExerciseKind = value === 'create-duration' ? 'duration' : 'strength';
    next.set(key, {
      kind: 'create-new',
      canonicalName: rawName,
      exerciseKind,
    });
  } else if (value.startsWith('existing:')) {
    const name = value.slice('existing:'.length);
    next.set(key, { kind: 'resolved', canonicalName: name });
  }
  return next;
}

export function mappingWithParsedExercises(
  mapping: ImportMappingState,
  registry: ExerciseRegistry,
  exercises: ParsedExercise[],
): ImportMappingState {
  const next = new Map(mapping);
  const seen = new Set<string>();
  for (const exercise of exercises) {
    const key = normalize(exercise.rawName);
    seen.add(key);
    if (next.has(key)) {
      continue;
    }
    const resolution = resolve(registry, exercise.rawName);
    if (resolution.kind === 'match') {
      next.set(key, { kind: 'resolved', canonicalName: resolution.entry.name });
    } else {
      next.set(key, { kind: 'unresolved' });
    }
  }
  for (const key of [...next.keys()]) {
    if (!seen.has(key)) {
      next.delete(key);
    }
  }
  return next;
}

export type ImportMappingRegistryUpdate = {
  registry: ExerciseRegistry;
  changed: boolean;
};

export function registryWithImportMappingChanges(
  registry: ExerciseRegistry,
  exercises: ParsedExercise[],
  mapping: ImportMappingState,
): ImportMappingRegistryUpdate {
  let next = registry;
  let changed = false;
  const seen = new Set<string>();
  for (const exercise of exercises) {
    const key = normalize(exercise.rawName);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const choice = mapping.get(key);
    if (!choice || choice.kind === 'unresolved') {
      continue;
    }
    const existing = next.entries.find((entry) => entry.name === choice.canonicalName);
    if (choice.kind === 'create-new') {
      if (!existing) {
        next = upsertEntry(next, {
          name: choice.canonicalName,
          kind: choice.exerciseKind,
          aliases: [],
        });
        changed = true;
      }
      continue;
    }
    if (!existing) {
      continue;
    }
    const rawKey = normalize(exercise.rawName);
    const knownKeys = new Set(
      [existing.name, ...existing.aliases].map((value) => normalize(value)),
    );
    if (knownKeys.has(rawKey)) {
      continue;
    }
    next = upsertEntry(next, {
      ...existing,
      aliases: [...existing.aliases, exercise.rawName],
    });
    changed = true;
  }
  return { registry: next, changed };
}
