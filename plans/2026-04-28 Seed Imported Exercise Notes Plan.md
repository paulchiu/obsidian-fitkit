---
status: approved
target: v0.9.1
date: 2026-04-28
branch: feature/seed-imported-exercise-notes
---

# Seed Imported Exercise Notes Plan

## 1. Problem

When the journal importer (or the "create missing exercises" modal on an already-parsed workout) creates a brand-new exercise note, the file is written with only frontmatter:

```
---
type: exercise
kind: strength
---
```

There is no heading, no Dataview query, no Notes section. Users see a blank page when they follow the dashboard's per-section wikilink and have to hand-author the recent-sessions and notes queries themselves to make the note useful.

## 2. Goal

A freshly-created exercise note ships with two Dataview sections that mirror the per-exercise queries the dashboard already renders:

1. `## Recent sessions`: same shape as `dataviewQuery()` in `src/vault/dashboard.ts`, branched on `kind` (strength table vs duration table).
2. `## Notes`: a Dataview that surfaces any list item with a `[notes::]` field for this exercise.

Both queries scope to the configured workouts folder so the note is correct in any vault layout.

## 3. Approach

**New pure composer.** Add `src/vault/exercise-note.ts` exporting:

```ts
export function composeExerciseNote(
  exerciseName: string,
  kind: 'strength' | 'duration',
  workoutsFolderPath: string,
): string
```

It returns the full markdown body for a new exercise note: frontmatter (`type: exercise`, `kind: …`), a `## Recent sessions` section with the kind-appropriate Dataview block, and a `## Notes` section with a Dataview that filters list items for `L.notes` (works the same for strength and duration rows, since both kinds carry an optional `[notes::]` field per `src/domain/workout-note-model.ts:13-15`). No explicit `#` heading: Obsidian renders the filename as the title.

**Strength Recent sessions query** (mirrors dashboard line 160-171):

```
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "<workoutsFolderPath>"
FLATTEN file.lists AS L
WHERE L.exercise = link("<name>") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
```

**Duration Recent sessions query** (mirrors dashboard line 149-157):

```
table without id file.link as Session, duration + "s" as Duration
from "<workoutsFolderPath>"
flatten file.lists as item
where contains(item.text, "[exercise:: [[<name>]]]") and item.duration
sort file.name desc
limit 12
```

**Notes query** (single shape, both kinds):

```
TABLE WITHOUT ID
  file.link AS Workout,
  L.notes AS Note
FROM "<workoutsFolderPath>"
FLATTEN file.lists AS L
WHERE L.exercise = link("<name>") AND L.notes
SORT file.name DESC
LIMIT 20
```

**Wire into both call sites.**

- `src/ui/import-modal.ts:450` (`createMissingExerciseNotes`): replace the inline `placeholder` string with `composeExerciseNote(choice.canonicalName, choice.exerciseKind, workoutsFolder(this.plugin.settings))`.
- `src/ui/create-missing-exercises-modal.ts:172` (`handleApply`): the same call with `row.rawName`, `row.kind`, and `workoutsFolder(this.plugin.settings)`.

Both modals already import `exercisesFolder` from `../settings-paths`; add `workoutsFolder` alongside.

**Out of scope:** the dashboard composer is not refactored to share its `dataviewQuery` helper. The two queries are short and the dashboard renders them inside fenced sections that already include the heading and a wikilink, so factoring out a single helper would conflate two different document layouts. Three similar lines beats a premature abstraction.

## 4. Out Of Scope

- Backfilling already-empty exercise notes. Only newly created notes get the seeded body. Users with existing stubs can re-run the importer or hand-edit; this fix is forward-looking.
- The "Bootstrap from vault" settings action. It still only updates the registry, not file contents (per the existing behaviour documented in `src/settings.ts`).
- Changes to the dashboard, the workout editor, or the registry.
- A user-configurable template. The seeded body is hard-coded; if users want a different layout they can edit after creation.
- Escaping exercise names with quotes or backslashes inside Dataview `link("…")` literals. This gap exists in both the dashboard composer and the new exercise-note composer; fixing one without the other would diverge the queries. Address both in a separate change.

## 5. Tests

UI flows are verified manually per AGENTS.md §6. The pure composer gets a new test file `tests/vault/exercise-note.test.ts`:

- Strength note: full-text assertions against the exact Dataview block (six lines of body plus `FROM "Fitness/Workouts"`, the `WHERE L.exercise = link("Squat") AND L.set` filter, `LIMIT 10`), the leading frontmatter (`---\ntype: exercise\nkind: strength\n---`), the `## Recent sessions` and `## Notes` headings, the trailing newline.
- Duration note: exact match on the duration query (`contains(item.text, "[exercise:: [[Plank]]]")`, `LIMIT 12`), `kind: duration` in frontmatter, and the same Notes Dataview shape.
- Notes block: same shape across both kinds, asserts the `WHERE L.exercise = link("…") AND L.notes` filter and `LIMIT 20`.
- Idempotence: identical inputs produce byte-identical output.
- Drift guard: assert that the composer's Recent sessions Dataview body matches the dashboard's `dataviewQuery()` output byte-for-byte for both kinds, importing the dashboard composer in the test. If either query string changes, both composers must move together.
- Unusual exercise name (e.g., `Machine Pushdown`): the name flows verbatim into both queries (no escaping changes; matches the dashboard's existing behaviour).

Manual:

1. Run **Import workout from journal note** with a journal that mentions a brand-new exercise; tick "Create missing exercises"; confirm the new file under `<fitnessRoot>/Exercises/` opens with `## Recent sessions` directly under the title, the Recent sessions Dataview renders rows from the just-imported workout, and the Notes query is empty-but-valid.
2. Add a per-set note to one row in the imported workout (workout editor pencil icon) and confirm it shows in the exercise note's Notes section after autosave.
3. Run **Create missing exercises** on a workout note that already has unknown exercises; confirm the same template applies.
4. Verify hidden-section settings, dashboard regeneration, and existing exercise notes are unaffected.

## 6. Risk

Low. New pure module with two single-line call-site updates. No data migration: only files freshly created by the importer pick up the new content. Existing user notes are untouched. Failure mode is benign: a malformed query renders Dataview's own error text in the note, fixable by editing.

The closest risk surface is exercise names with characters that break Dataview's `link("…")` literal (quotes, backslashes). The dashboard composer (`src/vault/dashboard.ts:154,168`) already feeds these names through unescaped today; this fix deliberately mirrors that behaviour rather than escaping in the new code only, since the two composers must stay byte-aligned (see Tests, drift guard) and a one-sided escape would produce different queries for the same exercise. The right fix for the escaping gap is a separate change touching both composers together; it is tracked as out of scope here. Bracket characters (`]`) are an existing wikilink-parser limitation (`src/domain/workout-note-model.ts:73`) and are equally unsupported in workout notes today.

## 7. Changelog

Under `### Fixed`:

- Importing a journal or creating missing exercises now seeds the new exercise note with Recent sessions and Notes Dataview sections instead of an empty stub.

## 8. Release Label

`patch`. Bug fix to existing behaviour, no new user-visible feature.
