---
status: draft
target: v0.7.0
date: 2026-04-28
branch: feature/duration-timer-controls
---

# Duration timer controls plan

## 1. Background

Duration exercises (plank, hang, run interval, jump rope, etc.) record elapsed seconds per
entry in `[duration:: N]`. Today the user enters that number by hand, which is fine when
they're glancing at a wall clock or a separate phone timer, but the workout editor is the
natural surface to time the exercise itself. v0.6.0 already shows PB and last-session-max
on the exercise card; the next ergonomic step is "press a button, hold the plank, press
again, the seconds land in the cell".

The user phrased it as "Duration exercise card should have timer controls for current set".
We read "current set" as the entry the user is actively recording, i.e. the last row in the
duration table.

## 2. Scope

In:

- A start/stop control that records elapsed wall-clock time into the active duration
  entry's `durationSeconds` field.
- Live elapsed time visible while the timer runs.
- Re-render safety: starting/stopping inside the editor must not lose timer state when the
  view re-renders (which happens on row add/delete/notes-edit today).
- View-lifecycle safety: the timer halts cleanly when the view closes or the file changes.

Out:

- Rest timers between strength sets (separate feature; flagged in §7).
- Audible cues, vibration, haptics, end-of-target alarms.
- Multiple concurrent timers on different cards (a single global timer at a time covers
  every realistic workflow).
- Persistence of running state across editor close / Obsidian restart.
- Background notifications when the app is suspended on mobile.

## 3. Data model

No persisted schema changes. `durationSeconds` already holds the integer seconds; the timer
just writes into it.

A new in-memory state lives on the view instance only:

```ts
interface ActiveTimer {
  card: ExerciseCard
  entry: EditableDurationEntry
  startedAtMs: number
  accumulator: number
  intervalId: number
}

private activeTimer: ActiveTimer | null = null
```

`accumulator` is the entry's `durationSeconds` at the moment Start was clicked. The live
display is `accumulator + secondsSinceStart`; the cell is overwritten with that sum on
Stop. This is what gives "pause/resume" behaviour without a dedicated pause button (see
§4.3).

Timer identity is held by **object references** (`card`, `entry`), not indices. Splicing
rows, reordering exercises, or any other index-shifting mutation does not invalidate the
timer. The only ways to lose identity are: the entry is removed from its card's
`durationEntries`, the card is removed from the model, or the card's kind switches and the
entries array is rebuilt. Each of those abort the timer (see §5).

`startedAtMs` uses `Date.now()` so elapsed time is computed off wall-clock, not interval
ticks. This is correct under throttling, OS suspension, and re-renders. Elapsed seconds
are clamped to non-negative integers (`Math.max(0, Math.floor((now - startedAtMs) / 1000))`)
to defend against clock skew.

## 4. UX shape

### 4.1 One control per card

The user's framing is "controls for current set" (singular). The current set is always the
**last** duration entry in the card. So the card gets exactly **one** timer toggle button,
positioned next to the existing `Add duration entry` button in the card's
`fitkit-row-actions` area.

While idle the button reads `Start timer` with a `play` icon. While running it reads
`Stop timer` with a `square` icon. The row currently being timed (the last row at start
time) shows a live elapsed counter in its duration input and gains the
`fitkit-row--timing` highlight class.

Per-row Start/Stop controls are explicitly out of scope. The user works the workout
sequentially; retroactively timing an older row is rare and can be done by hand.

### 4.2 Auto-create on start

If `durationEntries` is empty when the user clicks `Start timer`, the editor first appends
a new row (matching what `Add duration entry` does), then targets that fresh row.

### 4.3 Pause/resume by way of the cell value

There is no separate pause button. The existing `durationSeconds` of the targeted row acts
as an **accumulator**: when the user starts the timer, the running display shows
`accumulator + secondsSinceStart`. On stop, the cell is overwritten with that sum.

Concretely:

- Empty cell + Start, run 30s, Stop → cell reads `30`.
- Cell at `30` + Start, run 12s, Stop → cell reads `42`. (This is "resume" without a
  dedicated button.)
- Cell at `30` (typed by hand) + Start, run 5s, Stop → cell reads `35`. The user is
  treating the manual value as a baseline.

If the user wants a fresh time without keeping the prior value, they clear the cell, then
Start.

