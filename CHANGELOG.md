# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog v1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

### Changed

### Fixed

### Removed

## [0.21.0] - 2026-08-22

### Added

- Surface FitKit's settings in Obsidian's settings search on 1.13 and later by describing the tab
  declaratively. Obsidian below 1.13 keeps rendering the same tab through `display()`.

### Changed

- Rewrite the README around the current feature set and move the detail into dedicated `docs/`
  pages for the workout editor, exercise registry, dashboard and charts, note format, and settings.
- Replace the stale README screenshots and add ones for the registry, rename and merge previews,
  reading mode, and the maintenance actions.

### Fixed

### Removed

## [0.20.0] - 2026-08-21

### Added

- A "Rebuild registry" maintenance action that backfills the registry overlay with every
  exercise note and workout-history-only name it's missing, turning the registry into a
  comprehensive list you can curate wording, casing, and exercise splitting from. It never
  overwrites an existing entry, never records a unit for a name it adds, and skips names
  you've already deleted.
- A "Rename" action for note-backed Registry rows that previews every effect before writing
  anything: the note file rename, every workout note that will change and how many rows in
  each, the old name kept as an alias, and any wikilink it can't safely rewrite (pathed or
  aliased forms) surfaced as left stale instead of silently guessed at. Renaming onto a name
  already in use merges the two entries and carries the losing note's `## Notes` prose into
  the surviving note before removing it, with an explicit warning shown first. Confirming is
  safe to re-run: a partial failure leaves the modal open with a freshly recomputed preview so
  confirming again finishes only what is left.

### Changed

- Registry lookups (kind switch, upsert, remove) now match exercise names case- and
  whitespace-insensitively, so a differently-cased workout card updates the existing
  registry entry instead of creating a second, ambiguous one.
- Exercise unit precedence is now frontmatter-first everywhere: the exercise note's
  `unit:` wins when present, and the registry overlay's unit is only a fallback. Sync and
  repair no longer overwrites a valid frontmatter unit with a registry value.
- The Settings > Registry table now lists every exercise the plugin knows about (notes,
  no-note entries, and workout-history-only names), each tagged with where it comes from.
  A note-backed row now offers a "Rename" action, wired to the preview-and-apply flow above,
  in place of the previous disabled Edit button that had no effect; deleting a note-backed
  row still offers to also delete its note file.

### Fixed

- Kind switches and exercise renames now detect matching exercise note files even when
  malformed frontmatter keeps them out of Obsidian's metadata cache. Kind switches leave
  such notes byte-identical and report that they could not be updated, while renames refuse
  to proceed until the source note's frontmatter is valid.
- Switching an exercise's kind now writes `kind:` into that exercise's note frontmatter
  when a note exists, since the note is what wins on the next read. Previously the switch
  only updated the settings registry overlay, which a note-backed exercise silently
  discarded on the next read despite the success notice. If the note's frontmatter can't be
  parsed, the notice now says so instead of falsely claiming success.
- Logging a new exercise and accepting the "create note" prompt now also adds a registry
  overlay entry for it, so the exercise shows up in the settings Registry table instead of
  staying invisible there forever.
- The registry no longer synthesizes a `kg` unit for legacy entries with no unit recorded.
  A synthesized default was indistinguishable from an explicit choice, so Sync and repair
  could silently overwrite a hand-edited `unit: lbs` in an exercise note. Editing an entry
  through the Settings > Registry table (even just to change an alias) no longer synthesizes
  that default either; an unrecorded unit stays unrecorded unless the unit dropdown is
  actually touched.

### Removed

## [0.19.2] - 2026-08-21

### Added

### Changed

### Fixed

- The workout editor's autosave round-trip (parse note text, then write it back) no longer
  destroys content it does not model. Unrecognised frontmatter keys (`tags:`, `aliases:`,
  custom keys), non-exercise bullets (task checkboxes, plain notes), nested sub-bullets,
  section headings that are not exercise headings, and other body content (prose paragraphs,
  blockquotes, embeds, tables) are now captured verbatim at parse time and re-inserted at
  their original position on save. A note the editor did not create can now be opened once
  without silently losing hand-written content on the next autosave. Unrecognised inline
  fields (for example `[rpe:: 7]`) remain the one documented exception; see the README.
- A fenced code block in a workout note keeps its position and its surrounding blank lines
  across an editor save. It was previously moved to the end of its section and had the blank
  line separating it from neighbouring content stripped, which could make the fence render as
  part of the preceding list item.
