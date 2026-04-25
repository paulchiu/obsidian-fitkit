import type { App, TAbstractFile, TFile } from 'obsidian';

import type { FitKitSettings } from './settings';
import { normalizeFolder, workoutsFolder } from './settings-paths';
import { parseWorkoutNote, type ExerciseEntry, type WorkoutNoteModel } from './workout-note-model';

export interface BestSet {
  weight: number;
  reps: number;
  e1rm: number;
}

export interface ExerciseIndexRow {
  exerciseName: string;
  kind: 'strength' | 'duration';
  bestSet?: BestSet;
  totalSets?: number;
  totalDurationSeconds?: number;
}

export interface IndexEntry {
  path: string;
  mtime: number;
  date: string;
  name: string;
  exercises: ExerciseIndexRow[];
}

export interface IndexDiagnostic {
  path: string;
  warnings: string[];
}

export interface FitKitIndex {
  schemaVersion: 1;
  builtAt: number;
  entries: IndexEntry[];
  diagnostics: IndexDiagnostic[];
}

/** Epley formula: weight * (1 + reps / 30). */
export function epleyE1rm(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

/**
 * Pick best strength set per tier rules:
 * - Tier A: max e1RM among sets with reps in [1,12] and weight > 0
 * - Tier B: max e1RM among sets with reps >= 1 and weight > 0
 * - Tier C: heaviest set, or most reps when all weights are 0
 * Returns null if sets is empty.
 */
export function pickBestSet(sets: ReadonlyArray<{ weight: number; reps: number }>): BestSet | null {
  if (sets.length === 0) {
    return null;
  }

  const tierA = pickMaxE1rm(
    sets.filter((set) => set.weight > 0 && set.reps >= 1 && set.reps <= 12),
  );
  if (tierA) {
    return tierA;
  }

  const tierB = pickMaxE1rm(sets.filter((set) => set.weight > 0 && set.reps >= 1));
  if (tierB) {
    return tierB;
  }

  if (sets.every((set) => set.weight === 0)) {
    const mostReps = pickByScore(sets, (set) => set.reps);
    return { weight: mostReps.weight, reps: mostReps.reps, e1rm: 0 };
  }

  const heaviest = pickByScore(sets, (set) => set.weight);
  return {
    weight: heaviest.weight,
    reps: heaviest.reps,
    e1rm: epleyE1rm(heaviest.weight, heaviest.reps),
  };
}

/**
 * Full vault scan. Lists markdown files under the configured workouts folder.
 */
export async function rebuildIndex(app: App, settings: FitKitSettings): Promise<FitKitIndex> {
  const folder = workoutsFolder(settings);
  const entries: IndexEntry[] = [];
  const diagnostics: IndexDiagnostic[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    if (!isInFolder(file.path, folder)) {
      continue;
    }

    const source = await app.vault.read(file);
    const result = parseWorkoutNote(source, file.path);
    if (!result.isWorkout || !result.model) {
      continue;
    }

    entries.push(toEntry(file, result.model));
    if (result.warnings.length > 0) {
      diagnostics.push({ path: file.path, warnings: result.warnings });
    }
  }

  return {
    schemaVersion: 1,
    builtAt: Date.now(),
    entries: sortEntries(entries),
    diagnostics: sortDiagnostics(diagnostics),
  };
}

/**
 * Incremental update. Re-reads one file and returns a new immutable index.
 */
export async function updateIndexEntry(
  app: App,
  settings: FitKitSettings,
  index: FitKitIndex,
  path: string,
): Promise<FitKitIndex> {
  const normalizedPath = normalizeFolder(path);
  const existingEntries = index.entries.filter((entry) => entry.path !== normalizedPath);
  const existingDiagnostics = index.diagnostics.filter(
    (diagnostic) => diagnostic.path !== normalizedPath,
  );
  const file = app.vault.getAbstractFileByPath(normalizedPath);
  const folder = workoutsFolder(settings);

  if (!isMarkdownFile(file) || !isInFolder(file.path, folder)) {
    return {
      ...index,
      builtAt: Date.now(),
      entries: existingEntries,
      diagnostics: existingDiagnostics,
    };
  }

  const source = await app.vault.read(file);
  const result = parseWorkoutNote(source, file.path);
  if (!result.isWorkout || !result.model) {
    return {
      ...index,
      builtAt: Date.now(),
      entries: existingEntries,
      diagnostics: existingDiagnostics,
    };
  }

  const diagnostics =
    result.warnings.length > 0
      ? [...existingDiagnostics, { path: file.path, warnings: result.warnings }]
      : existingDiagnostics;

  return {
    ...index,
    builtAt: Date.now(),
    entries: sortEntries([...existingEntries, toEntry(file, result.model)]),
    diagnostics: sortDiagnostics(diagnostics),
  };
}

function pickMaxE1rm(sets: ReadonlyArray<{ weight: number; reps: number }>): BestSet | null {
  if (sets.length === 0) {
    return null;
  }

  const best = pickByScore(sets, (set) => epleyE1rm(set.weight, set.reps));
  return {
    weight: best.weight,
    reps: best.reps,
    e1rm: epleyE1rm(best.weight, best.reps),
  };
}

function pickByScore<T>(items: ReadonlyArray<T>, score: (item: T) => number): T {
  const first = items[0];
  if (first === undefined) {
    throw new Error('Cannot pick from an empty collection.');
  }

  return items.slice(1).reduce((best, item) => (score(item) > score(best) ? item : best), first);
}

function toEntry(file: TFile, model: WorkoutNoteModel): IndexEntry {
  return {
    path: file.path,
    mtime: file.stat.mtime,
    date: model.date,
    name: model.name,
    exercises: model.exercises.map(toRow),
  };
}

function toRow(exercise: ExerciseEntry): ExerciseIndexRow {
  if (exercise.kind === 'duration') {
    const durationEntries = exercise.durationEntries ?? [];
    return {
      exerciseName: exercise.exerciseName,
      kind: exercise.kind,
      totalSets: durationEntries.length,
      totalDurationSeconds: durationEntries.reduce(
        (total, entry) => total + entry.durationSeconds,
        0,
      ),
    };
  }

  const strengthSets = exercise.strengthSets ?? [];
  return {
    exerciseName: exercise.exerciseName,
    kind: exercise.kind,
    bestSet: pickBestSet(strengthSets) ?? undefined,
    totalSets: strengthSets.length,
  };
}

function isInFolder(path: string, folder: string): boolean {
  return path !== folder && path.startsWith(`${folder}/`);
}

function isMarkdownFile(file: TAbstractFile | null): file is TFile {
  return file !== null && (file as { extension?: unknown }).extension === 'md';
}

function sortEntries(entries: ReadonlyArray<IndexEntry>): IndexEntry[] {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
}

function sortDiagnostics(diagnostics: ReadonlyArray<IndexDiagnostic>): IndexDiagnostic[] {
  return [...diagnostics].sort((left, right) => left.path.localeCompare(right.path));
}
