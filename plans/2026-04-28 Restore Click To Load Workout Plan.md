---
status: approved
target: v0.7.1
date: 2026-04-28
branch: feature/restore-click-to-load-workout
---

# FitKit Restore Click-to-Load Workout Plan

## Audience

This plan is written for coding subagents (Claude Code, Codex, etc.) and the human
reviewer. The PR is one branch, one PR, with the code change, tests, and CHANGELOG bullet
landing as a single atomic commit (a follow-up test commit is acceptable if review
surfaces gaps).

**Authoritative inputs:**

- Coding standards: `/Users/paul/dev-misc/obsidian-fitkit/AGENTS.md`
- Prior plan format: `/Users/paul/dev-misc/obsidian-fitkit/plans/2026-04-28 Duration Timer Controls Plan.md`
- Source: `/Users/paul/dev-misc/obsidian-fitkit/src/main.ts`, `/Users/paul/dev-misc/obsidian-fitkit/src/ui/workout-editor-view.ts`
- Test harness reference: `/Users/paul/dev-misc/obsidian-fitkit/tests/ui/workout-editor-view.test.ts`
- Changelog format: `/Users/paul/dev-misc/obsidian-fitkit/CHANGELOG.md`
- User-reported behaviour (2026-04-28): clicking a workout note (file explorer, wikilink, search
  result, tab) opens it as a regular markdown editor. The user expects the FitKit Workout
  Editor view to render instead, treating workout notes as a "mini app inside Obsidian
  rather than a document".

## 1. Goal & Success Criteria

When the user opens any markdown note whose YAML frontmatter declares `type: workout`,
the leaf renders the FitKit Workout Editor view instead of the markdown editor. This
applies to every entry point Obsidian uses to open a note (file explorer click, wikilink
follow, search result, restored tab on startup, "Open in new tab" command, mobile drawer).

**Definition of done:**

- Clicking a `type: workout` note in any context produces a Workout Editor leaf for that
  note. The markdown editor flashes briefly is acceptable; what matters is the final
  state.
- Notes without `type: workout` frontmatter (regular notes, dashboards, journal pages)
  continue to open in the markdown editor as before.
- The workout editor behaves as a single mini-app: when one is already open and the user
  clicks a different workout note, the existing editor leaf retargets to the new file in
  place rather than spawning a second editor leaf. Any redundant markdown leaf that
  Obsidian created for the click is detached so the workspace stays at one editor.
- Re-clicking the file that the editor is currently showing is a no-op: no setViewState,
  no reload, no timer reset.
- A duration timer running on the previous file is flushed (its elapsed seconds written
  to the row) before the editor swaps to the new file. The fix changes the existing
  `abortTimer()` calls in `loadFile` and `onClose` to `stopTimer({ write: true })` so the
  timer's value lands on disk via the autosave that already follows. Explicit-discard
  paths (`reloadFromDisk`, row delete, kind switch) keep their `abortTimer` semantics.
- On Obsidian Mobile, the same flow works without leaving the editor stranded in a
  drawer (the existing iOS rootSplit guard from v0.4.2 stays effective).
- The "Open today's workout" and "Open workout editor for current file" commands continue
  to work, do not race with the new listener, and do not double-open.
- Regression tests cover: (a) a markdown leaf showing a workout file gets swapped to
  the editor; (b) non-workout files are left alone; (c) editor active plus click on a
  different workout file retargets in place and detaches the stray markdown leaf;
  (d) editor active plus re-click on the same file is a no-op; (e) a timer running plus
  `loadFile` writes the elapsed seconds to the row instead of discarding them.
- No new lint, format, type, or test failures.

## 2. Context & Background

The current `src/main.ts` registers the custom view and exposes commands but does not
listen for `file-open`, and `WorkoutEditorView` does not implement `getState`/`setState`.
The result is that Obsidian only routes a workout note through our custom view when the
user runs an explicit FitKit command. Every other entry point (file explorer click,
wikilink, restored tab) lands the user on the raw markdown editor.

