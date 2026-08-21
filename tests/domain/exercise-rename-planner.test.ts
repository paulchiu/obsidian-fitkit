import { describe, expect, it } from 'vitest'

import {
  buildExerciseRenamePlan,
  rewriteWorkoutNoteOccurrences,
  type ExerciseRenameCatalogEntry,
  type ExerciseRenamePlanInput,
  type ExerciseRenameWorkoutNoteInput,
} from '../../src/domain/exercise-rename-planner'

function note(path: string, exercise: string, extra = ''): ExerciseRenameWorkoutNoteInput {
  return {
    path,
    text: `---
type: workout
date: 2026-05-08
name: Test
---

## [[${exercise}]]

- [exercise:: [[${exercise}]]] [set:: 1] [weight:: 100] [reps:: 5]
${extra}`,
  }
}

function catalogEntry(
  name: string,
  path: string,
  kind: 'strength' | 'duration' = 'strength',
): ExerciseRenameCatalogEntry {
  return { name, path, kind }
}

function baseInput(overrides: Partial<ExerciseRenamePlanInput> = {}): ExerciseRenamePlanInput {
  return {
    oldName: 'Row',
    newName: 'Barbell Row',
    registry: [],
    catalog: [],
    deletedExercises: [],
    workoutNotes: [],
    ...overrides,
  }
}

