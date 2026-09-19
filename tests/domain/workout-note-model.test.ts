import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type {
  BodyweightExerciseEntry,
  DurationExerciseEntry,
  WorkoutNoteModel,
} from '../../src/domain/workout-note-model'
import {
  parseWorkoutNote,
  relabelSetsAsFirstLevel,
  semanticEqual,
  serializeWorkoutNote,
  setRowCount,
} from '../../src/domain/workout-note-model'
import type { CanonicalWorkout } from '../../src/domain/workout-note-serializer'
import { serializeWorkout } from '../../src/domain/workout-note-serializer'

const here = fileURLToPath(new URL('.', import.meta.url))
function fixture(rel: string): string {
  return readFileSync(resolve(here, '..', 'fixtures', rel), 'utf8')
}

const workoutFixtures = [
  'workouts/2026-04-19.md',
  'workouts/2026-04-09.md',
  'workouts/2026-03-16.md',
  'workouts/2026-03-25.md',
  'workouts/2026-04-08.md',
  'workouts/fence-block.md',
] as const

const fencedRoundTripCases = [
  [
    'after a modeled row',
    [
      '---',
      'type: workout',
      'date: 2026-08-18',
      'name: Row fence',
      '---',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
      '```txt',
      'hello',
      '```',
      '',
    ].join('\n'),
  ],
  [
    'after an exercise heading',
    [
      '---',
      'type: workout',
      'date: 2026-08-18',
      'name: Heading fence',
      '---',
      '',
      '## [[Squat]]',
      '',
      '```txt',
      'hello',
      '```',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
    ].join('\n'),
  ],
  [
    'before a modeled row with a separator blank',
    [
      '---',
      'type: workout',
      'date: 2026-08-18',
      'name: D',
      '---',
      '',
      '## [[Squat]]',
      '',
      '```txt',
      'hello',
      '```',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
    ].join('\n'),
  ],
  [
    'after preserved prose',
    [
      '---',
      'type: workout',
      'date: 2026-08-18',
      'name: Prose fence',
      '---',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
      'Keep the platform clear.',
      '',
      '```txt',
      'hello',
      '```',
      '',
    ].join('\n'),
  ],
  [
    'at the start of the body',
    [
      '---',
      'type: workout',
      'date: 2026-08-18',
      'name: Preamble fence',
      '---',
      '',
      '```txt',
      'hello',
      '```',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
    ].join('\n'),
  ],
  [
    'between two fenced blocks',
    [
      '---',
      'type: workout',
      'date: 2026-08-18',
      'name: Two fences',
      '---',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
      '```txt',
      'first',
      '```',
      '',
      '```txt',
      'second',
      '```',
      '',
    ].join('\n'),
  ],
] as const

function expectWorkoutModel(source: string, sourcePath: string): WorkoutNoteModel {
  const result = parseWorkoutNote(source, sourcePath)
  expect(result.isWorkout).toBe(true)
  expect(result.model).not.toBeNull()
  if (!result.model) {
    throw new Error(`${sourcePath} did not parse as a workout`)
  }
  return result.model
}

