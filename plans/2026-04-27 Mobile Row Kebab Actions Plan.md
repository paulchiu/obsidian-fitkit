---
status: approved
target: v0.5.0
date: 2026-04-27
branch: feature/mobile-row-kebab-actions
---

# FitKit v0.5.0 Mobile Row Kebab Actions Plan

## Audience

This plan is written for coding subagents (Claude Code, Codex, etc.) and the human
reviewer. The PR is one branch, one PR, with the code change and CHANGELOG bullet
landing as a single atomic commit, matching the most recent plan convention for small
scope.

**Authoritative inputs:**

- Coding standards: `/Users/paul/dev-misc/obsidian-fitkit/AGENTS.md`
- Prior plan format:
  `/Users/paul/dev-misc/obsidian-fitkit/plans/2026-04-27 v0.4.2 Mobile Leaf Iterate Root Leaves Plan.md`
- Source file:
  `/Users/paul/dev-misc/obsidian-fitkit/src/ui/workout-editor-view.ts`
- Changelog format: `/Users/paul/dev-misc/obsidian-fitkit/CHANGELOG.md`
- User-reported behaviour (2026-04-27): on iOS, swipe-right on a workout row
  collides with Obsidian's left-drawer gesture, and swipe-left collides with
  Obsidian's right-drawer gesture.

## 1. Goal & Success Criteria

On Obsidian Mobile, row actions are discoverable and tappable without horizontal swipe
gestures. The existing per-row kebab menu becomes the row-action entry point on mobile
and desktop.

**Definition of done for 0.5.0:**

- On Obsidian Mobile, every strength set row renders the kebab button.
- On Obsidian Mobile, every duration entry row renders the kebab button.
- On Obsidian Mobile, tapping the kebab opens the existing menu with Edit note and Delete
  row.
- On Obsidian Mobile, horizontal swipes on rows no longer trigger Edit note or Delete row.
- On desktop, the kebab remains present and the existing Edit note and Delete row menu
  behaviour is unchanged.
- On desktop, the kebab remains keyboard-reachable through the native button and keeps
  the existing `aria-label`.
- `npm run lint && npm run format:check && npm run build && npm test` pass on the final
  implementation commit.
- PR carries the `minor` label for target `v0.5.0`.
- CHANGELOG `## [Unreleased]` lists the user-visible removal under `### Removed`.

## 2. Scope In / Out

**In for 0.5.0:**

- Update `renderRowActions` so `renderRowKebab(body, opts.label, openNoteModal,
triggerDelete)` runs on both desktop and mobile.
- Remove the current mobile-only swipe install path from `renderRowActions`.
- Remove the `Platform` import from `src/ui/workout-editor-view.ts` if it has no other
  use after the branch is removed.
- Remove the now-unused `installRowSwipe` helper.
- Remove swipe-only CSS, including the reveal selectors and the `touch-action: pan-y`
  rule on `.fitkit-row-body`. That rule was only needed for pointer-driven swipe and
  could keep horizontal gestures from reaching Obsidian even after the pointer handlers
  are gone.
- Add one CHANGELOG bullet under `## [Unreleased]` `### Removed`. Suggested bullet:
  `Workout editor: Removed mobile row swipe gestures because they conflict with
Obsidian's iOS drawer gestures; use the row kebab menu for Edit note and Delete row.`

**Out (deferred):**

- Long-press row actions.
- Tap-the-set-cell actions.
- Row-input squaring or other density changes.
- A settings toggle for swipe, kebab, long-press, or platform-specific row actions.
- Changing the existing menu labels, icons, note modal, or delete confirmation flow.
- Changing workout serialization, autosave, registry logic, or dashboard generation.

## 3. Context

### Current code shape

`renderRowActions` in `src/ui/workout-editor-view.ts` currently creates two shared action
callbacks, `openNoteModal` and `triggerDelete`, then branches on platform:

```ts
if (Platform.isMobile) {
  this.installRowSwipe(container, body, openNoteModal, triggerDelete)
} else {
  this.renderRowKebab(body, opts.label, openNoteModal, triggerDelete)
}
```

That means `renderRowKebab` already exists, but it is desktop-only because the call site
excludes mobile. The mobile path installs `installRowSwipe`, which wraps the row body in a
swipe track, renders a Note / Delete reveal layer, and commits actions after an 80 px
horizontal threshold.

`renderRowKebab` itself creates a native button with class `fitkit-row-kebab`, type
`button`, and an `aria-label` of `Options for ${label}`. Its menu entries already call
the same note and delete callbacks that swipe uses. Reusing it on mobile therefore keeps
action semantics aligned across platforms.

### Decision

Drop the mobile exclusion around `renderRowKebab`. The kebab should render on both
platforms.

Remove mobile swipe entirely for this release. The swipe gestures added in 0.4.0 are
broken on iOS because their horizontal direction conflicts with Obsidian's left and right
drawer gestures. Weakening thresholds would still leave the gesture fighting the host app,
and adding a settings toggle would preserve a broken default. The mobile default should
be the explicit kebab menu.

