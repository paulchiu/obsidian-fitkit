---
status: draft
target: v0.6.0
date: 2026-04-27
branch: feature/exercise-pb-and-file-open
---

# FitKit v0.6.0 Exercise Card PB and File Link Plan

## §1 Background and motivation

The workout editor already renders each exercise as a card inside `.fitkit-exercise-list`,
with `renderExerciseCard` called once per exercise in the current workout model
(`src/ui/workout-editor-view.ts:221-224`, `src/ui/workout-editor-view.ts:264-317`).
The card top row currently contains the drag handle, exercise name button, and exercise
options gear (`src/ui/workout-editor-view.ts:276-301`). That top row is the right place
to surface compact history context because it belongs to the whole exercise row group,
not to any single set row.

FitKit already computes historical workout metrics outside the editor. `rebuildIndex`
scans markdown files under the configured workouts folder and parses only notes whose
frontmatter says `type: workout` (`src/vault/index.ts:13-43`). The generated dashboard
then renders a `## PBs` section from that index (`src/vault/dashboard.ts:22-43`). The
vault product spec says the history cache should power personal bests and last performed
or last-session-style lookup
(`/Users/paul/Library/Mobile Documents/iCloud~md~obsidian/Documents/Quartz/Projects/FitKit/2026-04-25 FitKit product spec.md:69-81`,
`/Users/paul/Library/Mobile Documents/iCloud~md~obsidian/Documents/Quartz/Projects/FitKit/2026-04-25 FitKit product spec.md:386-392`).
The POC spec also calls for PB display on rendered cards, while this plan resolves the
editor strength PB metric to the heaviest absolute weight lifted at any rep count
(`/Users/paul/dev-misc/fitkit-pocs/SPEC.md:146-152`,
`/Users/paul/dev-misc/fitkit-pocs/SPEC.md:185-190`).

The current editor menu surface is close to what this feature needs. Row kebabs already
render on strength and duration rows and expose Edit note plus Delete row
(`src/ui/workout-editor-view.ts:393-406`, `src/ui/workout-editor-view.ts:458-471`,
`src/ui/workout-editor-view.ts:513-534`). The card-level exercise menu already exists in
`openCardMenu` (`src/ui/workout-editor-view.ts:715-765`). Adding `Open exercise file` to
both surfaces keeps the action discoverable from either the exercise group or any row in
that group.

This plan is append-only under the repo plan rules. Existing plans are historical records,
and new work belongs in a new dated plan file (`AGENTS.md:123-130`). This planning pass
creates only this file. The future implementation PR still needs the normal user-visible
CHANGELOG entry because AGENTS.md requires one for user-facing changes (`AGENTS.md:95`,
`AGENTS.md:120`).

## §2 Scope

**In scope for v0.6.0:**

- Show a PB badge on each exercise card when history exists for that exercise.
- Show a last-session max badge on each exercise card when there is a prior session for
  that exercise.
- Add `Open exercise file` to the exercise card menu and the row kebab menu.
- Open an existing exercise note in the current leaf using same-pane navigation, replacing
  the editor on mobile as intended.
- Keep aggregation in pure domain code where possible, with Obsidian vault scanning kept
  in `src/vault/`, matching the tier rules (`AGENTS.md:22-31`).
- Add focused unit and UI coverage in the future implementation PR.
- Add a future CHANGELOG entry under `## [Unreleased]`.

**Out of scope for v0.6.0:**

- Writing implementation code during this planning pass.
- Modifying tests, `CHANGELOG.md`, `manifest.json`, or generated plugin output during this
  planning pass.
- Creating missing exercise files from the open-file menu entry.
- Changing the workout note format, exercise note frontmatter contract, or Dataview inline
  field format.
- Adding sparklines, volume deltas, trend charts, or dashboard redesign.
- Adding settings for PB display, history scan limits, leaf placement, or menu behavior.
- Reworking the dashboard duration PB wording unless the duration definition decision below
  forces a follow-up.