describe('buildExerciseRenamePlan', () => {
  it('plans a plain rename of a note-backed exercise', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        catalog: [catalogEntry('Row', 'Fitness/Exercises/Row.md')],
        workoutNotes: [note('Fitness/Workouts/2026-05-08.md', 'Row')],
      }),
    )

    expect(plan.refusal).toBeNull()
    expect(plan.operation).toBe('rename')
    expect(plan.sourceNotePath).toBe('Fitness/Exercises/Row.md')
    expect(plan.targetNotePath).toBe('Fitness/Exercises/Barbell Row.md')
    expect(plan.targetNoteExists).toBe(false)
    expect(plan.aliasesToKeep).toEqual(['Row'])
    expect(plan.workoutNotes).toEqual([
      {
        path: 'Fitness/Workouts/2026-05-08.md',
        headingOccurrences: 1,
        fieldOccurrences: 1,
        staleOccurrences: 0,
      },
    ])
    expect(plan.totalHeadingOccurrences).toBe(1)
    expect(plan.totalFieldOccurrences).toBe(1)
    expect(plan.totalStaleOccurrences).toBe(0)
  })

  it('treats a case-only rename as a plain rename, not a merge', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        oldName: 'squat',
        newName: 'Squat',
        catalog: [catalogEntry('squat', 'Fitness/Exercises/squat.md')],
      }),
    )

    expect(plan.refusal).toBeNull()
    expect(plan.operation).toBe('rename')
    expect(plan.targetNotePath).toBe('Fitness/Exercises/Squat.md')
    /** Case-only: the old name normalizes the same as the new one, so it is not worth keeping as a distinct alias. */
    expect(plan.aliasesToKeep).toEqual([])
  })

  it('detects a merge when the target name already has a note', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        catalog: [
          catalogEntry('Row', 'Fitness/Exercises/Row.md'),
          catalogEntry('Barbell Row', 'Fitness/Exercises/Barbell Row.md', 'strength'),
        ],
        registry: [{ name: 'Barbell Row', kind: 'strength', aliases: ['BB row'] }],
      }),
    )

    expect(plan.operation).toBe('merge')
    expect(plan.targetAlreadyExists).toBe(true)
    expect(plan.targetNoteExists).toBe(true)
    expect(plan.sourceNotePath).toBe('Fitness/Exercises/Row.md')
    expect(plan.targetNotePath).toBe('Fitness/Exercises/Barbell Row.md')
    expect(plan.aliasesToKeep.sort()).toEqual(['BB row', 'Row'].sort())
  })

  it('matches a differently-cased bare wikilink and rewrites it, not stale', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        catalog: [catalogEntry('Row', 'Fitness/Exercises/Row.md')],
        workoutNotes: [
          {
            path: 'Fitness/Workouts/2026-05-08.md',
            text: `---
type: workout
date: 2026-05-08
name: Test
---

## [[row]]

- [exercise:: [[row]]] [set:: 1] [weight:: 100] [reps:: 5]`,
          },
        ],
      }),
    )

    expect(plan.workoutNotes).toEqual([
      {
        path: 'Fitness/Workouts/2026-05-08.md',
        headingOccurrences: 1,
        fieldOccurrences: 1,
        staleOccurrences: 0,
      },
    ])
    expect(plan.totalHeadingOccurrences).toBe(1)
    expect(plan.totalFieldOccurrences).toBe(1)
    expect(plan.totalStaleOccurrences).toBe(0)
  })

  it("resolves a merge target typed as an existing alias to the alias owner's real note", () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        oldName: 'Deadlift',
        newName: 'Squat',
        catalog: [
          catalogEntry('Squats', 'Fitness/Exercises/Squats.md'),
          catalogEntry('Deadlift', 'Fitness/Exercises/Deadlift.md'),
        ],
        registry: [{ name: 'Squats', kind: 'strength', aliases: ['Squat'] }],
      }),
    )

    expect(plan.operation).toBe('merge')
    /** The surviving identity is the entry's real canonical name, not the typed alias. */
    expect(plan.newName).toBe('Squats')
    expect(plan.targetNotePath).toBe('Fitness/Exercises/Squats.md')
    expect(plan.targetNoteExists).toBe(true)
    expect(plan.aliasesToKeep.sort()).toEqual(['Deadlift', 'Squat'].sort())
  })

  it('detects a merge when the target only has a no-note registry entry', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        catalog: [catalogEntry('Row', 'Fitness/Exercises/Row.md')],
        registry: [{ name: 'Barbell Row', kind: 'strength', aliases: [] }],
      }),
    )

    expect(plan.operation).toBe('merge')
    expect(plan.targetNoteExists).toBe(false)
    /** No separate target file: the source note simply gets renamed onto the target name. */
    expect(plan.targetNotePath).toBe('Fitness/Exercises/Barbell Row.md')
  })

  it('does not treat renaming onto an existing alias of the same entry as a merge', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        oldName: 'Row',
        newName: 'BB row',
        catalog: [catalogEntry('Row', 'Fitness/Exercises/Row.md')],
        registry: [{ name: 'Row', kind: 'strength', aliases: ['BB row'] }],
      }),
    )

    expect(plan.operation).toBe('rename')
    expect(plan.aliasesToKeep).toEqual(['Row'])
  })

  it('leaves an unrelated exercise whose name is a prefix untouched', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        catalog: [catalogEntry('Row', 'Fitness/Exercises/Row.md')],
        workoutNotes: [
          note('Fitness/Workouts/2026-05-08.md', 'Row', ''),
          {
            path: 'Fitness/Workouts/2026-05-09.md',
            text: `---
type: workout
date: 2026-05-09
name: Test 2
---

## [[Barbell Row]]

- [exercise:: [[Barbell Row]]] [set:: 1] [weight:: 60] [reps:: 8]

## [[Cable Row]]

- [exercise:: [[Cable Row]]] [set:: 1] [weight:: 40] [reps:: 12]`,
          },
        ],
      }),
    )

    expect(plan.workoutNotes).toEqual([
      {
        path: 'Fitness/Workouts/2026-05-08.md',
        headingOccurrences: 1,
        fieldOccurrences: 1,
        staleOccurrences: 0,
      },
    ])
    expect(plan.totalHeadingOccurrences).toBe(1)
    expect(plan.totalFieldOccurrences).toBe(1)
  })

  it('escapes regex metacharacters in the exercise name', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        oldName: 'Push (incline)',
        newName: 'Incline push-up',
        catalog: [catalogEntry('Push (incline)', 'Fitness/Exercises/Push (incline).md')],
        workoutNotes: [
          {
            path: 'Fitness/Workouts/2026-05-08.md',
            text: `---
type: workout
date: 2026-05-08
name: Test
---

## [[Push (incline)]]

- [exercise:: [[Push (incline)]]] [set:: 1] [weight:: 20] [reps:: 10]`,
          },
        ],
      }),
    )

    expect(plan.refusal).toBeNull()
    expect(plan.totalHeadingOccurrences).toBe(1)
    expect(plan.totalFieldOccurrences).toBe(1)
  })

  it('refuses a target name containing "]]"', () => {
    const plan = buildExerciseRenamePlan(baseInput({ newName: 'Bad]]Name' }))
    expect(plan.refusal).toEqual({
      reason: 'invalid-characters',
      message: "Name cannot contain ']]' or '|': these break wikilink substitution.",
    })
    expect(plan.operation).toBeNull()
  })

  it('refuses a target name containing "|"', () => {
    const plan = buildExerciseRenamePlan(baseInput({ newName: 'Bad|Name' }))
    expect(plan.refusal?.reason).toBe('invalid-characters')
  })

  it('refuses an empty target name', () => {
    const plan = buildExerciseRenamePlan(baseInput({ newName: '   ' }))
    expect(plan.refusal).toEqual({
      reason: 'empty-name',
      message: 'Name cannot be empty.',
    })
  })

  it('refuses a target name that normalizes to nothing', () => {
    const plan = buildExerciseRenamePlan(baseInput({ newName: '...' }))
    expect(plan.refusal?.reason).toBe('name-normalizes-to-nothing')
  })

  it('refuses a no-op rename to the identical name', () => {
    const plan = buildExerciseRenamePlan(baseInput({ oldName: 'Row', newName: 'Row' }))
    expect(plan.refusal?.reason).toBe('unchanged')
  })

  it('refuses a target path collision with an unrelated file', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        catalog: [catalogEntry('Row', 'Fitness/Exercises/Row.md')],
        targetPathOccupiedByUnrelatedFile: true,
      }),
    )
    expect(plan.refusal).toEqual({
      reason: 'target-collision',
      message:
        "A file already exists at the destination for 'Barbell Row' that is not this exercise.",
    })
  })

  it('surfaces a tombstoned source without refusing', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        deletedExercises: ['Row'],
      }),
    )
    expect(plan.refusal).toBeNull()
    expect(plan.sourceTombstoned).toBe(true)
    expect(plan.targetTombstoned).toBe(false)
  })

  it('surfaces a tombstoned target without refusing', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        deletedExercises: ['Barbell Row'],
      }),
    )
    expect(plan.refusal).toBeNull()
    expect(plan.targetTombstoned).toBe(true)
    expect(plan.sourceTombstoned).toBe(false)
  })

  it('detects a pathed wikilink occurrence as stale, not rewritable', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        workoutNotes: [
          {
            path: 'Fitness/Workouts/2026-05-08.md',
            text: `---
type: workout
date: 2026-05-08
name: Test
---

See [[Fitness/Exercises/Row]] for form notes.`,
          },
        ],
      }),
    )
    expect(plan.totalStaleOccurrences).toBe(1)
    expect(plan.totalHeadingOccurrences).toBe(0)
    expect(plan.totalFieldOccurrences).toBe(0)
    expect(plan.workoutNotes).toEqual([
      {
        path: 'Fitness/Workouts/2026-05-08.md',
        headingOccurrences: 0,
        fieldOccurrences: 0,
        staleOccurrences: 1,
      },
    ])
  })

  it('detects an aliased wikilink occurrence as stale, not rewritable', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        workoutNotes: [
          {
            path: 'Fitness/Workouts/2026-05-08.md',
            text: `---
type: workout
date: 2026-05-08
name: Test
---

See [[Row|the row]] for form notes.`,
          },
        ],
      }),
    )
    expect(plan.totalStaleOccurrences).toBe(1)
  })

  it('does not double-count a rewritable field occurrence as stale', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        workoutNotes: [note('Fitness/Workouts/2026-05-08.md', 'Row')],
      }),
    )
    expect(plan.totalStaleOccurrences).toBe(0)
  })

  it('reports no plan entry for a note with no occurrences at all', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        workoutNotes: [
          {
            path: 'Fitness/Workouts/2026-05-08.md',
            text: `---
type: workout
date: 2026-05-08
name: Test
---

## [[Deadlift]]

- [exercise:: [[Deadlift]]] [set:: 1] [weight:: 100] [reps:: 5]`,
          },
        ],
      }),
    )
    expect(plan.workoutNotes).toEqual([])
    expect(plan.totalHeadingOccurrences).toBe(0)
  })

  it('finds nothing to rescan once occurrences already use the new name (idempotent)', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        workoutNotes: [note('Fitness/Workouts/2026-05-08.md', 'Barbell Row')],
      }),
    )
    expect(plan.workoutNotes).toEqual([])
    expect(plan.totalFieldOccurrences).toBe(0)
    expect(plan.totalHeadingOccurrences).toBe(0)
  })

  it('reports losing-note prose to carry over on a merge', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        catalog: [
          catalogEntry('Row', 'Fitness/Exercises/Row.md'),
          catalogEntry('Barbell Row', 'Fitness/Exercises/Barbell Row.md'),
        ],
        sourceNoteText: `---
type: exercise
kind: strength
---

## Notes

Cue: keep the bar close to the shins.
`,
      }),
    )
    expect(plan.operation).toBe('merge')
    expect(plan.losingNoteHasProse).toBe(true)
  })

  it('reports no prose to carry when the losing note only has the canonical query block', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        catalog: [
          catalogEntry('Row', 'Fitness/Exercises/Row.md'),
          catalogEntry('Barbell Row', 'Fitness/Exercises/Barbell Row.md'),
        ],
        sourceNoteText: `---
type: exercise
kind: strength
---

## Notes

\`\`\`dataview
TABLE WITHOUT ID file.link
\`\`\`
`,
      }),
    )
    expect(plan.losingNoteHasProse).toBe(false)
  })

  it('never reports losing-note prose for a plain rename', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        catalog: [catalogEntry('Row', 'Fitness/Exercises/Row.md')],
        sourceNoteText: '## Notes\n\nSome prose here.\n',
      }),
    )
    expect(plan.operation).toBe('rename')
    expect(plan.losingNoteHasProse).toBe(false)
  })

  it('never sets a unit when neither the source nor target entry has one', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        registry: [{ name: 'Row', kind: 'strength', aliases: [] }],
      }),
    )
    expect(plan.resultUnit).toBeUndefined()
  })

  it('carries forward an existing explicit unit rather than inventing one', () => {
    const plan = buildExerciseRenamePlan(
      baseInput({
        registry: [{ name: 'Row', kind: 'strength', unit: 'lbs', aliases: [] }],
      }),
    )
    expect(plan.resultUnit).toBe('lbs')
  })
})

