---
status: approved
target: v0.10.0
date: 2026-04-29
branch: feature/exercise-page-charts
---

## Problem

Strength exercise charts currently plot max weight by date, while the dashboard PB line is based on estimated one-rep max. That makes the exercise note chart disagree with the dashboard for the same exercise.

## Goal

Let each strength exercise note choose whether chart and dashboard PBs use max weight or e1rm through `metric: weight | e1rm` frontmatter. Missing or invalid values should default to e1rm. Duration exercises ignore the field.

## Approach

- Add a pure metric parser and default so chart block rendering and dashboard generation use the same validation rule.
- Extend chart series generation to accept the active strength metric and expose it on the series for SVG formatting.
- Render e1rm chart values without `kg`, with one decimal place and an `e1rm` axis label.
- Read exercise-note metric frontmatter when rendering charts and when regenerating the dashboard.
- Backfill `metric: e1rm` for existing strength exercise notes during sync, without changing existing metric keys.
- Seed new strength exercise notes with `metric: e1rm`; omit the field for duration notes.

## Out of Scope

- Per-workout metric overrides.
- Dashboard UI controls for changing metric.
- Migration or validation notices for duration notes that happen to contain `metric`.

## Tests

- Chart series tests for explicit weight behavior and e1rm aggregation.
- SVG formatting tests for e1rm axis label and tooltip text.
- Exercise-note composer tests for the new frontmatter line.
- Exercise-note migration tests for metric backfill and idempotency.
- Dashboard composer tests for e1rm default display and weight-metric PB display.

## Risk

The main behavior change is that existing strength charts default to e1rm rather than max weight. This is intentional, but users who prefer the old chart can set `metric: weight` on that exercise note.

## Changelog

Add entries under Unreleased for the new metric field, dashboard PB behavior, and chart default change.

## Release Label

minor
