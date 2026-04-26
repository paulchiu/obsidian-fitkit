# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog v1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

### Changed

- 2026-04-26: Plugin id renamed from `obsidian-fitkit` to `fitkit` to comply with the Obsidian community plugin naming rules (id must not include `obsidian`). The plugin's data folder under `.obsidian/plugins/` moves accordingly; any prior `data.json` will need to be relocated by hand.
- 2026-04-26: Command IDs no longer carry the redundant `fitkit-` prefix. Existing user-set hotkeys for these commands will need to be re-bound.
- 2026-04-26: Background file writes (dashboard regeneration, journal import, workout editor autosave) now use `Vault.process()` instead of `Vault.modify()`, aligning with current Obsidian guidance.

### Fixed

### Removed

## [0.1.0] - 2026-04-25

### Added

- 2026-04-26: Workout note parser, serializer, and round-trip preservation including fenced code blocks (Phase 1).
- 2026-04-26: Exercise registry with alias resolution and a "Bootstrap from vault" settings action that scans the exercises folder (Phase 1, Phase 5).
- 2026-04-26: Journal grammar covering `weight x reps`, `weight / reps`, multi-rep `w / r1 / r2 / r3`, and duration patterns `60s` and `30m` (Phase 1).
- 2026-04-26: Settings tab with a single configurable `fitnessRoot` (default `Fitness`), journal folder, autosave debounce, auto-create-missing-exercises and auto-update-dashboard toggles, plus a live derived-paths preview (Phase 2).
- 2026-04-26: Local index and a generated dashboard at `<fitnessRoot>/Fitness Dashboard.md` with a PB summary plus per-exercise Dataview queries; respects user-hidden sections (Phase 3).
- 2026-04-26: Workout editor ItemView with debounced autosave, FNV-hash and mtime conflict detection, mobile narrow-layout, kind-switch confirm modal, and right-sidebar fallback (Phase 4).
- 2026-04-26: Journal import modal with mapping UI for unknown exercises, auto-update of the index and dashboard on success (Phase 5).
- 2026-04-26: Eight palette commands: rebuild index, rebuild dashboard, restore hidden sections, show parse diagnostics, open today's workout, open workout editor for current file, import workout from journal note, import workout from pasted text.

### Changed

### Fixed

- 2026-04-26: Dashboard strength tables now use Dataview list fields instead of text matching.
- 2026-04-26: Journal import now accepts bare exercise rows like `Squat 100 x 5` and `Plank 60s`.
- 2026-04-26: Journal import now treats a leading `yyyy-mm-dd` line as the workout date, resolves exercise notes from the vault when the saved registry is empty, and only saves mapping changes after a successful import.
- 2026-04-26: Blank workout editor strength rows no longer persist as zero-weight zero-rep sets.
- 2026-04-26: Autosave debounce settings now show the clamped fallback after invalid input.
- 2026-04-26: Zero-rep strength sets no longer qualify as PBs.

### Removed
