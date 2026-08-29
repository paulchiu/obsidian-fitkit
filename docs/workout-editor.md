# Workout editor

The workout editor is a structured form that replaces Obsidian's Markdown view for workout notes. It reads and writes the same note you would otherwise edit by hand, so nothing is locked away behind it.

![Workout editor with a strength card, a duration card, and the rest timer](images/workout-editor.png)

## Opening it

A note counts as a workout when its frontmatter has `type: workout`. With `Auto-open workout editor` on (the default), opening one of those notes switches straight into the editor. Turn the setting off if you would rather open in Markdown and open the editor deliberately.

Two commands are in the palette:

- `Open today's workout` creates `Fitness/Workouts/<today>.md` if it does not exist, then opens it in the editor.
- `Open workout editor for current file` opens whatever Markdown file is active.

The second command works on any Markdown file, so it is also how you convert an existing note.

## Adding an exercise

`Add exercise` in the footer suggests names FitKit already knows about. Pick an existing one and the card takes its kind from the registry. Type a new one and FitKit asks whether to create an exercise note for it.

Leave `Create exercise note` ticked for anything you want to chart and revisit; the note is what gives the exercise a progression chart, a `Recent sessions` table, and a home for your own notes. Untick it and you get a no-note registry entry instead. Both paths register the name, so it appears in the registry table. `Skip` registers nothing and leaves the exercise living only in workout history.

## The exercise card

Each exercise gets a card. The header holds the name and the card menu, plus a drag handle on the left that appears when you hover the card or reach it with the keyboard. On a touch device or a narrow pane the handle is always visible.

The card menu covers `Open exercise file`, `Rename exercise`, `Add exercise note` / `Edit exercise note`, the plan items described under [Planning your next session](#planning-your-next-session), `Switch to strength` / `Switch to duration`, `Move up`, `Move down`, and `Remove exercise`.

`Rename exercise` is scoped to this workout: it points the card at a different exercise. It suggests names already in your exercises folder or workout history, and if the name you pick is a different kind it asks before switching the card over. To rename an exercise everywhere, use the registry instead, see [Exercise registry](exercise-registry.md#renaming-an-exercise).

Under the header sit the history badges:

- `PB` is the heaviest weight lifted for a strength exercise, or the longest session total for a duration one. It is a real lift, not an estimated 1RM.
- `last` is the same measure taken from the most recent prior session.
- `Next` shows the plan in force, and resolves the weight where it can (`Next: 22.5 kg`). A plan you set on this card wins over the one carried in from last session, so the badge reflects your choice as soon as you make it.

Badges are terse so several fit one line on a phone; hover one for the full sentence and its date. `PB` and `last` only appear once there is history to draw on, so a brand new exercise starts bare.

An exercise note is added from the card menu and renders as a line under the badges once one exists; click the line to edit it. It persists as a `[notes:: ...]` field on a header row for that exercise.

## Logging sets

Strength cards give you a `Set` figure, a `Weight` field and a `Reps` field per set. The set figure shows the number stored in the note rather than a running count, so a hand-edited `1, 3, 7` stays as you wrote it; `Renumber sets` in the row menu resequences from 1 when you want it tidied. `Add set` appends a row carrying the previous set's weight, with reps left empty. The kebab on each row holds `Edit note`, `Renumber sets` and `Delete row`; a saved row note renders under the row and reopens the editor when clicked.

The last row of a strength card is the one you are logging, so its fields are drawn larger than the finished rows above them, and larger again on a phone or a narrow pane.

The first set of a new card prefills its weight from the plan you recorded for that exercise last session, applied to that session's top set. A proposed weight is drawn dashed until you type over it. Reps are never prefilled: weight is what you choose before a set, reps are what you count after it. A row holding a weight and no reps counts for nothing until you record them, so it cannot become a personal best or move your history while the set is still in progress.

Duration cards work the same way, swapping weight and reps for a single `Duration` field, with `Add set` and a play button beside it that fills the entry live and writes it on stop. Their set numbers are figures too, resequenced from the same `Renumber sets` item. The field accepts three shapes:

- Bare seconds, `90`.
- Unit form, `1m30s` or `2h`.
- Clock form, `1:30` or `1:00:30`.

Whatever you type is normalised to the unit form on blur, and stored in the note as seconds.

## Planning your next session

The card menu records how you want to load the exercise next session: `Plan: increase`, `Plan: keep`, or `Plan: decrease`. Choosing the direction that is already set clears it. With increase or decrease chosen, `Set plan step...` takes the weight change; it stays greyed out until there is a direction to attach a step to.

This is a note to yourself, not an instruction the plugin acts on. It is written as `[next:: up 2.5]`, surfaces as the `Next` badge on the card straight away and again the next time that exercise comes up, and is listed under `Next session plans` on the dashboard. A `[next:: ...]` value that does not start with `up`, `down`, or `stay` is ignored rather than reported, so hand-written wording passes through untouched.

## Rest timer

The footer holds a rest timer that counts up from zero and shows `Last rest 90s` once you stop it. You start and stop it yourself; it never starts on its own, since only you know whether the set is over. It is a live aid only; rest is not written into the note. Turn it off under `Rest timer` in settings if you time rests elsewhere.

The timer on a duration card is a separate thing, and that one does write into the duration field.

## Switching an exercise between strength and duration

Switching kind from the card menu asks what you want it to apply to, because the two stores can disagree. `Just this workout` changes the card and its rows here. `Update registry too` also writes the exercise note's `kind:` frontmatter (or the registry entry when there is no note), so new cards for that exercise default to the new kind.

Existing rows of the old kind are cleared by the switch, and the dialog says so before you commit.

## Saving

The editor autosaves after you stop typing. `Autosave debounce (ms)` controls the wait, defaulting to 600. The header shows `unsaved` between the edit and the write.

If the file changes on disk while the editor has it open, a banner appears: `File changed on disk. Reload to pick up external edits before continuing.` Reloading discards the editor's in-memory state in favour of the file. There is no automatic merge, so the safe move with a synced vault is to reload before editing further.

## Reading mode

With the editor turned off, or on a note you opened as Markdown, FitKit still renders recognised exercise rows as a table in reading mode. See [Note format](note-format.md#reading-mode) for what that looks like and what it leaves alone.
