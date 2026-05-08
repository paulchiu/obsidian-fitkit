---
status: draft
target: v0.11.0
date: 2026-05-08
branch: codex/fitkit-master-plan
generated_by: Codex
generated_at: 2026-05-08T18:14:45+1000
prompt_summary: 'Plan FitKit exercise catalog, deletion, import, onboarding, and command UX work for parallel agents.'
---

# Exercise catalog and onboarding master plan

## 1. Problem

Several product questions now point at the same architectural boundary:

- Exercise note frontmatter and `settings.exerciseRegistry` both describe exercise kind.
- Deleting a registry entry does not necessarily delete the exercise, because exercise files are merged back into the runtime registry.
- New exercises can be typed into the workout editor, but that only creates a workout card. It does not clearly create a catalog entry or exercise note.
- Maintenance commands are exposed next to daily commands, which makes first use and day to day command palette use harder than needed.
- Small editor controls, such as the exercise card cog button, need polish but should not be blocked by catalog work.

The current behavior is understandable from the implementation, but not from the user's mental model. `exerciseRegistryWithVaultNotes()` promotes markdown files under the exercises folder into the runtime registry, while exercise note migration can also treat the saved registry as canonical. A user who deletes a registry entry can see it return if the note still exists, and dashboard rebuilds can still show exercises that exist in historical workout notes.

## 2. Product decision

Exercise notes are the canonical catalog for note-backed exercises.

- A markdown file under the exercises folder counts as an exercise only when its frontmatter has `type: exercise`.
- For note-backed exercises, the file basename is the canonical exercise name.
- For note-backed exercises, frontmatter owns `kind` and `metric`.
- `settings.exerciseRegistry` becomes an overlay for aliases and for exercises that do not have a note yet.
- Saved registry `kind` applies only when there is no note-backed exercise for that name.
- If saved registry `kind` disagrees with note frontmatter `kind`, FitKit should prefer the note and surface a diagnostic instead of silently rewriting either source.
- Deleting a registry overlay is not the same as deleting an exercise.
- Deleting an exercise means trashing the note, or changing/removing `type: exercise`.
- Deliberate exercise deletion records a tombstone for the normalized exercise name or stable key, so future imports and scans do not recreate it from historical workout notes by accident.
- Dashboard rebuilds remain history-based. If old workout notes still reference an exercise, dashboard history may still show it unless a separate hide/archive feature is added.

The user confirmed the previous recommended decisions 1, 2, 3, 6, and 7: no-note registry entries remain supported, deleting an exercise note also removes the matching overlay, dashboard history remains visible after deletion, onboarding starts as a Settings setup section without persisted completed state, and daily commands stay in the command palette while maintenance actions move to Settings after replacements exist.

## 3. Goals

- Make the source of truth easy to explain: exercise note frontmatter owns exercise metadata when a note exists.
- Make delete semantics explicit and predictable.
- Add a clear path for importing or creating new exercises without restoring the old free-text journal parser.
- Reduce command palette noise so daily actions are easy to find.
- Keep independent polish work parallel-safe.
- Keep each implementation slice testable and small enough for subagents.

## 4. Non-goals

- Do not restore the removed journal parser.
- Do not rewrite old workout notes when an exercise is deleted.
- Do not hide historical dashboard rows as part of delete. That is a separate product feature.
- Do not add a broad template system for exercise notes.
- Do not introduce a database, cache, or feature flag for the catalog.
- Do not automatically recreate deliberately deleted exercise names from old workout history.
- Do not rewrite existing shipped plans.

## 5. Architecture

### 5.1 Exercise catalog reader

Add a vault-aware catalog module, likely `src/vault/exercise-catalog.ts`.

Responsibilities:

- Scan markdown files under `exercisesFolder(settings)`.
- Include only files whose metadata has `type: exercise`.
- Read supported `kind` values from frontmatter.
- Read supported `metric` values for strength exercises.
- Return typed catalog entries with name, path, kind, metric, and diagnostics for missing or invalid metadata.
- Avoid filesystem APIs. Use Obsidian vault and metadata APIs only.

The domain tier stays pure. Frontmatter and vault access belong in `src/vault/`.

### 5.2 Effective registry builder

Replace the current filename-only merge behavior with an effective registry builder.

Rules:

- Start with catalog entries from exercise notes.
- Overlay saved registry aliases onto the matching note-backed entry by normalized name.
- Keep saved registry entries that do not have a matching note.
- For note-backed entries, ignore saved registry `kind`.
- For no-note entries, preserve saved registry `kind`.
- When saved registry `kind` disagrees with note frontmatter `kind`, prefer the note and return a diagnostic that Settings or sync can surface.
- Exclude names that have deliberate deletion tombstones, unless the user explicitly restores or unignores them.
- Preserve deterministic sorting and alias deduplication.

