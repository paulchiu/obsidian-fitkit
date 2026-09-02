# Project Context & Coding Standards

> **Purpose:** Context, rules, and constraints for AI agents working in this codebase.
> **Audience:** AI coding assistants (Claude Code, Copilot, Cursor, etc.).

## 1. Project Context

- **Type:** Obsidian community plugin.
- **Language:** TypeScript (strict, ES2018 target to match Obsidian's bundling constraints).
- **Runtime:** Loads inside Obsidian (Electron). Desktop and mobile both supported unless a feature needs `isDesktopOnly`.
- **Bundler:** esbuild (CJS, bundled to `main.js`).
- **Package manager:** npm.
- **Testing:** Vitest for pure modules (parsers, serializers, registry logic). UI/flow testing is manual against a dev vault (see `/Users/paul/dev-misc/dev-vault/dev`).
- **Related work:** De-risking POCs live in `/Users/paul/dev-misc/fitkit-pocs`. Product spec lives in the user's Obsidian vault at `Quartz/Projects/FitKit/`. Consult those before introducing new patterns.

## 2. Core Architectural Principles

- **Functional first where Obsidian allows:**
  - Pure functions for parsing, serialization, normalization, and registry logic. Extract into `src/` modules that are trivially unit-testable without `App`.
  - Classes are fine where Obsidian requires them (`Plugin`, `Modal`, `ItemView`, `SettingTab`). Keep them thin: hold references, wire events, delegate logic to pure helpers.
  - Immutability: `const` by default. Avoid in-place mutation of data structures that flow between modules.
- **File layout:** `src/` is split into three tiers plus a thin top level for the plugin entry-point and configuration glue.
  - `src/main.ts` - Plugin entry point (`export default class ... extends Plugin`).
  - `src/settings.ts`, `src/settings-paths.ts` - Settings types, defaults, `PluginSettingTab` subclass, and the pure path helpers shared by every tier.
  - `src/domain/` - Pure modules (parsers, serializers, registry, scoring, types). No `obsidian` imports allowed.
  - `src/vault/` - Obsidian-aware, non-UI helpers (vault scanner, file session, dashboard generator, vault-backed registry, vault utilities). May import from `obsidian` and `src/domain/`. Must not import from `src/ui/`.
  - `src/ui/` - Obsidian UI surfaces (views, modals). May import from anywhere.
  - Within a tier, imports use `./` relative paths. Cross-tier, use `../<tier>/` (e.g. `../domain/types`). Keep modules at the tier root: avoid deeper nesting until the codebase justifies it.
- **State:**
  - Plugin settings persisted via `loadData` / `saveData`.
  - Derived state recomputed from files/settings on demand; avoid long-lived in-memory caches unless profiling demands them.

## 3. Naming & File Conventions

- **Files:** `kebab-case.ts` (e.g., `workout-serializer.ts`, `exercise-registry.ts`, `import-modal.ts`). Matches the POC convention.
- **Symbols:**
  - Classes / types / interfaces: `PascalCase`.
  - Functions / variables: `camelCase`.
  - Constants: `SCREAMING_SNAKE_CASE` for module-level immutable values; `camelCase` for locals.
- **Exports:** Named exports preferred. Default export only for the Plugin class itself (Obsidian requires it).
- **Return types:** Required on all exported functions.

## 4. Coding Standards

- **Formatting:** 2 spaces for indentation (Prettier enforces, `printWidth: 100`). Semicolons omitted (Prettier semi false). Single quotes. Trailing commas where valid (`trailingComma: 'all'`). Run `npm run format` before committing; `npm run format:check` runs in CI.
- **TypeScript:**
  - `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess` enabled.
  - No `any`. Use `unknown` and narrow.
  - `import type { ... }` for type-only imports.
- **Comments & docs:**
  - Default to no comments. Let names carry the meaning.
  - When a comment is warranted (non-obvious invariant, workaround, subtle edge case), write a JSDoc block (`/** ... */`) rather than stacked `//` lines.
  - Document _why_, not _what_. Don't reference PR numbers, tickets, or the current task (they rot).
- **Error handling:**
  - Recoverable: return `null` or a typed result (e.g., `{ok: false, reason}`). Don't throw across module boundaries.
  - User-facing: surface via `Notice` for quick feedback, or a modal banner for anything the user must acknowledge. Never swallow errors silently.
- **Destructive UI:** Buttons that delete, remove, or overwrite must be neutral at rest and only take on destructive affordances (red border/text) on hover or keyboard focus.

## 5. Obsidian-Specific Guidance

Official references (authoritative):

- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Submission requirements: https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins
- Linter (most rules auto-enforced by `npm run lint`): https://github.com/obsidianmd/eslint-plugin

### Pitfalls reviewers and the linter look for

- **Manifest:** `id` and `name` must not include `obsidian`, and `id` must not end with `plugin`. `description` must not begin with "This plugin"/"Obsidian" and must end with terminal punctuation.
- **UI text:** all user-visible strings (settings, command names, modal copy, locale JSON/TS) are sentence case.
- **Commands:** don't include the word "command" or duplicate the plugin id in command IDs/names. Don't set default hotkeys.
- **Vault I/O:** use `vault.process(file, current => next)` for background rewrites and the `Editor` API for active-file edits. Use `fileManager.trashFile(file)` for deletes. Look files up with `vault.getAbstractFileByPath(path)`. Normalize all user-supplied paths with `normalizePath()`. Never touch the filesystem directly.
- **Popout safety:** use `activeWindow` / `activeDocument` (declared as ESLint readonly globals here) for DOM lookups and event targets, but `window.setTimeout` / `setInterval` / `clearTimeout` / `clearInterval` for timers, since a timer owned by a popout dies when that popout closes. Bare `document` / `setTimeout` break in popout windows.
- **DOM:** build elements via Obsidian helpers (`createEl`, `createDiv`, `createSpan`). Never use `document.createElement`, `innerHTML`, `outerHTML`, or inline styles. All styling lives in `styles.css` using Obsidian CSS variables.
- **Network & platform:** `requestUrl()` over `fetch()`; `Platform.isMobile` over `navigator.userAgent`.
- **Lifecycle:** register subscriptions with `this.registerEvent / registerDomEvent / registerInterval`. Don't store view references on the plugin or call `detachLeavesOfType` in `onunload`.
- **Logging:** no `console.log` in `onload` / `onunload`. Use `Notice` for user feedback.
- **Mobile:** avoid regex lookbehind (broken on iOS < 16.4) and Node APIs. Keep `isDesktopOnly: false` unless a feature genuinely needs desktop.

### Project-specific patterns

- **Autosave (editor views):** debounce writes (~600ms), flush on tab close and on switching files, show an `unsaved` indicator while a write is pending, and block on mid-edit external changes (offer a reload path).
- **Dataview inline fields** are the canonical editing surface for workout data: `[exercise:: [[Name]]] [set:: N] [weight:: X] [reps:: Y]` (strength) and `[exercise:: [[Name]]] [duration:: S]` (duration). The exercise-level bullet carries `[notes:: text]` and `[next:: up 2.5]` (the user's plan for next session: `up`, `down`, or `stay`, with an optional step). Fenced code blocks are reporting-only.
- **Frontmatter contracts:** `type: workout` on workout notes; `type: exercise` on exercise notes. Treat them as the discriminator between canonical docs and journal drafts.

## 6. Operation Manual

- **Install:** `npm install`
- **Dev (watch):** `npm run dev`
- **Build:** `npm run build` (runs `tsc -noEmit` then esbuild in production mode; must complete with zero errors).
- **Lint:** `npm run lint` (zero warnings tolerated).
- **Format:** `npm run format` (check with `npm run format:check`).
- **Test:** `npm test` (Vitest, runs unit tests for pure modules).
- **Version bump:** automated. Every PR must carry exactly one of the labels `major`, `minor`, `patch`, or `norelease`. On merge to `main`, the Release workflow runs `npm version` with that bump, tags the commit as bare `X.Y.Z` (no `v` prefix, so BRAT and the community registry resolve it), and publishes a GitHub release with `main.js`, `manifest.json`, and `styles.css` attached. `npm version <patch|minor|major>` still works locally for dev; it runs `version-bump.mjs` to update `manifest.json` and `versions.json`.
- **Changelog:** add entries to `CHANGELOG.md` under `## [Unreleased]` as part of each PR. Bullets do not carry per-bullet dates. The version heading captures the date in UTC; entries land under `## [Unreleased]` until the release workflow stamps the heading on merge. On merge, the Release workflow renames the `[Unreleased]` heading to `## [X.Y.Z] - YYYY-MM-DD` and inserts a fresh empty `[Unreleased]` block above it. Do not rename the heading manually.

## 7. Git Commit Convention

Conventional commits, sentence case, imperative mood:

- `feat:` new user-facing feature
- `fix:` bug fix
- `refactor:` internal change with no user-facing effect
- `test:` adding/updating tests
- `chore:` tooling, deps, config
- `docs:` docs only

Scope in parens is welcome when it clarifies (e.g., `feat(importer): ...`). Keep subject under 72 chars. Body explains _why_, not _what_.

## 8. "Do Not" Rules

1. **Do not** use em dashes in any prose or code comments. Use commas, parentheses, colons, or separate sentences.
2. **Do not** leave `console.log` in shipped code. Use `Notice` for user feedback and throw/return for programmatic signals.
3. **Do not** introduce abstractions, feature flags, or backwards-compat shims without a concrete second use case. Three similar lines beats a premature abstraction.
4. **Do not** add error handling, fallbacks, or validation for scenarios that can't happen. Trust internal code; validate only at system boundaries.
5. **Do not** leave the repo in a broken state. `npm run build` and `npm run lint` must pass before calling a task done.
6. **Do not** ignore warnings (ESLint, TypeScript, deprecation). Fix them in the same change.
7. **Do not** commit `main.js`, `node_modules`, or `data.json` (user plugin settings).
8. **Do not** open a PR without exactly one version label (`major`, `minor`, `patch`, or `norelease`). The `check-labels` CI gate enforces this.
9. **Do not** add user-visible changes without a matching entry under `## [Unreleased]` in `CHANGELOG.md`. Use `norelease` only when batching a truly user-invisible change into a later bump.
10. **Do not** rewrite the substance of existing files under `plans/`. They are historical records (see §9). Coding-style touch-ups from `npm run format` are fine; intentional content edits are not.

## 9. Plans

The `plans/` directory holds dated implementation plans (e.g. `plans/2026-04-26 v0.2.1 Implementation Plan.md`) used as durable, agent-readable context for the work that produced a particular release.

- **Append-only.** Once a plan ships, treat it as a historical record. Future agents read it to understand prior reasoning, not to modify it. New work goes in a new plan file with a fresh date.
- **Style-only edits are fine.** Repo-wide formatting passes (`npm run format`, mass-rename refactors that touch every markdown file) may rewrite prose mechanically. That is acceptable. Substantive content edits to a shipped plan are not.
- **Naming.** `plans/YYYY-MM-DD <title>.md` (sentence case in the title; preserve any acronym casing). The date is when the plan was authored, not when work landed.
- **Frontmatter.** Each plan starts with YAML frontmatter capturing at minimum `status`, `target`, `date`, and `branch`. Status moves `draft` to `approved` to `shipped`; do not flip back.