## §3 Data model and sources

**Exercise identity and note files.** The editor model stores the exercise name as a string
on `ExerciseEntry.exerciseName` and the editable `ExerciseCard.name`
(`src/domain/workout-note-model.ts:36-42`, `src/ui/workout-editor-view.ts:56-62`). Exercise
note files do exist: the configured exercise folder is `<fitnessRoot>/Exercises`
(`src/settings-paths.ts:13-15`), the vault registry merge scans markdown files in that
folder and uses file basenames as exercise names (`src/vault/exercise-registry-vault.ts:8-18`),
and the missing-exercises flow creates notes with frontmatter `type: exercise` plus `kind`
(`src/ui/create-missing-exercises-modal.ts:167-173`). Import can create the same note
shape (`src/ui/import-modal.ts:437-451`). The vault product spec treats exercise notes as
human-readable notes and Dataview entry points, not as a required structured source for
workout rows
(`/Users/paul/Library/Mobile Documents/iCloud~md~obsidian/Documents/Quartz/Projects/FitKit/2026-04-25 FitKit product spec.md:120-124`).

**Where links are materialized.** The canonical workout row link is the Dataview inline
field `[exercise:: [[Name]]]`, and the parser explicitly trusts that field over a mismatched
heading (`src/domain/workout-note-model.ts:9-15`, `src/domain/workout-note-model.ts:130-139`).
The serializer writes both the exercise heading as `## [[Name]]` and each row as
`[exercise:: [[Name]]]` with strength or duration fields (`src/domain/workout-note-model.ts:272-301`).
The journal import serializer follows the same wikilink and Dataview inline-field shape
(`src/domain/workout-note-serializer.ts:24-41`).

**Workout history storage.** Completed workouts are separate markdown notes under the
configured workouts folder. `Open today's workout` creates or opens
`<fitnessRoot>/Workouts/YYYY-MM-DD.md` (`src/main.ts:90-106`), and workout parsing accepts
only notes with frontmatter `type: workout` (`src/domain/workout-note-model.ts:81-93`).
Strength rows carry `set`, optional `weight`, optional `reps`, and optional note fields.
Duration rows carry optional `set`, required `durationSeconds`, and optional note fields
(`src/domain/workout-note-model.ts:23-42`). The index turns each workout file into an entry
with path, date, name, and exercise rows (`src/vault/index.ts:96-127`).

**Existing max and PB data.** Strength best-set selection already exists in `pickBestSet`:
it picks a weighted candidate for each exercise row group and treats all-zero-weight rows
by most reps (`src/domain/epley.ts:8-18`, `src/domain/epley.ts:24-46`). `rebuildIndex`
stores that best set on each strength exercise row (`src/vault/index.ts:120-126`). The
editor badge defined by this plan must use max-weight semantics, so the implementation
needs index data that exposes the heaviest absolute weight lifted for each exercise in
each workout rather than reusing the dashboard's strength score.

**Duration history shape.** The existing index stores duration exercise rows as
`totalDurationSeconds` plus `totalSets` per workout exercise group (`src/vault/index.ts:106-117`).
The dashboard currently formats duration PB-like output as total duration across all
sessions, not as a per-session maximum (`src/vault/dashboard.ts:128-132`). That is enough
for a v0.6.0 badge if duration max means "max session total", but not enough if duration
max means "longest single duration row". The product spec states that duration entries do
not produce strength best-set fields, so any duration badge must be duration-specific
rather than reusing strength scoring
(`/Users/paul/Library/Mobile Documents/iCloud~md~obsidian/Documents/Quartz/Projects/FitKit/2026-04-25 FitKit product spec.md:377-384`).

**Dataview versus vault scan.** The plugin emits Dataview queries into the dashboard
markdown (`src/vault/dashboard.ts:141-165`), but it does not depend on Dataview APIs for
aggregation. Existing aggregation is done by scanning the vault, reading markdown, and
parsing FitKit workout notes (`src/vault/index.ts:16-43`). The future implementation should
reuse that scan-and-parse approach rather than adding a runtime Dataview dependency.

