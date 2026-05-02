---
status: shipped
target: v0.10.1
date: 2026-05-01
branch: fix/exercise-page-frontmatter-rebuild
generated_by: Codex
generated_at: 2026-05-01T02:46:21+1000
prompt_summary: 'Plan and implement exercise page rebuild frontmatter repair.'
---

# Exercise page frontmatter rebuild plan

## Problem

`Sync and repair exercise notes` rebuilds exercise page sections, but frontmatter repair is only partial. It can add missing frontmatter, missing `type: exercise`, missing `kind:`, and missing strength `metric: e1rm`, but it leaves stale or invalid existing values untouched.

That means a page can keep frontmatter such as `kind: cardio`, `kind: strength` for a registry duration exercise, or `metric: pace` on a strength exercise even after the rebuild says the note was synced.

## Scope

- Repair exercise note frontmatter during the existing `migrateExerciseNote` flow.
- Treat the exercise registry kind as canonical when it resolves the note basename.
- Preserve notes that are explicitly not exercise notes.
- Preserve malformed frontmatter behavior so unsafe rewrites are skipped.
- Preserve valid user choices such as `metric: weight` for strength exercises.
- Do not remove duration `metric:` fields in this pass. Duration charts ignore the field, and deleting unrelated user frontmatter would be more invasive than this bug requires.

## Implementation

1. Extend `src/domain/exercise-note-migrate.ts` frontmatter repair.
2. When registry kind resolves:
   - Insert `kind:` if missing.
   - Replace invalid or stale `kind:` with the registry kind.
3. When no registry kind resolves:
   - Keep an existing valid `kind: strength|duration`.
   - Mark the result unknown when kind is missing or invalid.
4. For effective strength notes:
   - Insert missing `metric: e1rm`.
   - Replace invalid metric values with `metric: e1rm`.
   - Preserve valid `metric: weight` and `metric: e1rm`.
5. Keep Progress chart and Notes repair behavior unchanged.
6. If repairing `kind:` changes a note from one supported kind to the other, replace the old generated Recent sessions block with the generated block for the corrected kind.

## Tests

- Existing missing-frontmatter and missing-key tests should keep passing.
- Add tests for invalid kind repair from the registry.
- Add tests for stale valid kind repair from the registry.
- Add tests for invalid strength metric repair.
- Add coverage that stale generated Recent sessions queries are corrected when the repaired kind changes.
- Keep the valid `metric: weight` idempotency test.

## Verification

- `npm test`
- `npm run lint`
- `npm run format:check`
- `npm run build`
- CodeRabbit CLI review before PR.