### 4.4 Adding a new entry mid-run

If the user clicks `Add duration entry` while a timer is running, we treat that as the end
of the current set: stop and write back first, then append the new row. The new row
becomes the new "last row" but the timer does not auto-restart.

### 4.5 Stop and write-back

On stop:

- `elapsed = max(0, floor((now - startedAtMs) / 1000))`.
- `entry.durationSeconds = (entry.durationSeconds ?? 0) + elapsed` (accumulator semantics
  per §4.3).
- `markDirty()` so autosave fires.

### 4.6 Mid-render and lifecycle

The timer must abort cleanly on every path that destroys or replaces the entry's owning
state. Required abort sites (no write-back; the user is no longer in the set they were
timing):

- `onClose` (view tear-down).
- `loadFile` (switching to a different workout).
- `reloadFromDisk` (conflict-banner reload, model is replaced wholesale).
- The active duration row deleted via the row kebab.
- The active exercise card deleted via the card menu.
- The active card's kind switched via the kind-switch modal (rebuilds `durationEntries`).

Single-active invariant: there is at most one running timer in the editor. Starting a
timer on card B while card A is running writes back A's elapsed value first, then starts
B. (In practice this is rare since the controls are per-card.)

Re-renders during a running timer (caused by add/delete/notes-edit on **other** rows or
cards) keep the timer alive. Because identity is by reference (`card`, `entry`), the model
still contains the entry; the render walk finds it and re-attaches the live counter to
the row. The 1s tick targets the row container via a
`data-fitkit-timer-row="<exerciseIndex>:<entryIndex>"` attribute set during render.
Loss of the data attribute mid-tick is a defensive no-op; the timer keeps running on the
model side, and the next render re-attaches.

### 4.7 Visuals

- The card-level toggle uses Obsidian icons: `play` while idle, `square` while running.
- The running row (last entry of the card) gets a `.fitkit-row--timing` modifier class for
  subtle highlight (e.g. background tint pulled from `--background-modifier-active-hover`).
- The duration input is `disabled` while the timer is running on its row, so the user
  can't fight the live update.
- Sentence-case button labels: `Start timer` and `Stop timer`. The `aria-label` matches
  the visible text.

## 5. Implementation outline

Files touched: `src/ui/workout-editor-view.ts`, `styles.css`,
`tests/ui/workout-editor-view.test.ts`, `CHANGELOG.md`. No domain changes.

### 5.1 View state

Add to `WorkoutEditorView`:

```ts
private activeTimer: ActiveTimer | null = null
```

Private helpers (all within `WorkoutEditorView`):

- `startCardTimer(card: ExerciseCard): void`
  - If `card.durationEntries.length === 0`, push a fresh `{}` entry first.
  - Let `entry = card.durationEntries[card.durationEntries.length - 1]`.
  - If `this.activeTimer && this.activeTimer.entry !== entry`, call
    `stopTimer({ write: true })` first (single-active invariant).
  - If `this.activeTimer && this.activeTimer.entry === entry`, no-op.
  - `accumulator = entry.durationSeconds ?? 0`.
  - Set `this.activeTimer = { card, entry, startedAtMs: Date.now(), accumulator, intervalId }`
    where `intervalId = activeWindow.setInterval(() => this.tickTimer(), 1000)`.
  - `this.markDirty()` (creating the auto-row counts as a model change).
  - `this.render()`.

- `stopTimer(opts: { write: boolean }): void`
  - If `this.activeTimer` is null, no-op.
  - `activeWindow.clearInterval(this.activeTimer.intervalId)`.
  - If `opts.write`:
    - `this.activeTimer.entry.durationSeconds = liveSeconds(this.activeTimer)`.
    - `this.markDirty()`.
  - Set `this.activeTimer = null`.
  - `this.render()`.

- `tickTimer(): void`
  - If `this.activeTimer` is null, no-op (defence).
  - Look up the live row's duration `<input>` by data attribute on `this.contentEl`.
  - If found, write `String(liveSeconds(this.activeTimer))` to its `value`.
  - If not found, no-op (the next `render()` will re-attach).

- `liveSeconds(t: ActiveTimer): number`
  - `t.accumulator + Math.max(0, Math.floor((Date.now() - t.startedAtMs) / 1000))`.