describe('workout note model', () => {
  it.each(workoutFixtures)('round-trips %s semantically', (path) => {
    const model = expectWorkoutModel(fixture(path), path)
    const serialized = serializeWorkoutNote(model)
    const reparsed = expectWorkoutModel(serialized, path)

    expect(semanticEqual(model, reparsed)).toBe(true)
  })

  it('warns when a workout fixture skips strength set numbers', () => {
    const result = parseWorkoutNote(fixture('workouts/2026-03-25.md'), 'workouts/2026-03-25.md')

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some((warning) => warning.includes('set'))).toBe(true)
  })

  it('warns before dropping strength data when an exercise mixes row kinds', () => {
    const result = parseWorkoutNote(
      [
        '---',
        'type: workout',
        'date: 2026-04-24',
        'name: Mixed Rows',
        '---',
        '',
        '## [[Squat]]',
        '',
        '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
        '- [exercise:: [[Squat]]] [duration:: 60]',
      ].join('\n'),
      'mixed-rows.md',
    )

    expect(
      result.warnings.some(
        (warning) => warning.includes('dropping') && warning.includes('strength'),
      ),
    ).toBe(true)
  })

  it('carries only one payload per entry, keyed by kind', () => {
    const model = expectWorkoutModel(
      [
        '---',
        'type: workout',
        'date: 2026-04-24',
        'name: Kind Payloads',
        '---',
        '',
        '## [[Squat]]',
        '',
        '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
        '',
        '## [[Plank]]',
        '',
        '- [exercise:: [[Plank]]] [duration:: 60]',
      ].join('\n'),
      'kind-payloads.md',
    )

    expect(model.exercises).toHaveLength(2)
    const strength = model.exercises[0]
    const duration = model.exercises[1]
    expect('durationEntries' in (strength as object)).toBe(false)
    expect('strengthSets' in (duration as object)).toBe(false)
    expect(strength).toEqual({
      exerciseName: 'Squat',
      kind: 'strength',
      strengthSets: [{ set: 1, weight: 100, reps: 5 }],
    })
    expect(duration).toEqual({
      exerciseName: 'Plank',
      kind: 'duration',
      durationEntries: [{ durationSeconds: 60 }],
    })
  })

  it('coerces strength rows to a duration entry carrying only the duration rows', () => {
    const result = parseWorkoutNote(
      [
        '---',
        'type: workout',
        'date: 2026-04-24',
        'name: Mixed Rows',
        '---',
        '',
        '## [[Squat]]',
        '',
        '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
        '- [exercise:: [[Squat]]] [duration:: 60]',
      ].join('\n'),
      'mixed-rows.md',
    )

    expect(result.warnings).toContain(
      'mixed-rows.md: Exercise "Squat" has both strength and duration rows; dropping strength data.',
    )
    expect(result.model?.exercises).toHaveLength(1)
    const entry = result.model?.exercises[0]
    expect(entry?.kind).toBe('duration')
    expect('strengthSets' in (entry as object)).toBe(false)
    expect(entry).toEqual({
      exerciseName: 'Squat',
      kind: 'duration',
      durationEntries: [{ durationSeconds: 60 }],
    })
  })

  it('coerces duration rows to a strength entry carrying only the strength rows', () => {
    const result = parseWorkoutNote(
      [
        '---',
        'type: workout',
        'date: 2026-04-24',
        'name: Mixed Rows',
        '---',
        '',
        '## [[Plank]]',
        '',
        '- [exercise:: [[Plank]]] [duration:: 60]',
        '- [exercise:: [[Plank]]] [set:: 1] [weight:: 100] [reps:: 5]',
      ].join('\n'),
      'mixed-rows-mirror.md',
    )

    expect(result.warnings).toContain(
      'mixed-rows-mirror.md: Exercise "Plank" has both strength and duration rows; dropping duration data.',
    )
    expect(result.model?.exercises).toHaveLength(1)
    const entry = result.model?.exercises[0]
    expect(entry?.kind).toBe('strength')
    expect('durationEntries' in (entry as object)).toBe(false)
    expect(entry).toEqual({
      exerciseName: 'Plank',
      kind: 'strength',
      strengthSets: [{ set: 1, weight: 100, reps: 5 }],
    })
  })

  it('keeps the exercise note and next plan when strength rows coerce to duration', () => {
    const model = expectWorkoutModel(
      [
        '---',
        'type: workout',
        'date: 2026-04-24',
        'name: Mixed Rows',
        '---',
        '',
        '## [[Squat]]',
        '',
        '- [exercise:: [[Squat]]] [notes:: felt easy] [next:: up 2.5]',
        '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
        '- [exercise:: [[Squat]]] [duration:: 60]',
      ].join('\n'),
      'mixed-rows-note.md',
    )

    expect(model.exercises).toHaveLength(1)
    const entry = model.exercises[0]
    if (entry?.kind !== 'duration') {
      throw new Error('expected the coerced entry to be duration')
    }
    expect(entry.note).toBe('felt easy')
    expect(entry.next).toEqual({ direction: 'up', step: 2.5 })
    expect(entry.durationEntries).toEqual([{ durationSeconds: 60 }])
  })

  it('keeps the exercise note and next plan when duration rows coerce to strength', () => {
    const model = expectWorkoutModel(
      [
        '---',
        'type: workout',
        'date: 2026-04-24',
        'name: Mixed Rows',
        '---',
        '',
        '## [[Plank]]',
        '',
        '- [exercise:: [[Plank]]] [notes:: cold gym] [next:: down 1]',
        '- [exercise:: [[Plank]]] [duration:: 60]',
        '- [exercise:: [[Plank]]] [set:: 1] [weight:: 100] [reps:: 5]',
      ].join('\n'),
      'mixed-rows-mirror-note.md',
    )

    expect(model.exercises).toHaveLength(1)
    const entry = model.exercises[0]
    if (entry?.kind !== 'strength') {
      throw new Error('expected the coerced entry to be strength')
    }
    expect(entry.note).toBe('cold gym')
    expect(entry.next).toEqual({ direction: 'down', step: 1 })
    expect(entry.strengthSets).toEqual([{ set: 1, weight: 100, reps: 5 }])
  })

  it('preserves fenced blocks in serialized output', () => {
    const model = expectWorkoutModel(fixture('workouts/fence-block.md'), 'workouts/fence-block.md')
    const serialized = serializeWorkoutNote(model)

    expect(serialized).toContain('Note block: this should be preserved verbatim.')
  })

  it('preserves multiple fenced blocks in original relative order', () => {
    const model = expectWorkoutModel(
      [
        '---',
        'type: workout',
        'date: 2026-04-24',
        'name: Multi Fence',
        '---',
        '',
        '## [[Squat]]',
        '',
        '```txt',
        'FENCE_ONE_BODY',
        '```',
        '```txt',
        'FENCE_TWO_BODY',
        '```',
        '- [exercise:: [[Squat]]] [set:: 1] [weight:: 10] [reps:: 10]',
      ].join('\n'),
      'multi-fence.md',
    )
    const serialized = serializeWorkoutNote(model)
    const firstFenceIndex = serialized.indexOf('FENCE_ONE_BODY')
    const secondFenceIndex = serialized.indexOf('FENCE_TWO_BODY')
    const reparsed = expectWorkoutModel(serialized, 'multi-fence.md')

    expect(firstFenceIndex).toBeGreaterThanOrEqual(0)
    expect(secondFenceIndex).toBeGreaterThanOrEqual(0)
    expect(firstFenceIndex).toBeLessThan(secondFenceIndex)
    expect(semanticEqual(model, reparsed)).toBe(true)
  })

  it.each(fencedRoundTripCases)(
    'round-trips a fenced block %s byte-identically',
    (_case, source) => {
      const serialized = serializeWorkoutNote(expectWorkoutModel(source, 'fenced-position.md'))

      expect(serialized).toBe(source)
    },
  )

  it.each(fencedRoundTripCases)(
    'keeps a fenced block %s stable across three round-trips',
    (_case, source) => {
      let current = source

      for (let round = 0; round < 3; round += 1) {
        current = serializeWorkoutNote(expectWorkoutModel(current, 'stable-fenced-position.md'))
        expect(current).toBe(source)
      }
    },
  )

  it('serializes blank strength sets without zero weight or reps', () => {
    const serialized = serializeWorkoutNote({
      date: '2026-04-24',
      name: 'Blank Set',
      sourcePath: 'blank-set.md',
      preserveBlocks: [],
      frontmatterExtra: [],
      exercises: [
        {
          exerciseName: 'Squat',
          kind: 'strength',
          strengthSets: [
            { set: 1, weight: 10, reps: 10 },
            { set: 2, weight: 20, reps: 8 },
            { set: 3 },
          ],
        },
      ],
    })

    expect(serialized).toContain('- [exercise:: [[Squat]]] [set:: 3]\n')
    expect(serialized).not.toContain('[set:: 3] [weight:: 0]')
    expect(serialized).not.toContain('[set:: 3] [reps:: 0]')
  })

  it('parses bodyweight strength rows with reps and no weight', () => {
    const model = expectWorkoutModel(
      [
        '---',
        'type: workout',
        'date: 2026-04-27',
        'name: Bodyweight day',
        '---',
        '',
        '## [[Body Weight Pull-ups]]',
        '',
        '- [exercise:: [[Body Weight Pull-ups]]] [set:: 1] [reps:: 20]',
      ].join('\n'),
      'bodyweight.md',
    )

    expect(model.exercises[0]?.strengthSets).toEqual([{ set: 1, reps: 20 }])
  })

  it('parses a bodyweight row into a bodyweight entry with its level and reps', () => {
    const model = expectWorkoutModel(
      [
        '---',
        'type: workout',
        'date: 2026-09-01',
        'name: Bodyweight day',
        '---',
        '',
        '## [[Push-up]]',
        '',
        '- [exercise:: [[Push-up]]] [level:: 2] [reps:: 8]',
      ].join('\n'),
      'bodyweight-row.md',
    )

    expect(model.exercises).toHaveLength(1)
    const entry = model.exercises[0]
    if (entry?.kind !== 'bodyweight') {
      throw new Error('expected the entry to be bodyweight')
    }
    expect(entry.bodyweightSets).toEqual([{ level: 2, reps: 8 }])
  })

  it('reads an optional load on a bodyweight row and leaves it unset when absent', () => {
    const model = expectWorkoutModel(
      [
        '---',
        'type: workout',
        'date: 2026-09-01',
        'name: Bodyweight day',
        '---',
        '',
        '## [[Dip]]',
        '',
        '- [exercise:: [[Dip]]] [level:: 3] [reps:: 6] [load:: 10]',
        '- [exercise:: [[Dip]]] [level:: 3] [reps:: 6]',
      ].join('\n'),
      'bodyweight-load.md',
    )

    const entry = model.exercises[0]
    if (entry?.kind !== 'bodyweight') {
      throw new Error('expected the entry to be bodyweight')
    }
    expect(entry.bodyweightSets).toEqual([
      { level: 3, reps: 6, load: 10 },
      { level: 3, reps: 6 },
    ])
  })

  it('keeps parsing rows with neither level nor duration as strength', () => {
    const model = expectWorkoutModel(
      [
        '---',
        'type: workout',
        'date: 2026-09-01',
        'name: Mixed day',
        '---',
        '',
        '## [[Squat]]',
        '',
        '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      ].join('\n'),
      'strength-fallback.md',
    )

    expect(model.exercises).toHaveLength(1)
    const entry = model.exercises[0]
    if (entry?.kind !== 'strength') {
      throw new Error('expected the entry to stay strength')
    }
    expect(entry.strengthSets).toEqual([{ set: 1, weight: 100, reps: 5 }])
  })

  it('keeps every rung when a bodyweight exercise mixes levels across rows', () => {
    const model = expectWorkoutModel(
      [
        '---',
        'type: workout',
        'date: 2026-09-01',
        'name: Bodyweight day',
        '---',
        '',
        '## [[Pull-up]]',
        '',
        '- [exercise:: [[Pull-up]]] [level:: 4] [reps:: 5]',
        '- [exercise:: [[Pull-up]]] [level:: 3] [reps:: 6]',
      ].join('\n'),
      'bodyweight-rungs.md',
    )

    const entry = model.exercises[0]
    if (entry?.kind !== 'bodyweight') {
      throw new Error('expected the entry to be bodyweight')
    }
    expect(entry.bodyweightSets).toEqual([
      { level: 4, reps: 5 },
      { level: 3, reps: 6 },
    ])
  })

  it('treats a level-only row as a set row rather than an exercise note', () => {
    const model = expectWorkoutModel(
      [
        '---',
        'type: workout',
        'date: 2026-09-01',
        'name: Bodyweight day',
        '---',
        '',
        '## [[Push-up]]',
        '',
        '- [exercise:: [[Push-up]]] [level:: 3]',
      ].join('\n'),
      'bodyweight-level-only.md',
    )

    const entry = model.exercises[0]
    if (entry?.kind !== 'bodyweight') {
      throw new Error('expected the entry to be bodyweight')
    }
    expect(entry.note).toBeUndefined()
    expect(entry.bodyweightSets).toEqual([{ level: 3 }])
  })

  it('distinguishes two bodyweight entries that differ only in a set level', () => {
    const base = {
      date: '2026-09-01',
      name: 'Bodyweight day',
      sourcePath: 'bodyweight-levels.md',
      preserveBlocks: [],
      frontmatterExtra: [],
    } as const
    const left = {
      ...base,
      exercises: [
        {
          exerciseName: 'Push-up',
          kind: 'bodyweight',
          bodyweightSets: [{ level: 2, reps: 8 }],
        },
      ],
    } as WorkoutNoteModel
    const right = {
      ...base,
      exercises: [
        {
          exerciseName: 'Push-up',
          kind: 'bodyweight',
          bodyweightSets: [{ level: 3, reps: 8 }],
        },
      ],
    } as WorkoutNoteModel

    expect(semanticEqual(left, right)).toBe(false)
  })

  it('round-trips bodyweight rows byte for byte, with and without a load', () => {
    const source = [
      '---',
      'type: workout',
      'date: 2026-09-01',
      'name: Bodyweight day',
      '---',
      '',
      '## [[Dip]]',
      '',
      '- [exercise:: [[Dip]]] [level:: 3] [reps:: 6] [load:: 10]',
      '- [exercise:: [[Dip]]] [level:: 3] [reps:: 6]',
      '',
    ].join('\n')

    const serialized = serializeWorkoutNote(expectWorkoutModel(source, 'bodyweight-roundtrip.md'))

    expect(serialized).toBe(source)
  })

  it('warns naming both kinds when bodyweight rows coerce to strength', () => {
    const result = parseWorkoutNote(
      [
        '---',
        'type: workout',
        'date: 2026-09-01',
        'name: Mixed Rows',
        '---',
        '',
        '## [[Push-up]]',
        '',
        '- [exercise:: [[Push-up]]] [level:: 2] [reps:: 8]',
        '- [exercise:: [[Push-up]]] [set:: 1] [weight:: 100] [reps:: 5]',
      ].join('\n'),
      'mixed-rows-bodyweight.md',
    )

    expect(result.warnings).toContain(
      'mixed-rows-bodyweight.md: Exercise "Push-up" has both strength and bodyweight rows; dropping bodyweight data.',
    )
    expect(result.model?.exercises).toHaveLength(1)
    const entry = result.model?.exercises[0]
    expect(entry?.kind).toBe('strength')
    expect('bodyweightSets' in (entry as object)).toBe(false)
    expect(entry).toEqual({
      exerciseName: 'Push-up',
      kind: 'strength',
      strengthSets: [{ set: 1, weight: 100, reps: 5 }],
    })
  })

  it('round-trips a next-time plan on the exercise bullet', () => {
    const source = [
      '---',
      'type: workout',
      'date: 2026-08-17',
      'name: Plan day',
      '---',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [notes:: felt easy] [next:: up 2.5]',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
    ].join('\n')

    const model = expectWorkoutModel(source, 'plan.md')
    const serialized = serializeWorkoutNote(model)

    expect(model.exercises[0]?.next).toEqual({ direction: 'up', step: 2.5 })
    expect(serialized).toContain('[notes:: felt easy] [next:: up 2.5]')
    expect(semanticEqual(model, expectWorkoutModel(serialized, 'plan.md'))).toBe(true)
  })

  it('writes the exercise bullet for a plan with no exercise note', () => {
    const serialized = serializeWorkoutNote({
      date: '2026-08-17',
      name: 'Plan only',
      sourcePath: 'plan-only.md',
      preserveBlocks: [],
      frontmatterExtra: [],
      exercises: [
        {
          exerciseName: 'Squat',
          kind: 'strength',
          next: { direction: 'down' },
          strengthSets: [{ set: 1, weight: 100, reps: 5 }],
        },
      ],
    })

    expect(serialized).toContain('- [exercise:: [[Squat]]] [next:: down]\n')
    expect(serialized).not.toContain('[notes::]')
  })

  it('ignores an unrecognised next-time value', () => {
    const model = expectWorkoutModel(
      [
        '---',
        'type: workout',
        'date: 2026-08-17',
        'name: Freehand',
        '---',
        '',
        '## [[Squat]]',
        '',
        '- [exercise:: [[Squat]]] [next:: heavier if grip holds]',
        '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      ].join('\n'),
      'freehand.md',
    )

    expect(model.exercises[0]?.next).toBeUndefined()
  })

  it('round-trips a hand-edited note without losing frontmatter, prose, or bullets', () => {
    const source = fixture('workouts/hand-edited.md')
    const model = expectWorkoutModel(source, 'workouts/hand-edited.md')
    const serialized = serializeWorkoutNote(model)

    /** Unrecognised inline fields are the only intentional round-trip loss. */
    expect(serialized).toBe(source.replace(' [rpe:: 7]', ''))

    /** Frontmatter: unknown keys survive. */
    expect(serialized).toContain('tags:')
    expect(serialized).toContain('- training')
    expect(serialized).toContain('- push')
    expect(serialized).toContain('mood: tired')

    /** Body content the model does not represent. */
    expect(serialized).toContain('# Push Day')
    expect(serialized).toContain(
      'Felt sluggish today, skipped the usual warmup because I was short on time.',
    )
    expect(serialized).toContain("> Remember: elbows tucked on bench, don't flare.")
    expect(serialized).toContain('![[gym-setup.png]]')
    expect(serialized).toContain(
      'Plate math: 20+10+5 = bar+70 (2 plates and a 5.5kg on each side).',
    )
    expect(serialized).toContain('- [ ] foam roll 10 min')
    expect(serialized).toContain('- felt strong today, chest felt activated')
    expect(serialized).toContain('  - grip slightly wider than usual')
    expect(serialized).toContain(
      'Rested longer than usual before overhead press, shoulder felt a bit tight.',
    )

    /**
     * Content must stay attached to the section it was written under, not
     * just survive somewhere in the output. The preamble comes before
     * Bench Press, the plate-math fence sits directly above the Bench Press
     * heading, the nested bullet stays between Bench Press's two set rows,
     * and the inter-section note stays between Bench Press and Overhead
     * Press, not after Overhead Press's own row.
     */
    const lines = serialized.split('\n')
    const indexOf = (needle: string) => lines.findIndex((line) => line.includes(needle))
    const preambleIndex = indexOf('# Push Day')
    const fenceIndex = indexOf('Plate math:')
    const benchHeadingIndex = indexOf('## [[Bench Press]]')
    const benchSet1Index = indexOf('[set:: 1] [weight:: 60]')
    const nestedBulletIndex = indexOf('grip slightly wider')
    const benchSet2Index = indexOf('[set:: 2] [weight:: 65]')
    const interSectionIndex = indexOf('Rested longer than usual')
    const overheadHeadingIndex = indexOf('## [[Overhead Press]]')
    const overheadRowIndex = indexOf('[[Overhead Press]]] [set:: 1]')

    expect(preambleIndex).toBeGreaterThanOrEqual(0)
    expect(preambleIndex).toBeLessThan(fenceIndex)
    expect(fenceIndex).toBeLessThan(benchHeadingIndex)
    expect(benchHeadingIndex).toBeLessThan(benchSet1Index)
    expect(benchSet1Index).toBeLessThan(nestedBulletIndex)
    expect(nestedBulletIndex).toBeLessThan(benchSet2Index)
    expect(benchSet2Index).toBeLessThan(interSectionIndex)
    expect(interSectionIndex).toBeLessThan(overheadHeadingIndex)
    expect(overheadHeadingIndex).toBeLessThan(overheadRowIndex)

    /** Exercise rows still round-trip. */
    const reparsed = expectWorkoutModel(serialized, 'workouts/hand-edited.md')
    expect(semanticEqual(model, reparsed)).toBe(true)
    expect(reparsed.exercises[0]?.strengthSets).toEqual([
      { set: 1, weight: 60, reps: 8 },
      { set: 2, weight: 65, reps: 6 },
    ])
  })

  it('serializes a hand-edited note to the same output on a second save', () => {
    const source = fixture('workouts/hand-edited.md')
    const firstSave = serializeWorkoutNote(expectWorkoutModel(source, 'workouts/hand-edited.md'))
    const secondSave = serializeWorkoutNote(
      expectWorkoutModel(firstSave, 'workouts/hand-edited.md'),
    )

    expect(secondSave).toBe(firstSave)
  })

  it('serializes a fenced-block note to the same output on a second save', () => {
    const source = fixture('workouts/fence-block.md')
    const firstSave = serializeWorkoutNote(expectWorkoutModel(source, 'workouts/fence-block.md'))
    const secondSave = serializeWorkoutNote(
      expectWorkoutModel(firstSave, 'workouts/fence-block.md'),
    )

    expect(secondSave).toBe(firstSave)
  })

  it('keeps content between two exercise sections in place, not moved past the later section', () => {
    const source = [
      '---',
      'type: workout',
      'date: 2026-08-16',
      'name: Interleaved',
      '---',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
      'Some prose written between the two exercise sections.',
      '',
      '## [[Deadlift]]',
      '',
      '- [exercise:: [[Deadlift]]] [set:: 1] [weight:: 120] [reps:: 5]',
    ].join('\n')

    const model = expectWorkoutModel(source, 'interleaved.md')
    const out1 = serializeWorkoutNote(model)
    const out2 = serializeWorkoutNote(expectWorkoutModel(out1, 'interleaved.md'))

    expect(out2).toBe(out1)
    const lines = out1.split('\n')
    const proseIndex = lines.findIndex((l) => l.includes('Some prose written'))
    const deadliftHeadingIndex = lines.findIndex((l) => l.includes('## [[Deadlift]]'))
    const squatHeadingIndex = lines.findIndex((l) => l.includes('## [[Squat]]'))

    expect(proseIndex).toBeGreaterThan(squatHeadingIndex)
    expect(proseIndex).toBeLessThan(deadliftHeadingIndex)
  })

  it.each([
    ['lowercase wikilink', '## [[squat]]'],
    ['aliased wikilink', '## [[Folder/Squat|Squat]]'],
    ['plain text', '## Squat'],
  ])('normalizes a %s exercise heading without duplicating it', (_label, heading) => {
    const source = [
      '---',
      'type: workout',
      'date: 2026-08-20',
      'name: Squat Day',
      '---',
      '',
      heading,
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
    ].join('\n')
    const expected = [
      '---',
      'type: workout',
      'date: 2026-08-20',
      'name: Squat Day',
      '---',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
    ].join('\n')

    const serialized = serializeWorkoutNote(expectWorkoutModel(source, 'squat-day.md'))

    expect(serialized).toBe(expected)
    expect(serialized.split('\n').filter((line) => line.startsWith('## '))).toHaveLength(1)
  })

  it('preserves a wikilink H2 with no modeled rows beneath it', () => {
    const source = [
      '---',
      'type: workout',
      'date: 2026-08-20',
      'name: Skipped Squat',
      '---',
      '',
      '## [[Squat]]',
      '',
      'Planned but skipped.',
      '',
    ].join('\n')

    const serialized = serializeWorkoutNote(expectWorkoutModel(source, 'skipped-squat.md'))

    expect(serialized).toBe(source)
    expect(serialized.split('\n').filter((line) => line.startsWith('## '))).toHaveLength(1)
  })

  it('round-trips an ordinary H2 section after an exercise byte-identically', () => {
    const source = [
      '---',
      'type: workout',
      'date: 2026-08-18',
      'name: Push Day',
      'tags:',
      '  - gym',
      '---',
      '',
      'Felt strong today.',
      '',
      '## [[Bench Press]]',
      '',
      '- [exercise:: [[Bench Press]]] [set:: 1] [weight:: 60] [reps:: 5]',
      '',
      '## Session notes',
      '',
      'Shoulder felt tight',
      '',
      '### Warmup',
      '',
      '- band pull-aparts',
      '',
    ].join('\n')

    const serialized = serializeWorkoutNote(expectWorkoutModel(source, 'w.md'))

    expect(serialized).toBe(source)
  })

  it('round-trips an ordinary H2 section before the first exercise byte-identically', () => {
    const source = [
      '---',
      'type: workout',
      'date: 2026-08-18',
      'name: Early notes',
      '---',
      '',
      '## Session notes',
      '',
      'Arrived early.',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
    ].join('\n')

    const serialized = serializeWorkoutNote(expectWorkoutModel(source, 'early-notes.md'))

    expect(serialized).toBe(source)
  })

  it('round-trips an ordinary H2 section between two exercises byte-identically', () => {
    const source = [
      '---',
      'type: workout',
      'date: 2026-08-18',
      'name: Mid-session notes',
      '---',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
      '## Session notes',
      '',
      'Changed platforms.',
      '',
      '## [[Deadlift]]',
      '',
      '- [exercise:: [[Deadlift]]] [set:: 1] [weight:: 120] [reps:: 5]',
      '',
    ].join('\n')

    const serialized = serializeWorkoutNote(expectWorkoutModel(source, 'mid-session-notes.md'))

    expect(serialized).toBe(source)
  })

  it('keeps ordinary H2 sections stable across three round-trips', () => {
    const source = [
      '---',
      'type: workout',
      'date: 2026-08-18',
      'name: Stable notes',
      '---',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
      '## Session notes',
      '',
      'Keep this section stable.',
      '',
    ].join('\n')
    const saves: string[] = []
    let current = source

    for (let round = 0; round < 3; round += 1) {
      current = serializeWorkoutNote(expectWorkoutModel(current, 'stable-notes.md'))
      saves.push(current)
    }

    expect(saves[1]).toBe(saves[0])
    expect(saves[2]).toBe(saves[0])
  })

  it('changes only the edited value on a hand-edited note, leaving preserved content untouched', () => {
    const source = fixture('workouts/hand-edited.md')
    const baseline = serializeWorkoutNote(expectWorkoutModel(source, 'workouts/hand-edited.md'))

    const edited = expectWorkoutModel(source, 'workouts/hand-edited.md')
    const bench = edited.exercises[0]
    if (bench?.kind !== 'strength') {
      throw new Error('hand-edited.md first exercise did not parse as strength')
    }
    const benchSets = bench.strengthSets
    expect(benchSets[1]).toBeDefined()
    if (benchSets[1]) {
      benchSets[1].weight = 70
    }
    const editedSerialized = serializeWorkoutNote(edited)

    const baselineLines = baseline.split('\n')
    const editedLines = editedSerialized.split('\n')
    expect(editedLines.length).toBe(baselineLines.length)
    const diffIndices = baselineLines
      .map((line, i) => (line === editedLines[i] ? -1 : i))
      .filter((i) => i >= 0)

    expect(diffIndices).toEqual([
      baselineLines.indexOf('- [exercise:: [[Bench Press]]] [set:: 2] [weight:: 65] [reps:: 6]'),
    ])
    expect(editedSerialized).toContain(
      '- [exercise:: [[Bench Press]]] [set:: 2] [weight:: 70] [reps:: 6]',
    )
  })

  it('drops an unrecognised inline field such as rpe (documented, intentional loss)', () => {
    const source = fixture('workouts/hand-edited.md')
    const model = expectWorkoutModel(source, 'workouts/hand-edited.md')

    const first = model.exercises[0]
    if (first?.kind !== 'strength') {
      throw new Error('hand-edited.md first exercise did not parse as strength')
    }
    expect(first.strengthSets[0]).toEqual({ set: 1, weight: 60, reps: 8 })
    const serialized = serializeWorkoutNote(model)
    expect(serialized).not.toContain('rpe')
  })

  it('reports non-workout markdown without a model', () => {
    const result = parseWorkoutNote('hello world', 'x')

    expect(result.isWorkout).toBe(false)
    expect(result.model).toBeNull()
  })

  const pristineFixtures = workoutFixtures.filter((path) => path !== 'workouts/fence-block.md')

  it.each(pristineFixtures)(
    'serializes %s to the same output on a second save (a note with no foreign content is not reformatted)',
    (path) => {
      const firstSave = serializeWorkoutNote(expectWorkoutModel(fixture(path), path))
      const secondSave = serializeWorkoutNote(expectWorkoutModel(firstSave, path))

      expect(secondSave).toBe(firstSave)
    },
  )

  it('returns no model for a note with no frontmatter at all', () => {
    const result = parseWorkoutNote(
      ['# Just a note', '', 'Some body text with no frontmatter.'].join('\n'),
      'no-frontmatter.md',
    )

    expect(result.isWorkout).toBe(false)
    expect(result.model).toBeNull()
  })

  it('returns no model for an empty note', () => {
    const result = parseWorkoutNote('', 'empty.md')

    expect(result.isWorkout).toBe(false)
    expect(result.model).toBeNull()
  })

  it('round-trips a note that has only frontmatter and no body', () => {
    const source = ['---', 'type: workout', 'date: 2026-08-16', 'name: Rest Day', '---'].join('\n')
    const model = expectWorkoutModel(source, 'frontmatter-only.md')

    expect(model.exercises).toEqual([])
    expect(model.preserveBlocks).toEqual([])

    const serialized = serializeWorkoutNote(model)
    expect(semanticEqual(model, expectWorkoutModel(serialized, 'frontmatter-only.md'))).toBe(true)
  })

  it('round-trips CRLF line endings the same as LF', () => {
    const lf = fixture('workouts/hand-edited.md')
    const crlf = lf.replace(/\n/g, '\r\n')

    const lfModel = expectWorkoutModel(lf, 'lf.md')
    const crlfModel = expectWorkoutModel(crlf, 'crlf.md')

    expect(semanticEqual(lfModel, crlfModel)).toBe(true)
    expect(crlfModel.frontmatterExtra).toEqual(lfModel.frontmatterExtra)
    expect(serializeWorkoutNote(crlfModel)).toContain(
      "> Remember: elbows tucked on bench, don't flare.",
    )
  })

  it('round-trips a note with no trailing newline', () => {
    const source = [
      '---',
      'type: workout',
      'date: 2026-08-16',
      'name: No Trailing Newline',
      '---',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
    ].join('\n')
    /** Deliberately no trailing newline on `source`. */
    const model = expectWorkoutModel(source, 'no-trailing-newline.md')

    expect(model.exercises[0]?.strengthSets).toEqual([{ set: 1, weight: 100, reps: 5 }])
  })

  it('does not mistake a frontmatter value containing "---" for the closing fence', () => {
    const source = [
      '---',
      'type: workout',
      'date: 2026-08-16',
      'name: Delimiter Lookalike',
      'summary: --- like a divider ---',
      '---',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
    ].join('\n')
    const model = expectWorkoutModel(source, 'delimiter.md')

    expect(model.frontmatterExtra).toEqual(['summary: --- like a divider ---'])
    expect(model.exercises).toHaveLength(1)

    const serialized = serializeWorkoutNote(model)
    expect(serialized).toContain('summary: --- like a divider ---')
    expect(semanticEqual(model, expectWorkoutModel(serialized, 'delimiter.md'))).toBe(true)
  })

  it('does not reinterpret frontmatter- or exercise-row-like text inside a fenced block', () => {
    const source = [
      '---',
      'type: workout',
      'date: 2026-08-16',
      'name: Fence Lookalike',
      '---',
      '',
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '',
      '```md',
      '---',
      'type: workout',
      'name: Fake',
      '---',
      '- [exercise:: [[Fake]]] [set:: 1] [weight:: 999] [reps:: 999]',
      '```',
    ].join('\n')
    const model = expectWorkoutModel(source, 'fence-lookalike.md')

    expect(model.exercises).toHaveLength(1)
    expect(model.exercises[0]?.strengthSets).toEqual([{ set: 1, weight: 100, reps: 5 }])

    const serialized = serializeWorkoutNote(model)
    /** The fenced block's fake frontmatter and exercise row survive verbatim as opaque text. */
    expect(serialized).toContain('- [exercise:: [[Fake]]] [set:: 1] [weight:: 999] [reps:: 999]')
    /** But they were never parsed as a second, real exercise entry. */
    const reparsed = expectWorkoutModel(serialized, 'fence-lookalike.md')
    expect(reparsed.exercises).toHaveLength(1)
  })

  it('parses canonical workout markdown from an explicit workout fixture', () => {
    const workout: CanonicalWorkout = {
      name: 'Sample strength',
      date: '2026-04-24',
      exercises: [
        {
          canonicalName: 'Squat',
          note: 'Keep chest tall',
          rows: [
            { kind: 'strength', weight: 50, reps: 5 },
            { kind: 'strength', weight: 55, reps: 5 },
          ],
        },
        {
          canonicalName: 'Bench',
          note: '',
          rows: [{ kind: 'strength', weight: 40, reps: 8 }],
        },
        {
          canonicalName: 'Plank',
          note: '',
          rows: [{ kind: 'duration', seconds: 60 }],
        },
      ],
    }

    const result = parseWorkoutNote(serializeWorkout(workout), 'canonical.md')

    expect(result.isWorkout).toBe(true)
    expect(result.model?.exercises).toHaveLength(3)
  })
})

describe('setRowCount', () => {
  it('counts the logged rows of an entry whatever its kind', () => {
    expect(
      setRowCount({
        exerciseName: 'Push-up',
        kind: 'strength',
        strengthSets: [
          { set: 1, weight: 10, reps: 8 },
          { set: 2, weight: 10, reps: 6 },
          { set: 3, reps: 5 },
        ],
      }),
    ).toBe(3)
    expect(
      setRowCount({
        exerciseName: 'Plank',
        kind: 'duration',
        durationEntries: [
          { set: 1, durationSeconds: 60 },
          { set: 2, durationSeconds: 45 },
        ],
      }),
    ).toBe(2)
    expect(
      setRowCount({
        exerciseName: 'Push-up',
        kind: 'bodyweight',
        bodyweightSets: [{ level: 2, reps: 8 }],
      }),
    ).toBe(1)
  })
})

describe('relabelSetsAsFirstLevel', () => {
  it('marks strength rows as level 1, carrying weight as load', () => {
    expect(
      relabelSetsAsFirstLevel({
        exerciseName: 'Dip',
        kind: 'strength',
        strengthSets: [
          { set: 1, weight: 10, reps: 8, note: 'Steady' },
          { set: 2, reps: 6 },
        ],
      }),
    ).toEqual([
      { level: 1, set: 1, reps: 8, load: 10, note: 'Steady' },
      { level: 1, set: 2, reps: 6 },
    ])
  })

  it('marks duration rows as level 1, keeping notes but no reps', () => {
    const entry: DurationExerciseEntry = {
      exerciseName: 'Plank',
      kind: 'duration',
      durationEntries: [
        { set: 1, durationSeconds: 60, note: 'Hard' },
        { set: 2, durationSeconds: 45 },
      ],
    }
    expect(relabelSetsAsFirstLevel(entry)).toEqual([
      { level: 1, set: 1, note: 'Hard' },
      { level: 1, set: 2 },
    ])
  })

  it('offers nothing when the entry already names its rungs', () => {
    const entry: BodyweightExerciseEntry = {
      exerciseName: 'Push-up',
      kind: 'bodyweight',
      bodyweightSets: [{ level: 2, reps: 8 }],
    }
    expect(relabelSetsAsFirstLevel(entry)).toEqual([{ level: 2, reps: 8 }])
  })
})