A grep across the entire git history confirms no prior commit added a `file-open` handler
or `setState` override. The user's "used to load" framing is most likely a recall of a
mental model (workout files = workout editor) that was never wired up. Either way, the
fix is the same.

The plugin already has a robust `openWorkoutEditor(file)` helper that handles the iOS
rootSplit guard, detaches stranded drawer leaves, and calls `loadFile`. The new listener
should reuse this helper where possible to keep the swap path consistent.

## 3. Approach & Design

**Detection strategy.** Use `app.metadataCache.getFileCache(file)?.frontmatter?.type === 'workout'`.
That is synchronous and reflects what Obsidian itself parsed. For files that exist on
disk, Obsidian populates the cache before surfacing the file in the explorer, so the
synchronous lookup is sufficient for the reported scenario. A `vault.cachedRead` fallback
is intentionally deferred (see §6 Risks) to avoid speculative complexity in the first cut.

**Listener.** Register `this.app.workspace.on('file-open', ...)` from `onload`. The event
fires with the file just opened in the active leaf; `null` means the leaf is now empty.
On every fire the listener decides between three outcomes (single-mini-app semantics):

1. If `file` is null, `file.extension !== 'md'`, or the file is not a workout, return.
2. If a Workout Editor leaf already exists in the workspace, treat it as the canonical
   editor:
   - If that leaf is already showing this file, return (no flicker, no timer reset).
   - Otherwise call `view.loadFile(file)` on the existing editor leaf, then detach the
     redundant markdown leaf Obsidian just spawned for the click (the active markdown
     view whose `.file === file`). Reveal the editor leaf so it becomes active.
3. If no Workout Editor leaf exists, swap the just-clicked markdown leaf to the editor
   view in place (the same path the no-editor-open case has used since the first cut).

The retarget path in step 2 is what makes the editor feel like a single mini-app rather
than per-document tabs. It also matches what `openWorkoutEditor(file)` does today for the
command path: consolidate to one leaf, retarget it.

**Refactor `openWorkoutEditor` for reuse.** Split today's helper into:

- `openWorkoutEditor(file: TFile)`: used by commands. Keeps today's behaviour
  (consolidate to a main-area workout-editor leaf, detach stranded drawers, and load).
- `swapLeafToWorkoutEditor(leaf: WorkspaceLeaf, file: TFile)`: used by both the
  command path and the new file-open handler. If the leaf already runs the editor view,
  skip `setViewState` and call `loadFile(file)` directly; otherwise mount the editor via
  `setViewState` and then call `loadFile`. This avoids re-mounting the view on retarget,
  which would otherwise tear down DOM state for no reason.

**Same-file no-op.** Add a public read-only accessor on `WorkoutEditorView` (e.g.
`get currentFile(): TFile | null`) that returns the file the active session is bound to.
The listener uses this to short-circuit when the editor is already showing the clicked
file, so re-clicking the current file does nothing visible.

**Timer flush on file change.** `loadFile` and `onClose` currently call `abortTimer()`,
which clears the active timer's interval and discards the elapsed seconds. With the new
retarget path a running timer would silently lose its in-flight value when the user
clicks a different workout note. Change those two call sites to `stopTimer({ write: true })`
so the elapsed seconds are written to the row before the autosave that already follows.
Leave `reloadFromDisk`, the row-delete handler, and the kind-switch handler on
`abortTimer()`: those are user-driven discard gestures.

**`onClose` invariants.** At the call site of `stopTimer({ write: true })` inside
`onClose`, `this.session` and `this.model` are still live; `onClose` only nulls them
after the autosave flush completes (see workout-editor-view.ts:155-158). So writing
`entry.durationSeconds` before `flushAutoSave()` operates on the same `FileSession` that
will perform the disk write. The order is: stop timer (writes to model) → clear pending
autosave timer → flush autosave (reads model, writes disk) → null out session and model.

**Recursion via autosave.** Autosave goes through `Vault.process()` which fires the
`modify` event, not `file-open`. Listeners on `file-open` are not triggered by writes,
so the retarget path's autosave flush cannot re-enter the listener.