- `abortTimer(): void`
  - Wrapper for `stopTimer({ write: false })`. Call sites: `onClose`, `loadFile` (top),
    `reloadFromDisk` (top, before model swap), the active row's delete handler, the active
    card's delete handler, and the kind-switch handler when `card.kind === 'duration'` and
    is becoming `strength`.

`ActiveTimer` is updated to carry the accumulator:

```ts
interface ActiveTimer {
  card: ExerciseCard
  entry: EditableDurationEntry
  startedAtMs: number
  accumulator: number
  intervalId: number
}
```

### 5.2 Render hook

Two render touchpoints:

**a) `renderDurationTable(card, ex, exerciseIndex)`** gains a `Start timer` / `Stop timer`
toggle button in the existing `actions` row, sibling to `Add duration entry`:

- Class `fitkit-btn fitkit-timer-button`.
- Idle state: text `Start timer`, icon `play`, click handler calls
  `this.startCardTimer(ex)`.
- Running state (when `this.activeTimer?.card === ex`): text `Stop timer`, icon `square`,
  click handler calls `this.stopTimer({ write: true })`.
- The `Add duration entry` button's existing handler is wrapped: if a timer is running on
  this card, it calls `this.stopTimer({ write: true })` before pushing the new entry (per
  §4.4).

**b) `renderDurationRow(wrap, ex, i, exerciseIndex)`** is extended (the new
`exerciseIndex` parameter is plumbed through from `renderDurationTable`):

- Set `row.dataset.fitkitTimerRow = "${exerciseIndex}:${i}"` for tick lookup.
- If `this.activeTimer?.entry === durationEntry`:
  - `durationInput.value = String(liveSeconds(this.activeTimer))`.
  - `durationInput.toggleAttribute('disabled', true)`.
  - Add `fitkit-row--timing` class to `container`.
- Else: render as today.

### 5.3 Lifecycle wiring

- `onClose`: prepend `this.abortTimer()` before the existing autosave flush.
- `loadFile`: prepend `this.abortTimer()` before the autosave-flush block.
- `reloadFromDisk`: prepend `this.abortTimer()` before the model swap.
- Row delete (`onDelete` inside `renderRowActions` for duration rows): if `this.activeTimer
?.entry === durationEntry`, abort first.
- Card delete (already in `openCardMenu` "Delete exercise"): if `this.activeTimer?.card ===
ex`, abort first.
- Kind switch (KindSwitchChoiceModal handler): if the card is the active timer's card and
  is moving away from `duration`, abort first.

### 5.4 Mobile / popout safety

- All scheduling via `activeWindow.setInterval` and `activeWindow.clearInterval`, mirroring
  the existing autosave pattern at lines 134-180 of `workout-editor-view.ts`. We do not
  wrap with `this.registerInterval`; cleanup is explicit at every exit point.
- `Date.now()` is the wall-clock anchor; OS-level throttling does not corrupt the final
  recorded duration. The on-screen counter may visually skip after resume; that is
  expected.
- No `Platform.isMobile` branching; behaviour is identical on desktop and mobile.

### 5.5 Styles

In `styles.css`:

```css
.fitkit-timer-button {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.fitkit-row--timing {
  background: var(--background-modifier-active-hover);
}
```

The button mirrors `.fitkit-row-kebab` sizing for visual consistency.

### 5.6 Changelog

Under `## [Unreleased]` `### Added`:

- "Duration exercise cards now have a timer for the current set. Press Start timer to
  time the set; press Stop timer to record the elapsed seconds. If the row already has a
  duration, the timer resumes from there."

## 6. Test plan

### Vitest (pure)

No new domain module. Existing tests unaffected.

### UI tests (`tests/ui/workout-editor-view.test.ts`)

The harness is **not** jsdom: Vitest runs `environment: 'node'` and the existing tests use
a custom `TestElement` mock plus a hoisted `obsidian` mock. Two harness extensions are
needed:

1. The hoisted `obsidian` mock currently exports an empty `ItemView`. Add the bare-minimum
   members the new code paths touch: nothing extra is needed for `registerInterval`
   because we are not using it. We do need `setIcon` (already mocked) to handle `play` and
   `square` strings (any string is fine since the mock just sets `data-icon`).
