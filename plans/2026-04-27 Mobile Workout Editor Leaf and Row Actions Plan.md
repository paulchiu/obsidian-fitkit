---
status: draft
target: v0.4.1
date: 2026-04-27
branch: feature/mobile-editor-main-area-leaf
---

# FitKit v0.4.1 Mobile Workout Editor Leaf and Row Actions Plan

## Audience

This plan is written for coding subagents (Claude Code, Codex, etc.) and the human reviewer. The PR is one branch, one PR, with the in-scope change landing as a single atomic commit. A second commit may add the matching CHANGELOG entry. Part 2 is explicitly deferred: it lives at the bottom of this document as a post-merge follow-up so the in-scope change ships small.

**Authoritative inputs:**

- Coding standards: `/Users/paul/dev-misc/obsidian-fitkit/AGENTS.md`
- Prior plan format: `/Users/paul/dev-misc/obsidian-fitkit/plans/2026-04-26 v0.2.1 Implementation Plan.md`
- User-reported behaviour (2026-04-27): on Obsidian Mobile, `Open today's workout` always opens the editor in a side / right leaf. The desktop case is fine.
- User-reported behaviour (2026-04-27): swipe-right-to-edit and swipe-left-to-delete on row gestures are hard to perform on mobile, especially when the editor sits in a side leaf where the swipe-from-edge gesture conflicts with the iOS drawer.

## 1. Goal & Success Criteria

When the user runs `Open today's workout` or `Open workout editor for current file` on Obsidian Mobile, the editor opens in the main area (`workspace.rootSplit`) by default, not in a side leaf. When an existing editor leaf is already open, the main-area leaf is preferred; any sidebar leaf is a fallback.

**Definition of done for 0.4.1:**

- On Obsidian Mobile (real device, manual smoke), running `Open today's workout` from a clean state opens the editor in the main area.
- On Obsidian Mobile, running `Open workout editor for current file` from a clean state also opens in the main area.
- On Obsidian Mobile, running either command after closing the editor opens it in the main area again.
- On Obsidian Mobile, running either command while the editor is already open in the main area reveals that leaf (no duplicate).
- On Obsidian Mobile, running either command while the editor is stranded in a sidebar (e.g., a pre-upgrade state) reveals the sidebar leaf rather than creating a duplicate. Next fresh open after that leaf is closed will land in main area.
- On desktop, the behaviour is unchanged for the common case (a tab in the main area).
- `npm run lint && npm run format:check && npm run build && npm test` pass on the final commit.
- PR carries the `patch` label.
- CHANGELOG `## [Unreleased]` lists the user-visible fix under `### Fixed`.

## 2. Scope (In / Out)

**In for 0.4.1:**

- Replace the `getLeaf(false)` call inside `openWorkoutEditor` (`src/main.ts:154-163`) with a strategy that targets the main area on both desktop and mobile.
- Add a one-line JSDoc above the leaf-selection lines explaining the non-obvious choice (why we use `'tab'` instead of `false`).
- One CHANGELOG bullet under `### Fixed`.

**Out (deferred to post-merge follow-up, see §6):**

- Mobile row-action ergonomics (swipe alternatives, kebab column, long-press, tap-the-set-cell). Not in this PR. The leaf fix is expected to defuse the worst of the side-leaf swipe pain on its own; revisit ergonomics after observing real usage on mobile.
- Squaring the row inputs (smaller `border-radius`, tighter padding) to free horizontal space. Tied to the row-action work, deferred with it.
- Settings-tab control to choose desktop vs. mobile leaf preference. Not asked for; would add surface area for a one-line internal change.
- Any other workout editor changes (gear menu, drag-and-drop, kind switch, etc.). Out of scope.

## 3. Context

### Current behaviour

`src/main.ts:154-163`:

```ts
private async openWorkoutEditor(file: TFile): Promise<void> {
  const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_FITKIT_WORKOUT_EDITOR)[0]
  const leaf = existing ?? this.app.workspace.getLeaf(false)
  await leaf.setViewState({ type: VIEW_TYPE_FITKIT_WORKOUT_EDITOR, active: true })
  await this.app.workspace.revealLeaf(leaf)
  const view = leaf.view
  if (view instanceof WorkoutEditorView) {
    await view.loadFile(file)
  }
}
```

`workspace.getLeaf(false)` returns the most-recently-active leaf. On desktop this is almost always a leaf inside `rootSplit` (the main area). On Obsidian Mobile, however, the active leaf is whatever the user last touched, and the side drawers (left and right sidebars) carry their own active leaf. If the command palette is invoked from the side drawer, or if the side drawer was the last thing focused, `getLeaf(false)` returns a sidebar leaf. The editor then loads inside the drawer and the user has to drag it back to the main area manually.

### Target behaviour

Use a three-step selection:

1. Find all existing editor leaves (`getLeavesOfType(VIEW_TYPE_FITKIT_WORKOUT_EDITOR)`).
2. Prefer a leaf whose root is `workspace.rootSplit` (main area); fall back to the first leaf found if none are in main.
3. If no existing editor leaf exists at all, create a new tab with `getLeaf('tab')`, which always targets `rootSplit`.

This means a user upgrading from the old code, whose editor is stranded in a sidebar, still has that leaf revealed on the first run (no duplicate). On the next fresh open after they close it, the new tab lands in main area.

### Why not `getMostRecentLeaf(rootSplit)`

`getMostRecentLeaf(workspace.rootSplit) ?? getLeaf('tab')` is a tempting alternative. It would replace whatever main-area leaf the user last viewed (e.g., a journal note) with the workout editor, losing that leaf's prior state. `getLeaf('tab')` opens a fresh tab next to the current main-area tab, preserving the user's other open notes. That matches user expectation for a command-palette-invoked editor.

## 4. Phased Build Order

### Phase 1. Switch leaf strategy and document the choice (sequential, single commit)

**Prereq:** branch `feature/mobile-editor-main-area-leaf` checked out off `main`. **Output:** one commit.

1. In `src/main.ts:154-163`, replace the two-line `existing` / `leaf` selection with the three-step strategy. Suggested replacement (add a one-sentence JSDoc above, no stacked `//`):
   ```ts
   /** Prefer a rootSplit leaf so both commands open in the main area on mobile, not in a drawer. */
   const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_FITKIT_WORKOUT_EDITOR)
   const existing = leaves.find((l) => l.getRoot() === this.app.workspace.rootSplit) ?? leaves[0]
   const leaf = existing ?? this.app.workspace.getLeaf('tab')
   ```
2. Run the full gate: `npm run lint && npm run format:check && npm run build && npm test`.
3. Commit:
   ```
   fix(editor): Open workout editor in main area on Obsidian Mobile
   ```

**Acceptance:**

- Gate passes.
- `git diff HEAD~..HEAD -- src/main.ts` is small: the three-line replacement plus the JSDoc.
- No other files changed in this commit.

**Risks:**

- `getLeaf('tab')` always creates a new tab, whereas `getLeaf(false)` may reuse the current empty tab on desktop. The `existing` short-circuit covers the "editor already open" case, so the only desktop-visible change is that running the command from an empty new tab now opens a sibling tab instead of reusing that empty one. Acceptable.
- `WorkspaceLeaf.parent` may be `WorkspaceMobileDrawer` on mobile; `revealLeaf` will bring a drawer leaf forward rather than moving it. This is intentional: the first run after upgrade reveals the stranded leaf where it sits; next fresh open lands in main area.

### Phase 2. CHANGELOG bullet (sequential, single commit)

**Prereq:** Phase 1. **Output:** one commit.

1. Edit `CHANGELOG.md`: under `## [Unreleased]` `### Fixed`, add the bullet:
   - `Workout editor: Open today's workout and Open workout editor for current file now open the editor in the main area on Obsidian Mobile instead of a side leaf.`
2. No date prefix on the bullet (per AGENTS.md §6).
3. Run the gate.
4. Commit:
   ```
   docs(changelog): Note mobile main-area leaf fix
   ```

