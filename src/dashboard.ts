import type { App, TAbstractFile, TFile } from 'obsidian';

import type { BestSet, ExerciseIndexRow, FitKitIndex } from './index';
import type { FitKitSettings } from './settings';
import { dashboardPath, normalizeFolder, workoutsFolder } from './settings-paths';

interface ExerciseAggregate {
  exerciseName: string;
  kind: 'strength' | 'duration';
  bestSet?: BestSet;
  totalSets: number;
  totalDurationSeconds: number;
  sessionCount: number;
}

/**
 * Pure: build full dashboard markdown from index.
 * @param index - The FitKit index.
 * @param workoutsFolderPath - Resolved folder path for Dataview queries.
 * @param hiddenKeys - Set of keys like 'exercise:Squat' to exclude.
 */
export function composeDashboard(
  index: FitKitIndex,
  workoutsFolderPath: string,
  hiddenKeys: ReadonlySet<string>,
): string {
  const exercises = aggregateExercises(index)
    .filter((exercise) => !hiddenKeys.has(`exercise:${exercise.exerciseName}`))
    .sort((left, right) => left.exerciseName.localeCompare(right.exerciseName));
  const lines: string[] = [];

  lines.push('# FitKit Dashboard');
  lines.push('');
  lines.push(
    `_Generated ${new Date(index.builtAt).toISOString()}; ${index.entries.length} sessions, ${exercises.length} exercises._`,
  );
  lines.push('');
  lines.push('## PBs');
  lines.push('');

  for (const exercise of exercises) {
    lines.push(formatPb(exercise));
  }

  for (const exercise of exercises) {
    lines.push('');
    lines.push(`## ${exercise.exerciseName}`);
    lines.push('');
    lines.push('```dataview');
    lines.push(...dataviewQuery(exercise, workoutsFolderPath));
    lines.push('```');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export async function regenerateDashboard(
  app: App,
  settings: FitKitSettings,
  index: FitKitIndex,
): Promise<{ path: string; sectionCount: number }> {
  const path = normalizeFolder(dashboardPath(settings));
  const hiddenKeys = new Set(settings.hiddenDashboardSectionsByPath[path] ?? []);
  const folder = workoutsFolder(settings);
  const markdown = composeDashboard(index, folder, hiddenKeys);
  const existing = app.vault.getAbstractFileByPath(path);

  if (isMarkdownFile(existing)) {
    await app.vault.modify(existing, markdown);
  } else {
    await app.vault.create(path, markdown);
  }

  return {
    path,
    sectionCount: aggregateExercises(index).filter(
      (exercise) => !hiddenKeys.has(`exercise:${exercise.exerciseName}`),
    ).length,
  };
}

function aggregateExercises(index: FitKitIndex): ExerciseAggregate[] {
  const exercises = new Map<string, ExerciseAggregate>();

  for (const entry of index.entries) {
    const sessionExercises = new Set<string>();
    for (const row of entry.exercises) {
      const aggregate = getAggregate(exercises, row);
      aggregate.totalSets += row.totalSets ?? 0;
      aggregate.totalDurationSeconds += row.totalDurationSeconds ?? 0;
      if (!sessionExercises.has(row.exerciseName)) {
        aggregate.sessionCount += 1;
        sessionExercises.add(row.exerciseName);
      }
      if (
        row.bestSet &&
        row.bestSet.reps !== 0 &&
        (!aggregate.bestSet || row.bestSet.e1rm > aggregate.bestSet.e1rm)
      ) {
        aggregate.bestSet = row.bestSet;
      }
    }
  }

  return [...exercises.values()];
}

function getAggregate(
  exercises: Map<string, ExerciseAggregate>,
  row: ExerciseIndexRow,
): ExerciseAggregate {
  const existing = exercises.get(row.exerciseName);
  if (existing) {
    return existing;
  }

  const created: ExerciseAggregate = {
    exerciseName: row.exerciseName,
    kind: row.kind,
    totalSets: 0,
    totalDurationSeconds: 0,
    sessionCount: 0,
  };
  exercises.set(row.exerciseName, created);
  return created;
}

function formatPb(exercise: ExerciseAggregate): string {
  if (exercise.kind === 'duration') {
    const sessionLabel = exercise.sessionCount === 1 ? 'session' : 'sessions';
    return `- **${exercise.exerciseName}:** total ${exercise.totalDurationSeconds}s across ${exercise.sessionCount} ${sessionLabel}`;
  }

  if (!exercise.bestSet) {
    return `- **${exercise.exerciseName}:** no completed sets`;
  }

  return `- **${exercise.exerciseName}:** ${exercise.bestSet.weight} kg x ${exercise.bestSet.reps} (e1rm ${exercise.bestSet.e1rm.toFixed(1)})`;
}

function dataviewQuery(exercise: ExerciseAggregate, workoutsFolderPath: string): string[] {
  if (exercise.kind === 'duration') {
    return [
      'table without id file.link as Session, duration + "s" as Duration',
      `from "${workoutsFolderPath}"`,
      'flatten file.lists as item',
      `where contains(item.text, "[exercise:: [[${exercise.exerciseName}]]]") and item.duration`,
      'sort file.name desc',
      'limit 12',
    ];
  }

  return [
    'TABLE WITHOUT ID',
    '  file.link AS Workout,',
    '  L.set AS Set,',
    '  L.weight AS Weight,',
    '  L.reps AS Reps',
    `FROM "${workoutsFolderPath}"`,
    'FLATTEN file.lists AS L',
    `WHERE L.exercise = link("${exercise.exerciseName}") AND L.set`,
    'SORT file.name DESC, L.set ASC',
    'LIMIT 10',
  ];
}

function isMarkdownFile(file: TAbstractFile | null): file is TFile {
  return file !== null && (file as { extension?: unknown }).extension === 'md';
}
