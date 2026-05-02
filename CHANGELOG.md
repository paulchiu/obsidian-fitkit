# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog v1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

### Changed

### Fixed

### Removed

## [0.11.0] - 2026-05-02

### Added

- Workout notes now render their FitKit rows as compact read-only tables in Obsidian reading mode, while keeping the raw Dataview inline-field source unchanged.
- New `Auto-open workout editor` setting. Turn it off to keep workout notes in normal Markdown views by default and open the editor only via command.

### Changed

### Fixed

### Removed

## [0.10.2] - 2026-05-02

### Added

### Changed

### Fixed

### Removed

## [0.10.1] - 2026-05-02

### Added

### Changed

### Fixed

- Workout editor: Add bottom clearance on mobile so the Add exercise button is not covered by Obsidian's floating toolbar.
- Workout editor set note popup buttons remain reachable above the iOS keyboard.

### Removed

## [0.10.0] - 2026-04-29

### Added

- Edit and curate the exercise registry directly from settings: list, search, add, edit, and delete entries (canonical name, kind, aliases) without touching `data.json`. Renaming an entry keeps the old name as an alias so existing workout references still resolve. Deleting an entry can optionally trash the matching note file in your Exercises folder.
- Exercise pages now include a progression chart: heaviest weight per workout date for strength exercises, total session duration for duration exercises. Shows the last 30 sessions by default; configurable via the new `Chart sessions` setting or per-block with `window: <N>` inside a `fitkit-chart` block. Charts read from the cached workout index; if a freshly logged workout doesn't appear, run `Rebuild index`.
- New command `Sync exercise notes`: walks every `type: exercise` note in your Exercises folder and inserts the chart block where missing, so existing notes pick up the chart without manual editing. Idempotent.
- `Sync exercise notes` now repairs existing exercise notes to the current template, including missing frontmatter, stale Recent sessions queries, missing Progress chart blocks, and missing Notes headings.
- New metric frontmatter field on exercise notes (weight | e1rm), honored by chart and dashboard.
- Dashboard honoring per-exercise metric for display and PB ranking.

### Changed

- Exercise note templates and repair now place Progress chart immediately after frontmatter, before Recent sessions and Notes.
- Chart strength default shifted from max-weight to e1rm (breaking for existing chart embeds without explicit metric: weight).

### Fixed

- Exercise chart blocks now distinguish missing and invalid exercise-note `kind:` frontmatter when showing fallback notes.
- Bodyweight strength charts and dashboard PBs consistently keep zero-weight sets.
- `Sync exercise notes` now scans every note in the Exercises folder, so notes without frontmatter can receive missing chart blocks and other template repairs.
- `Sync exercise notes` now seeds the Notes Dataview block when repairing missing or empty Notes sections.

### Removed

## [0.9.1] - 2026-04-28

### Added

### Changed

### Fixed

- Importing a journal or creating missing exercises now seeds the new exercise note with Recent sessions and Notes Dataview sections instead of an empty stub.

### Removed

## [0.9.0] - 2026-04-28

### Added

- Dashboard exercise sections now include a wikilink to the matching exercise note.

### Changed

- Dashboard PB list now links each entry to the matching exercise section in the dashboard.

### Fixed

### Removed

## [0.8.1] - 2026-04-28

### Added

### Changed

### Fixed

- Settings: editing the Fitness root no longer loses focus after every character; the derived-paths preview now updates in place.

### Removed

## [0.8.0] - 2026-04-27

### Added

- Workout editor now shows a skeleton placeholder while a workout file is loading, with a minimum visibility window so quick loads do not blink past it.

### Changed

- When you switch the workout editor to a different file (or close the editor) while a duration timer is running, the timer's elapsed seconds are now saved to the row before the swap. Previously they were silently discarded.

### Fixed

- Workout editor opens automatically when you click a `type: workout` note from the file explorer, a wikilink, search results, or a restored tab. Previously these entry points opened the raw markdown editor.
- Workout editor now retargets in place to the clicked workout file instead of spawning a second editor leaf or requiring you to reopen via the command palette.

### Removed

## [0.7.0] - 2026-04-27

### Added

- Workout editor duration cards now have a timer for the current set. Press Start timer to time the set, press Stop timer to record the elapsed seconds. If the row already has a duration, the timer resumes from there.

### Changed

### Fixed

### Removed

## [0.6.0] - 2026-04-27

### Added

- Workout editor exercise cards now show PB and Last badges from prior workout history.
- Workout editor exercise and row menus now include Open exercise file.

### Changed

- Workout editor strength PBs now use the heaviest recorded weight at any rep count rather than estimated 1RM.

### Fixed

### Removed

## [0.5.0] - 2026-04-27

### Added

- Workout editor: mobile row kebab menu is now reachable for Edit note and Delete row.

### Changed

### Fixed

### Removed

- Workout editor: swipe row actions on mobile.

## [0.4.2] - 2026-04-27

### Added

### Changed

### Fixed

- Workout editor: "Open today's workout" and "Open workout editor for current file" now reliably open in the main area on Obsidian Mobile, including the case where a previous version stranded the editor in a side drawer (the stranded leaf is detached on next open).