**Acceptance:**

- The new bullet is the only change under `## [Unreleased]`.
- Gate passes.

## 5. Test / Gate Plan

Every phase ends with:

```
npm run lint && npm run format:check && npm run build && npm test
```

Manual smoke (out-of-band; not part of CI):

- Obsidian Mobile, fresh launch: tap into the right drawer, then run `Open today's workout` from the command palette. Expected: editor opens in the main area, not in the drawer.
- Obsidian Mobile, fresh launch: tap into the right drawer, then run `Open workout editor for current file` on an open workout note. Expected: same as above, main area.
- Obsidian Mobile, editor already open in main area: run either command. Expected: existing leaf is revealed, no duplicate.
- Obsidian Mobile, editor stranded in a sidebar (simulating pre-upgrade state): run either command. Expected: existing sidebar leaf is revealed (no duplicate). Close it, then run the command again. Expected: new leaf opens in main area.
- Desktop: run `Open today's workout` with no existing editor tab. Expected: a new tab opens next to the current main-area tab. Run it again. Expected: existing tab is revealed, no duplicate.
- Desktop: run `Open today's workout` with no existing editor tab, from a state where a split-pane editor might be in a sidebar panel. Expected: no regression.

## 6. Post-merge follow-up: mobile row-action ergonomics

**Status:** explicitly deferred. Open a follow-up issue (or new plan) after this PR merges and after the user has had a few days of mobile use to see how much pain remains.

The user reported that swipe-right-to-edit-note and swipe-left-to-delete-row are hard to perform on mobile, especially when the editor sits in a side leaf. Phase 1 above defuses the side-leaf case for the default flow; the swipe ergonomics inside the main area are still worth revisiting because the swipe-from-edge gesture can still snag against iOS system gestures and any future side-leaf use.

Options to weigh in the follow-up plan, ordered roughly by cost:

1. **Long-press the row to open the existing kebab menu.** The desktop kebab already exposes `Edit note` and `Delete row`. Wire long-press (~500ms) to call the same menu on mobile. Zero new pixels, zero horizontal-gesture conflict. Preferred starting point.
2. **Tap the set-number cell to open the same menu.** Visible affordance, no horizontal space cost, very discoverable. Could complement option 1.
3. **Add a 4th column with a kebab on mobile.** Match the desktop layout. Discoverable; no gesture at all. Costs horizontal space, which is why option 4 is bundled with it.
4. **Square the row inputs (smaller `border-radius`, tighter padding).** Frees ~30 to 40 px per row, enough to fit option 3's kebab without shrinking set / weight / reps inputs noticeably. Pairs with option 3.
5. **Keep the existing swipe gestures** as a secondary affordance for muscle memory, removing them only if option 1 or 3 fully replaces them.

Recommended path for the follow-up plan, subject to mobile testing after Phase 1 ships:

- Add long-press as the primary mobile row-action gesture (option 1).
- Optionally make the set-number cell tap-to-open as a redundant affordance (option 2).
- Keep swipe (option 5) as legacy until next ergonomic pass.
- Revisit the kebab column (option 3 + 4) only if 1 + 2 still feel insufficient after a week of real use.

Out-of-scope for the follow-up regardless: settings-tab toggle for which gesture is primary, custom long-press timing, or per-set drag-to-reorder rows.

## 7. Out-of-band reminders

- Commit messages must adhere to AGENTS.md §7 (conventional commits, sentence case, imperative) and §8 (no em dashes; no `console.log`; JSDoc not stacked `//`).
- PR carries `patch` label (per AGENTS.md §6: bug fix, no new feature, no breaking change).
- CHANGELOG `## [Unreleased]` entry is mandatory under `### Fixed`. Bullet does not carry a per-bullet date (AGENTS.md §6 / auto-memory).
- Do not commit `main.js`, `data.json`, or `node_modules`.
- Branch is `feature/mobile-editor-main-area-leaf` (per project naming preference; auto-memory `feedback_branch_naming.md`).
