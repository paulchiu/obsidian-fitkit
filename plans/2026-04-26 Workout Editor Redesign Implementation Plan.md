---
status: draft
target: v0.3.0
date: 2026-04-26
branch: feature/workout-editor-redesign
---

# Workout Editor Redesign Implementation Plan

## Audience

Coding subagents (Claude Code, Codex) and the human reviewer. Each phase fits one
subagent invocation. All phases land on `feature/workout-editor-redesign`.

**Authoritative inputs:**

- `AGENTS.md`: coding standards, Obsidian-specific guidance, destructive-UI rule, plan conventions.
- `src/ui/workout-editor-view.ts`: the file most UI work targets.
- `src/main.ts`: leaf placement for the editor view.
- Previous plans in `plans/`: historical context for prior decisions; do not edit them.

**Acceptance gate (every phase):** `npm run lint && npm run format:check && npm run build && npm test`
clean before commit. Conventional commits, sentence case, imperative mood (AGENTS.md §7).

## 1. Goal & Success Criteria

Reshape the workout editor for primary-pane and mobile use, replacing legacy affordances:

1. Editor opens as a main-area tab (not the right sidebar).
2. The strength/duration toggle and the per-card remove button live behind a per-card gear menu.
3. Drag-and-drop replaces Up/Down buttons; works on mouse and touch.
4. The workout's frontmatter `name` is editable from the header.
5. Strength rows render as Set/Weight/Reps in three equal columns at all viewport widths;
   per-row actions sit in a strip outside the input grid.
6. Per-set notes live behind a pencil icon and a modal; non-empty notes render as wrapping
   text beneath the row.
7. Exercise rename uses the same picker modal as Add Exercise (existing-or-new), not a
   free-text input.
8. Per-set delete keeps an inline trash icon but routes through a confirmation modal
   (friction is intentional; protects against accidental deletes on mobile).

**Definition of done:**

- All criteria above hold against the dev-vault (`/Users/paul/dev-misc/dev-vault/dev/Fitness/Workouts/`)
  on desktop and Obsidian mobile (manual smoke).
- `npm run lint && npm run format:check && npm run build && npm test` all clean.
- `CHANGELOG.md` `## [Unreleased]` lists user-visible changes; PR carries `minor` label.

## 2. Scope (In / Out)

**In:**

- All eight items in §1.
- Extracting the embedded `ConfirmModal` and `ExerciseSuggestModal` from
  `src/ui/workout-editor-view.ts` into shared modules so they can be reused for new confirm
  flows and the rename picker.
- New `SetNoteModal` for per-set notes.
- Pointer-events drag-and-drop implementation; no library dependency.
- Pure `reorderArray` helper extracted to `src/domain/` with unit tests.
- CSS additions only; no inline styles (AGENTS.md §5).

**Out:**

- Renaming the underlying `<date>.md` file (frontmatter `name` edits only).
- Per-row gear menus for set rows (only the per-card gear is in scope).
- Reordering individual set rows within an exercise (only exercise cards drag).
- Restructuring `src/ui/workout-editor-view.ts` beyond what these features require.
- Animations beyond minimal drag feedback (transform on the dragged card; static drop
  indicator).
- Multi-select; swipe gestures.

## 3. Architecture

### Files touched

| File                               | Phase  | Change                                                                                               |
| ---------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `src/main.ts`                      | 1      | Drop right-leaf fallback; always open in main area; reuse existing FitKit editor leaf when present.  |
| `src/ui/workout-editor-view.ts`    | 1 to 6 | Header name input, gear menu, drag handles, 3-col rows, action strip, note rendering, picker rename. |
| `src/ui/confirm-modal.ts`          | 2      | New file. Extract `ConfirmModal` class.                                                              |
| `src/ui/exercise-suggest-modal.ts` | 6      | New file. Extract `ExerciseSuggestModal` class.                                                      |
| `src/ui/set-note-modal.ts`         | 5      | New file. Modal with one labeled `<textarea>` for per-set / per-duration notes.                      |
| `src/domain/array-utils.ts`        | 3      | New file. Pure `reorderArray<T>(items, from, to): T[]`.                                              |
| `tests/array-utils.test.ts`        | 3      | New file. Unit tests for `reorderArray`.                                                             |
| `styles.css`                       | 1 to 6 | Drag handle, grid, action strip, note line, name button, gear button. Use Obsidian CSS variables.    |
| `CHANGELOG.md`                     | 7      | Entries under `## [Unreleased]`.                                                                     |