### Removed

## [0.4.1] - 2026-04-27

### Added

### Changed

### Fixed

- Workout editor: "Open today's workout" and "Open workout for active note" now open in the main editor area on Obsidian Mobile instead of the side or right drawer.

### Removed

## [0.4.0] - 2026-04-26

### Added

- Workout editor: per-row overflow kebab menu on desktop with Edit note and Delete row entries.
- Workout editor: touch swipe gestures on rows (swipe right to edit note, swipe left to delete) on Obsidian Mobile.

### Changed

- Workout editor: Add Exercise and Rename Exercise now take the kind from the matching exercise registry entry; unknown names still fall back to strength.
- Workout editor: switching kind via the gear menu, or renaming into an exercise of a different kind, seeds one empty row of the new kind.
- Workout editor: card top-row controls (drag handle, name button, gear button) now share a single height for visual alignment.
- Workout editor: gear menu kind switch now opens a three-button modal (Cancel, Just this workout, Update registry too) so users can persist the new kind back to the exercise registry without leaving the editor.

### Fixed

### Removed

- Workout editor: per-row pencil and trash buttons replaced by the overflow kebab and the swipe gestures.

## [0.3.0] - 2026-04-26

### Added

- Workout editor: per-card gear menu (switch kind, move up, move down, remove with confirmation).
- Workout editor: drag-and-drop exercise reorder via a left-edge grip handle (mouse and touch).
- Workout editor: editable workout name in the header.
- Workout editor: per-set notes via a pencil icon and a modal; non-empty notes render as wrapping muted text below the row.
- Workout editor: exercise rename via the existing picker (with "add new" support).

### Changed

- Workout editor opens in the main area instead of the right sidebar.
- Workout editor strength rows render as three equal columns (set, weight, reps) at all viewport widths; duration rows render as two equal columns (set, duration).
- Per-row delete (set or duration entry) now asks for confirmation.

### Fixed

### Removed

- Workout editor: legacy up and down buttons (replaced by drag-and-drop and the gear menu).
- Workout editor: legacy remove-exercise X button (replaced by the gear menu).
- Workout editor: inline strength/duration toggle buttons (replaced by the gear menu).
- Workout editor: inline per-row notes input (replaced by the pencil icon and modal).

## [0.2.1] - 2026-04-26

### Added

### Changed

- Plugin and package descriptions now mention the Dataview plugin dependency.
- README documents the Dataview plugin requirement and expands the Development section.

### Fixed

### Removed

- Dropped "LLM-assisted import" from the README limitations list; it was never planned.

## [0.2.0] - 2026-04-26

### Added

### Changed

- Plugin id renamed from `obsidian-fitkit` to `fitkit` to comply with the Obsidian community plugin naming rules (id must not include `obsidian`). The plugin's data folder under `.obsidian/plugins/` moves accordingly; any prior `data.json` will need to be relocated by hand.
- Command IDs no longer carry the redundant `fitkit-` prefix. Existing user-set hotkeys for these commands will need to be re-bound.
- Background file writes (dashboard regeneration, journal import, workout editor autosave) now use `Vault.process()` instead of `Vault.modify()`, aligning with current Obsidian guidance.

### Fixed

### Removed

## [0.1.0] - 2026-04-25

### Added

- Workout note parser, serializer, and round-trip preservation including fenced code blocks (Phase 1).
- Exercise registry with alias resolution and a "Bootstrap from vault" settings action that scans the exercises folder (Phase 1, Phase 5).
- Journal grammar covering `weight x reps`, `weight / reps`, multi-rep `w / r1 / r2 / r3`, and duration patterns `60s` and `30m` (Phase 1).
- Settings tab with a single configurable `fitnessRoot` (default `Fitness`), journal folder, autosave debounce, auto-create-missing-exercises and auto-update-dashboard toggles, plus a live derived-paths preview (Phase 2).
- Local index and a generated dashboard at `<fitnessRoot>/Fitness Dashboard.md` with a PB summary plus per-exercise Dataview queries; respects user-hidden sections (Phase 3).
- Workout editor ItemView with debounced autosave, FNV-hash and mtime conflict detection, mobile narrow-layout, kind-switch confirm modal, and right-sidebar fallback (Phase 4).
- Journal import modal with mapping UI for unknown exercises, auto-update of the index and dashboard on success (Phase 5).
- Eight palette commands: rebuild index, rebuild dashboard, restore hidden sections, show parse diagnostics, open today's workout, open workout editor for current file, import workout from journal note, import workout from pasted text.

### Changed

### Fixed

- Dashboard strength tables now use Dataview list fields instead of text matching.
- Journal import now accepts bare exercise rows like `Squat 100 x 5` and `Plank 60s`.
- Journal import now treats a leading `yyyy-mm-dd` line as the workout date, resolves exercise notes from the vault when the saved registry is empty, and only saves mapping changes after a successful import.
- Blank workout editor strength rows no longer persist as zero-weight zero-rep sets.
- Autosave debounce settings now show the clamped fallback after invalid input.
- Zero-rep strength sets no longer qualify as PBs.

### Removed
