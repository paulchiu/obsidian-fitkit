---
status: approved
target: v0.11.0
date: 2026-04-28
branch: feature/exercise-page-charts
---

# Exercise Page Charts Plan

## 1. Problem

Exercise notes (`Exercises/<Name>.md`, frontmatter `type: exercise`) currently render as Dataview tables only: a "Recent sessions" block (LIMIT 10 sets for strength, LIMIT 12 sessions for duration) and a "Notes" block (LIMIT 20). See `src/vault/exercise-note.ts:9-74`.

There is no visual progression view. To gauge whether a lift is trending up or stalling, the user has to scan a table of weights/reps row-by-row, or build their own Dataview query. The user has asked for a chart of the heaviest weight per workout date (strength) or longest session duration per workout date (duration), with a window similar to the existing tables but allowed to be larger if it fits.

There is also no current custom Markdown code block processor in the plugin (`registerMarkdownCodeBlockProcessor` is unused in `src/main.ts`); exercise pages are rendered entirely by Obsidian + Dataview. Adding charts therefore needs a small new rendering surface.

## 2. Goal

Render a per-exercise progression chart inline on each exercise page, plus seed it into newly created exercise notes and let the user retro-fit it to existing notes.

User-visible behaviour:

- A new `\`\`\`fitkit-chart\`\`\`` block on every freshly created exercise note, rendered as an inline SVG line chart by the plugin.
- The chart shows one point per workout date: the heaviest set's weight (strength exercises) or the total session duration (duration exercises), reading from the existing `FitKitIndex`.
- Default window of the last 30 sessions, override via a `Chart sessions` setting in the settings tab.
- A `Sync exercise notes` command that walks every `type: exercise` note and inserts the chart block (idempotently) so existing notes pick up the feature.
- No charting library: pure inline SVG, built with Obsidian DOM helpers, mobile-safe.
- "No data yet." placeholder text when there are no qualifying workouts.

## 3. Approach

### 3.1 Settings

Add one field to `FitKitSettings` in `src/settings.ts`:

```ts
chartSessionsWindow: number // default 30, min 5, max 365
```

UI under a new `Charts` heading in the settings tab:

- `Chart sessions` text input (numeric). Description: `"How many recent workout dates to plot on the exercise progression chart. Each chart block can override this with 'window: <N>'."`
- Validation on blur/change: clamp to `[5, 365]`; non-numeric resets to `30`.

The block syntax (§3.2) supports per-block override via `window:`, so the global setting is just the default.

### 3.2 Code block processor

Register in `FitKitPlugin.onload()`:

```ts
this.registerMarkdownCodeBlockProcessor('fitkit-chart', (source, el, ctx) =>
  renderExerciseChart(this, source, el, ctx),
)
```

We return the promise directly so Obsidian can track the post-processor lifecycle (it accepts a promise-returning handler).

`renderExerciseChart` lives in `src/ui/exercise-chart-block.ts`. Responsibilities:

1. Parse the block body. Body is a small `key: value` per line list; all keys optional.
   - `exercise:` (or `name:`) — exercise name. Defaults to the source file's `basename` when the source file is a `type: exercise` note. Required when the block is embedded in a non-exercise note.
   - `kind:` — `strength` or `duration`. Resolution order: (a) explicit value in the block body; (b) frontmatter `kind` of the matched exercise note (`Exercises/<name>.md`) read via `app.metadataCache.getFileCache(file)?.frontmatter`; (c) `kindForName(name, registry)` from the vault-merged registry; (d) `strength`. Looking up the exercise note's frontmatter before the registry avoids the misclassification where a vault-bootstrapped duration entry defaults to strength in the registry. When the block is embedded in a non-exercise note and no `kind:` is supplied, we still proceed (with the registry fallback) but render a small inline notice line above the chart suggesting the user add `kind: strength|duration` for safety.
   - `window:` — positive integer. Defaults to `settings.chartSessionsWindow`. Clamp at parse time to `[1, 365]`; non-integer or out-of-range falls back to the default and emits a small inline notice line above the chart.
