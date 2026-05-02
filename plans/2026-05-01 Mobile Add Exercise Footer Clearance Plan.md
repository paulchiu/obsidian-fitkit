---
status: shipped
target: v0.10.1
date: 2026-05-01
branch: main
---

# Mobile Add Exercise Footer Clearance Plan

## Goal

Fix the mobile workout editor footer so the Add exercise button remains tappable when
Obsidian shows its floating bottom toolbar.

## Scope

- Add mobile-only bottom clearance to the workout editor scroll container.
- Keep the existing Add exercise button and footer structure unchanged.
- Add a matching CHANGELOG entry under `## [Unreleased]`.

## Acceptance

- On Obsidian Mobile, scrolling to the bottom of a workout editor leaves the Add exercise
  button above the floating toolbar.
- Desktop layout is unchanged.
- `npm run lint`, `npm run format:check`, `npm run build`, and `npm test` pass.
