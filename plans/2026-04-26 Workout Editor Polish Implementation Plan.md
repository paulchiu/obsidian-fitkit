---
status: draft
target: v0.4.0
date: 2026-04-26
branch: feature/workout-editor-polish
---

# Workout Editor Polish Implementation Plan

## Audience

Coding subagents (Claude Code, Codex) and the human reviewer. Each phase fits one
subagent invocation. All phases land on `feature/workout-editor-polish`.

**Authoritative inputs:**

- `AGENTS.md`: coding standards, Obsidian-specific guidance, destructive-UI rule, plan conventions.
- `src/ui/workout-editor-view.ts`: the file most UI work targets.
- `src/domain/exercise-registry.ts`: the canonical source for exercise kind by name.
- `plans/2026-04-26 Workout Editor Redesign Implementation Plan.md`: just-shipped
  predecessor; this plan is a polish pass on its results.

**Acceptance gate (every phase):** `npm run lint && npm run format:check && npm run build && npm test`
clean before commit. Conventional commits, sentence case, imperative mood (AGENTS.md §7).

## 1. Goal & Success Criteria

Polish the redesigned workout editor along four axes:

1. **Kind follows the registry on add and rename.** When the user picks an exercise from the
   suggest modal (whether adding a new card or renaming an existing one), the resulting card's
   `kind` is taken from the registry entry that matches the picked name. Unknown names fall
   back to `'strength'` (current behaviour) but a known-duration entry no longer silently
   becomes a strength card.
2. **Switching kind seeds an empty row.** After the gear-menu "Switch to strength/duration"
   path clears the prior rows, the editor seeds the now-active table with one empty row so the
   user can start typing immediately.
3. **Card top-row controls share a height.** The drag handle, exercise-name button, and gear
   button visually align as a single horizontal strip (same height, same vertical alignment).
4. **Per-row actions stop consuming a separate row.** The pencil and trash buttons currently
   occupy a `fitkit-row-actions-strip` flex row beneath each set/duration row. Replace that
   strip with an inline overflow kebab on the row plus a touch swipe gesture (right = note,
   left = delete) so vertical density matches a typical Obsidian table.

**Definition of done:**

- All criteria above hold against the dev-vault
  (`/Users/paul/dev-misc/dev-vault/dev/Fitness/Workouts/`) on desktop and Obsidian mobile (manual smoke).
- `npm run lint && npm run format:check && npm run build && npm test` all clean.
- `CHANGELOG.md` `## [Unreleased]` lists user-visible changes; PR carries `minor` label.

## 2. Scope (In / Out)

**In:**

- Lookup helper that resolves an exercise name to a kind from `plugin.settings.exerciseRegistry`
  plus the vault-derived bootstrap registry, reusing `resolve()` in `src/domain/exercise-registry.ts`.
- Wiring that helper into the add-exercise and rename-exercise flows of `WorkoutEditorView`.
- Seeding logic for `applyKindSwitch` so the post-switch card has one blank set/duration row.
- CSS adjustments for the card top row (uniform height, alignment).
- Replacement of `.fitkit-row-actions-strip` with an inline overflow kebab and a pointer-events
  swipe gesture on the row.
- New unit tests for the kind-lookup helper (pure module).
- Manual QA matrix update.

**Out:**

- Any change to the underlying workout note serialization or frontmatter contract.
- Any change to autosave, conflict detection, or file-session behaviour.
- Any change to importer flows or the dashboard.
- Any change to the parse-diagnostics or create-missing-exercises modals.
- A keyboard alternative for the new swipe gesture beyond what the kebab menu already provides.
  (The kebab is the keyboard-accessible path; swipe is touch-only sugar.)

## 3. Architectural Notes

- **Registry access from the view.** `WorkoutEditorView` already owns a reference to the
  plugin (`this.plugin`). The plugin's `settings.exerciseRegistry` plus the vault scan via
  `exerciseRegistryWithVaultNotes` (in `src/vault/exercise-registry-vault.ts`) cover both
  user-curated entries and bootstrapped stems. The lookup helper is a pure function over
  `ExerciseRegistryEntry[]` so it can be unit-tested without `App`.