2. Resolve the index: prefer `plugin.cachedIndex`; if `null`, await `rebuildIndex(app, settings)` and assign back to `plugin.cachedIndex` so subsequent blocks reuse it. (Mirrors the dashboard's lazy-rebuild pattern; staleness handling unchanged from elsewhere — `Rebuild index` command refreshes.)
3. Build the series via the pure domain function (§3.3), passing the vault-merged registry so alias matching works.
4. Render via the pure SVG builder (§3.4) into `el` using Obsidian DOM helpers.
5. On any error (unknown exercise, malformed body), render a muted message inside `el` instead of throwing. Never rethrow into Obsidian's renderer.

Body parsing rules:

- Trim each line; ignore blank lines and lines starting with `#`.
- Split on the first `:`; trim both sides; lowercase the key.
- Unknown keys: ignored silently (forward-compatible with future params).
- Empty body: all defaults.

### 3.3 Domain layer (series builder)

New file `src/domain/exercise-chart.ts`. All exported functions pure, unit-tested.

```ts
export interface ChartPoint {
  date: string // 'YYYY-MM-DD'
  value: number // weight in kg (strength) or seconds (duration)
  workoutPath: string // path of the workout that contributed this date's max
}

export interface ChartSeries {
  exerciseName: string // canonical name as queried (echoes the input)
  kind: 'strength' | 'duration'
  unit: 'kg' | 's'
  points: ChartPoint[] // sorted by date asc, post-aggregation, post-window
  windowRequested: number
  totalDates: number // total qualifying date buckets, before windowing
}

export function buildExerciseChartSeries(
  index: FitKitIndex,
  registry: ExerciseRegistry,
  exerciseName: string,
  kind: 'strength' | 'duration',
  window: number,
): ChartSeries
```

Behaviour:

1. Build a name-match set: the canonical entry resolved via `resolve(registry, exerciseName)` plus all of its aliases, all reduced via `normalize()`. If no entry resolves, fall back to a single-key set `{ normalize(exerciseName) }` so unregistered notes still render their own data.
2. Walk `index.entries`. For each entry, scan `entry.exercises` for rows whose `normalize(row.exerciseName)` is in the match set **and** whose `kind` matches the requested kind. The index stores the raw `[exercise:: [[X]]]` link target verbatim with no alias resolution (`src/vault/index.ts:107`), so alias-based logging is the common case, not the exception; relying solely on canonical-name match would silently drop those workouts.
3. Per-row metric:
   - Strength: `row.maxWeightSet?.weight`. Skip the row when `weight === undefined` or `!Number.isFinite(weight)` or `weight <= 0`.
   - Duration: `row.totalDurationSeconds`. Skip when `undefined` or `!Number.isFinite(value)` or `<= 0`. (`workout-note-model` parses durations via `Number(...)`, which can produce `NaN`; the index then sums without a finiteness guard, so a single malformed entry could otherwise corrupt the chart.)
4. Per-date aggregation: when multiple workouts share the same date, take the **max** value across them. `workoutPath` records the path of the workout that contributed that max.
5. Sort points ascending by `date`.
6. Take the **last** `window` points (most recent dates) and return them in ascending order.
7. `totalDates` reflects the count of distinct date buckets **after** aggregation but **before** windowing. The chart caption uses this for "last N of M" copy so the numbers in the title agree with the buckets actually plotted. In all user-facing copy (chart title, settings name, changelog) we call a date bucket a "session"; this is the same convention the existing dashboard "Recent sessions" copy already uses, and `totalDates` is the implementation-side name for the same concept.

Edge cases:

- Zero matching entries → `points: []`, `totalDates: 0`.
- Non-ISO dates: `entry.date` from the index is already an ISO `YYYY-MM-DD` string (set by `parseWorkoutNote`); we trust that. If it's malformed, it sorts wrong but won't crash. No special handling.
- Multiple workouts on the same date with the same max value: tie-break `workoutPath` by lexicographic comparison so the result is deterministic for tests.

### 3.4 SVG renderer

Pure DOM builder in `src/ui/exercise-chart-svg.ts`. Takes a container element and a `ChartSeries`, populates the container. Uses Obsidian's `createSvg(...)` (DOM-helper exposed on `HTMLElement.prototype`) for SVG nodes, never `innerHTML` or `document.createElementNS` directly.

Layout (single SVG, `viewBox="0 0 800 320"`, `preserveAspectRatio="xMidYMid meet"`, `width="100%" height="auto"`):

- Title row above the SVG (a sibling `<div>`): `"<Exercise> · last <N> sessions"` (or `"<Exercise> · last <N> of <total> sessions"` if windowed).
- Plot area: 800×260 with margins (left 56, right 16, top 16, bottom 44) for axis labels.
- X axis: dates evenly spaced. Tick labels at first, last, and ~3 evenly-spaced midpoints, formatted as `YYYY-MM-DD` truncated to `MM-DD` when there are 8+ points.
- Y axis: 4 horizontal gridlines at min, 1/3, 2/3, max of the value range (rounded to "nice" numbers). Labels formatted `Xkg` (strength) or `Xs` for short, `Xm Ys` for ≥60s (duration).
- Line: connect points in order with a polyline, `stroke-width: 2`, colour from CSS variable `--interactive-accent`.
- Dots: `<circle r="3.5">` at each point, fill same accent colour.
- Empty state: when `points.length === 0`, render a single muted `<div>` saying `"No <kind> sessions found for this exercise yet."` and skip the SVG entirely.
- Single-point state: render the dot only, skip the polyline.
- Axes/gridlines/labels styled via CSS classes (no inline `style=` attributes), so dark/light theme inherits.

The renderer is pure: takes inputs, populates the container, returns nothing. Logic for tick generation (`niceRange(min, max)`, `pickXTickIndices(count)`) lives in `src/domain/exercise-chart.ts` and is unit-tested.

Mobile note: SVG `width="100%"` + a fixed `viewBox` keeps the chart legible at any narrow width without media queries. No `<foreignObject>` (broken on iOS WebKit historically).

### 3.5 Exercise note template integration

Extend `composeExerciseNote` in `src/vault/exercise-note.ts`:

````
---
type: exercise
kind: <kind>
---

## Recent sessions
<existing dataview block>

## Progress chart

```fitkit-chart
````

## Notes

<existing dataview block>
```

The `fitkit-chart` block body is left empty by default (all defaults: name from filename, kind from frontmatter, window from settings).

Update the existing JSDoc on `composeExerciseNote` to note the new `Progress chart` section.

### 3.6 Sync exercise notes command

Add a command in `FitKitPlugin.onload()`:

```ts
this.addCommand({
  id: 'sync-exercise-notes',
  name: 'Sync exercise notes',
  callback: () => void this.syncExerciseNotes(),
})
```

`syncExerciseNotes()` walks `app.vault.getMarkdownFiles()` filtered to:

1. Located under `exercisesFolder(settings)`.
2. Frontmatter `type === 'exercise'`.

For each, read with `await app.vault.read(file)`, call the pure helper `migrateExerciseNote(source: string): string`, and **only** call `app.vault.process(file, () => next)` when `next !== current`. `vault.process` always writes (and stamps `mtime`, fires `vault.modify` events that would trigger downstream listeners), so the pre-read + compare pattern keeps idempotency cheap and avoids spurious modifications when re-running the command.

The helper `migrateExerciseNote` lives in `src/domain/exercise-note-migrate.ts`:

- Detect existing `fitkit-chart` blocks via a small line-by-line fence scanner (mirrors the bounded scanner in `workout-note-model.ts`): track open/close state on backtick fence lines matching `^\`{3,}`at column 0 (no leading spaces), recording the info string only on opening fences. We deliberately do **not** treat CommonMark indented fences (1–3 leading spaces) as fences here, because (a) our own composer never emits them and (b) tightening to column-0 keeps the scanner simple and avoids false positives where indented backticks appear in narrative prose. If any opening fence's info string equals`fitkit-chart`(case-insensitive, trimmed), return`source`unchanged. This avoids false positives when the literal text`\`\`\`fitkit-chart` appears inside a different fenced block (a documentation note quoting the syntax) or in inline code.
- Otherwise, insert a new section before the first **top-level** `## Notes` heading (lines starting with exactly `## Notes`, ignoring `### Notes` etc.). Format:

  ````
  ## Progress chart

  ```fitkit-chart
  ````

  ```

  ```

- If no top-level `## Notes` heading exists, append the new section at end of file.
- Preserves frontmatter byte-for-byte and the original trailing newline (or lack thereof).

Idempotency: `migrateExerciseNote(migrateExerciseNote(x)) === migrateExerciseNote(x)` (covered by tests, plus an integration QA step).

After processing, show a `Notice`: `"Synced N exercise note(s); M updated, K already current."`

The command is intentionally narrow for v1: it inserts the chart block. Future migrations (e.g., bumping the Dataview LIMIT) can reuse the same `migrateExerciseNote` helper without changing the command surface.

### 3.7 CSS

New rules in `styles.css`. All existing `.fitkit-card` etc. classes untouched.

- `.fitkit-chart` — block container; `margin: 0.5rem 0`.
- `.fitkit-chart-title` — small muted line above the SVG.
- `.fitkit-chart-svg` — `width: 100%; height: auto; max-width: 720px;` (caps so very wide editors don't stretch the chart out of proportion).
- `.fitkit-chart-axis` — axis line stroke, uses `var(--background-modifier-border)`.
- `.fitkit-chart-grid` — gridline stroke, lighter than axis.
- `.fitkit-chart-axis-label` — small text, `fill: var(--text-muted); font-size: 11px`.
- `.fitkit-chart-line` — polyline stroke, `var(--interactive-accent)`.
- `.fitkit-chart-dot` — `fill: var(--interactive-accent)`.
- `.fitkit-chart-empty` — muted text for the no-data state.

Keep the chart visible (not `display: none`) when there are no data points; render the muted message instead of an empty SVG so the user has a hint.

## 4. Out Of Scope

- Multi-exercise overlay charts (compare two lifts).
- Estimated 1RM Y-axis (user explicitly asked for max weight, not e1RM). Future enhancement could add `metric: e1rm` as a block param.
- Volume (total weight × reps) Y-axis.
- Hover tooltips. Pure-SVG hover works on desktop but not mobile, and the user did not ask for it. Defer.
- Date-range windowing (`since: 2026-01-01` etc.). Window is by session count only (i.e. a count of distinct workout dates, not calendar days).
- Click-through to the workout note from a data point. The series carries `workoutPath` so this is easy to add later, but not in v1.
- Auto-rebuild of the index on `vault.modify`. Pre-existing limitation: the index refreshes on demand via `Rebuild index` and `Rebuild dashboard`. Out of scope.
- Updating existing dashboard rendering to embed sparklines. Dashboard charts are a separate, larger change.
- Deleting the chart block from existing notes (no `Remove chart` command). Users can delete the block manually if they don't want it.
- A custom IconView / per-exercise full-screen chart panel. We render in-place inside the markdown view only.

## 5. Tests

### Unit (Vitest)

New tests in `tests/domain/exercise-chart.test.ts`:

**`buildExerciseChartSeries`**

- Empty index → `points: []`, `totalDates: 0`.
- Single matching workout, strength: one point with weight from `maxWeightSet`.
- Single matching workout, duration: one point with `totalDurationSeconds`.
- Filters by kind: a `'duration'` row in the index is ignored when querying `'strength'` for the same exercise name.
- Filters by name (normalize-aware): `"squat"` query matches `"Squat"` row.
- Alias matching: a row whose `exerciseName` equals one of the registry alias entries for the canonical name is included. Verifies the index-stored raw name is reconciled via the registry before matching.
- Unregistered exercise: when the canonical name is not in the registry, the function still matches rows whose `normalize(name)` equals `normalize(query)` (graceful fallback for vault-only stems).
- Same date, two workouts: takes the max value; `workoutPath` is the path of the max. Tie on equal values is broken by lexicographic `workoutPath` for determinism.
- `totalDates` counts post-aggregation date buckets, not raw row count: 3 workouts on 2 distinct dates → `totalDates: 2`.
- Window truncation: 50 distinct dates, `window: 30` → returns the most recent 30, sorted ascending; `totalDates: 50`.
- `window: 1` returns the single most recent point.
- Skips strength rows where `maxWeightSet` is undefined.
- Skips duration rows where `totalDurationSeconds` is `0`, `undefined`, `NaN`, or `Infinity`.
- Skips strength rows where `maxWeightSet.weight` is `NaN` or non-finite.
- Result `points` are sorted ascending by date even when index entries are out of order.

**`niceRange`** (helper for axis bounds)

- All values equal → returns `[v - 1, v + 1]` (or similar non-zero band so the line isn't on the edge).
- All values zero → returns `[0, 1]`.
- Range expands to "nice" round numbers (e.g. min 47, max 103 → `[40, 110]` or similar with a 5/10/25/50 step).

**`pickXTickIndices`**

- `count <= 5` → returns every index.
- `count = 30` → returns 5 indices including 0 and 29, evenly spaced.

New tests in `tests/domain/exercise-note-migrate.test.ts`:

**`migrateExerciseNote`**

- Note with no chart block, has `## Notes` → inserts `## Progress chart` block before `## Notes`.
- Note with no chart block, no `## Notes` → appends `## Progress chart` block at end.
- Note already containing ` ```fitkit-chart ` as a real opening fence → returns input unchanged.
- Note where the literal text `\`\`\`fitkit-chart` appears inside an unrelated fenced code sample (a doc note quoting the syntax) → still treated as missing; helper inserts a real chart block.
- Indented fences (` ```fitkit-chart` with leading spaces) are NOT recognised as chart blocks (CommonMark allows ≤3 leading spaces but our composer never emits them; covered by a negative test).
- Longer backtick fences (4+ backticks) opening a `fitkit-chart` block are recognised.
- `### Notes` (an h3, not h2) does NOT trigger the "insert before Notes" branch; the new section appends at end.
- Idempotent: applying twice equals applying once.
- Preserves frontmatter byte-for-byte.
- Preserves trailing newline (presence and absence both round-trip).
- Pre-read + compare path: when `migrateExerciseNote(source) === source`, the caller (`syncExerciseNotes`) skips `vault.process` entirely (verified at the call site, not in this pure test, but referenced in the manual QA step).

### Manual QA (per AGENTS.md §6)

1. **Fresh exercise note**: create a new exercise via auto-create (or workout editor's `+`). Open the new file; confirm the `## Progress chart` section renders. With no workouts logged, see `"No strength sessions found for this exercise yet."`.
2. **Strength chart populated**: log 3 workouts on different dates with the same exercise. Open the exercise page; chart shows 3 points, ascending date, line connecting them, Y-axis labelled in `kg`.
3. **Duration chart populated**: same as #2 but with a duration exercise. Y-axis labelled in `s` for short sessions, `Xm Ys` for ≥60s.
4. **Multiple workouts same date**: log two workouts on the same date with different max weights. Chart shows one point at the higher value.
5. **Window truncation**: with `chartSessionsWindow: 30` and 35 logged sessions, chart shows 30 points; title reads `"<Name> · last 30 of 35 sessions"`.
6. **Per-block override**: edit a chart block to `window: 5`, save. Chart renders 5 points only; title says `"last 5 of 35"`.
7. **Settings**: change `Chart sessions` to `60`. Reload the exercise note (or run "Reload"); chart shows 60 points (or all points if fewer than 60). Set to `0` → snaps to 5 (clamp). Set to `999` → snaps to 365.
8. **Sync command — fresh insert**: take an existing exercise note that lacks a chart block. Run `Sync exercise notes`. Confirm the block is inserted before `## Notes`, the file is not otherwise modified, and the chart renders.
9. **Sync command — idempotent**: run `Sync exercise notes` a second time. Notice reads `"X already current."`. Diff shows no changes.
10. **Mobile**: open an exercise note with chart in Obsidian Mobile. SVG renders at full width without overflowing. Tap the workout note from the recent-sessions table; navigation works.
11. **Unknown exercise**: in a non-exercise note, embed `\`\`\`fitkit-chart\nexercise: NotARealLift\n\`\`\``. Renders the empty-state message; no console errors.
12. **Malformed body**: `\`\`\`fitkit-chart\nwindow: not-a-number\n\`\`\``. Renders with default window; small inline notice line above the chart explains the fallback.
13. **Stale index**: log a new workout while the exercise note is open. Chart does not auto-update (expected). Run `Rebuild index` then re-open the note (or trigger a re-render); chart now includes the new point. Document this in CHANGELOG to set expectations.
14. **Theme switch**: toggle dark/light mode. Chart line, dots, axis, gridlines all stay legible (no hard-coded colours).
15. **Aliases**: log a workout whose `[exercise:: [[Bench]]]` link uses an alias of `"Bench Press"`. The canonical exercise (`"Bench Press"`) page chart still includes that workout. This works because the chart series builder (§3.3) resolves aliases via the registry; the index stores the raw link target verbatim, so without that resolution alias-only workouts would be invisible to the chart.

## 6. Risk

**Low–medium.** New rendering surface, but well-scoped: one processor, one pure series builder, one pure SVG renderer, one pure note migrator. No changes to vault writes outside the explicit `Sync exercise notes` command path.

Risk surfaces:

- **Rebuild on first chart render**: cold-open the first exercise note with a chart block triggers a full vault scan. For typical fitness vaults (<200 workouts) this is sub-second; documented in CHANGELOG.
- **SVG rendering on mobile**: pure SVG with `viewBox` and CSS sizing is supported on iOS/Android Obsidian (Electron / WebKit). Avoid `<foreignObject>` and lookbehind regex (already a project rule).
- **Sync command file mutations**: every match is rewritten via `app.vault.process` only when the chart block is missing. Idempotent helper means re-runs are no-ops. Pure migrator covered by tests.
- **Existing exercise notes**: `migrateExerciseNote` only inserts the chart section; it never touches the existing `## Recent sessions` or `## Notes` blocks. User-customised content (extra headings, prose) is preserved.
- **Index staleness**: charts read `cachedIndex`; same staleness model as the dashboard. If a user reports "my new workout isn't showing", `Rebuild index` is the answer. Could be tightened later by registering a `vault.on('modify')` listener, but that's a separate change with broader implications.
- **Unicode exercise names**: name resolution uses `normalize()` (NFC, lowercase, trim). Same matching as everywhere else; risk parity with existing flows.

## 7. Changelog

Under `### Added`:

- Exercise pages now include a progression chart: heaviest weight per workout date for strength exercises, total session duration for duration exercises. Shows the last 30 sessions by default; configurable via the `Chart sessions` setting or per-block with `window: <N>` inside a `\`\`\`fitkit-chart\`\`\`` block.
- New command `Sync exercise notes`: walks every `type: exercise` note and inserts the chart block where missing, so existing notes pick up the chart without manual editing. Idempotent.

Under `### Notes`:

- Charts read from the cached workout index; if a freshly logged workout doesn't appear, run `Rebuild index`.

## 8. Release Label

`minor`. New user-visible feature, additive only, no schema or behavioural breaks.
