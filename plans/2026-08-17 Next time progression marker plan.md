---
status: shipped
target: 0.19.0
date: 2026-08-17
branch: feature/next-time-progression-marker
---

# Next-time progression marker

## Problem

The exercise card shows PB and last-session max, both backward-looking. Nothing carries
a decision forward. After a set you know whether to add weight next time, and by the next
session that judgement is gone.

## Shape

A note to self, authored by the user, stored in the workout note beside the sets it
refers to, and surfaced the next time the exercise comes up.

Concepts were explored in `~/dev/sandbox/2026-08-17 FitKit Next-Time Progression
Concepts.html`. Chosen: a three-way toggle with an optional step (S3) writing to the
exercise-level bullet, surfaced as a badge in the existing history row (P1).

## Decisions

- **Vocabulary:** direction plus optional step, serialized as `[next:: up 2.5]`.
  `stay` never carries a step.
- **Storage:** the exercise-level bullet in the workout note. The bullet already exists
  for `[notes::]` and `INLINE_FIELD` parses arbitrary keys, so reading is free and every
  marker stays in the log as history. The alternative (exercise-note frontmatter) has no
  history and desyncs when past workouts are edited.
- **Lifecycle:** sticky with no expiry. The most recent plan across all prior sessions
  applies however long the gap.
- **Defaults:** no default step and no default direction. An exercise has no plan until
  the user sets one.
- **Scope:** strength only in the UI. "Up" on a duration exercise means longer for a
  plank and faster for a timed run, and the registry has no field to express which. The
  model round-trips `next` on duration exercises so hand-written values survive.
- **Units:** no conversion. The registry editor warns when the unit changes that recorded
  weights and steps stay as written.
- **Unrecognised values:** ignored silently, not reported as parse diagnostics.

## Implementation

- `src/domain/next-plan.ts`: type, parse, format, and target-weight helpers.
- `src/domain/workout-note-model.ts`: `ExerciseEntry.next`, parsed from and written to the
  exercise-level bullet, included in `canonicalizeForEquality`.
- `src/domain/types.ts` and `src/vault/index.ts`: carry `next` onto the index row.
- `src/domain/exercise-history.ts`: track the most recent plan per exercise and format the
  badge. `isLaterSession` now breaks same-date ties by mtime so the most recently written
  note wins.
- `src/ui/workout-editor-view.ts`: the toggle, step field, live target, and plan badge.
- `src/ui/workout-reading-mode.ts` and `src/vault/dashboard.ts`: read-only surfacing.
- `src/ui/exercise-registry-entry-modal.ts`: unit-change warning.

## Follow-ups

- Prefill the plan as a placeholder in the weight input next session (P2 in the concepts
  doc). Deliberately not in this change: writing a weight that was not lifted would put a
  false record in the log, so any prefill must stay a placeholder until accepted.
- Per-exercise increments on the registry entry, which would give the step field a
  sensible default.
- Duration progression once the registry can say which direction counts as progress.
