# FitKit

FitKit tracks workouts as plain Markdown notes in Obsidian. The structured editor handles sets, reps, weight, duration, and rest timing. FitKit also keeps exercise notes, progression charts, and a generated dashboard up to date while leaving the underlying data readable in your vault.

The 'kit' is a small set of tools kept together:

- Workout notes in `Fitness/Workouts`.
- Exercise notes in `Fitness/Exercises`.
- A generated `Fitness/Fitness Dashboard.md`.
- A workout editor for daily data entry.
- Exercise charts, recent-session tables, and PB summaries.

FitKit writes the notes and generated blocks. The [Dataview plugin](https://github.com/blacksmithgu/obsidian-dataview) renders the history tables in the dashboard and exercise notes. Without Dataview, your workout data is still stored as Markdown, but those generated history sections show as raw `dataview` code blocks.

## Install

Install Dataview first from Obsidian's community plugins. FitKit needs Dataview to render the dashboard and recent-session views.

To install FitKit with the [BRAT community plugin](https://github.com/TfTHacker/obsidian42-brat):

1. Install BRAT.
2. Add `https://github.com/paulchiu/obsidian-fitkit` as a beta plugin.
3. Enable FitKit from Obsidian's community plugins list.

To install manually from a release:

1. Download `main.js`, `manifest.json`, and `styles.css` from the release.
2. Put them in `<vault>/.obsidian/plugins/fitkit/`, creating the folder if needed.
3. Reload Obsidian, then enable FitKit from the community plugins list.

To install manually from source:

```bash
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/fitkit/` and reload Obsidian.

## Getting started

![FitKit settings showing the default paths and setup actions](docs/images/settings.png)

Open FitKit settings after enabling the plugin. The default root is `Fitness`, which gives you:

- `Fitness/Workouts` for workout notes.
- `Fitness/Exercises` for exercise notes.
- `Fitness/Fitness Dashboard.md` for the generated dashboard.

The defaults are enough to start. Change `Fitness root` only if you want those files somewhere else in your vault.

Run `Open today's workout` from the command palette. FitKit creates today's workout note if it does not exist and opens the structured workout editor.

![Workout editor with a strength exercise, rows, and rest timer](docs/images/workout-editor.png)

Add an exercise, then enter the sets, reps, weight, or duration you want to track. If the exercise is new, FitKit asks whether to create an exercise note for it. Leave `Create exercise note` enabled for exercises you want to revisit, chart, and annotate later.

The editor autosaves back to the Markdown note. A basic strength workout is stored like this:

```markdown
---
type: workout
date: 2026-05-09
name: Squat Day
---

## [[Squat]]

- [exercise:: [[Squat]]] [set:: 1] [weight:: 50] [reps:: 5]
- [exercise:: [[Squat]]] [set:: 2] [weight:: 55] [reps:: 5]
```

Duration exercises use `[duration:: 60]`, stored as seconds.

## Dashboard and exercise notes

![Generated dashboard with PBs and Dataview history tables](docs/images/dashboard.png)

![Exercise note with a progression chart and Recent sessions](docs/images/exercise-note.png)

Use `Rebuild dashboard` in FitKit settings once you have a few workouts. FitKit scans the workout notes, updates its local index, and regenerates `Fitness/Fitness Dashboard.md` with PBs and per-exercise Dataview queries.

Exercise notes are normal Markdown files with `type: exercise` frontmatter. FitKit can seed them with:

- A `fitkit-chart` progression chart.
- A Dataview-powered `Recent sessions` section.
- A `Notes` section for your own training notes.

Use `Sync and repair exercise notes` if you already have exercise notes and want FitKit to add or refresh the generated sections. Use `Import exercises` when you have workout history and want FitKit to create missing exercise notes or no-note registry entries from the names it finds.

## Commands

The command palette is reserved for daily workout entry.

| Command                                | Description                                                                |
| -------------------------------------- | -------------------------------------------------------------------------- |
| `Open today's workout`                 | Create today's workout note if needed, then open it in the workout editor. |
| `Open workout editor for current file` | Open the active Markdown file in the workout editor.                       |

## Settings and maintenance

The settings tab keeps the everyday setup in one place:

- `Fitness root`: where workouts, exercises, and the dashboard live.
- `Auto-open workout editor`: open workout notes in the FitKit editor by default.
- `Rest timer`: show the workout editor rest timer.
- `Auto-update dashboard on save`: refresh dashboard data after workout saves.
- `Chart sessions`: default number of recent sessions to plot in exercise charts.

The maintenance actions cover generated data and diagnostics:

- `Rebuild index`: rescan workout notes into the local index.
- `Rebuild dashboard`: regenerate `Fitness/Fitness Dashboard.md` from the index.
- `Restore hidden dashboard sections`: bring back per-exercise sections you have hidden.
- `Show parse diagnostics`: list workout notes that failed to parse cleanly.
- `Show exercise registry diagnostics`: report registry inconsistencies.
- `Sync and repair exercise notes`: insert or refresh charts, `Recent sessions`, and `Notes` blocks in existing exercise notes.
- `Import exercises`: scan workout history for missing exercise notes and registry entries.

## Workout note format

Workout notes use `type: workout` frontmatter. Exercise notes use `type: exercise` frontmatter. Those fields are the discriminator FitKit uses to decide which notes are canonical workout or exercise files.

Dataview inline fields are the canonical workout format:

```markdown
[exercise:: [[Name]]] [set:: N] [weight:: X] [reps:: Y]
[exercise:: [[Name]]] [duration:: S]
```

Fenced code blocks are reporting surfaces, not the source of truth.

## Limitations

- Conflict resolution is still manual. FitKit detects mid-edit file changes and asks you to reload before further edits.
- SQL/WASM analytics are not implemented.
- A custom fenced source format is not implemented.
- Repeat-last-workout is not implemented.
- Per-exercise unit overrides and multi-unit support are not implemented.

## Development

Run `npm install` to install dependencies.

Run `npm run dev` to start esbuild in watch mode. It produces `main.js` next to `manifest.json` at the repo root.

To point a dev vault at the build, symlink `main.js`, `manifest.json`, and `styles.css` from the repo root into `<vault>/.obsidian/plugins/fitkit/`. Reload Obsidian, or toggle the plugin off and on, to pick up new builds.

The local gate is `npm test`, `npm run lint`, and `npm run format`. Run all three before pushing.

On merge to `main`, the Release workflow stamps a version using the PR's label (`major`, `minor`, `patch`, or `norelease`) and publishes a GitHub release with `main.js`, `manifest.json`, and `styles.css` attached.

See `AGENTS.md` for project conventions.

## License

MIT.