**Open-file primitive.** There is no current markdown-note open helper in the plugin. The
existing open primitive is the v0.4.2 workout-editor path: find a main-area leaf with
`iterateRootLeaves`, clean up stray workout-editor leaves, create a new tab with
`getLeaf('tab')` when needed, call `setViewState`, then `revealLeaf`
(`src/main.ts:154-174`). The v0.4.2 plan documents why `iterateRootLeaves` is preferred
over root identity checks on mobile and why `getLeaf('tab')` was chosen for main-area tabs
(`plans/2026-04-27 v0.4.2 Mobile Leaf Iterate Root Leaves Plan.md:73-116`).
For `Open exercise file`, do not reuse that `iterateRootLeaves` path. This action is
same-pane navigation, so it should use `app.workspace.openLinkText` with the active leaf
and intentionally replace the editor on mobile.

**Open question:** Should duration PB and last-session max mean the largest single
`durationSeconds` row, or the largest total duration for that exercise in a workout
session? The current index supports session total today. A single-entry max needs either
new index data or a new history scan over parsed models.

**Open question:** Should editor PB badges exclude the currently open workout file? The
recommended first implementation excludes the current `sourcePath` so the badge reflects
prior history and does not change while the user edits today's rows. Resolved 2026-04-27:
Anchor date is the date of the workout currently being edited, NOT new Date()/today.
Compare sessions strictly before that workout date. Fallback chain if workout has no date
metadata: (1) frontmatter date field, (2) filename date (YYYY-MM-DD prefix), (3) treat as
today for safety. Document this fallback chain explicitly in the implementation outline
section.

## §4 UX shape

PB and last-session max should appear in the exercise card top row, after the exercise name
button and before the gear button. The exact attach point is the `top` element created as
`.fitkit-card-top` in `renderExerciseCard` (`src/ui/workout-editor-view.ts:276-301`). Add a
small stats cluster there, for example `.fitkit-card-stats`, so the drag handle, name,
stats, and gear remain one card header. CSS already makes `.fitkit-card-top` a wrapping
flex row with a shared control size (`styles.css:136-142`), and the exercise name button
is flexible (`styles.css:144-157`), so badges can wrap below the name on narrow mobile
widths without changing the set-row grid.

For strength exercises, PB means the highest absolute weight lifted at any rep count. The
badge should read like `PB 95 kg x 8` when the source data has a weighted set, and its
tooltip or label should read something like `Heaviest weight lifted (not 1RM)`. The
last-session badge should read like `Last 90 kg x 8`, using the heaviest weighted set from
the latest prior session. If no eligible historical set exists, hide the badge rather than
showing noisy placeholder text.

For duration exercises, the tentative v0.6.0 badge definition is session total duration,
because that matches the current `ExerciseIndexRow.totalDurationSeconds` data shape
(`src/domain/types.ts:7-13`, `src/vault/index.ts:106-117`). The badge should read like
`PB 270s` and `Last 240s`. If the open question resolves toward longest single entry, the
implementation should add a dedicated `bestDurationSeconds` shape instead of overloading
`totalDurationSeconds`.

`Open exercise file` should be the first non-destructive item in the exercise card menu,
before switch-kind and move actions. The card menu is built in `openCardMenu`
(`src/ui/workout-editor-view.ts:715-765`). The same menu item should also appear at the
top of each row kebab menu, before Edit note and Delete row. The row kebab is built in
`renderRowKebab` (`src/ui/workout-editor-view.ts:513-534`), so `renderRowActions` needs the
exercise name passed in from both `renderStrengthRow` and `renderDurationRow`
(`src/ui/workout-editor-view.ts:359-407`, `src/ui/workout-editor-view.ts:430-472`).

