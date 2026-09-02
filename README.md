# FitKit

FitKit is a workout tracker for Obsidian. Your sets, reps, weight, and durations are stored as plain Markdown in your vault, edited through a form built for use during workouts, with a rolled-up dashboard and per-exercise progression charts when you need it.

Every workout is a normal note with Dataview inline fields. If you uninstall FitKit tomorrow, your training history is still plain text in your vault. You choose where to store the notes and how you use your data.

The workout editor is optimised to be low-touch so you can expend workout effort on reps rather than data entry. Tap to add a set, type the weight, that's it. Once you have a few workouts logged, the dashboard and the per-exercise charts auto-populate.

## Install

FitKit needs the [Dataview plugin](https://github.com/blacksmithgu/obsidian-dataview) to render history tables and recent-session views. Install it first from Obsidian's community plugins.

FitKit is listed in [Obsidian's community plugin directory](https://community.obsidian.md/plugins/fitkit). To install it from the community plugins browser:

1. Open Settings, then Community plugins, then Browse.
2. Search for FitKit.
3. Select Install, then Enable.

For beta builds with BRAT or a manual install from a GitHub release, see [Install](docs/install.md).

## Log your first workout

The defaults are designed so you can log a workout the moment FitKit is enabled. No setup is required.

![Workout editor with a strength card, a duration card, and the rest timer](docs/images/workout-editor.png)

1. Run `Open today's workout` from the command palette. FitKit creates today's note under `Fitness/Workouts/` and opens it in the editor.
2. Add an exercise. Type the name, for example `Squat`. If it is new, FitKit asks whether to create an exercise note for it; say yes for anything you want to chart and revisit later.
3. Log your sets: weight and reps for a strength exercise, or a duration for a time-based one. Tap the rest timer between sets if you want it.
4. Before you move on, open the card menu and set a plan for next session: increase, keep, or decrease, with an optional weight step. It shows up as a badge on the card, and prefills the weight the next time that exercise comes around.

That is it. The editor autosaves as you go, and the underlying Markdown stays readable:

```markdown
---
type: workout
date: 2026-05-12
name: Squat Day
---

## [[Squat]]

- [exercise:: [[Squat]]] [set:: 1] [weight:: 50] [reps:: 5]
- [exercise:: [[Squat]]] [set:: 2] [weight:: 55] [reps:: 5]
```

## After a few sessions

Run `Rebuild dashboard` from FitKit's settings to generate `Fitness/Fitness Dashboard.md`. It lists your recent sessions, a personal best per exercise, and any next-session plans you recorded, followed by a per-exercise section backed by a Dataview query.

![Generated dashboard with recent workouts, PBs, and next session plans](docs/images/dashboard.png)

Exercise notes pick up a progression chart and a `Recent sessions` table without you wiring anything up. They are ordinary notes with `type: exercise` frontmatter, so the `Notes` section is yours to write in.

## Maintaining your exercise list

Names drift. You log 'Pushup' one week and 'Push Up' the next, or an exercise ends up living only in workout history with no note behind it. The registry in FitKit's settings lists every exercise the plugin knows about, labelled by where it came from, and is where you fix that.

![Registry table showing note-backed, registry-only, and history-only exercises](docs/images/registry.png)

Renaming from here renames the exercise note, rewrites every reference across your workout notes, and keeps the old name as an alias so nothing stops resolving. You see a preview of every file and row that will change, and can cancel before anything is written. Renaming onto a name already in use consolidates the two.

## Documentation

| Page                                                 | What it covers                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Workout editor](docs/workout-editor.md)             | Cards, sets, durations, the rest timer, next-session plans, autosave.            |
| [Exercise registry](docs/exercise-registry.md)       | Where exercises come from, rebuilding, renaming, consolidating, kinds and units. |
| [Dashboard and charts](docs/dashboard-and-charts.md) | What the dashboard generates, how a PB is chosen, `fitkit-chart` options.        |
| [Note format](docs/note-format.md)                   | Frontmatter, inline fields, and exactly what survives a save.                    |
| [Settings and maintenance](docs/settings.md)         | Every setting, every maintenance action, and the two commands.                   |
| [Install](docs/install.md)                           | Installing with BRAT for beta builds, and installing manually from a release.    |

## Limitations

- Conflict resolution is manual. FitKit detects mid-edit file changes and asks you to reload before further edits.
- Splitting one exercise into two is not implemented. Consolidating two into one is.
- Repeat-last-workout is not implemented.
- Inline fields FitKit does not recognise, such as `[rpe:: 7]`, are dropped the next time the editor saves that note. Everything else in a workout note is preserved, see [Note format](docs/note-format.md#what-survives-a-save).
- A per-exercise weight unit (`kg` or `lbs`) only changes labels. There is no numeric conversion.
- SQL/WASM analytics and a custom fenced source format are not implemented.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose changes and what a good PR looks like.

Run `npm install` to install dependencies.

Run `npm run dev` to start esbuild in watch mode. It produces `main.js` next to `manifest.json` at the repo root.

To point a dev vault at the build, symlink `main.js`, `manifest.json`, and `styles.css` from the repo root into `<vault>/.obsidian/plugins/fitkit/`. Reload Obsidian, or toggle the plugin off and on, to pick up new builds.

The local gate is `npm test`, `npm run lint`, and `npm run format`. Run all three before pushing.

On merge to `main`, the Release workflow stamps a version using the PR's label (`major`, `minor`, `patch`, or `norelease`) and publishes a GitHub release with `main.js`, `manifest.json`, and `styles.css` attached.

See `AGENTS.md` for project conventions.

## License

MIT.