describe('rewriteWorkoutNoteOccurrences', () => {
  it('rewrites the heading and field forms', () => {
    const text = note('irrelevant', 'Row').text
    const result = rewriteWorkoutNoteOccurrences(text, 'Row', 'Barbell Row')
    expect(result.headingRewrites).toBe(1)
    expect(result.fieldRewrites).toBe(1)
    expect(result.text).toContain('## [[Barbell Row]]')
    expect(result.text).toContain('[exercise:: [[Barbell Row]]]')
    expect(result.text).not.toContain('[[Row]]')
  })

  it('leaves an unrelated exercise whose name is a prefix untouched', () => {
    const text = `## [[Barbell Row]]

- [exercise:: [[Barbell Row]]] [set:: 1] [weight:: 60] [reps:: 8]

## [[Cable Row]]

- [exercise:: [[Cable Row]]] [set:: 1] [weight:: 40] [reps:: 12]`
    const result = rewriteWorkoutNoteOccurrences(text, 'Row', 'Deadlift')
    expect(result.headingRewrites).toBe(0)
    expect(result.fieldRewrites).toBe(0)
    expect(result.text).toBe(text)
  })

  it('is a no-op on text that already uses the new name (idempotent rescan)', () => {
    const text = note('irrelevant', 'Barbell Row').text
    const result = rewriteWorkoutNoteOccurrences(text, 'Row', 'Barbell Row')
    expect(result.headingRewrites).toBe(0)
    expect(result.fieldRewrites).toBe(0)
    expect(result.text).toBe(text)
  })

  it('leaves pathed and aliased wikilinks untouched', () => {
    const text = 'See [[Fitness/Exercises/Row]] and [[Row|the row]] for cues.'
    const result = rewriteWorkoutNoteOccurrences(text, 'Row', 'Barbell Row')
    expect(result.text).toBe(text)
    expect(result.headingRewrites).toBe(0)
    expect(result.fieldRewrites).toBe(0)
  })

  it('rewrites a differently-cased bare wikilink, matching normalize() elsewhere in the app', () => {
    const text = `## [[row]]

- [exercise:: [[ROW]]] [set:: 1] [weight:: 100] [reps:: 5]`
    const result = rewriteWorkoutNoteOccurrences(text, 'Row', 'Barbell Row')
    expect(result.headingRewrites).toBe(1)
    expect(result.fieldRewrites).toBe(1)
    expect(result.text).toContain('## [[Barbell Row]]')
    expect(result.text).toContain('[exercise:: [[Barbell Row]]]')
  })

  it('preserves everything foreign to the plugin in a hand-edited note', () => {
    const text = `---
type: workout
date: 2026-05-08
name: Test
custom-field: keep-me
---

# Leg day

> Felt strong today, slept 8 hours.

- [ ] Stretch afterwards
- Just a plain bullet, not FitKit's
- [exercise:: [[Row]]] [set:: 1] [weight:: 100] [reps:: 5] trailing note text

![[form-check.png]]

\`\`\`
[exercise:: [[Row]]] this looks like a field but is inside a fenced code block
\`\`\`
`
    const result = rewriteWorkoutNoteOccurrences(text, 'Row', 'Barbell Row')
    expect(result.fieldRewrites).toBe(1)
    expect(result.headingRewrites).toBe(0)
    expect(result.text).toContain('custom-field: keep-me')
    expect(result.text).toContain('# Leg day')
    expect(result.text).toContain('> Felt strong today, slept 8 hours.')
    expect(result.text).toContain('- [ ] Stretch afterwards')
    expect(result.text).toContain("- Just a plain bullet, not FitKit's")
    expect(result.text).toContain(
      '[exercise:: [[Barbell Row]]] [set:: 1] [weight:: 100] [reps:: 5] trailing note text',
    )
    expect(result.text).toContain('![[form-check.png]]')
    /** Content inside a fenced code block is never rewritten, even if it looks like a field. */
    expect(result.text).toContain('[exercise:: [[Row]]] this looks like a field')
  })
})