- **Kind seeding.** `applyKindSwitch` already flips `ex.kind` and clears both arrays. The
  seed is a one-line addition: push `{ set: 1 }` to `strengthSets` or `{}` to `durationEntries`
  depending on the new kind. The same seeding is already used by `openAddExerciseModal`.
- **Top-row alignment.** The drag handle and gear button are 32 x 32. The name button has
  variable height because it inherits its size from `padding + line-height`. Pinning all
  three to a shared `--fitkit-card-control-size` (32 px) and centring with `align-items: center`
  on `.fitkit-card-top` (already set) is enough.
- **Swipe gesture.** Pointer Events API. The row container is the swipe surface; a
  `pointerdown` on an `<input>` is ignored so editing still works. On `pointermove`, translate
  the row by `dx`; reveal a tinted action layer on the opposite side. On `pointerup`, if `|dx|`
  exceeds a threshold (e.g. 80 px), commit the action; else snap back. This piggybacks on the
  same `activeWindow` event lifetime pattern already used for drag-and-drop.
- **Kebab overflow.** A single `setIcon('more-vertical')` button placed as a fourth grid
  column on `.fitkit-set-row` (3 + actions for strength, 2 + actions for duration). Opens an
  Obsidian `Menu` with Note + Delete entries, matching the card-level gear menu.

## 4. Phases

### Phase 1 - Registry-aware kind selection

**Files:**

- `src/domain/exercise-registry.ts` (add `kindForName(registry, name): ExerciseKind | null`).
- `tests/exercise-registry.test.ts` (new or extend; cover match, alias-match, unknown).
- `src/ui/workout-editor-view.ts` (use the helper in `openAddExerciseModal` and
  `openRenameExerciseModal`).
- `src/ui/workout-editor-view.ts` collects suggestions via `collectExerciseSuggestions`; the
  kind lookup needs the matching `ExerciseRegistryEntry[]`, which means either (a) pass through
  the merged registry from `exerciseRegistryWithVaultNotes`, or (b) add a sibling helper that
  returns `[entries, names]`. Option (a) is simpler.

**Acceptance:**

- New unit tests pass.
- Add Exercise: picking a duration-registered name produces a card with `kind: 'duration'` and
  one empty duration row.
- Rename Exercise: picking a duration-registered name updates `card.kind` to `'duration'` and
  clears `strengthSets` / seeds `durationEntries` (mirrors the gear-menu switch behaviour).
- Unknown names fall back to `'strength'`.

### Phase 2 - Switch-kind seeds an empty row

**Files:** `src/ui/workout-editor-view.ts` (`applyKindSwitch`).

**Change:** after `ex.strengthSets = []; ex.durationEntries = []`, push `{ set: 1 }` to
`strengthSets` or `{}` to `durationEntries` based on `nextKind`. Re-render after.

**Acceptance:**

- Switching strength to duration leaves exactly one empty duration row.
- Switching duration to strength leaves exactly one empty strength row with `set: 1` so the
  Set column is pre-populated.