**Active-leaf transient.** The retarget path detaches the redundant markdown leaf before
revealing the editor leaf, so the workspace briefly has no active leaf. This mirrors the
ordinary "close active tab" flow Obsidian already handles. `revealLeaf(editorLeaf)` then
restores the active leaf to the editor.

**Startup sweep.** When Obsidian restores a layout with workout notes already open as
markdown views (because the previous session had no listener), the file-open event does
not retroactively fire. Add a one-shot `app.workspace.onLayoutReady(() => sweep())` that
iterates leaves of type `markdown`, checks each `view.file` for workout frontmatter, and
calls `swapLeafToWorkoutEditor` per match. This catches users upgrading from a release
without the listener.

**State persistence across reloads.** Out of scope for this fix. Implementing
`getState/setState` on the view would let Obsidian restore the workout-editor leaf
directly without going through the markdown view. Worth a follow-up plan, but the swap
listener handles the common case adequately by triggering on the file-open that fires
during layout restoration.

## 4. Implementation Steps

### 4.1 Refactor `openWorkoutEditor` into command + swap helper

In `src/main.ts`:

```ts
private async swapLeafToWorkoutEditor(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
  if (!(leaf.view instanceof WorkoutEditorView)) {
    await leaf.setViewState({ type: VIEW_TYPE_FITKIT_WORKOUT_EDITOR, active: true })
  }
  await this.app.workspace.revealLeaf(leaf)
  const view = leaf.view
  if (view instanceof WorkoutEditorView) {
    await view.loadFile(file)
  }
}

private async openWorkoutEditor(file: TFile): Promise<void> {
  let mainAreaLeaf: WorkspaceLeaf | null = null
  this.app.workspace.iterateRootLeaves((leaf) => {
    if (!mainAreaLeaf && leaf.view.getViewType() === VIEW_TYPE_FITKIT_WORKOUT_EDITOR) {
      mainAreaLeaf = leaf
    }
  })
  for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_FITKIT_WORKOUT_EDITOR)) {
    if (leaf !== mainAreaLeaf) {
      leaf.detach()
    }
  }
  const leaf = mainAreaLeaf ?? this.app.workspace.getLeaf('tab')
  await this.swapLeafToWorkoutEditor(leaf, file)
}
```

### 4.2 Add the file-open listener

Register inside `onload`, after `registerView`:

```ts
this.registerEvent(
  this.app.workspace.on('file-open', (file) => {
    if (!file) return
    void this.maybeRouteWorkoutFile(file)
  }),
)
```

`maybeRouteWorkoutFile`:

```ts
private async maybeRouteWorkoutFile(file: TFile): Promise<void> {
  if (file.extension.toLowerCase() !== 'md') return
  if (!this.isWorkoutFile(file)) return

  const editorLeaf = this.findExistingEditorLeaf()
  if (editorLeaf) {
    const view = editorLeaf.view
    if (view instanceof WorkoutEditorView && view.currentFile?.path === file.path) {
      // Re-click on the currently-loaded file: no-op.
      return
    }
    // Detach the redundant markdown leaf Obsidian just spawned for this click before
    // retargeting the editor, so the workspace stays at one editor.
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView)
    if (
      markdownView &&
      markdownView.file === file &&
      markdownView.leaf !== editorLeaf
    ) {
      markdownView.leaf.detach()
    }
    await this.swapLeafToWorkoutEditor(editorLeaf, file)
    return
  }

  // No editor open: swap the just-clicked markdown leaf in place.
  const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView)
  if (!markdownView || markdownView.file !== file) return
  await this.swapLeafToWorkoutEditor(markdownView.leaf, file)
}

private findExistingEditorLeaf(): WorkspaceLeaf | null {
  let mainAreaLeaf: WorkspaceLeaf | null = null
  this.app.workspace.iterateRootLeaves((leaf) => {
    if (!mainAreaLeaf && leaf.view.getViewType() === VIEW_TYPE_FITKIT_WORKOUT_EDITOR) {
      mainAreaLeaf = leaf
    }
  })
  if (mainAreaLeaf) return mainAreaLeaf
  return this.app.workspace.getLeavesOfType(VIEW_TYPE_FITKIT_WORKOUT_EDITOR)[0] ?? null
}

private isWorkoutFile(file: TFile): boolean {
  const cached = this.app.metadataCache.getFileCache(file)?.frontmatter?.type
  return typeof cached === 'string' && cached.toLowerCase() === 'workout'
}
```

