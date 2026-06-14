---
status: draft
target: v0.18.0
date: 2026-06-15
branch: feature/one-click-open-exercise-file
---

# FitKit v0.18.0 One click open exercise file Plan

## Background

The workout editor already renders each exercise as a card with a header containing the
drag handle, exercise name, and options gear. The prior
`plans/2026-04-27 Exercise Card PB and File Link Plan.md` established same-pane opening
for exercise files from the card menu, and that behavior is now the baseline.

The approved Concept B change makes the exercise name itself the primary open action.
The previous name click opened the rename flow, while the gear menu exposed `Open
exercise file`. That split made the visible exercise name look editable but not link-like,
even though the exercise note is the natural destination.

## Scope

In scope:

- Render the exercise name as a link-style button in the card header.
- Open the exercise note in the same pane when the note exists.
- Create the exercise note when it is missing, then open it in the same pane.
- Move rename to a dedicated pencil icon button beside the name.
- Keep the existing gear-menu `Open exercise file` item and route it through the same
  open-or-create handler.
- Extract a pure planning helper for open versus create intent.
- Add focused helper and UI wiring tests.
- Add a changelog entry under `## [Unreleased]`.

Out of scope:

- Changing workout serialization or Dataview inline fields.
- Adding settings for link behavior or leaf placement.
- Reworking the exercise registry editor or import planner.
- Creating notes from any per-set row menu.

## Data model

The card model supplies the exercise name and kind. The canonical note path remains
`<fitnessRoot>/Exercises/<name>.md`, using the same folder helpers as existing exercise
note creation.

When a missing strength note is created, `composeExerciseNote` needs a weight unit. The
unit comes from the merged registry returned by `exerciseRegistryWithVaultNotes`, then
`unitForName`, falling back to `DEFAULT_WEIGHT_UNIT`. This matches the import planner
precedence and keeps note-backed registry data authoritative.

The pure helper returns an intent:

- `open`, with the canonical note path and source path.
- `create`, with the note path, name, kind, workouts folder, and resolved unit.
- `error`, for impossible boundary input such as a blank exercise name.

The Obsidian view executes the intent. It checks file existence, creates parent folders,
writes the note, opens with `workspace.openLinkText`, and shows `Notice` feedback.

## UX shape

The exercise name remains in the card header but is styled as an actionable link with the
accent color and a small outbound arrow icon. The button is always enabled. Clicking it
opens the note if present or creates the note first if missing.

Rename moves to a pencil icon button between the name and gear. The pencil and gear share
the existing compact transparent card-control pattern with hover and keyboard-focus
affordances.

The gear menu still starts with `Open exercise file`, but that item uses the same
open-or-create handler as the name link. Users who rely on the menu get the same
create-on-missing behavior.

## Implementation outline

1. Add `src/vault/exercise-file-plan.ts` with pure path and intent helpers.
2. Replace the name-button rename click in `renderExerciseCard` with the open-or-create
   handler.
3. Add a pencil icon button that calls `openRenameExerciseModal(index)`.
4. Route the card menu `Open exercise file` item through the shared handler.
5. Execute create intents with `ensureParentFolder`, `vault.create`, `composeExerciseNote`,
   and same-pane `openLinkText`.
6. Style the name link and shared card icon controls in `styles.css`.
7. Add helper tests and focused UI wiring tests.

## Test plan

- Unit test the pure helper for open, create, registry-unit fallback, canonical path
  trimming, and error intent.
- UI test that the rendered name is link-style and the pencil calls rename.
- UI test that clicking the name opens an existing note in the same pane.
- UI test that clicking the name creates a missing note and then opens it.
- UI test that the gear item routes through the same handler.
- Run `npm run lint`, `npm run format:check`, `npm run build`, and `npm test`.