- Reload from disk after switch + autosave persists the empty row only if the user has
  edited it; otherwise serialization should still match prior behaviour (the existing
  serializer already drops zero-valued strength rows; verify this hasn't regressed).

### Phase 3 - Uniform card top-row height

**Files:** `styles.css` (`.fitkit-card-top`, `.fitkit-name-button`, `.fitkit-drag-handle`,
`.fitkit-gear-button`).

**Change:** Introduce `--fitkit-card-control-size: 32px` on `.fitkit-card-top`. Pin the drag
handle, name button, and gear button to that height. Keep `.fitkit-name-button` flex-growing.

**Acceptance:**

- Visual diff: all three controls are exactly the same height at desktop and 360 px viewport.
- Name button text remains vertically centred.
- Hit area for the drag handle and gear button stays usable on touch (>= 32 px).

### Phase 4 - Inline kebab + swipe-to-action

**Files:**

- `src/ui/workout-editor-view.ts` (`renderRowActions` rewrite, swipe wiring, kebab menu).
- `styles.css` (new `.fitkit-row-kebab`, `.fitkit-row-swipe-surface`, action-reveal styles).
- `CHANGELOG.md`.

**Change:**

- Drop `.fitkit-row-actions-strip` and the two large 44 x 44 buttons.
- Add a single `.fitkit-row-kebab` button placed in a fourth grid column on `.fitkit-set-row`
  (and `.fitkit-duration-row`). It opens an Obsidian `Menu` with two items: "Edit note" and
  "Delete row" (the latter `setWarning(true)`).
- Wrap the row's input grid in a swipe-detecting wrapper. On touch pointerdown originating
  outside the inputs, track horizontal delta. Translate the row via a CSS variable on
  `pointermove`. On `pointerup`:
  - dx > +threshold ([recommend 80 px]): trigger note-edit modal.
  - dx < -threshold: trigger delete confirm.
  - else: animate back to 0.
- Feedback layer: position absolute behind the row, showing "Note" on the left edge and
  "Delete" on the right edge, revealed only as the row translates.
- Accessibility: keyboard users get the kebab menu (Tab-reachable, Enter opens). Swipe is a
  bonus for touch.

**Open questions (please confirm before Phase 4 lands):**

- **Q1.** Direction mapping: should swiping right open the note modal (revealing "Note" on
  the LEFT, the typical iOS Mail "info" gesture) and swiping left fire the delete confirm
  (revealing "Delete" on the RIGHT, the typical iOS Mail "delete" gesture)? Or the inverse?
  The iOS-native mapping is the recommendation; iOS-native is also what Obsidian Mobile users
  will reach for.
- **Q2.** Threshold and animation. 80 px feels right on phone-sized cards; below 80 px snaps
  back. Alternatively, a 50% width threshold matches iOS Mail's "swipe past halfway to
  auto-trigger". Recommend fixed 80 px to keep the gesture feel consistent across viewport
  widths.
- **Q3.** Should the kebab show on desktop only (touch users get swipe and no kebab), or
  always (desktop and touch)? Recommend always; the kebab is the keyboard-accessible path and
  hiding it on touch removes that fallback.

**Acceptance:**

- Each row collapses to a single line on desktop (no separate action strip beneath).
- Right-edge kebab opens a 2-item Obsidian `Menu`; both entries fire the existing handlers
  (note modal, delete confirm modal).
- On mobile, swipe past threshold triggers the same handlers; below threshold animates back.
- Non-empty `set.note` continues to render as the existing `.fitkit-note-line` below the row,
  unchanged. Tapping it opens the note modal pre-filled (existing behaviour).

### Phase 5 - Manual QA + changelog

**Files:**

- `CHANGELOG.md` under `## [Unreleased]`.
- A short addendum to the prior `Codex UI Test Prompt for Workout Editor Redesign` checklist
  saved to `~/dev/sandbox/2026-04-26 Codex UI Test Prompt for Workout Editor Polish.md`,
  covering the four polish items.

**Acceptance:**

- `CHANGELOG.md` lists: registry-driven kind on add/rename; auto-seed row after kind switch;
  uniform top-row controls; swipe-to-action with overflow kebab.
- `npm run lint && npm run format:check && npm run build && npm test` all clean.
- PR opens with the `minor` label.

## 5. Risks & Mitigations

- **Registry false matches.** Aliases on a registry entry can collide with the canonical name
  of another entry. Mitigation: `resolve()` already returns `'ambiguous'` for that case; treat
  ambiguous as "no determination, fall back to strength".
- **Swipe vs. drag conflict.** Card-level vertical drag uses the left grip handle; the row
  swipe is horizontal on the row body. Different surfaces, different axes; should not
  conflict. Mitigation: explicitly check `evt.target` to ensure pointerdown is not on an input.
- **iOS scroll hijack.** A horizontal swipe must not block vertical scroll. Mitigation:
  release pointer capture and abort the gesture if the absolute vertical delta exceeds the
  horizontal delta within the first 16 px.
- **Accessibility regression.** Removing visible action buttons reduces affordance. Mitigation:
  the kebab stays visible at all viewports; it carries `aria-label="Row options"`.

## 6. Out-of-scope follow-ups

- Editor-side display of the registry-derived kind on the card before save (e.g. an icon).
- Long-press alternative gesture on touch.
- Confirm-on-undo for swipe-to-delete (current behaviour: tap Delete in the kebab also fires
  ConfirmModal, so swipe will too).
