---
status: shipped
target: v0.11.0
date: 2026-05-01
branch: feature/duration-smart-input
generated_by: Codex
generated_at: 2026-05-01T03:05:26+1000
prompt_summary: 'Plan and implement smart duration input for workout editor duration rows.'
---

# Duration smart input plan

## Problem

Workout editor duration rows currently expose the stored value directly as seconds in a numeric field labelled `Duration (s)`. That is fast for raw data entry, but it does not scale once a duration crosses minute or hour boundaries, and it blocks natural entries such as `3min`.

The stored workout note format should remain `[duration:: seconds]`. The editor needs a display/input layer that can format seconds for humans and parse human-friendly input back into seconds.

## Scope

- Add a pure duration display and parsing helper in `src/domain`.
- Keep the canonical serialized workout data as numeric seconds.
- Change the workout editor duration input from numeric seconds to text input.
- Display durations in compact time notation:
  - `<60s`: `45s`.
  - `>=60s` and `<1h`: `m:ss`.
  - `>=1h`: `h:mm:ss`.
- Accept smart input forms:
  - Plain seconds, for existing `90` style entry.
  - Unit suffixes such as `90s`, `3min`, `3 minutes`, and `1.5h`.
  - Composite unit phrases such as `1h 2m 3s`.
  - Clock notation such as `1:30` and `1:02:03`.
- Show invalid text as invalid in the field without corrupting the stored duration value.

## Implementation

1. Create `src/domain/duration-input.ts` with `formatDurationInput` and `parseDurationInput`.
2. Add unit tests for seconds, minute, hour, composite, clock, blank, and invalid cases.
3. Update `WorkoutEditorView` duration rows:
   - Header and aria label become `Duration`.
   - Input uses `type="text"` with `inputmode="text"`.
   - Rendered value comes from `formatDurationInput(durationSeconds)`.
   - `input` parses valid text into `durationSeconds`, clears on blank, and marks invalid text with `aria-invalid`.
   - `blur` normalises valid input back to formatted display and reverts invalid text to the current stored value.
   - Timer display uses the same formatter.
4. Update focused editor tests for display, smart parsing, invalid handling, and timer formatting.
5. Add an Unreleased changelog entry.

## Verification

- `npm test`
- `npm run lint`
- `npm run format:check`
- `npm run build`
- CodeRabbit CLI review before PR.