If the metadata cache miss case proves common in practice (it should be rare since
Obsidian populates the cache before firing `file-open` for known files), follow up with
an async fallback that reads the file head and pattern-matches on `^---` … `type: workout`.
Do not add the fallback speculatively; the synchronous path covers the reported scenario.

### 4.3 Startup sweep on layout ready

Inside `onload`:

```ts
this.app.workspace.onLayoutReady(() => {
  for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
    const view = leaf.view
    if (view instanceof MarkdownView && view.file && this.isWorkoutFile(view.file)) {
      void this.swapLeafToWorkoutEditor(leaf, view.file)
    }
  }
})
```

Purposely not async; we fire the swaps without awaiting so layout-ready returns
immediately.

### 4.4 Timer flush on file change

In `src/ui/workout-editor-view.ts`:

- `onClose`: replace `this.abortTimer()` with `this.stopTimer({ write: true })`. The
  existing `flushAutoSave()` call right after will then persist the elapsed seconds.
- `loadFile`: same replacement at the top of the method, before the autosave flush.
- `reloadFromDisk`: leave as `this.abortTimer()`. The user explicitly asked to reload
  from disk, so any local timer state should be discarded.
- Row delete and kind switch sites: leave as `this.abortTimer()`. These are user-driven
  discards of the timer's owning row/card.

Add a public read-only accessor on `WorkoutEditorView` so the listener can detect the
same-file no-op without reaching into private state:

```ts
get currentFile(): TFile | null {
  return this.session?.file ?? null
}
```

### 4.5 Imports

Add `MarkdownView` to the obsidian import in `src/main.ts`.

### 4.6 Mobile and iOS guard

The existing v0.4.2 iOS rootSplit detach logic is preserved on the command path.
On Obsidian Mobile, clicking a file in the file explorer drawer routes the file into the
active root-split (main area) leaf, not into the drawer. The listener therefore swaps
the main-area markdown leaf to the workout editor, matching Obsidian's normal "clicks
from a drawer land in main" behaviour. The rootSplit guard remains as a safety net for
the explicit "Open today's workout" command, which is where the iOS bug from v0.4.2
actually manifested. The listener itself does not detach any leaves; it only transforms
the leaf Obsidian routed the click to.

### 4.7 Manual smoke checklist (PR description)

Verify on desktop:

- Click a `type: workout` note in the file explorer with no editor open → opens in
  workout editor.
- Click the same note again → no-op (no flicker, no reload, the timer keeps running if
  one is active).
- Click a different workout note while the editor is already open → the existing editor
  leaf retargets to the new file in place; no second editor leaf is created. Any timer
  that was running on the previous file has its elapsed seconds persisted to that file's
  row (verify by reopening the previous file).
- Click a non-workout markdown note → opens in markdown editor as before. The workout
  editor leaf is left alone.
- Run "Open today's workout" command → still works, single editor leaf.
- Run "Open workout editor for current file" with a workout note active → loads in editor.
- Reload Obsidian with a workout note open → sweep restores the editor.

Verify on Obsidian Mobile (iOS):

- Click a workout note from the file explorer drawer → editor opens in main area.
- Run "Open today's workout" command → editor opens in main area, not drawer (regression
  guard for v0.4.2).

## 5. Test Plan

The repo currently has no `tests/main.test.ts`; create one. Vitest runs in `node`
environment; reuse the TestElement-free pattern by stubbing only the Obsidian APIs we
exercise.

**Mock surface for `tests/main.test.ts`:**

- `MarkdownView` class with a `file` property and a `leaf` reference.
- `Workspace` mock exposing `getActiveViewOfType`, `getLeavesOfType`, `iterateRootLeaves`,
  `revealLeaf`, `onLayoutReady`, `on('file-open', ...)`.