Do not add desktop swipe as part of this fix. Desktop already has the kebab, and adding a
new desktop swipe affordance would be a separate feature with its own testing surface.
Since no platform should install swipe in this plan, delete `installRowSwipe` and its
associated swipe CSS in the same commit.

### Interaction notes

Removing mobile swipe avoids the concurrent swipe plus kebab tap problem on mobile. A tap
on the kebab remains a normal button click rather than competing with row-level pointer
capture.

Desktop regression risk is low because desktop already uses `renderRowKebab`; the
implementation should preserve the existing menu construction and button attributes.
Manual smoke still needs to confirm the desktop menu opens by mouse and keyboard after
the branch is simplified.

## 4. Phased Build Order

### Phase 1. Render the kebab on mobile and remove mobile swipe (single commit)

**Prereq:** branch `feature/mobile-row-kebab-actions` checked out off base commit
`40f52c9c1633e8d89b5931f3177b49898ff11518`. **Output:** one commit.

1. In `src/ui/workout-editor-view.ts`, change `renderRowActions` so it always calls
   `renderRowKebab(body, opts.label, openNoteModal, triggerDelete)`.
2. Remove the `Platform.isMobile` branch from `renderRowActions`.
3. Remove the `Platform` import if unused.
4. Remove `installRowSwipe`.
5. Remove swipe-only CSS selectors from `styles.css`, including
   `.fitkit-row-track`, `.fitkit-row-reveal*`, `.fitkit-row.is-swipe-*`, and the
   `.fitkit-row-body` `touch-action: pan-y` declaration.
6. Edit `CHANGELOG.md`: under `## [Unreleased]` `### Removed`, add the mobile swipe
   removal bullet.
7. Run the full implementation gate:
   `npm run lint && npm run format:check && npm run build && npm test`.
8. Commit:
   ```text
   fix(editor): Use row kebab actions on mobile
   ```

**Acceptance:**

- The implementation commit changes only `src/ui/workout-editor-view.ts`, `styles.css`
  if dead swipe styles are removed, and `CHANGELOG.md`.
- Strength and duration rows both get the same kebab behaviour.
- No mobile row swipe path remains active.
- No long-press, set-cell tap, row-input sizing, or settings-toggle work is included.

**Risks:**

- Mobile horizontal space: the kebab adds a 28 px button plus the existing 6 px gap to
  each row. Defer input squaring unless manual smoke proves the row no longer fits.
- CSS cleanup: removing swipe CSS is safe only after confirming no classes are still
  emitted. Use `rg "is-swipe|fitkit-row-track|fitkit-row-reveal|touch-action"` before
  deleting or changing the selectors.
- Accessibility: native button semantics are already present, but manual desktop smoke
  should verify keyboard activation still opens the menu.

## 5. Test / Gate Plan

Implementation gate for the future code commit:

```text
npm run lint && npm run format:check && npm run build && npm test
```

Manual smoke (out-of-band; run against a dev vault after the implementation is built):

- iOS, strength row: tap the kebab. Expected: menu opens with Edit note and Delete row.
- iOS, duration row: tap the kebab. Expected: menu opens with Edit note and Delete row.
- iOS, strength and duration rows: horizontal swipes no longer reveal or trigger Note /
  Delete. Obsidian drawer gestures should behave normally.
- iOS, Edit note: choose the menu item, save a note, and confirm the note line renders
  and remains tappable.
- iOS, Delete row: choose the menu item, confirm the modal, and confirm the correct row
  is removed.
- Desktop, mouse: click the kebab on strength and duration rows. Expected: existing menu
  behaviour is unchanged.
- Desktop, keyboard: tab to the kebab and press Enter or Space. Expected: the menu opens.

Planning-only gate for this plan-file pass:

```text
npm run format:check
npm run lint
```

Do not run build or tests during the planning-only pass.

## 6. Out-of-band reminders

- This is a single-commit change because the scope is small and recent repo convention
  collapses small code plus CHANGELOG changes into one commit.
- CHANGELOG goes under `### Removed` because mobile row swipe gestures are removed, not
  merely softened.
- PR carries `minor` to match target `v0.5.0`.
- Do not edit older files under `plans/`; they are historical records.
- Do not commit `main.js`, `data.json`, or `node_modules`.

## Review round-trip

Self-review found that the mobile exclusion is not inside `renderRowKebab`; it is the
`Platform.isMobile` branch in `renderRowActions`. The plan was already written around the
call site, so no correction was needed there.

Self-review found that swipe removal must include CSS, not only pointer handlers. The
plan now explicitly removes reveal selectors plus the row-body touch-action declaration,
so row bodies do not keep suppressing horizontal gestures.

Self-review checked the main edge cases: concurrent swipe plus kebab tap, desktop
regression, and keyboard access. The plan now relies on removing swipe entirely, preserving
desktop's existing native button path, and keeping manual mouse plus keyboard smoke tests.

Self-review checked scope creep against the requested minimal scope. Long-press,
tap-the-set-cell, row-input squaring, and settings toggles remain explicitly deferred.
