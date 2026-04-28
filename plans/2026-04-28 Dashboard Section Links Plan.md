---
status: approved
target: v0.9.0
date: 2026-04-28
branch: feature/dashboard-section-links
---

# Dashboard Section Links Plan

## 1. Problem

The generated FitKit Dashboard has per-exercise sections but no in-note navigation: scrolling is the only way from the PBs list at the top to a specific section. From a section, there is no shortcut to that exercise's note in the vault either.

## 2. Goal

Two-step navigation across the dashboard:

1. The PBs list at the top doubles as a table of contents: each exercise name jumps to its `## Exercise` heading in the same note.
2. Each `## Exercise` section carries a wikilink to that exercise's note in the vault, so the exercise page is one click away.

## 3. Approach

- **TOC links.** In `formatPb` (`src/vault/dashboard.ts:128`), render the leading exercise name as `[[#Exercise|Exercise]]` rather than plain `Exercise`. The bold stays on the outside, so the row reads `- **Squat:** 50 kg x 20 (e1rm 73.3)` in reading mode with the name now clickable and resolving to the matching `## Squat` heading.
- **Section page link.** In the section loop in `composeDashboard` (`src/vault/dashboard.ts:45-52`), insert a path-qualified `[[<exercisesFolder>/Exercise|Exercise]]` line, surrounded by blank lines, between the `## Exercise` heading and the dataview code fence. The path is derived from `exercisesFolder(settings)` (a new parameter to `composeDashboard`) so the link is unambiguous even when another vault note shares the basename. The display label remains the bare exercise name.

Both pieces reuse the same `exerciseName` that already drives the heading; no new data flows through. Hidden sections are filtered before rendering, so they continue to drop out of both the TOC and the section list together.

## 4. Out Of Scope

- No `Open exercise note:` label on the section link; a bare wikilink keeps the markdown terse.
- No back-to-top link from each section.
- No change to the Dataview queries, the PB ordering, or the hidden-section settings.
- No change to exercise notes themselves. Obsidian renders missing wikilinks as create-stub links, identical to today's Dataview output for missing exercises.

## 5. Tests

UI rendering is verified manually per AGENTS.md §6. The pure composer is covered by `tests/vault/dashboard.test.ts`. Updates:

- Update the strength/duration phrasing test to also assert the PB row contains `[[#Squat|Squat]]` and that the `## Squat` section block contains `[[Squat]]` on its own line between the heading and the code fence.
- Update the "no completed sets" test fixture so its asserted PB row reflects the new linked format.
- Add a small assertion that the duration exercise (Plank) gets the same TOC link and section page link.

Manual:

1. Rebuild the dashboard. Confirm clicking a PB row's exercise name jumps to that section.
2. Confirm clicking the `[[Exercise]]` link under each section opens the matching exercise note.
3. Hide a section via the existing settings flow and confirm both the TOC entry and the section disappear.

## 6. Risk

Low. Pure-module change in a single file with one focused test update. No data migration, no settings change, no view lifecycle. Heading-incompatible characters in `exerciseName` are an existing risk surface (already used as `## heading`), so this change adds none.

## 7. Changelog

Under `### Added`:

- Dashboard exercise sections now include a wikilink to the matching exercise note.

Under `### Changed`:

- Dashboard PB list now links each entry to the matching exercise section in the dashboard.

## 8. Release Label

`minor`.