When an exercise file exists, the action opens the note at
`<fitnessRoot>/Exercises/<exerciseName>.md`. When it does not exist, the menu entry should
be disabled if that is straightforward with Obsidian `MenuItem`, or should no-op with a
short `Notice` such as `No exercise file found.` if the disabled state is awkward in the
row menu. Do not create a file from this action in v0.6.0.

The exercise file should open in the current leaf, using `app.workspace.openLinkText` with
the active leaf. Do not use the v0.4.2 `iterateRootLeaves` path or create a separate
`getLeaf('tab')` tab for this action, because that helper is for escaping an editor leaf,
not for same-pane navigation. Manual iOS smoke must confirm that replacing the editor with
the exercise note is the observed behavior.

## §5 Implementation outline

**`src/domain/exercise-history.ts` (new):** Add pure types and helpers that summarize PB
and last-session max by exercise name from a `FitKitIndex`. Keep this module free of
`obsidian` imports, per the domain tier rule (`AGENTS.md:25`). Recommended exported
helpers: one function to build a map of exercise names to history summaries, one formatter
or lightweight label helper for strength and duration badges, and small internal helpers
for choosing the latest prior session by date then path. Strength PB must choose the
highest absolute weight lifted at any rep count, and last-session max must choose the
heaviest weighted set from the latest prior session. Exclude the current workout path from
the input before aggregating.

Anchor-date fallback for the current workout:

1. Frontmatter `date` field.
2. Filename date from a `YYYY-MM-DD` prefix.
3. Treat as today for safety.

**`tests/domain/exercise-history.test.ts` (new):** Cover strength PB by highest absolute
weight, last-session selection by latest prior date, current-path exclusion, missing
history, zero-weight and missing-weight behavior, and the chosen duration definition.
Mirror the existing test layout under `tests/domain/` (`tests/vault/index.test.ts:1-76`,
`tests/vault/dashboard.test.ts:71-98`).

**`src/vault/exercise-history-vault.ts` (new):** Add the Obsidian-aware helper that obtains
history for the editor. Read from `plugin.cachedIndex`, the `FitKitIndex` value produced by
`rebuildIndex` and `updateIndexEntry` in `src/vault/index.ts` and assigned on the plugin in
`src/main.ts` and `src/ui/import-modal.ts`. If the cache is null, build it once before
aggregating. Keep any scan bounded to `workoutsFolder(settings)`, matching `rebuildIndex`
(`src/vault/index.ts:16-43`). The implementation must account for staleness because
current cache writes happen only through rebuild commands and import dashboard updates
(`src/main.ts:25-72`, `src/ui/import-modal.ts:458-478`).

**`tests/vault/exercise-history-vault.test.ts` (new):** Mock the vault to verify that only
workout-folder markdown files are read, non-workout markdown is ignored, current path is
excluded, and unreadable files produce a recoverable result rather than breaking the editor.

**`src/ui/workout-editor-view.ts`:** Add a private history-summary field to the view, load
it once per `loadFile` call, and clear it on close or when loading a non-workout file
(`src/ui/workout-editor-view.ts:150-167`, `src/ui/workout-editor-view.ts:130-144`). Render
the stat badges inside `.fitkit-card-top` in `renderExerciseCard`
(`src/ui/workout-editor-view.ts:264-317`). Add `Open exercise file` to `openCardMenu` and
`renderRowKebab`, pass the exercise name through `renderRowActions`, and add a private
method that resolves the exercise note path with `exercisesFolder` and `normalizePath`.
Use `vault.getAbstractFileByPath` and require a `TFile`, matching the existing boundary
checks elsewhere (`src/ui/create-missing-exercises-modal.ts:78-82`,
`src/main.ts:97-105`). History aggregation runs once per `loadFile` call, the result is
stored on the view instance, and re-renders during edit do NOT recompute it.

**`tests/ui/workout-editor-view.test.ts`:** Extend the existing row-action tests to assert
that the row kebab includes `Open exercise file` before Edit note and Delete row. Add a
card-menu test for the same item on the exercise menu. Add focused rendering coverage for
PB and last-session badges, using the current lightweight Obsidian `Menu` mock
(`tests/ui/workout-editor-view.test.ts:58-110`,
`tests/ui/workout-editor-view.test.ts:246-281`).

