# Dashboard and charts

FitKit derives two reporting surfaces from your workout notes: a single dashboard note, and a progression chart on each exercise note. Both need [Dataview](https://github.com/blacksmithgu/obsidian-dataview) installed for their query blocks to render.

## The dashboard

![Generated dashboard with recent workouts, PBs, and next session plans](images/dashboard.png)

`Rebuild dashboard`, under `Setup and maintenance`, rescans your workout notes and regenerates `Fitness/Fitness Dashboard.md` in full. Treat it as output; anything you write into it is overwritten on the next rebuild.

The generated note has four kinds of section:

- `Recent workouts` lists the ten most recent sessions, newest first, each linked and labelled with its workout name.
- `PBs` gives one line per exercise.
- `Next session plans` appears only when at least one exercise carries a plan, and shows the direction, the change, and the date you recorded it.
- One section per exercise, linking to its exercise note and embedding a Dataview query over that exercise's rows.

`Rebuild index` does the scanning half on its own, without rewriting the dashboard. It also refreshes the parse diagnostics that `Show parse diagnostics` reports, which is the quickest way to find a workout note FitKit could not read.

`Restore hidden dashboard sections` clears per-exercise hidden-section state for the dashboard and regenerates it.

## How a PB is chosen

For a duration exercise, the PB line is the total seconds logged and the number of sessions it spans.

For a strength exercise, FitKit picks the best set in three tiers:

1. Highest estimated 1RM among sets with a weight above zero and between 1 and 12 reps.
2. Failing that, highest estimated 1RM among sets with a weight above zero and at least one rep.
3. Failing that, the heaviest set, or the most reps when every set is bodyweight.

Estimates use Epley, `weight * (1 + reps / 30)`. Sets with zero or blank reps are ignored, and a blank weight with completed reps counts as bodyweight.

For a bodyweight exercise, the PB line is the rung reached and the reps at it (`Push-up x 8`), or the bare rung name when no reps were logged. Rungs outrank everything, then reps, then added load, so a higher rung always wins and load only breaks ties; load itself is not shown.

The PB line shows the actual set, with the estimate in brackets when the exercise's metric is `e1rm`: `50kg x 5 (e1rm 58.3kg)`. The `PB` badge in the workout editor is a plainer measure, the heaviest weight lifted, and never an estimate.

## Chart blocks

An exercise note gets a `fitkit-chart` block under `## Progress chart`. The plugin renders it as an SVG line chart of one point per session.

```fitkit-chart
exercise: Squat
metric: e1rm
window: 30
```

Recognised keys:

| Key                | Values                               | Default                                                                       |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------------------- |
| `exercise`, `name` | Exercise name                        | Taken from the note's filename                                                |
| `kind`             | `strength`, `duration`, `bodyweight` | Taken from the exercise's registered kind                                     |
| `metric`           | `e1rm`, `weight`, `level`, `reps`    | Strength: the note's `metric:` frontmatter, then `e1rm`. Bodyweight: `level`. |
| `window`           | 1 to 365                             | The `Chart sessions` setting, default 30                                      |

Blank lines and `#` comment lines are skipped. An unreadable `metric` or `window` value falls back to the default and says so under the chart rather than failing.

`metric` is per kind. Strength accepts `e1rm` or `weight`. Bodyweight accepts `level` or `reps` and defaults to `level`. Duration exercises always plot total seconds and take no metric. On a strength or bodyweight chart, a metric belonging to another kind is ignored with a note under the chart, and the default is plotted instead. Setting `metric: e1rm` plots the Epley estimate, which smooths out a session where you went heavier for fewer reps; `metric: weight` plots the top-set weight, which is what you lifted.

```fitkit-chart
exercise: Push Up
metric: level
window: 30
```

A level series draws as a step line, holding each rung until the next session, with rung names on the vertical axis. A rung the ladder no longer names is labelled `Level N`.

## Recent sessions

![Exercise note with a progression chart and a Recent sessions table](images/exercise-note.png)

Under `## Recent sessions`, FitKit writes a Dataview query that pulls that exercise's rows out of your workout notes: the last ten sets for a strength or bodyweight exercise (Level, Reps, and Load columns for bodyweight), or the last twelve entries for a duration one. There is a matching query behind `## Notes` that collects the per-set notes you wrote.

Both are ordinary Dataview blocks. Customise one and `Sync and repair exercise notes` leaves your version in place and reports it rather than overwriting, unless it still points at a name the exercise no longer uses.
