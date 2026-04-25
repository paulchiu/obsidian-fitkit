/**
 * Serializer for the canonical workout note format used by POC9/POC10.
 */

import type { ExerciseRow } from './journal-grammar';

export type CanonicalExercise = {
  /** Canonical (resolved) exercise name. */
  canonicalName: string;
  note: string;
  rows: ExerciseRow[];
};

export type CanonicalWorkout = {
  name: string;
  date: string;
  exercises: CanonicalExercise[];
};

function frontmatter(name: string, date: string): string {
  return `---\ntype: workout\ndate: ${date}\nname: ${name}\n---`;
}

function renderExercise(exercise: CanonicalExercise): string {
  const parts: string[] = [];
  parts.push(`## [[${exercise.canonicalName}]]`);
  parts.push('');
  if (exercise.note.trim().length > 0) {
    parts.push(`- [exercise:: [[${exercise.canonicalName}]]] [notes:: ${exercise.note.trim()}]`);
  }

  let setNumber = 1;
  for (const row of exercise.rows) {
    if (row.kind === 'strength') {
      parts.push(
        `- [exercise:: [[${exercise.canonicalName}]]] [set:: ${setNumber}] [weight:: ${formatNumber(row.weight)}] [reps:: ${formatNumber(row.reps)}]`,
      );
      setNumber += 1;
    } else {
      parts.push(`- [exercise:: [[${exercise.canonicalName}]]] [duration:: ${row.seconds}]`);
    }
  }

  return parts.join('\n');
}

/**
 * Format a number without trailing zero noise: `10` not `10.0`, `13.6` kept.
 * `String(n)` already collapses `10.0` to `'10'` in JS, so this is the canonical write path.
 */
function formatNumber(value: number): string {
  return String(value);
}

export function serializeWorkout(workout: CanonicalWorkout): string {
  const blocks: string[] = [frontmatter(workout.name, workout.date)];
  for (const exercise of workout.exercises) {
    blocks.push(renderExercise(exercise));
  }
  return `${blocks.join('\n')}\n`;
}
