---
status: shipped
target: v0.11.0
date: 2026-05-01
branch: feature/duration-structured-entry
generated_by: Codex
generated_at: 2026-05-01T03:57:52+1000
prompt_summary: 'Replace free-text duration parsing with structured duration data entry.'
---

# Duration structured input optimization plan

## Problem

The first duration smart input implementation added a free-text parser for values such as `3min`, `90s`, and `1:30`. That parser is more surface area than the workout editor needs when duration data entry can be made explicit and fast.

## Scope

- Keep the compact duration display for running timers and stored values.
- Keep canonical workout markdown storage as seconds.
- Remove the free-text duration parser from the workout editor path.
- Render normal duration editing as structured hour, minute, and second numeric inputs.
- Allow overlarge minute or second values so users can type quickly, then normalise through the stored seconds value.
- Preserve invalid-input protection for pasted or otherwise invalid numeric field text.

## Implementation

1. Replace `parseDurationInput` with pure helpers that split seconds into `{ hours, minutes, seconds }` and combine those parts back to seconds.
2. Render duration rows with a grouped set of numeric inputs labelled hours, minutes, and seconds.
3. Keep the timer row as a disabled compact display because it is not editable while the timer runs.
4. Update tests to cover structured field rendering, part-to-seconds updates, invalid part preservation, and helper behaviour.
5. Update the changelog wording to describe structured duration entry instead of free-text parsing.

## Verification

- `npm test`
- `npm run lint`
- `npm run format:check`
- `npm run build`
- CodeRabbit CLI review before PR.