- `MetadataCache` mock with `getFileCache(file)` returning `{ frontmatter: { type } }`.
- `Plugin` base class with no-op `registerEvent`, `registerView`, `addCommand`,
  `addSettingTab`, `loadData`, `saveData`.
- `Leaf` mock with `view`, `setViewState` (records calls), `detach`, `getRoot`.
- `WorkoutEditorView` mock with a `loadFile` spy.
- `TFile` class with `extension` and `path`.

Construct the plugin via `Object.create(FitKitPlugin.prototype)` to bypass the real
`Plugin` constructor (no `app` injection needed). Set `plugin.app` manually.

**Cases (file-open listener, no editor open):**

1. **Workout file in active markdown leaf swaps to editor**: stub `getActiveViewOfType`
   to return a markdown view whose `file` matches the argument; metadata cache returns
   `type: workout`; assert `setViewState` was called with `{ type: VIEW_TYPE_FITKIT_WORKOUT_EDITOR, active: true }`
   and the resulting view's `loadFile` was called with the file.
2. **No-editor regression test (named explicitly)**: same as case 1 but asserts the
   precondition that `getLeavesOfType(VIEW_TYPE_FITKIT_WORKOUT_EDITOR)` is `[]`. Pins
   the regression that originally motivated this PR.
3. **Non-workout markdown is left alone**: metadata cache returns `type: journal`;
   assert `setViewState` was not called.
4. **Non-md extension is ignored**: file with `extension = 'png'`; assert `setViewState`
   was not called.
5. **Active view is not a markdown view AND no editor exists**: a no-op state.

**Cases (file-open listener, editor already open):**

6. **Editor active showing file A, click file B → retarget in place**: stub
   `iterateRootLeaves` to surface the existing editor leaf with `view.currentFile.path
=== 'A.md'`; stub `getActiveViewOfType(MarkdownView)` to return the redundant markdown
   view spawned for B; metadata cache returns `type: workout` for B. Assert the editor
   leaf's `loadFile` was called with B; assert the markdown leaf's `detach()` was called;
   assert `setViewState` was NOT called on the editor leaf (since it is already the
   editor type).
7. **Editor active showing file A, re-click file A → no-op**: same setup as case 6 but
   `currentFile.path === 'A.md'` matches the clicked file. Assert `loadFile` was not
   called; assert no `detach`; assert no `setViewState`.
8. **Editor active, click non-workout markdown**: stub the metadata cache to return
   `type: journal` (or no frontmatter); assert the listener returns early without
   calling `loadFile`, `setViewState`, or `detach` on any leaf. The markdown leaf and
   the editor leaf remain untouched. (Whether Obsidian then renders the markdown view
   for the journal note is outside this unit's scope; this test asserts only that the
   listener does not interfere.)

**Cases (startup sweep):**

9. **Layout-ready sweep transforms each markdown leaf showing a workout file**: stub
   `getLeavesOfType('markdown')` to return two leaves, one with a workout file and one
   without; assert only the workout leaf had `setViewState` called.

**Cases (idempotency with command path):**

10. **`openWorkoutEditor` consolidates and reuses an existing main-area editor leaf**:
    regression cover for the existing iOS fix to make sure the refactor did not break it.
    Stub `iterateRootLeaves` to surface a workout-editor leaf; assert `getLeaf('tab')` is
    not called.

**Cases (timer flush, in `tests/ui/workout-editor-view.test.ts`):**

11. **`loadFile` mid-timer writes elapsed seconds before swapping files**: set up an
    editor with an active timer (accumulator + start time), call `loadFile(newFile)`,
    assert the original entry's `durationSeconds` was set to the expected accumulator +
    elapsed value, assert `activeTimer` was cleared, assert `markDirty` was called.
12. **`onClose` writes elapsed seconds before tearing down**: same shape but via
    `onClose()`; assert the entry's seconds were written before the autosave flush.

Cases 1-10 land in `tests/main.test.ts`. Cases 11-12 extend the existing duration-timer
suite in `tests/ui/workout-editor-view.test.ts`.

## 6. Risks & Mitigations