- An exercise heading written by hand as `## Squat`, `## [[squat]]`, or with a pathed link is
  recognised as that exercise's heading rather than being duplicated alongside a generated
  one.

### Removed

## [0.19.1] - 2026-08-17

### Added

### Changed

### Fixed

- Next-session history badges no longer serve a stale plan after the workout editor
  autosaves. The editor now refreshes the cached index entry for the note it just wrote,
  so an edited or cleared `next::` value is reflected immediately instead of waiting for
  a manual `Rebuild index`.
- The next-time step field now stays on the same row as the direction buttons instead of
  stretching to full width and wrapping onto a line of its own.

### Removed

- The live target-weight preview under the Next time control. It restated what the
  direction and step already say, and went stale when the set weight changed underneath
  it.
- The `Auto-update dashboard on save` setting. Nothing ever read it, so the toggle had no
  effect; the dashboard still regenerates from the `Rebuild dashboard` maintenance
  action.

## [0.19.0] - 2026-08-16

### Added

- Strength exercise cards can record how to load the exercise next session (up, stay, or
  down) with an optional weight change, saved to the note as `[next:: up 2.5]`.
- The workout editor shows the plan recorded last session as a badge beside PB and Last
  max, resolved to a target weight when the plan carries a step.
- Reading mode shows the plan recorded on an exercise, and the dashboard gains a
  `Next session plans` section listing every exercise with an outstanding plan.

### Changed

- Changing an exercise unit in the registry editor now warns that recorded weights and
  next-time steps stay as written.
- History badges now break same-date ties by modification time, so the most recently
  written note wins when an exercise is logged twice in one day.

### Fixed

### Removed

## [0.18.0] - 2026-06-14

### Added

- Exercise names in the workout editor now open existing exercise notes in one click or
  create the note before opening it when missing.

### Changed

- Renaming an exercise in the workout editor now uses a dedicated pencil button beside
  the exercise name.

### Fixed

- Opening or creating an exercise note from a workout card now resolves aliases to the
  canonical exercise file, uses one normalized path for lookup, create, and open, and
  clears restored exercise tombstones.

### Removed

## [0.17.2] - 2026-06-14

### Added

### Changed

- Raised `minAppVersion` to 1.7.2 to match the newest Obsidian APIs the plugin already uses (`Workspace.revealLeaf` requires 1.7.2; also `FileManager.trashFile`, `Vault.createFolder`, `Vault.process`, and `Menu.showAtPosition`).
- Updated dev dependencies, including `eslint-plugin-obsidianmd` to 0.3.0. Scoped its typed rules to real TypeScript source so they no longer crash on `package.json` and config files, re-enabled the six rules the interim fix had disabled (`no-plugin-as-component`, `no-view-references-in-plugin`, `no-unsupported-api`, `prefer-file-manager-trash-file`, `prefer-instanceof`, `no-global-this`), and fixed the violations they flagged. `prefer-window-timers` stays disabled because it conflicts with the project's `activeWindow` popout-safety convention.

### Fixed

### Removed

## [0.17.1] - 2026-06-14

### Added

### Changed

### Fixed

### Removed

## [0.17.0] - 2026-06-14

### Added

### Changed

- Duplicating a strength set in the workout editor now focuses the Reps field instead of Weight, since the duplicated weight usually carries over and only the rep count needs editing.

### Fixed

### Removed

## [0.16.3] - 2026-06-14

### Added

### Changed

### Fixed

### Security

- Bump esbuild (build-time devDependency) to 0.28.1 to resolve a high-severity advisory (GHSA-gv7w-rqvm-qjhr). No runtime or user-facing change.

### Removed

## [0.16.2] - 2026-05-12

### Added

### Changed

### Fixed

- Deleted exercises no longer appear in the add-exercise suggestion list in the workout editor.

### Removed

## [0.16.1] - 2026-05-12

### Added

### Changed

### Fixed

- Sync and repair exercise notes now overwrites strength unit: frontmatter to match the registry, so changing a unit in settings reflects in charts and the dashboard after the next sync.
- Sync and repair exercise notes now preserves valid note-backed strength `unit:` frontmatter when the exercise has no registry entry, instead of resetting it to kg.
- Sync and repair exercise notes now preserves valid note-backed strength `unit:` frontmatter when a duration registry entry conflicts with the note kind, instead of resetting it to kg.
- Dashboard PB lines now fall back to the registry unit when an exercise note has an invalid unit: value, instead of silently using kg.