### Module rules (recap from AGENTS.md §2)

- `src/domain/`: no `obsidian` imports.
- `src/ui/`: may import from anywhere.
- The extracted `ConfirmModal` and `ExerciseSuggestModal` move to `src/ui/`;
  `reorderArray` lives in `src/domain/`.

## 4. Phased Build Order

Phases are sequential. Every phase touches `src/ui/workout-editor-view.ts`, so parallel
execution would conflict. Each phase ends with one conventional commit describing the
user-visible change.

### Phase 1: Main-area leaf and editable workout name

**Output:** Editor opens in a main-area tab; the header has an editable `name` field
bound to frontmatter.

1. `src/main.ts`, the open command currently calls
   `app.workspace.getRightLeaf(false) ?? app.workspace.getLeaf(true)`. Replace with:
   - If a `VIEW_TYPE_FITKIT_WORKOUT_EDITOR` leaf already exists, reveal it via
     `app.workspace.revealLeaf(...)`.
   - Otherwise call `app.workspace.getLeaf(false)` to use the active main pane (or a new
     tab if a markdown file is active and dirty).
   - Drop `getRightLeaf` entirely.
2. `WorkoutEditorView.renderHeader`: replace the `name` segment in the `meta` text with a
   real `<input>` (use `createEl('input', ...)`). Bind to `model.name`. On `input`,
   update `model.name` and call `markDirty()`. Keep the `<h3>` file basename; keep the
   `date` segment as read-only meta text in this phase.
3. Do not refactor unrelated code; behavioral surface stays the same elsewhere.

**Acceptance:**

- `Open today's workout` opens a tab in the main area regardless of right-sidebar state.
- Editing the name input persists to frontmatter `name` after autosave; reopening the
  file reflects the saved name.
- Lint, format, build, tests all clean.

### Phase 2: Per-card gear menu and ConfirmModal extraction

**Output:** A single per-card gear button replaces the strength/duration toggle and the
Remove button. Remove routes through a confirmation modal.

1. Extract the embedded `ConfirmModal` (currently around line 810 of
   `src/ui/workout-editor-view.ts`) into `src/ui/confirm-modal.ts`. Lift verbatim, do not
   refactor. Update the existing kind-switch call site to import from the new module.
2. In `renderExerciseCard`'s top row: remove the strength/duration buttons and the
   Remove button. Add a single gear button via `setIcon(btn, 'settings')` from `obsidian`.
   Set `aria-label="Exercise options"`.
3. Wire the gear to an Obsidian `Menu` (import `Menu` from `obsidian`). Items, in order:
   - "Switch to strength" / "Switch to duration": only the inactive kind appears; the
     handler calls the existing `switchKind` flow (which already confirms when rows exist).
   - "Move up": calls `moveExercise(index, -1)`; disable at index 0.
   - "Move down": calls `moveExercise(index, +1)`; disable at the last index.
   - "Remove exercise": destructive label. Routes through `ConfirmModal` with copy:
     `Remove "<name>"? This cannot be undone.` Confirm calls the existing `removeExercise`.
4. Use `menu.showAtMouseEvent(evt)` from the click handler so the menu anchors near the
   gear icon.
5. Keep `moveExercise` and `removeExercise` private methods unchanged; this phase only
   changes how they are invoked.

**Acceptance:**

- Gear button is keyboard-focusable; Enter and Space open the menu.
- Remove never fires without confirmation.
- Move up / down still work; existing reorder semantics preserved.
- `npm run lint` clean (no new ESLint warnings, especially around Obsidian API rules).

