import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', async () =>
  (await import('../../fixtures/obsidian-editor-mock')).createObsidianMock(),
)

import type {
  DurationExerciseEntry,
  StrengthExerciseEntry,
} from '../../../src/domain/workout-note-model'
import {
  ensureKnownNotice,
  formatLadderChangesWarning,
  ladderRecordNotice,
  toEditorExercise,
  toWorkoutExercise,
  typeRecordNotices,
} from '../../../src/ui/obsidian/workout-editor-view'

/** The editor's pure helpers; everything it draws is driven through a real view in the sibling files. */
describe('WorkoutEditorView ladder history warning', () => {
  it('names each affected level with its old and new meaning', () => {
    expect(
      formatLadderChangesWarning('Push-up', [
        { level: 2, from: 'Knee push-up', to: 'Full push-up' },
        { level: 3, from: 'Incline push-up', to: 'Knee push-up' },
      ]),
    ).toEqual({
      title: 'Change what logged levels mean for Push-up?',
      message:
        'This edit changes what some already-logged levels mean. ' +
        "Level 2 currently means 'Knee push-up' and would come to mean 'Full push-up'. " +
        "Level 3 currently means 'Incline push-up' and would come to mean 'Knee push-up'. " +
        'Logged sets keep their numbers.',
    })
  })
})

describe('WorkoutEditorView exercise store notices', () => {
  it.each([
    {
      result: { name: 'Squat', wrote: 'note', customRecentSessions: false },
      notices: [
        'Exercise note now records Squat as strength.',
        'Registry now records Squat as strength.',
      ],
    },
    {
      result: { name: 'Squat', wrote: 'registry', customRecentSessions: false },
      notices: ['Registry now records Squat as strength.'],
    },
    {
      result: { name: 'Squat', wrote: 'note-unchanged', customRecentSessions: false },
      notices: [
        'Could not update the exercise note for Squat; its frontmatter was left unchanged.',
      ],
    },
    {
      result: { name: 'Squat', wrote: 'note', customRecentSessions: true },
      notices: [
        "The Recent sessions query in the note for Squat looks customised, so it was left as it is and still reads the old kind's fields.",
        'Exercise note now records Squat as strength.',
        'Registry now records Squat as strength.',
      ],
    },
  ] as const)('words a type record that wrote $result.wrote', ({ result, notices }) => {
    expect(typeRecordNotices(result, 'strength')).toEqual(notices)
  })

  it.each([
    { wrote: 'note', notice: 'Exercise note now records levels for Push-up.' },
    { wrote: 'registry', notice: 'Registry now records levels for Push-up.' },
    { wrote: 'note-unchanged', notice: null },
  ] as const)('words a ladder record that wrote $wrote', ({ wrote, notice }) => {
    expect(ladderRecordNotice({ name: 'Push-up', wrote })).toBe(notice)
  })

  it.each([
    { result: { outcome: 'note-created' }, notice: "Created exercise note for 'Squat'." },
    {
      result: { outcome: 'note-reused', restored: false },
      notice: "Using existing exercise note for 'Squat'.",
    },
    {
      result: { outcome: 'note-reused', restored: true },
      notice: "Restored 'Squat' using the existing exercise note.",
    },
    { result: { outcome: 'registry-added' }, notice: "Added 'Squat' as a no-note registry entry." },
    { result: { outcome: 'already-known' }, notice: null },
    {
      result: { outcome: 'note-failed', message: 'read only' },
      notice: "Could not create exercise note for 'Squat': read only.",
    },
  ] as const)('words an unknown exercise outcome of $result.outcome', ({ result, notice }) => {
    expect(ensureKnownNotice('Squat', result)).toBe(notice)
  })
})

describe('WorkoutEditorView editor round-trip', () => {
  /** Loading an entry into the editor and saving it straight back preserves every field. */
  it('round-trips a strength entry through the editor conversions unchanged', () => {
    const entry: StrengthExerciseEntry = {
      exerciseName: 'Bench Press',
      kind: 'strength',
      strengthSets: [
        { set: 1, weight: 60, reps: 8 },
        { set: 2, weight: 60, reps: 6, note: 'grindy' },
      ],
      note: 'paused reps',
      next: { direction: 'up', step: 2.5 },
    }

    expect(toWorkoutExercise(toEditorExercise(entry))).toEqual(entry)
  })

  it('round-trips a duration entry through the editor conversions unchanged', () => {
    const entry: DurationExerciseEntry = {
      exerciseName: 'Plank',
      kind: 'duration',
      durationEntries: [
        { set: 1, durationSeconds: 60 },
        { set: 2, durationSeconds: 45, note: 'shaky' },
      ],
      note: 'knees off',
      next: { direction: 'stay' },
    }

    expect(toWorkoutExercise(toEditorExercise(entry))).toEqual(entry)
  })
})
