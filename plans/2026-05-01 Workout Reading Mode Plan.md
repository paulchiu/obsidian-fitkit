---
status: shipped
target: v0.11.0
date: 2026-05-01
branch: feature/workout-reading-mode
title: 'Workout reading mode plan'
generation:
  summary_prompt: >-
    Recreate this dated FitKit implementation-options plan for adding a prettier
    Obsidian reading-mode presentation for raw workout notes, preserving the
    current workout Markdown file format and editor workflow.
  source_context: >-
    Generated from an inspection of the FitKit Obsidian plugin on 2026-05-01.
    Relevant sources included src/main.ts, src/domain/workout-note-model.ts,
    src/settings.ts, styles.css, README.md, AGENTS.md, and existing plans.
  conversation_archive:
    status: 'summarised_only'
    path: null
---

# Workout Reading Mode Plan

## Answer

Yes. A prettier workout in Obsidian reading mode is possible without changing the
raw workout note format.

The practical implementation is a Markdown post-processor that runs only for
`type: workout` notes. It should render each parsed workout exercise section as
a compact read-only card or table, then hide only the raw FitKit Dataview field
rows that it successfully replaced. The existing workout editor remains the
data-entry surface.

One additional routing change is needed for this to be useful: workout files are
currently auto-swapped from a Markdown leaf into `WorkoutEditorView` when opened.
Add a setting or command path that lets a user keep a workout note in the normal
Markdown reading view.

## Current Behaviour

- Workout notes are plain Markdown with `type: workout` frontmatter, one `##`
  exercise heading per exercise, and Dataview inline fields for rows.
- `parseWorkoutNote` already parses those notes into `WorkoutNoteModel`
  (`src/domain/workout-note-model.ts:81`).
- `serializeWorkoutNote` preserves the canonical Dataview inline-field format
  (`src/domain/workout-note-model.ts:253`).
- `FitKitPlugin.onload` registers the existing `fitkit-chart` Markdown code
  block processor (`src/main.ts:97`), so the plugin already has one preview
  renderer pattern.
- `maybeRouteWorkoutFile` swaps opened workout Markdown leaves into the custom
  workout editor (`src/main.ts:212`), and `sweepLeavesForWorkout` does the same
  for existing Markdown leaves at layout-ready (`src/main.ts:252`).
- Tests currently assert that opening a workout Markdown file auto-opens the
  editor (`tests/main.test.ts:259`, `tests/main.test.ts:276`,
  `tests/main.test.ts:427`).

## Options

### Option 1: Markdown post-processor for reading mode, recommended

Use Obsidian's `registerMarkdownPostProcessor` in `FitKitPlugin.onload`. The
processor should:

- Skip unless `ctx.frontmatter?.type` or the file metadata says `workout`.
- Use `ctx.getSectionInfo(el)` so rendering happens per Markdown section rather
  than duplicating a whole-workout preview for every section.
- Parse a section by wrapping the section text in minimal workout frontmatter and
  calling the existing `parseWorkoutNote`.
- Render only when the section parses to exactly one exercise entry.
- Add classes to successfully replaced raw FitKit row elements and hide them via
  `styles.css`.
- Leave the original `## [[Exercise]]` heading visible so Obsidian's native link,
  outline, and section navigation behaviour stays intact.
- Leave unparsed prose, normal lists, and fenced blocks visible.

Suggested renderer:

- `src/ui/workout-reading-mode.ts`
  - Export `renderWorkoutReadingModeSection(plugin, el, ctx)`.
  - Export pure helpers for formatting set labels, weights, reps, durations, and
    notes.
  - Use Obsidian DOM helpers (`createDiv`, `createEl`, `createSpan`) only.
- `src/main.ts`
  - Import and register the post-processor after the chart block processor.
- `styles.css`
  - Add `.fitkit-reading-*` classes for the card/table UI.
  - Add `.fitkit-reading-hidden-source-row { display: none; }`.

Recommended presentation:

- Strength exercises: a compact table with Set, Weight, Reps, and Notes columns.
- Duration exercises: a compact table with Set, Duration, and Notes columns.
- Exercise note row: a muted note strip above the table.
- Empty or malformed exercise section: leave the original Markdown untouched.

This option is the best fit because it changes reading mode only, keeps the
file source canonical, and reuses the existing parser as the contract.

### Option 2: Whole-note preview post-processor

Render a full workout summary once at the top of the Markdown preview and hide
all raw FitKit row sections below it.

This can look more polished, but it is riskier:

- Obsidian post-processors can run per rendered section, so duplicate insertion
  needs careful gating.
- Hiding whole sections can break outline navigation, heading links, and local
  context around preserved fenced blocks.
- It needs more DOM coordination than the section-level approach.

Use this only if the desired design is an app-like report rather than a prettier
Markdown reading mode.

### Option 3: Custom workout preview view

Create a second custom `ItemView`, for example `fitkit-workout-preview`, that
renders the same read-only card/table UI as a full app surface.

This is not the requested reading-mode behaviour. It may be useful later if
FitKit wants a dedicated report view, but it does not improve the raw Markdown
file in Obsidian's reading mode.