### Phase 3: Drag-and-drop reorder + reorderArray helper

**Output:** Card reorder via a left-edge drag handle works on mouse and touch. The gear
menu's Move up / down items become a keyboard / accessibility fallback.

1. New file `src/domain/array-utils.ts`:

   ```ts
   export function reorderArray<T>(items: ReadonlyArray<T>, from: number, to: number): T[]
   ```

   Returns a new array with the element at `from` moved to position `to`. No-op when
   `from === to` or either index is out of range. Pure; no side effects.

2. New file `tests/array-utils.test.ts`: cover forward move, backward move, no-op,
   head and tail edges, out-of-range indices.
3. In `renderExerciseCard`, prepend a drag handle to `.fitkit-card-top`. Use
   `setIcon(handle, 'grip-vertical')`. Set `aria-label="Drag to reorder"` and `tabindex="0"`.
4. Pointer-events drag in a private helper `installCardDrag(card, index)`:
   - On `pointerdown` on the handle: call `handle.setPointerCapture(evt.pointerId)`,
     record the start coords and the card's index, add `is-dragging` to the card.
   - On `pointermove`: translate the dragged card by setting a CSS custom property via
     `card.style.setProperty('--fitkit-drag-offset', '<n>px')`. Compute the candidate
     target index by hit-testing sibling card center Y values.
   - Render a drop indicator (a single CSS-styled element) inserted into
     `.fitkit-exercise-list` at the candidate index.
   - On `pointerup` and `pointercancel`: release capture, remove `is-dragging`, remove
     the indicator. If the target index changed, set
     `this.model.exercises = reorderArray(this.model.exercises, from, to)`, then call
     `markDirty()` and `render()`.
5. Touch behavior: pointer events handle this. Verify on Obsidian iOS in Phase 7.
6. Register a fallback `pointerup` listener on `activeWindow` via `this.registerDomEvent`
   so a dropped pointer (iOS Safari off-viewport) still cleans the `is-dragging` state and
   the drop indicator.

**AGENTS.md §5 watchpoints:**

- No inline styles. The drag offset uses a CSS custom property set via JS, which is the
  documented escape hatch in the Obsidian eslint plugin. If the linter still flags it,
  fall back to a `data-fitkit-drag-offset` attribute and a CSS attribute selector. Do not
  silence the rule.
- Use `activeWindow` (not bare `window`) for any pointer fallbacks.

**Acceptance:**

- Drag-and-drop reorders cards on Obsidian desktop (mouse) and Obsidian mobile (touch).
- Releasing outside the list cancels (no reorder, no exception).
- `tests/array-utils.test.ts` passes.
- Keyboard users can still reorder via the gear menu's Move up / Move down items.

### Phase 4: Three-column rows, action strip, per-set delete confirm

**Output:** Strength rows render as three equal columns on every viewport. Per-set
delete asks for confirmation.

1. Update `renderStrengthTable` and `renderStrengthRow`:
   - Header row becomes `Set | Weight | Reps` only (drop the "Notes" header and the
     trailing empty header cell).
   - Each row is a 3-col CSS grid (`.fitkit-set-row`) for the inputs, then a separate
     `.fitkit-row-actions` strip after the grid (still inside the row container, but a
     sibling of the grid, not a fourth grid column).
   - Inputs unchanged behaviorally; only DOM structure and CSS shift.
2. Update `renderDurationTable` and `renderDurationRow`:
   - Header becomes `Set | Duration (s)`. The model has `set?: number` on duration
     entries already; show it. If undefined, derive `i + 1` for display only.
   - 2-col grid plus the same actions strip.
3. `.fitkit-row-actions` is a small flex strip with two icon buttons:
   - Pencil (note): placeholder in this phase; wired in Phase 5.
   - Trash (delete row): replaces the existing `X` text button.
4. Trash click: route through `ConfirmModal` with copy `Remove set <n>?` (or
   `Remove duration entry <n>?`). On confirm, run the existing splice logic.
