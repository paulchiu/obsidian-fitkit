/* eslint-disable import/no-nodejs-modules */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { DurationRow, ParsedExercise, SetRow } from '../src/journal-grammar';
import { parseJournal } from '../src/journal-grammar';

const here = fileURLToPath(new URL('.', import.meta.url));
function fixture(rel: string): string {
  return readFileSync(resolve(here, 'fixtures', rel), 'utf8');
}

function exerciseAt(exercises: ParsedExercise[], index: number): ParsedExercise {
  const exercise = exercises[index];
  if (!exercise) {
    throw new Error(`Missing exercise at index ${index}`);
  }
  return exercise;
}

function strengthRows(exercise: ParsedExercise): SetRow[] {
  return exercise.rows.filter((row): row is SetRow => row.kind === 'strength');
}

function durationRows(exercise: ParsedExercise): DurationRow[] {
  return exercise.rows.filter((row): row is DurationRow => row.kind === 'duration');
}

describe('journal grammar', () => {
  it('parses inline strength rows and the workout title', () => {
    const parsed = parseJournal(fixture('journals/sample-strength.md'));

    expect(parsed.name).toBe('Squat Day');
    expect(parsed.exercises.map((exercise) => exercise.rawName)).toEqual([
      'Squat',
      'Bench',
      'Dumbbell Row',
    ]);
    expect(strengthRows(exerciseAt(parsed.exercises, 0))).toEqual([
      { kind: 'strength', weight: 50, reps: 15, raw: 'Squat: 50 / 15' },
    ]);
    expect(strengthRows(exerciseAt(parsed.exercises, 1))).toEqual([
      { kind: 'strength', weight: 50, reps: 15, raw: 'Bench: 50 x 15' },
    ]);
    expect(strengthRows(exerciseAt(parsed.exercises, 2))).toEqual([
      { kind: 'strength', weight: 50, reps: 15, raw: 'Dumbbell Row: 50 / 15 / 8' },
    ]);
    expect(parsed.exercises.reduce((sum, exercise) => sum + strengthRows(exercise).length, 0)).toBe(
      3,
    );
  });

  it('parses inline duration rows and converts minutes to seconds', () => {
    const parsed = parseJournal(fixture('journals/sample-duration.md'));

    expect(parsed.name).toBe('Cardio Day');
    expect(parsed.exercises.map((exercise) => exercise.rawName)).toEqual([
      'Treadmill',
      'Stationary Bike',
      'Plank',
    ]);
    expect(durationRows(exerciseAt(parsed.exercises, 0))).toEqual([
      { kind: 'duration', seconds: 600, raw: 'Treadmill: 600s' },
    ]);
    expect(durationRows(exerciseAt(parsed.exercises, 1))).toEqual([
      { kind: 'duration', seconds: 1800, raw: 'Stationary Bike: 30m' },
    ]);
    expect(durationRows(exerciseAt(parsed.exercises, 2))).toEqual([
      { kind: 'duration', seconds: 60, raw: 'Plank: 60s' },
    ]);
  });
});