### Option 4: CSS only

Try to restyle the rendered Dataview inline fields and bullets with CSS.

This is not enough. The field labels and row structure are semantic data, not a
presentation model. CSS cannot reliably regroup fields into tables, handle
strength versus duration rows cleanly, or avoid brittle coupling to Dataview's
rendered inline-field markup.

### Option 5: Add a custom fenced workout block

Add a generated `fitkit-workout` fenced code block to every workout note and
render that with `registerMarkdownCodeBlockProcessor`.

This is technically simple, but it is the wrong tradeoff for current FitKit
notes:

- It duplicates the canonical row data in the file.
- It creates synchronization questions between the rows and the rendered block.
- The editor currently preserves fenced blocks, so stale generated report blocks
  could survive edits.

## Routing Choice

The renderer alone is insufficient because the current open flow immediately
converts workout Markdown leaves into `WorkoutEditorView`.

Recommended routing change:

- Add `autoOpenWorkoutEditor: boolean` to `FitKitSettings`, defaulting to `true`
  to preserve current behaviour.
- Add a Behavior setting named `Auto-open workout editor`.
- In `maybeRouteWorkoutFile` and `sweepLeavesForWorkout`, return early when the
  setting is `false`.
- Keep the `Open workout editor for current file` command and `Open today's
workout` command as explicit editor entry points.

Optional follow-up:

- Add `Open current workout as Markdown` if users want a one-off preview path
  while keeping automatic editor routing enabled. That command can open a
  Markdown leaf with a short-lived path bypass set so the `file-open` handler
  does not immediately route it into the editor.

## Implementation Steps

1. Add `autoOpenWorkoutEditor` to `FitKitSettings` and `DEFAULT_SETTINGS` in
   `src/settings.ts`.
2. Add the settings-tab toggle under Behavior.
3. Gate `maybeRouteWorkoutFile` and `sweepLeavesForWorkout` in `src/main.ts` on
   `this.settings.autoOpenWorkoutEditor`.
4. Add `src/ui/workout-reading-mode.ts`.
5. Register the post-processor from `FitKitPlugin.onload`.
6. Add reading-mode CSS classes to `styles.css`.
7. Update README workflow notes so users know that the editor is for entry and
   Markdown reading mode is for review.
8. Add a changelog entry under `## [Unreleased]`.

## Suggested Post-Processor Shape

```ts
this.registerMarkdownPostProcessor((el, ctx) => renderWorkoutReadingModeSection(this, el, ctx))
```

```ts
export function renderWorkoutReadingModeSection(
  plugin: FitKitPlugin,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): void {
  if (!isWorkoutContext(plugin, ctx)) {
    return
  }

  const section = ctx.getSectionInfo(el)
  if (!section || !section.text.trimStart().startsWith('## ')) {
    return
  }

  const parsed = parseWorkoutNote(
    ['---', 'type: workout', 'date:', 'name:', '---', '', section.text].join('\n'),
    ctx.sourcePath,
  )
  const exercise = parsed.model?.exercises[0]
  if (!parsed.isWorkout || parsed.model?.exercises.length !== 1 || !exercise) {
    return
  }

  renderExercisePreview(el, exercise)
  hideRecognisedFitKitRows(el)
}
```

The final implementation should avoid exactly this naive `startsWith('## ')`
gate if Obsidian includes leading frontmatter or callouts in `section.text`.
The point is the shape: section-gated, parser-backed, and no source mutation.

## Tests

- Pure formatter tests for strength rows, duration rows, blank weights/reps, and
  notes.
- UI unit tests for `renderWorkoutReadingModeSection` using a mocked
  `MarkdownPostProcessorContext`.
- Routing tests that assert workout Markdown leaves stay Markdown when
  `autoOpenWorkoutEditor` is false.
- Regression tests that existing auto-route behaviour remains unchanged when
  `autoOpenWorkoutEditor` is true.
- A fixture with an unparseable or custom section to prove raw Markdown is left
  visible.

## Risks

- Dataview can alter inline-field DOM in reading mode. The implementation should
  hide only rows that the post-processor can positively identify from the source
  section, and leave anything uncertain visible.
- Section post-processing can run multiple times during preview refreshes. The
  renderer should be idempotent by checking for an existing `.fitkit-reading`
  child before inserting.
- The current settings schema resets to defaults when `schemaVersion` changes.
  Do not bump `schemaVersion` for this additive setting unless there is a real
  migration requirement.
- If a workout section contains custom prose mixed with FitKit rows, the custom
  prose should stay visible.

## Decision

Implement Option 1 plus the routing setting. It is the only option that satisfies
the ask directly: the raw workout file can remain a normal Markdown note, and
reading mode can become a pleasant review surface while the workout editor stays
optimized for data entry.

## CodeRabbit Review

Reviewed with:

```bash
coderabbit review --agent --no-color -t uncommitted -f "plans/2026-05-01 Workout Reading Mode Plan.md" -c AGENTS.md CLAUDE.md
```

Result: CodeRabbit raised 0 issues against this plan.