The existing `ExerciseRegistryEntry` type may remain the resolution shape, but the vault layer should also expose catalog metadata for UI that needs paths or diagnostics.

### 5.3 Tombstones for deleted exercises

Add a small settings-backed tombstone list for deliberately deleted exercise names, likely normalized names or stable exercise keys. The exact storage shape can be chosen during implementation, but it should be explicit enough that agents can distinguish "missing because never imported" from "missing because the user deleted or ignored it".

Rules:

- Deleting an exercise through FitKit records a tombstone after the note is trashed or `type: exercise` is removed.
- Removing only a registry overlay does not record a tombstone unless the entry has no note and the user chooses an action whose copy clearly says FitKit will ignore that name.
- Import and scan planners must treat tombstoned names as ignored by default, including names found only in historical workout notes.
- The import review should show tombstoned names separately or with an ignored status, with a restore or unignore action.
- Restoring or unignoring removes the tombstone and allows the user to create a note or no-note registry overlay again.
- Tombstones do not hide historical dashboard data. They only prevent automatic catalog recreation.

### 5.4 Frontmatter migration

Update `Sync and repair exercise notes` so it repairs missing or invalid note metadata without overwriting valid note-backed choices from saved registry settings.

Expected behavior:

- Catalog diagnostics should report note and registry conflicts, missing `type: exercise`, missing or invalid `kind`, invalid strength `metric`, and names blocked by tombstones.
- Missing `type: exercise` can still be inserted for files being repaired as exercise notes.
- Missing or invalid `kind` can be repaired from valid note content or a no-note registry entry where appropriate.
- Once a note has valid `kind`, the saved registry must not silently override it.
- If valid note `kind` and saved registry `kind` disagree, prefer the note and report a diagnostic. Do not use a one-time prompt in this pass.
- Strength notes still get a valid default metric when missing or invalid.
- If a note or registry entry conflicts with a tombstone, Sync and repair should surface a repair action: restore or unignore the deleted name, or keep it ignored and leave the note or overlay alone unless the user chooses a destructive action.
- Duration metric semantics are out of scope. Duration chart behavior should not be widened while repairing strength metrics.

### 5.5 Delete semantics

Clarify the registry settings UI.

There are two different actions:

- Remove registry overlay: removes aliases and no-note registry metadata. If a note-backed exercise remains, the exercise still exists.
- Delete exercise: trashes the matching exercise note, removes the overlay, and records a tombstone so imports and scans do not recreate the name from old workout notes.
- Restore or unignore deleted exercise: removes the tombstone and lets the user create a note or no-note overlay again.

The existing delete modal already has an "Also delete the note file" checkbox. This phase should be treated as a copy and action-label tightening unless implementation finds a real behavior gap. A retained exercise note should not be described as fully deleted.

### 5.6 Import and creation flow

Do not bring back free-text journal import. Add an exercise import and creation path built on existing structured sources.

Recommended shape:

- Add an `Import exercises` action in Settings, likely in the Registry section. Do not add it to the command palette in the first pass.
- Scan exercise notes and parsed FitKit workout notes under the configured fitness root.
- Present a review table with exercise name, resolved kind, registry status, note status, tombstone or ignored status, and checkboxes for creating notes or keeping no-note registry entries.
- Reuse `composeExerciseNote()` from `src/vault/exercise-note.ts` when creating note files.
- Reuse registry validation and upsert helpers.
- Put the vault-aware planner in `src/vault/exercise-import-planner.ts`.
- Update workout editor `Add exercise` so a newly typed name prompts once with a default-on `Create exercise note` option.
- If the user creates a note, do not also create a registry overlay unless aliases or no-note metadata are explicitly needed.
- If the user skips note creation, create a no-note registry overlay so future suggestions and kind resolution still work.
- If a historical workout references a tombstoned exercise, keep it ignored by default and require an explicit restore or unignore before creating a note or overlay.

Replace the existing `Create missing exercises for current workout` command with the Settings import flow. The first pass keeps import in Settings and scans saved FitKit workout notes instead of adding another daily command.

### 5.7 Onboarding and command UX

Keep command palette entries focused on daily work:

- `open-todays-workout`: `Open today's workout`
- `open-workout-editor`: `Open workout editor for current file`

Move maintenance and setup actions into Settings:

- Rebuild index.
- Rebuild dashboard.
- Restore hidden dashboard sections.
- Show parse diagnostics.
- Sync and repair exercise notes, including catalog diagnostics from note and registry kind conflicts, missing or invalid metadata, and deleted-name tombstones that can be restored or kept ignored.
- Import exercises from saved FitKit workout history.