5. CSS:
   - `.fitkit-set-row` switches to `display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--size-4-2);`.
   - `.fitkit-set-row.fitkit-duration-row` overrides to two columns.
   - Drop the existing `.is-narrow .fitkit-set-row` 2-col override; the 3-col grid is now
     the universal layout.
   - Action strip: `display: flex; gap: var(--size-4-1);` aligned trailing the row.
   - Trash button reuses `.fitkit-destructive-button` semantics (neutral at rest, error
     color on hover/focus per AGENTS.md §4); pencil is neutral.

**Acceptance:**

- Strength rows show three columns at iPhone-width viewports (manual + DevTools).
- Per-set delete prompts a confirm modal; cancel leaves data intact.
- Existing parser and serializer tests still pass (no model changes).
- No inline styles introduced.

### Phase 5: Per-set notes (pencil + modal + below-row render)

**Output:** Notes live behind a pencil icon; non-empty notes render below the row as
wrapping text and are tap-to-edit.

1. New file `src/ui/set-note-modal.ts`:

   ```ts
   export class SetNoteModal extends Modal {
     constructor(
       app: App,
       opts: {
         title: string
         initial: string
         onSave: (next: string | undefined) => void
       },
     )
   }
   ```

   - Renders one labeled `<textarea>` pre-filled with `initial`.
   - Save commits the value (empty string normalizes to `undefined`).
   - Cancel and close discard.

2. In `renderStrengthRow` and `renderDurationRow`:
   - Pencil button in `.fitkit-row-actions`: `setIcon(btn, 'pencil')`. Click opens
     `SetNoteModal` for the current row's `note`. On save, update `set.note` or
     `entry.note`, call `markDirty()`, and `render()`.
   - When `note` is non-empty, append a `.fitkit-note-line` element after the row but
     inside the per-row container. Render as plain wrapping text. Click on the line
     opens the same modal.
3. CSS `.fitkit-note-line`:
   - `font-size: var(--font-ui-smaller);`
   - `color: var(--text-muted);`
   - `padding: var(--size-4-1) var(--size-4-2);`
   - `cursor: pointer;`
   - Stretches the full width below the row.
4. Remove the per-row Notes text input (its header cell was already removed in Phase 4).

**Acceptance:**

- Empty rows show only the pencil icon (no note line, no trailing empty input).
- Saving a note re-renders the row with the muted text below; closing the modal without
  saving leaves state untouched.
- Tap on either the pencil icon or the rendered note opens the modal.
- Round-trip through the serializer preserves the note (existing parser tests cover
  this; verify no regression).

### Phase 6: Exercise rename via picker

**Output:** The free-text name input on each card becomes a click-to-pick button that
uses the existing exercise picker modal.

1. Extract `ExerciseSuggestModal` (currently around line 862 of
   `src/ui/workout-editor-view.ts`) and the `ExerciseChoice` type into
   `src/ui/exercise-suggest-modal.ts`. Lift verbatim. Update the existing
   `openAddExerciseModal` call site to import from the new module.
2. Replace the per-card name `<input>` in `renderExerciseCard` with a button-styled
   element (`.fitkit-name-button`). Render the current name as the button's text.
3. Click handler:
   - Build the suggestion list via the existing `collectExerciseSuggestions()` helper.
   - Open `ExerciseSuggestModal` with the current name pre-populated in the search
     input (set `modal.inputEl.value` after `open()`).
   - On pick: update `ex.name` to the chosen value, call `markDirty()` and `render()`.
4. The "Add 'Foo'" path continues to work for renames (changing a card to a brand-new
   name without creating an exercise note, matching the v0.1.0 Q4 contract).

**Acceptance:**

- Tapping a card's name opens the picker pre-filled.
- Selecting an existing exercise updates the card's name and persists.
- Selecting "Add 'Foo'" sets the card's name to `Foo` without creating an exercise note.
- The existing Add Exercise footer button continues to work.

### Phase 7: QA, CHANGELOG, ship-prep

**Output:** Releasable feature.