**`styles.css`:** Add compact badge styles near the card-top styles
(`styles.css:136-171`). Keep badges small, wrapping, and based on Obsidian CSS variables.
Do not change the set-row grid definitions (`styles.css:214-223`) unless manual mobile
smoke proves the header badges affect row layout.

**`CHANGELOG.md`:** Future implementation PR only. Add one `### Added` bullet under
`## [Unreleased]` because these are user-visible editor features. Do not edit the changelog
as part of this plan-file-only pass.

## §6 Test plan

Run the full implementation gate in the future code PR:

- `npm run lint`
- `npm run format:check`
- `npm run build`
- `npm test`

Unit tests:

- `tests/domain/exercise-history.test.ts`: strength PB chooses the highest absolute
  historical weight at any rep count.
- `tests/domain/exercise-history.test.ts`: last-session max chooses the latest prior workout
  for that exercise, not the latest file in the whole vault.
- `tests/domain/exercise-history.test.ts`: current `sourcePath` is excluded from PB and
  last-session stats.
- `tests/domain/exercise-history.test.ts`: empty history, zero-weight or missing-weight
  strength history, and missing duration values return absent badges.
- `tests/domain/exercise-history.test.ts`: duration PB and last-session max follow the
  chosen definition once resolved in §7.

Vault tests:

- `tests/vault/exercise-history-vault.test.ts`: scans only the configured workouts folder.
- `tests/vault/exercise-history-vault.test.ts`: ignores markdown without `type: workout`.
- `tests/vault/exercise-history-vault.test.ts`: filters the current file by normalized path.
- `tests/vault/exercise-history-vault.test.ts`: does not require Dataview to be installed.

UI tests:

- `tests/ui/workout-editor-view.test.ts`: card top renders PB and Last badges for strength.
- `tests/ui/workout-editor-view.test.ts`: card top renders PB and Last badges for duration.
- `tests/ui/workout-editor-view.test.ts`: row kebab menu order is Open exercise file,
  Edit note, Delete row.
- `tests/ui/workout-editor-view.test.ts`: exercise card menu includes Open exercise file
  without changing switch-kind, move, or remove behavior.
- `tests/ui/workout-editor-view.test.ts`: missing exercise file path disables the menu item
  or produces the planned Notice behavior.

Manual desktop smoke:

- Open a workout with known historical strength data. Confirm PB and Last appear on the
  matching exercise card and do not appear on unrelated cards.
- Open a workout with known historical duration data. Confirm PB and Last use the chosen
  duration definition.
- Use the exercise card menu to open an existing exercise file. Confirm it opens in the
  current leaf.
- Use a row kebab to open the same exercise file. Confirm Edit note and Delete row still
  work afterwards.
- Rename an exercise to another known exercise. Confirm the visible history updates or the
  plan's chosen refresh behavior is documented in the PR.

Manual iOS smoke:

- Open today's workout from the command palette, then use `Open exercise file` from a card.
  Confirm the exercise note replaces the editor in the current leaf, not a side drawer.
- Repeat from a row kebab on both strength and duration rows.
- Confirm badges wrap cleanly in narrow width and do not compress set, weight, reps, or
  duration inputs.
- Confirm missing exercise files fail gracefully and do not create files.

## §7 Risks and open questions

**Open question: PB definition.** Strength PB should follow the existing implementation
and the POC spec also mentions tie-breakers by weight, reps, and RPE
(`/Users/paul/dev-misc/fitkit-pocs/SPEC.md:148-152`), but the current code has no RPE and
does not implement explicit equal-score tie-breakers. Resolved 2026-04-27: Highest
absolute weight lifted at ANY rep count. NOT estimated 1RM. Do not use bestSet.e1rm. The
tooltip/label must read something like Heaviest weight lifted (not 1RM).