No command should be removed until its replacement Settings action exists in the same PR or has already landed.

Settings should have a lightweight onboarding/setup sequence:

1. Choose fitness root.
2. Import or scan exercises.
3. Review unknown kinds and missing notes.
4. Sync and repair exercise notes.
5. Open today's workout.

This should be a grouped setup section in Settings, not a long explanatory document inside the plugin and not a persisted completed-state system in the first pass.

### 5.8 Editor control polish

Balance the cog button against the drag handle as a small independent CSS/UI task.

Likely scope:

- Inspect `.fitkit-drag-handle`, `.fitkit-gear-button`, and shared button styles.
- Keep stable 32 px control sizing unless manual testing shows a better Obsidian-native size.
- Ensure icon visual weight and hit target feel balanced on desktop and mobile.
- Keep destructive UI rules unchanged unless the task deliberately includes them.

## 6. Subagent work plan

### Agent A: Catalog architecture

Ownership:

- `src/vault/exercise-catalog.ts`
- `src/vault/exercise-registry-vault.ts`
- Domain helpers only if the merge rules need pure functions.
- Tests for catalog scanning and effective registry merge.

Acceptance criteria:

- Note-backed exercise kind comes from frontmatter.
- Saved aliases still resolve.
- Saved registry kind does not override a valid note-backed kind.
- Divergent note and saved registry kinds produce a diagnostic.
- Tombstoned exercise names are excluded from automatic effective registry recreation.
- Markdown files without `type: exercise` do not become exercises only because they sit under the exercises folder.

### Agent B: Frontmatter sync and delete semantics

Ownership:

- `src/domain/exercise-note-migrate.ts`
- `src/main.ts` sync path if needed.
- `src/settings.ts`
- `src/ui/delete-registry-entry-modal.ts`
- Related tests.

Acceptance criteria:

- Sync repairs missing or invalid metadata without overriding valid note metadata from saved registry state.
- Sync surfaces repair actions for note or registry conflicts, missing or invalid `kind`, and tombstoned names that need restore or unignore.
- Delete UI distinguishes overlay removal from exercise deletion.
- Trashing a note uses `fileManager.trashFile`.
- Deleting an exercise records a tombstone so old workout history does not recreate it during import or scan.
- Retaining a note gives clear copy that the exercise remains.

Agent B starts only after Agent A's catalog contract lands on the shared implementation branch.

### Agent C: Import and add-exercise flow

Ownership:

- A new vault-aware import planner in `src/vault/exercise-import-planner.ts`.
- A thin UI modal for reviewing and applying the planner output.
- `src/ui/workout-editor-view.ts` add exercise flow.
- Settings action wiring from the `Import exercises` button to the planner, after Agent D scaffolding exists.
- Related tests.

Acceptance criteria:

- A user can import exercises from existing FitKit workout notes and exercise notes.
- Import does not recreate a tombstoned exercise unless the user explicitly restores or unignores it.
- A user can create a new exercise note while adding a brand-new exercise in the editor.
- A user can create a no-note registry overlay when they deliberately skip note creation.
- The old journal parser does not return.
- Existing create-missing command behavior is replaced by the Settings import flow.

Agent C starts only after Agent A's catalog contract lands on the shared implementation branch.

### Agent D: Onboarding, commands, and docs

Ownership:

- Command registrations in `src/main.ts`.
- Settings maintenance/onboarding UI in `src/settings.ts`.
- README and changelog.
- Command registration tests.

Acceptance criteria:

- Daily command palette contains only daily workflow commands.
- Maintenance actions remain reachable from Settings.
- No command is removed before its Settings replacement exists in the same PR or has already landed.
- `Import exercises` is Settings-only in the first pass.
- Agent D may scaffold the `Import exercises` Settings entry, but Agent C owns wiring it to the planner.
- README no longer claims the registry editor is missing.
- README documents chart session settings and the actual maintenance actions.
- Changelog records user-visible command and onboarding changes.

Agent D can start Settings scaffolding, README cleanup, and command registration tests after the product decision is confirmed. Command removal waits for the replacement Settings actions.

### Agent E: Cog and drag handle polish

Ownership:

- `styles.css`
- Minimal markup changes only if CSS cannot solve the balance issue.
- Visual/manual verification notes.

Acceptance criteria:

- Cog and drag handle have balanced visual weight.
- Hit targets remain usable on mobile.
- No layout shift in exercise cards.

Agent E can run in parallel with all other agents.

## 7. Suggested sequencing