1. Run `npm run lint && npm run format:check && npm run build && npm test`. Fix any drift.
2. Manual QA on `/Users/paul/dev-misc/dev-vault/dev/`:
   - Open `2026-04-19.md` (strength) and `2026-04-09.md` (duration); cards render with
     the new layout.
   - Drag-reorder two exercises; reload the file; order persists.
   - Open the gear; switch a kind on a non-empty card; confirm modal fires and rows clear.
   - Remove an exercise via gear; confirm modal fires; cancel leaves data; confirm
     removes.
   - Per-set trash; confirm modal fires.
   - Edit a set note; verify below-row render; reopen and re-edit.
   - Edit the workout name in the header; verify frontmatter on disk.
   - Rename an exercise via picker; pick an existing one and a brand-new one.
   - Mobile smoke on Obsidian iOS: drag, gear, picker, note modal.
3. `CHANGELOG.md` `## [Unreleased]`:
   - Added: per-card gear menu; drag-and-drop reorder; editable workout name; per-set
     notes via modal; exercise rename via picker.
   - Changed: workout editor opens in the main area; strength rows are three equal
     columns at all widths.
   - Removed: legacy Up / Down buttons; legacy X exercise-remove button; inline
     strength / duration toggle buttons; inline per-row notes input.
4. PR carries `minor` label per AGENTS.md §6.

## 5. Subagent Sequencing

Phases run sequentially because every phase touches `src/ui/workout-editor-view.ts`.
Each phase is one subagent invocation:

| Phase | Subagent prompt mentions                                                       |
| ----- | ------------------------------------------------------------------------------ |
| 1     | Goal §1.1 and §1.4. Main-area leaf change in `src/main.ts`. Name input header. |
| 2     | Goal §1.2. Extract `ConfirmModal`. Build `Menu`. Remove confirm.               |
| 3     | Goal §1.3. `reorderArray` plus tests. Pointer-events drag with handle.         |
| 4     | Goal §1.5 and §1.8. 3-col grid. Trash routes through confirm.                  |
| 5     | Goal §1.6. `SetNoteModal`. Below-row note render.                              |
| 6     | Goal §1.7. Extract `ExerciseSuggestModal`. Rename via picker.                  |
| 7     | QA pass. CHANGELOG entries. Final lint, format, build, test.                   |

Each subagent must commit with a conventional commit message, run the four-command
acceptance gate, and stop. The orchestrator reviews the diff before dispatching the next
phase.

## 6. Risks

- **Pointer-events drag on iOS.** Pointer capture sometimes drops on iOS Safari for
  touches that move outside the viewport. Mitigation: register a fallback `pointerup` on
  `activeWindow` via `this.registerDomEvent`; ensure the cleanup path always removes
  `is-dragging` and the drop indicator.
- **Inline-style lint trap.** The drag offset uses a CSS custom property set via JS. If
  `obsidianmd/no-inline-styles` flags it, switch to a `data-fitkit-drag-offset`
  attribute paired with a `[data-fitkit-drag-offset]` CSS rule. Do not silence the rule.
- **Menu API on mobile.** Obsidian's `Menu` opens differently on mobile. Smoke test in
  Phase 7 before claiming the gear menu works end-to-end.
- **CSS regression at narrow widths.** The 3-col grid replaces the existing `.is-narrow`
  2-col override. Test narrow viewports to ensure inputs are still usable on iPhone-width
  screens.
- **Modal extraction without behavior drift.** `ConfirmModal` and `ExerciseSuggestModal`
  both hold subtle state (the settled flag, the keydown handler). Lift verbatim; do not
  refactor while extracting.

## 7. Out-of-band reminders

- AGENTS.md §7: conventional commits; sentence case; imperative.
- AGENTS.md §8 highlights: no em dashes; no `console.log`; JSDoc blocks not stacked `//`;
  no inline styles; no `document.createElement` (use `createEl` / `createDiv`).
- AGENTS.md §9: this plan is append-only once shipped. Do not edit substance after merge.
- `CHANGELOG.md` `## [Unreleased]` entries are mandatory; PR label `minor`.