### Removed

## [0.16.0] - 2026-05-12

### Added

- Dashboard now opens with a "Recent workouts" section listing the last 10 workout dates and names linked to their notes. Existing dashboards are updated when rebuilt.
- Added per-exercise strength weight units (`kg` or `lbs`) through the registry editor and exercise-note `unit:` frontmatter, with chart and dashboard labels using the selected unit without converting stored numbers.

### Changed

- Exercise chart e1rm and weight axis labels now include the active `kg` or `lbs` unit, and e1rm values render with the same unit suffix as chart ticks.

### Fixed

- `Sync and repair exercise notes` now backfills missing strength `unit:` frontmatter from the registry or kg, and repairs invalid unit values from the registry or kg.

### Removed

## [0.15.2] - 2026-05-09

### Added

### Changed

- README now explains installation, first-run workout tracking, Dataview expectations, and key feature screenshots.

### Fixed

### Removed

## [0.15.1] - 2026-05-09

### Added

### Changed

### Fixed

### Removed

## [0.15.0] - 2026-05-09

### Added

### Changed

### Fixed

### Removed

## [0.14.2] - 2026-05-06

### Added

- Exercise charts now plot completed reps for bodyweight strength exercises when no positive-weight sets exist.
- Settings now includes setup and maintenance actions for rebuilding the index, rebuilding the dashboard, restoring hidden dashboard sections, showing parse diagnostics, showing exercise registry diagnostics, and syncing exercise notes.
- Exercise catalog onboarding now treats vault exercise notes as the source of truth for registry and import repair flows.
- Settings now includes an Import exercises action that scans workout history, creates missing exercise notes or no-note registry entries, and respects deleted-exercise tombstones.
- Added `deletedExercises` settings tombstones so deleted exercise notes stay ignored until explicitly restored.

### Changed

- Maintenance actions now live in Settings so the command palette stays focused on daily workout entry.
- Catalog and import onboarding surfaces have clearer button and icon polish.
- The old Bootstrap from vault registry action was replaced by catalog-backed runtime entries and the Import exercises review flow.

### Fixed

- Exercise charts now treat strength rows with reps and no weight as bodyweight sets, and e1rm charts fall back to plotting reps when an exercise only has bodyweight data.
- Bodyweight personal bests now render as `N reps` instead of `0 kg x N` in editor badges and dashboard PB rows.
- Import exercises now lets matched registry entries create missing exercise note files.

### Removed

- Removed rebuild, dashboard restore, parse diagnostics, create-missing-exercises, and exercise-note sync maintenance commands from the command palette.

## [0.14.1] - 2026-05-05

### Added

### Changed

### Fixed

- `Sync and repair exercise notes` now fills missing no-registry exercise `kind:` frontmatter by inferring from existing Recent sessions or defaulting to strength, and tells you how many notes need validation.

### Removed

## [0.14.0] - 2026-05-05

### Added

### Changed

### Fixed

### Removed

- Removed the free-text journal import commands, parser, and importer settings surface.

## [0.13.1] - 2026-05-04

### Added

### Changed

- Workout editor rest timer now lives in the footer and keeps showing the last rest duration after you stop it.

### Fixed

### Removed

## [0.13.0] - 2026-05-03

### Added

- Workout editor strength rows now include a view-only rest timer, so you can time rest between sets without changing the workout note.
- Settings now let you turn the strength rest timer on or off.

### Changed

### Fixed

### Removed

## [0.12.2] - 2026-05-03

### Added

### Changed

### Fixed

- Workout editor duration history badges now use compact duration text instead of raw seconds.

### Removed

## [0.12.1] - 2026-05-02

### Added

### Changed

### Fixed

- `Sync and repair exercise notes` now repairs invalid or stale exercise note `kind:` frontmatter, invalid strength `metric:` values, and stale generated Recent sessions blocks during rebuild.

### Removed

## [0.12.0] - 2026-05-02

### Added

### Changed

### Fixed

### Removed

## [0.11.0] - 2026-05-02

### Added

- Workout notes now render their FitKit rows as compact read-only tables in Obsidian reading mode, while keeping the raw Dataview inline-field source unchanged.
- New `Auto-open workout editor` setting. Turn it off to keep workout notes in normal Markdown views by default and open the editor only via command.
- Workout editor duration fields now display compact time values in one text field up to years, accept entries such as `5m` and `5:30`, and still store workout files as seconds.

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