1. Confirm the product decision in section 2.
2. Agent E can start immediately.
3. Agent D can start Settings scaffolding, README cleanup, and tests, but must not remove command palette entries yet.
4. Agent A implements and lands the catalog contract on the shared implementation branch.
5. Agent B updates sync and delete semantics on top of Agent A.
6. Agent C adds import and add-exercise creation flows on top of Agent A.
7. Agent D removes replaced commands only after the Settings actions exist.
8. Run a final integration pass for Settings layout, README consistency, and changelog wording.

## 8. Test plan

Required local verification for implementation branches:

- `npm test`
- `npm run lint`
- `npm run format:check`
- `npm run build`

Targeted coverage to add:

- Catalog reader includes only `type: exercise` notes.
- Effective registry uses note frontmatter kind for note-backed entries.
- Effective registry keeps saved aliases on note-backed entries.
- Effective registry preserves no-note registry entries.
- Effective registry reports divergent note and saved registry kinds.
- Effective registry excludes tombstoned names unless restored.
- Sync does not overwrite valid note-backed kind from saved registry kind.
- Sync reports missing or invalid `kind`, note or registry conflicts, and tombstoned names with repair actions.
- Delete overlay only leaves a note-backed exercise visible.
- Delete exercise with note trash removes it from the catalog after rebuild.
- Deleted exercise tombstones prevent import from recreating old names from historical workout notes.
- Restore or unignore removes the tombstone and allows explicit recreation.
- Dashboard can still show historical workout data independent of catalog deletion.
- Import planner dedupes names across workout notes and exercise notes.
- Editor add flow can create a note for a new name.
- Editor add flow can create a no-note registry overlay when note creation is skipped.
- The final command-removal PR has a registration test that contains only `open-todays-workout` and `open-workout-editor`.

Manual verification:

- Fresh vault onboarding.
- Existing vault with exercises folder and empty registry.
- Existing vault with registry aliases and exercise notes.
- Delete overlay only, then rebuild dashboard and registry views.
- Delete exercise note, then rebuild.
- Delete exercise note, run import from historical workouts, verify the name remains ignored until restored.
- Add a new exercise from the workout editor on desktop and mobile.

## 9. Review gates

Before implementation:

- Claude review of this plan.
- CodeRabbit CLI review of this plan diff.
- User confirmation of section 2 and section 11.

Before PR:

- Independent review of implementation branch changes.
- CodeRabbit CLI review of committed or PR diff.
- One release label: `minor` for the full feature set, or `patch` for isolated polish/fix slices.

## 10. Risks

- Treating exercise notes as canonical changes behavior for users who edited registry kind but not note frontmatter. Mitigation: prefer the note, surface diagnostics, and provide repair paths.
- Dashboard history can make deleted exercises appear to persist. Mitigation: copy must explain that delete does not rewrite history, while tombstones prevent catalog recreation.
- Tombstones can make an exercise look missing if users forget they ignored it. Mitigation: diagnostics and import review must show ignored names with restore or unignore actions.
- Settings could become crowded if maintenance, onboarding, registry, and import all land as separate blocks. Mitigation: use concise grouped sections and avoid long in-plugin explanations.
- Add-exercise creation can interrupt fast workout entry if it asks too many questions. Mitigation: only ask creation questions for unknown names, with sensible defaults.

## 11. Confirmed and open decisions

Confirmed:

1. Keep no-note registry entries as a supported lightweight mode, but make note creation the default for new exercises.
2. When deleting an exercise note through FitKit, also remove the matching registry overlay.
3. Keep dashboard history visible after exercise deletion. A hide/archive concept is separate future work.
4. Make onboarding a grouped setup section in Settings without a persisted completed state in the first pass.
5. Keep daily commands in the command palette, and move maintenance actions to Settings after replacement actions exist.
6. Make `Import exercises` a Settings-only action in the first pass.
7. When adding a brand-new exercise during a workout, prompt once with a default-on `Create exercise note` option.

Still recommended:

None.

## 12. Common understanding target

Implementation should not start until we agree on these statements:

- Exercise note frontmatter is canonical for note-backed exercise metadata.
- The registry is an overlay for aliases and no-note exercises.
- Deleting an overlay is not deleting an exercise.
- Deleting an exercise does not rewrite old workout notes.
- Deleted exercise tombstones prevent import and scans from recreating historical names until the user restores or unignores them.
- Sync and repair surfaces diagnostics and repair actions for note or registry conflicts, missing or invalid kind, and tombstoned names.
- Importing exercises means scanning structured FitKit notes, not parsing free-form journals.
- `Import exercises` is a Settings action, not a daily command.
- Daily commands stay in the command palette, maintenance actions move to Settings after replacement actions exist.
