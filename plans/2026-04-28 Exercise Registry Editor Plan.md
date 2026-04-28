---
status: approved
target: v0.10.0
date: 2026-04-28
branch: feature/exercise-registry-editor
---

# Exercise Registry Editor Plan

## 1. Problem

The exercise registry (`plugin.settings.exerciseRegistry`, an array of `{ name, kind, aliases }`) is the single source of truth for canonical exercise names, their kind (`strength` / `duration`), and aliases. It powers:

- `kindForName` lookups when adding/renaming exercises in the workout editor (`src/ui/workout-editor-view.ts:693, 710, 767`).
- Resolution in the import modal and the create-missing-exercises modal (`src/ui/import-modal.ts:210`, `src/ui/create-missing-exercises-modal.ts:76`).
- Indirectly, the autocomplete name list (`src/ui/exercise-suggest-modal.ts`).

Today the only ways to mutate it are:

1. **Bootstrap from vault** in settings (`src/settings.ts:132-145`): regenerates from `Exercises/` folder stems, keeping existing aliases.
2. The import modal's confirm path (`src/ui/import-modal.ts:333` plus `registryWithImportMappingChanges` in `src/domain/import-mapping.ts:85-119`), which both *adds entries* and *appends raw names as aliases* on existing entries when the user maps a journal name.
3. The create-missing-exercises modal (`src/ui/create-missing-exercises-modal.ts:159`).
4. **Workout editor kind switch** (`src/ui/workout-editor-view.ts:745-758`, `persistRegistryKind`): toggling strength↔duration on a card writes the registry.
5. Hand-editing `data.json`.

There is no UI to view, search, edit, rename, change the kind of, or delete entries directly. Users who mistype a name, want to merge two entries, or curate aliases have no path other than editing JSON.

A subtlety: most read-side callers wrap `settings.exerciseRegistry` in `exerciseRegistryWithVaultNotes()` (`src/vault/exercise-registry-vault.ts:8-19`), which merges vault `Exercises/<stem>.md` filenames in as default-strength entries with empty aliases. Those vault-derived entries are visible to the importer and editor at runtime but never persisted unless the user clicks Bootstrap. The editor here does not change that contract; see §3.7.

## 2. Goal

A first-class **registry editor in the settings tab** that lets the user:

- See every persisted entry at a glance (canonical name, kind, alias count).
- Search/filter by name or alias.
- Add a new entry from scratch.
- Edit an existing entry's name, kind, and aliases.
- Delete an entry with confirmation.
- Keep the existing **Bootstrap from vault** action as a one-click seed.

Workout-note resolution stays robust across renames: when the canonical name changes, the old name is automatically added as an alias so existing `[exercise:: [[Old Name]]]` references still resolve to the same entry.

## 3. Approach

### 3.1 Settings tab UI

Replace the current ~15-line Registry section in `src/settings.ts` with a richer block under the existing `Registry` heading.

Layout, top to bottom:

- A short description: `'Curate canonical exercise names, kinds, and aliases. The registry is consulted whenever you add, rename, or import an exercise. Note: filenames in your Exercises folder also count at runtime, even if they are not listed here. Run Bootstrap from vault to materialize them.'`
- Action row: `[Add entry]` `[Bootstrap from vault]`.
- Search input (`type=search`, placeholder "Search by name or alias"); filter is case-insensitive substring on the **normalized** form (`normalize()` from the domain module), against the canonical name and every alias.
- A scrollable wrapper `<div class="fitkit-registry-table-wrap">` with `overflow-x: auto`, around a table:

  | Name | Kind | Aliases | |
  |------|------|---------|---|
  | Squat | strength | Back Squat, BB Squat | [Edit] [Delete] |
  | Plank | duration | none | [Edit] [Delete] |

  - Aliases column: comma-joined; if empty, show muted "none". Truncate visually with CSS, full text in `title=` attribute.
  - Action cell uses `white-space: nowrap` so the buttons stay together.
  - Empty state when there are no entries: "No entries yet. Add one or bootstrap from your Exercises folder."
  - Empty state when the search query excludes everything: "No matches for '<query>'."

