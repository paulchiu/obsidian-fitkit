---
status: shipped
target: v0.11.0
date: 2026-05-01
branch: feature/duration-smart-input
generated_by: Codex
generated_at: 2026-05-01T03:05:26+1000
prompt_summary: 'Plan and implement structured duration input for workout editor duration rows.'
---

# Duration structured input plan

## Problem

Workout editor duration rows currently expose the stored value directly as seconds in a numeric field labelled `Duration (s)`. That is fast for raw data entry, but it does not scale once a duration crosses minute or hour boundaries.

The stored workout note format should remain `[duration:: seconds]`. The editor needs a display/input layer that formats seconds for humans while keeping data entry explicit and fast.

## Scope

- Add pure duration display and split/combine helpers in `src/domain`.
- Keep the canonical serialized workout data as numeric seconds.
- Change the workout editor duration input from raw seconds to structured hour, minute, and second numeric inputs.
- Display durations in compact time notation:
  - `<60s`: `45s`.
  - `>=60s` and `<1h`: `m:ss`.
  - `>=1h`: `h:mm:ss`.
- Allow overlarge minute or second values so users can type quickly, then normalise through the stored seconds value.
- Show invalid numeric field text as invalid without corrupting the stored duration value.

## Implementation

1. Create `src/domain/duration-input.ts` with `formatDurationInput`, `durationPartsFromSeconds`, and `secondsFromDurationParts`.
2. Add unit tests for compact formatting and structured part conversion.
3. Update `WorkoutEditorView` duration rows:
   - Header and aria label become `Duration`.
   - Normal editing uses grouped numeric inputs labelled hours, minutes, and seconds.
   - Input changes combine valid parts into stored seconds, clear all blanks to an empty duration, and mark invalid field text with `aria-invalid`.
   - Blur normalises valid parts back from the stored seconds value and reverts invalid text to the current stored value.
   - Timer display uses the compact formatter while the row is disabled.
4. Update focused editor tests for structured display, part conversion, invalid handling, and timer formatting.
5. Add an Unreleased changelog entry.

## Verification

- `npm test`
- `npm run lint`
- `npm run format:check`
- `npm run build`
- CodeRabbit CLI review before PR.
