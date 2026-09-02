# Contributing to FitKit

Thanks for your interest in contributing. Bug reports, feature discussion, and pull requests are all welcome. The issue tracker is at [github.com/paulchiu/obsidian-fitkit/issues](https://github.com/paulchiu/obsidian-fitkit/issues); that is the place to start for almost everything below.

## Reporting bugs

A useful bug report includes your Obsidian version, your FitKit version, and the platform you hit it on (desktop or mobile), along with the steps that trigger it.

FitKit stores everything as plain Markdown, so the fastest way to give a reproducible case is usually to paste a minimal workout note (the frontmatter and the inline fields) that shows the problem, rather than describing it in prose. See [Note format](docs/note-format.md) if you need a reminder of the shape of that Markdown.

## Suggesting features

Open an issue to discuss a feature before putting together a large PR. It saves rework if the direction needs to change.

Before suggesting something, check the Limitations section of [README.md](README.md). Several known gaps (manual conflict resolution, no exercise splitting, no repeat-last-workout, and others) are already tracked there rather than missing by oversight.

## Development setup

Run `npm install`, then `npm run dev` to start esbuild in watch mode. It emits `main.js` next to `manifest.json` at the repo root on every change.

To see your changes inside Obsidian, symlink `main.js`, `manifest.json`, and `styles.css` from the repo root into `<vault>/.obsidian/plugins/fitkit/`, then reload Obsidian (or toggle the plugin off and on) after each build. See the [Development](README.md#development) section of the README for the full details.

## Coding standards

[AGENTS.md](AGENTS.md) is the source of truth for conventions in this repo: file layout, naming, error handling, and the Obsidian-specific pitfalls reviewers look for. Read it before making non-trivial changes. A few points matter most for a drive-by contribution:

- The codebase is TypeScript, and Prettier formatting is enforced (`npm run format`).
- `src/` is layered: `src/domain/` holds pure modules with no `obsidian` imports, `src/vault/` holds Obsidian-aware helpers that may depend on `src/domain/` but not `src/ui/`, and `src/ui/` holds the views and modals that may depend on anything. Keep new code in the right tier.
- Vault access goes through Obsidian's Vault API (`vault.process`, the `Editor` API, `fileManager.trashFile`, and so on), never the filesystem directly.

## Tests and the local gate

Before pushing, `npm test`, `npm run lint`, and `npm run format` must all pass. Vitest covers the pure modules in `src/domain/` and `src/vault/`; UI flows (the editor, the dashboard, the registry) are verified manually against a dev vault, since they depend on the Obsidian runtime.

## Pull requests

Use a conventional commit style for the PR title (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`, with an optional scope). Keep one logical change per PR.

Every PR needs exactly one release label: `major`, `minor`, `patch`, or `norelease`. On merge to `main`, the Release workflow reads that label to decide the version bump: `major`, `minor`, and `patch` map to the matching `npm version` bump, and `norelease` skips the version bump and the GitHub release entirely. Pick `norelease` for changes with no user-facing effect; use one of the others for anything that should ship in the next release.

## Licence

By contributing, you agree that your contribution is licensed under this repository's MIT licence.