**Open question: last-session max scope.** Should last-session max be anchored to today or
to the workout currently being edited? Resolved 2026-04-27: Anchor date is the date of the
workout currently being edited, NOT new Date()/today. Compare sessions strictly before
that workout date. Fallback chain if workout has no date metadata: (1) frontmatter date
field, (2) filename date (YYYY-MM-DD prefix), (3) treat as today for safety. Document this
fallback chain explicitly in the implementation outline section.

**Open question: duration max definition.** The smallest implementation uses session total
duration because `ExerciseIndexRow` already stores `totalDurationSeconds`
(`src/domain/types.ts:7-13`). If the product intent is longest single hold, add a dedicated
field instead and update tests accordingly.

**Open question: current workout inclusion.** Excluding the open file keeps today's in-progress
sets from self-referencing as PBs. Including the open file would make the badge more dynamic
but could require rerendering during autosave and may disrupt focused inputs. Resolved
2026-04-27: compare only sessions strictly before the edited workout's anchor date, and
also exclude the current path before aggregation.

**Open question: aliases and renamed exercises.** History is name-based today. The registry
can resolve aliases for import and editor choices (`src/domain/exercise-registry.ts:57-112`),
but historical workout rows store names as written. A renamed exercise may fragment PB history
unless alias-aware history aggregation is added later.

**Performance on many notes.** A full scan on every editor load could be noticeable in a
large vault. Read from `plugin.cachedIndex`, the `FitKitIndex` value produced by
`rebuildIndex` and `updateIndexEntry` in `src/vault/index.ts` and assigned on the plugin in
`src/main.ts` and `src/ui/import-modal.ts`. History aggregation runs once per `loadFile`
call, the result is stored on the view instance, and re-renders during edit do NOT
recompute it. The existing cache is transient and not always fresh (`src/main.ts:25-72`,
`src/ui/import-modal.ts:458-478`). The first implementation should prefer correctness, use
`cachedRead`, and keep the aggregation pure. If load latency is visible, promote the POC8
incremental index lifecycle later (`/Users/paul/dev-misc/fitkit-pocs/POC8-SPEC.md:162-185`).

**Open question: exercise file target leaf.** Should opening an exercise file create or
find a main-area tab, or should it use the current leaf? Resolved 2026-04-27: Open in the
CURRENT leaf (same pane). Use app.workspace.openLinkText with the active leaf. Do NOT use
iterateRootLeaves (that helper is for escaping an editor leaf, not for same-pane
navigation). On mobile the editor is replaced; that is desired behaviour.

**iOS leaf placement.** The v0.4.1 and v0.4.2 fixes show that leaf placement is fragile on
Obsidian Mobile (`plans/2026-04-27 Mobile Workout Editor Leaf and Row Actions Plan.md:72-85`,
`plans/2026-04-27 v0.4.2 Mobile Leaf Iterate Root Leaves Plan.md:70-116`). Opening an
exercise markdown file should use current-leaf same-pane navigation and must be manually
smoked on a real iOS device. Do not reach for the `iterateRootLeaves` code path for this
action.

**Missing exercise file graceful no-op.** Exercise notes are optional. The registry can include
saved entries that have no file, and workout rows can mention names with no note. The menu
action must check `vault.getAbstractFileByPath` and require `TFile` before opening. Missing
files should not throw, should not create notes, and should give predictable user feedback.

## §8 Out-of-scope follow-ups

- Add sparkline history in the card header, as suggested by the POC rendered-card concept.
- Add volume delta versus last session.
- Add alias-aware history merging for renamed exercises.
- Add a persisted incremental history index instead of a scan on editor load.
- Align dashboard duration PB wording with the editor duration badge definition.
- Add exercise note creation or templating from the Open exercise file menu.
- Add unit conversion or per-exercise unit display beyond the current kg copy used by the
  dashboard.
- Add settings for hiding badges or controlling which metric appears.