2. Provide `globalThis.activeWindow` in the test setup, pointing at `globalThis`. The view
   calls `activeWindow.setInterval` / `activeWindow.clearInterval`; once `activeWindow`
   resolves to `globalThis`, Vitest's `vi.useFakeTimers()` intercepts both.

With those in place, add cases:

- Duration card renders a card-level `Start timer` button with `data-icon="play"` next to
  `Add duration entry`.
- Auto-create on Start: with an empty `durationEntries`, click `Start timer`. Assert a
  new row exists, the timer is running on it, and the card-level button now reads
  `Stop timer` with `data-icon="square"`.
- Tick: with timer running on the last row at `accumulator = 0`,
  `vi.setSystemTime(...)` to simulate 3s, `vi.advanceTimersByTime(3000)`. Assert the
  duration input value reads `3`, is disabled, and the row has `fitkit-row--timing`.
- Stop and write-back: click `Stop timer`. Assert the input is no longer disabled, the
  timing class is gone, the model entry's `durationSeconds === 3`, and `markDirty` was
  called.
- Resume from existing value: pre-populate `durationSeconds = 30`, click `Start timer`,
  advance 5s, click `Stop timer`. Assert `durationSeconds === 35`.
- Add-during-run flushes: with timer running, click `Add duration entry`. Assert the
  prior entry's `durationSeconds` was written and the new entry is appended (no longer
  the active row).
- Abort on row delete: with timer running, delete the active row via the kebab "Delete"
  flow. Assert the timer is null and no other row was written.
- Abort on `loadFile`: call `loadFile` with a different file. Assert the timer is null
  and the prior row was not written.
- Abort on `onClose`: assert the timer is null and the prior row was not written.

Time control: `vi.useFakeTimers()` (with `vi.setSystemTime(new Date(...))`) for every
timer-related test, restoring real timers in `afterEach`.

### Manual / on-device

- Desktop: start, switch to another tab, return after 30s, stop, confirm `~30` recorded.
- iOS: same flow with screen lock for 60s. Confirm recorded value is correct (wall-clock).
- iOS: start, swipe back to home, return after 60s, stop. Confirm correct value.
- Switch to a different workout file mid-timer: confirm timer halts with no write-back.

## 7. Risks and open questions

- **R1: iOS background suspension.** When the app is fully suspended, our `setInterval`
  stops firing, but `Date.now()` is still correct on resume. The live counter will jump
  forward when the user re-foregrounds. This is acceptable; the recorded value on stop is
  what matters.
- **R2: Re-render during timer.** The 1s tick uses a targeted DOM update via the
  `data-fitkit-timer-row` attribute. Re-renders triggered by edits on **other** rows or
  cards do not lose timer state because identity is by reference (see §3). If the
  re-render happens to land between two ticks the row attribute is just rebuilt; the next
  tick finds it.
- **R3: Conflict reload.** If the file is externally modified while a timer is running,
  the conflict banner appears. Clicking `Reload from disk` aborts the timer (no
  write-back) before swapping the model. The user re-starts after reconciling.
- **R4: Active row deleted.** If the user deletes the row currently being timed, the
  timer aborts (no write-back). The "Delete duration entry" confirm modal already exists;
  we just slot in the abort before `splice`.
- **R5: Active card kind-switched.** Switching `duration` to `strength` rebuilds
  `durationEntries`. Abort the timer (no write-back) before the kind change is applied.
- **Q1 (resolved 2026-04-28):** Stopwatch only. Countdown is parking-lot.
- **Q2 (resolved 2026-04-28):** Auto-create a fresh duration row when `Start timer` is
  clicked on an empty table. Driven by the user's preference for fewer clicks.
- **Q3 (resolved 2026-04-28):** Pause/resume is achieved implicitly via the accumulator
  semantics in §4.3: clicking `Start timer` on a row that already has a `durationSeconds`
  value continues from there, so a separate pause button is unnecessary. Single primary
  toggle: `Start timer` ↔ `Stop timer`.

## 8. Out-of-scope (parking lot)

- Rest timer between strength sets.
- Audible / haptic / Notice on stop.
- Per-card "Start next set" affordance.
- Timer history (e.g. "you ran this for 45s last time, beat it"), already partially
  covered by the last-session-max badge from v0.6.0.
- Cross-device timer sync.