- Re-render the section after every mutation by calling a new local `renderRegistrySection()` that scopes to a registry container `<div>`, not the whole tab. (Avoids the focus-loss problem fixed in `2026-04-28 Settings Fitness Root Focus Plan.md`.) The container is created once in `display()`, cleared and rebuilt on each call to `renderRegistrySection()`.

### 3.2 Edit/Create modal

Add `src/ui/exercise-registry-entry-modal.ts`:

```ts
export class ExerciseRegistryEntryModal extends Modal {
  constructor(
    plugin: FitKitPlugin,
    mode:
      | { kind: 'create' }
      | { kind: 'edit'; original: ExerciseRegistryEntry },
    onSaved: () => void,
  )
}
```

Form fields:

- **Name** (single-line text input, required, autofocus).
- **Kind** (segmented `<select>` with `Strength` / `Duration`; default `strength` in create mode, the original value in edit mode).
- **Aliases** (multi-line textarea, one alias per line; trimmed and empty lines dropped on save). One-per-line beats comma-separated because exercise names occasionally contain commas.

Validation, evaluated on every keystroke (Save disabled while invalid) and re-evaluated again at save time against fresh state — see §3.4 stale-save handling. The pure validator lives in `src/domain/exercise-registry.ts` (see §3.6) so it gets unit-tested:

- Trimmed name is non-empty.
- The proposed canonical name's normalized form does not collide with **any normalized key** (canonical name OR alias) of any **other** entry; i.e., it does not exist in `buildIndex`-of-rest. Self-collision in edit mode (canonical equals its own original) is fine.
- Each proposed alias's normalized form does not collide with any normalized key of any **other** entry. Self-aliases (alias normalizes to the entry's own canonical) are silently dropped, not an error.
- Duplicate aliases within the entry are deduped on the normalized form (first occurrence wins, original casing preserved).

When validation fails, error messages identify the conflicting entry: `"Alias 'X' conflicts with entry 'Y'."` / `"Name 'X' conflicts with alias on entry 'Y'."`

Save behaviour:

- **Create mode**: `upsertEntry(registry, { name, kind, aliases })` → write `settings.exerciseRegistry = next.entries` → `await plugin.saveSettings()`.
- **Edit mode**: delegate to a new pure `renameEntry(registry, oldName, newEntry)` (see §3.6). This handles the normalize-aware rename + alias preservation in one step. It:
  1. Removes the old entry by canonical name.
  2. If `normalize(oldName) !== normalize(newEntry.name)`, prepends the old name to `newEntry.aliases` (deduped on the normalized form so aliases that already cover the old name aren't doubled).
  3. Inserts the new entry.

  After save, show a `Notice` if the canonical name changed: `"Renamed 'Old' → 'New'. 'Old' was kept as an alias so existing workout references still resolve."`

  If the kind changed, show a separate `Notice`: `"Kind changed to <new>. Recent-sessions queries on existing workouts may stop returning rows until they're re-recorded under the new kind."`

Buttons: `Cancel` / `Save`. Save is disabled while validation fails; inline error text appears under the offending field.

### 3.3 Delete flow

Reuse the existing `ConfirmModal` (`src/ui/confirm-modal.ts:10-55`) — same shape we need, no new modal class:

```ts
new ConfirmModal(this.app, {
  title: 'Delete entry?',
  message: `Delete '${name}'? This removes only the registry entry. The note file in <Exercises folder>, if any, is left untouched, and existing workouts that reference '${name}' will resolve as Unknown until you re-add the entry.`,
  confirmText: 'Delete',
  cancelText: 'Cancel',
}, (confirmed) => { if (confirmed) void doDelete() }).open()
```

`ConfirmModal` already styles the confirm button with `.fitkit-destructive-button`. The destructive-at-rest styling that conflicts with AGENTS.md §57 is pre-existing in `styles.css:420-433` and across other call sites; fixing it is out of scope here so the registry editor stays consistent with the rest of the plugin. (Tracked separately: see §4.)

On confirm: `removeEntry(registry, name)` → save → re-render. Delete is registry-only; the corresponding `Exercises/<Name>.md` (if any) is intentionally not touched.

### 3.4 Stale-save and stale-delete handling

`Save` and `Delete` both *re-read* `plugin.settings.exerciseRegistry` immediately before mutating, not the snapshot taken when the modal opened. This matters because the import modal, create-missing-exercises modal, and `persistRegistryKind` from the workout editor can all mutate the registry between the editor opening and the user clicking Save / Delete.

**Save (create or edit)**:

1. Build `current = createRegistry(plugin.settings.exerciseRegistry)` afresh.
2. In edit mode: look up the original entry by canonical name in `current`. If absent (concurrently deleted), show a `Notice` ("That entry was removed elsewhere; close and reopen the registry editor to see the latest state.") and abort.
3. Re-run `validateEntryDraft(current, sanitizedDraft, { excludeOriginalName })` against fresh state. If it now fails (a concurrent change introduced a conflict that didn't exist when the modal opened), surface the error inline and do not save.
4. If validation passes, apply via `upsertEntry` (create) / `renameEntry` (edit) and persist. The user's typed values win over any concurrent same-entry alias/kind change — this is last-write-wins on a per-entry basis. Acceptable because the user has explicitly typed the values they expect; aborting on every untouched-field drift would be hostile (e.g., if the importer added an alias `BB Squat` while the user is renaming Squat → Back Squat, the rename should still go through; if the user wanted to keep `BB Squat`, they re-open and add it).
5. Call `onSaved()` to close + re-render.

**Delete**:

1. Build `current` afresh.
2. Look up the entry by canonical name. If absent (already deleted concurrently), show a `Notice` ("That entry was already removed.") and close the confirm modal without erroring.
3. If present, `removeEntry(current, name)` regardless of any kind/alias drift since the modal opened — delete is by identity, not by content; the user's intent is "remove this entry" and the canonical name is the identity.
4. Persist; re-render.

This makes the editor cooperate with concurrent writes without forcing the user to redo work over fields they did not touch.

### 3.5 CSS

Reuse the existing `.fitkit-import-*` table and button vocabulary where it fits, since the visual goal is the same. New rules in `styles.css`:

- `.fitkit-registry-table-wrap` — `overflow-x: auto; margin-bottom: 0.5rem` for mobile horizontal scroll.
- `.fitkit-registry-search` — full-width search input.
- `.fitkit-registry-empty` — muted text for the empty/no-match states.
- `.fitkit-registry-action-cell` — `white-space: nowrap` so Edit / Delete don't wrap apart.
- `.fitkit-registry-aliases-muted` — muted text colour for the "none" placeholder.

### 3.6 Domain layer

Three new pure functions in `src/domain/exercise-registry.ts`. All exported and unit-tested.

```ts
export type RegistryEntryDraft = {
  name: string
  kind: ExerciseKind
  aliases: string[]
}

export type ValidationError = { field: 'name' | 'alias'; index?: number; message: string }

/**
 * Trim and dedupe a raw form draft. Drops empty aliases, dedupes aliases
 * by normalized form (first occurrence wins, original casing kept), and
 * trims the canonical name. Self-aliases (alias normalizing to the
 * draft's own canonical) are dropped here. Idempotent.
 */
export function sanitizeEntryDraft(draft: RegistryEntryDraft): RegistryEntryDraft

/**
 * Validate a sanitized draft against an existing registry.
 * `excludeOriginalName` lets edit mode ignore self-collisions. Returns
 * [] when valid. Callers pass the output of sanitizeEntryDraft.
 */
export function validateEntryDraft(
  registry: ExerciseRegistry,
  draft: RegistryEntryDraft,
  options?: { excludeOriginalName?: string },
): ValidationError[]

/**
 * Return an updated registry with the entry under oldName replaced by
 * `next`. If `normalize(oldName) !== normalize(next.name)`, the old name
 * is prepended to next.aliases (deduped on normalized form). Aliases
 * that normalize to the new canonical are dropped. Caller passes a
 * sanitized draft.
 */
export function renameEntry(
  registry: ExerciseRegistry,
  oldName: string,
  next: RegistryEntryDraft,
): ExerciseRegistry
```

Sanitization ownership: the modal calls `sanitizeEntryDraft` first, then `validateEntryDraft` and `renameEntry`/`upsertEntry` on the sanitized result. The sanitize step is the single canonical normaliser; validate is a pure check; rename is the merge. Each concern lives in exactly one place. The implementation is short — `validateEntryDraft` builds a normalized key index of every other entry; `renameEntry` does `removeEntry` + alias-merge + `upsertEntry`. Centralising lets §3.4 stale-save handling and the modal share the same logic, and all three are testable without an Obsidian app.

### 3.7 Vault-derived entries

`exerciseRegistryWithVaultNotes()` will continue to merge vault stems with `settings.exerciseRegistry` for read-side callers. The editor edits **only** the persisted array. Implication: a stem like `Exercises/Bench.md` that is NOT in the registry will not appear in the editor, even though `kindForName('Bench', registry)` resolves at runtime. The description blurb (§3.1) names this; clicking Bootstrap is the path to materialize and edit such stems.

This is the simplest contract and avoids the editor having two display-only rows that behave differently from the rest. We deliberately do not change reader call sites here.

## 4. Out Of Scope

- Bulk operations (multi-select delete, bulk kind change).
- Drag-to-reorder. Entries are auto-sorted alphabetically by canonical name (existing `upsertEntry` behaviour).
- Renaming the on-disk `Exercises/<name>.md` note when an entry's canonical name changes. The modal compensates by adding the old name as an alias so resolution stays correct; the user can rename the note file separately.
- Updating `[exercise:: [[Old Name]]]` references inside existing workout notes when an entry is renamed. Aliasing handles resolution; rewriting the markdown is a different scope.
- Importing/exporting the registry as JSON or CSV.
- Per-entry metadata beyond `kind` and `aliases` (description, default rep ranges, equipment, muscle groups). The registry stays minimal.
- Changing the **Bootstrap from vault** merge logic.
- Quote/backslash escaping for entries whose names contain `"`. Same status as elsewhere in the plugin; fix it across all composers in a separate change.
- Fixing `.fitkit-destructive-button` (and `.fitkit-btn-danger`) so they're neutral at rest per AGENTS.md §57. The current rules are red-at-rest at `styles.css:420-433`. The registry editor uses `ConfirmModal` and inherits whatever styling already ships; cleaning up the destructive-button colour scheme touches every confirm flow and belongs in a separate small change.
- Showing vault-derived (unpersisted) entries in the editor (see §3.7). They remain visible only to runtime readers via `exerciseRegistryWithVaultNotes`.

## 5. Tests

### Unit (Vitest)

New tests in `tests/domain/exercise-registry.test.ts`:

**`sanitizeEntryDraft`**
- Trims canonical name and aliases.
- Drops empty-after-trim aliases.
- Dedupes aliases by normalized form, keeping first occurrence's original casing.
- Drops self-aliases (alias that normalizes to the draft's own canonical).
- Idempotent: `sanitize(sanitize(x))` deep-equals `sanitize(x)`.

**`validateEntryDraft`** (caller has already sanitized)
- Returns `[]` for a valid draft (name + non-conflicting aliases).
- Empty trimmed name returns a `field: 'name'` error.
- Canonical name colliding with another entry's canonical returns a `field: 'name'` error with the conflicting entry's name in the message.
- Canonical name colliding with another entry's **alias** returns a `field: 'name'` error.
- Alias colliding with another entry's canonical returns a `field: 'alias'` error with the alias's index.
- Alias colliding with another entry's **alias** returns a `field: 'alias'` error.
- Self-collision is allowed: in edit mode (`excludeOriginalName` set), a draft with the same canonical as its original entry passes.
- Alias that normalizes to the draft's own canonical is NOT an error (will be dropped at save time).
- Punctuation/case-only collision counts (uses `normalize`).

**`renameEntry`** (caller has already sanitized)
- No-rename (same canonical name): kind/aliases update; old name NOT added to aliases.
- Normalize-equivalent rename (e.g., `'Squat '` → `'Squat'`): treated as no-rename; no self-alias added.
- True rename: old name is prepended to aliases.
- True rename where the supplied draft already lists the old name as an alias (raw match): deduped.
- True rename where the supplied draft already lists a normalize-equal-but-raw-different alias of the old name (e.g., old `'Back Squat'`, supplied alias `'back squat '`): deduped on normalize, original casing kept.
- Aliases that normalize to the new canonical are dropped from the saved aliases.
- Old name no longer present as a canonical entry afterwards.
- `resolve(registry, oldName)` after rename returns `match` pointing to the renamed entry.

### Manual QA (per AGENTS.md §6)

1. **List & search**: open settings → Registry. Confirm every entry from `data.json` shows up. Type `squa`; only Squat-family rows show. Clear; everything returns. Aliases column truncates long lists with hover tooltip showing the full list.
2. **Add entry**: click `Add entry`. Fill `Front Squat` / `strength` / `Front-loaded Squat` and `FSquat` on separate lines. Save. New row appears alphabetically. Reopen the modal on the new row; the data round-trips.
3. **Edit entry, rename**: edit `Squat` → `Back Squat`. Save. Confirm the row shows `Back Squat` with `Squat` automatically added to aliases. Open a workout note with `[exercise:: [[Squat]]]` and confirm the workout editor still detects it as strength.
4. **Edit entry, normalize-equivalent rename**: edit `Squat` → `Squat ` (trailing space). Save. Aliases unchanged (no self-alias added).
5. **Edit entry, kind change**: edit `Plank`, change kind from `duration` to `strength`. Save. Notice appears about historical query rows.
6. **Validation**:
   - Empty name → Save disabled.
   - Name `back squat` when another entry has alias `Back Squat` → blocked, message names the conflicting entry.
   - Alias `squat` when entry `Squat` exists → blocked.
   - Alias matching the draft's own canonical → silently dropped; save succeeds.
   - Two duplicate aliases differing only in casing → deduped.
7. **Delete**: click `Delete` on a test entry. `ConfirmModal` appears. Cancel; entry stays. Click Delete again → confirm; row gone. Reload Obsidian; entry stays gone.
8. **Stale-save**:
   - Open the editor on entry `Squat`.
   - In another tab, run an import that adds `Squat` an alias.
   - Click Save in the editor without changes → notice appears: "That entry was modified elsewhere; close and reopen…".
   - Reopen the editor; the new alias is visible.
9. **Bootstrap interplay**: after curating entries, click `Bootstrap from vault`. Manually-added entries that don't correspond to vault stems are preserved; vault-only stems become new entries with empty aliases. Aliases on existing entries are not lost.
10. **Concurrent kind change from the workout editor**: change kind via the gear menu in the workout editor (`persistRegistryKind`). Open the registry editor; the new kind is reflected.
11. **Persistence**: reload Obsidian after each mutation; changes survive.
12. **Mobile**: open the settings tab on Obsidian Mobile. Confirm the table scrolls horizontally inside its wrapper without overflowing the page. Add and delete one entry on mobile to confirm the modal works.
13. **Vault-only stem visibility**: confirm a stem `Exercises/NewLift.md` that has never been bootstrapped does NOT appear in the editor, but `kindForName('NewLift', exerciseRegistryWithVaultNotes(...))` still resolves in the workout editor. After clicking Bootstrap, it appears in the editor.

## 6. Risk

**Low–medium.** The new code is concentrated in two files plus a small domain extension; reuses existing CRUD primitives, validation, and confirm modal. Risk surfaces:

- **Rename → orphaned exercise note file**: a renamed entry's `.md` stub becomes stale (filename = old name). Resolution is preserved by alias, so workouts keep working. Documented in the rename `Notice`.
- **Kind change**: dashboard queries are kind-specific. Switching strength→duration leaves historical strength rows un-queried until they're re-recorded. Mitigation: warning at save; reversible.
- **Delete with workout references**: deleting an entry leaves existing workouts with `[exercise:: [[Name]]]` resolving as `Unknown`. Mitigation: confirmation modal explicitly warns.
- **Concurrent registry mutations**: import / create-missing / kind-switch flows can write the registry while the editor is open. Mitigated via stale-save handling (§3.4).
- **Vault-derived entry confusion**: a user might delete `Squat` from the editor and be surprised when the importer still finds it (because `Squat.md` exists in the vault). Mitigated by description copy and the delete confirmation message; full reconciliation is out of scope.
- **AGENTS destructive-button rule**: pre-existing CSS inconsistency, not introduced here. Out of scope to fix; tracked in §4.

## 7. Changelog

Under `### Added`:

- Edit and curate the exercise registry directly from settings: list, search, add, edit, and delete entries (canonical name, kind, aliases) without touching `data.json`. Renaming an entry keeps the old name as an alias so existing workout references still resolve.

## 8. Release Label

`minor`. New user-visible feature, no breaking changes.