- **Risk:** The `file-open` event fires during the swap and recurses.
  **Mitigation:** The custom view does not surface a file to `Workspace.file`, so Obsidian
  should not re-fire. Plus the same-file no-op short-circuits any accidental loop on the
  editor leaf, and the no-editor branch only fires when the active view is a markdown
  view whose file matches the event. Verified by cases 7 and 5.

- **Risk:** Frontmatter not yet in metadata cache at click time.
  **Mitigation:** For files that exist on disk, Obsidian populates the cache before
  surfacing the file in the explorer. The synchronous lookup is sufficient for the
  reported scenario. If users report missed swaps, follow up with a `cachedRead` fallback
  and a `metadataCache.on('changed')` retry. Do not pre-emptively complicate.

- **Risk:** Conflict with the v0.4.2 iOS rootSplit guard.
  **Mitigation:** The listener does not detach the editor leaf or any non-redundant leaf;
  it only detaches the markdown leaf Obsidian just spawned for the click when retargeting.
  The command path's drawer-detach logic is unchanged. Verified by case 10.

- **Risk:** Forcing a single editor leaf surprises a user who had intentionally split
  the workspace to view two workouts side-by-side. **Mitigation:** Accept this. The user
  reframed the editor as a mini-app; if anyone needs side-by-side comparison they can
  open the second file in a markdown view via the "Open in markdown" submenu (Obsidian's
  built-in path that bypasses `file-open`).

- **Risk:** Timer flush on file change writes a value the user did not want to keep
  (e.g., they accidentally started the timer then switched files to abandon it).
  **Mitigation:** This is a behaviour trade-off vs the prior silent-discard. Persisting
  is the safer default because the elapsed value is recoverable (delete the duration row)
  while a discarded value is not. Document the change in the CHANGELOG so the behaviour
  is discoverable.

- **Risk:** Tests over-mock and pass without exercising the routing logic. **Mitigation:**
  Assert on the actual `setViewState` payload, the `loadFile` call, and the `detach` call,
  not on whether the handler was invoked.

## 7. Open Questions

- Do we want to add `getState/setState` to `WorkoutEditorView` in this PR so Obsidian
  restores workout-editor leaves directly across reload, dropping the brief markdown
  flash? Recommendation: defer. The sweep covers the reload case and adding state
  persistence has more surface area than this fix needs.
- Should the timer-flush behaviour be configurable (a setting toggle for "discard timer
  on file change" vs "save timer")? Recommendation: defer until a user asks. The default
  saves work, which is what most users want.

## 8. Definition of Done

- One PR on `feature/restore-click-to-load-workout` against `main`, labelled `patch`
  (release pipeline cuts `0.7.1` on merge: bug fix, not a feature).
- `src/main.ts` carries the listener (with retarget + same-file no-op branches), the
  sweep, the `findExistingEditorLeaf` helper, and the refactored `swapLeafToWorkoutEditor`
  helper that skips `setViewState` when the leaf already runs the editor view.
- `src/ui/workout-editor-view.ts` flushes a running timer with `stopTimer({ write: true })`
  in `loadFile` and `onClose`; other `abortTimer` sites (`reloadFromDisk`, row delete,
  kind switch) are unchanged. A public `currentFile` accessor exists for the listener's
  same-file check.
- `tests/main.test.ts` added with cases 1-10. `tests/ui/workout-editor-view.test.ts`
  extended with cases 11-12. The pre-existing 99-test green baseline grows to roughly
  108 with no regressions.
- CHANGELOG `[Unreleased] / Fixed` lists two bullets: (a) "Workout editor opens
  automatically when you click a `type: workout` note from the file explorer, a wikilink,
  search results, or a restored tab. Previously these entry points opened the raw
  markdown editor." (b) "Workout editor now retargets in place to the clicked workout
  file, instead of spawning a second editor leaf or requiring you to reopen via the
  command palette." A `### Changed` bullet documents the timer-flush behaviour: "When
  switching to a different workout file (or closing the editor), a running duration
  timer's elapsed seconds are now saved to the row before the swap. Previously they
  were silently discarded."
- `npm run lint`, `npx prettier --check .`, `npm run build`, `npm test` all green.
