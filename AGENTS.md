# Project Context & Coding Standards

> **Purpose:** Context, rules, and constraints for AI agents working in this codebase.
> **Audience:** AI coding assistants (Claude Code, Copilot, Cursor, etc.).

## 1. Project Context

- **Type:** Obsidian community plugin.
- **Language:** TypeScript (strict, ES2018 target to match Obsidian's bundling constraints).
- **Runtime:** Loads inside Obsidian (Electron). Desktop and mobile both supported unless a feature needs `isDesktopOnly`.
- **Bundler:** esbuild (CJS, bundled to `main.js`).
- **Package manager:** npm.
- **JSX:** `.tsx` files compile with Preact's automatic runtime (`jsx: react-jsx`, `jsxImportSource: preact` in `tsconfig.json`, and the matching options in `esbuild.config.mjs` and `vitest.config.ts`). Preact is a pinned devDependency, since esbuild bundles it.
- **Testing:** Tests mirror the UI folders: `tests/ui/obsidian/`, plus `tests/ui/components/` and `tests/ui/model/` for the pure tiers. Vitest for pure modules (parsers, serializers, registry logic) and for UI through the offline render harness in `tests/harness/` (see its README). The harness renders the real components against the real `styles.css` in jsdom and measures chart SVG geometry with resvg, so it checks structure, cascade, stylesheet coverage and SVG geometry. It never checks HTML layout (jsdom has no layout engine). Manual passes against a dev vault (see `/Users/paul/dev-misc/dev-vault/dev`) still cover flows the harness cannot reach.
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
  - `src/ui/` - the UI, split by what each file may touch:
    - `src/ui/components/` - Preact function components and hooks. May import `preact`, `preact/hooks`, `src/domain/`, `src/ui/model/` and each other. Never `obsidian`, `src/ui/obsidian/`, `src/vault/` or the plugin shell (`src/main.ts`, `src/settings.ts`), nor Obsidian's globals (`activeDocument`, `createEl`, `sleep`, `fish` and the rest) or its DOM extensions (`empty`, `setText`, `addClass` and the rest). They reach the platform through the `Host` context (`components/host.ts`).
    - `src/ui/model/` - pure TypeScript with no DOM, Preact or Obsidian: no `document`, `window` or DOM types. May import `src/domain/` and `src/settings-paths.ts`.
    - `src/ui/obsidian/` - every file that imports `obsidian` or builds DOM with Obsidian's helpers, plus any file that fits neither pure folder (one that needs `window` timers or browser audio, say). May import from anywhere. A file moves out when it is ported to a component or a model.
  - **Lint fences:** `eslint.config.mts` enforces the tiers with `@typescript-eslint/no-restricted-imports` (type-only imports count, and a module is matched at any depth with or without an extension), `no-restricted-syntax` (dynamic `import()` and `typeof import()` types, which that rule cannot see, are banned in the fenced folders), `no-restricted-globals` and `no-restricted-properties`. `src/domain/` may not import `obsidian`, `preact`, `src/ui/`, `src/vault/` or the plugin shell, nor use Obsidian's globals or DOM extensions; `src/ui/model/` and `src/ui/components/` follow the rules above; and `src/vault/` may not import from `src/ui/`. In the fenced folders obsidianmd's own restricted imports and globals are errors rather than warnings. `src/main.ts`, `src/settings.ts` and `src/ui/obsidian/` are unrestricted.
  - Within a tier, imports use `./` relative paths. Cross-tier, use `../<tier>/` (e.g. `../domain/types`), or `../../<tier>/` from a `src/ui` sub-folder. `src/ui` is the one tier with sub-folders, because it carries three constraint sets; `src/domain/` and `src/vault/` stay flat.
- **Drawing the UI with Preact:** the UI is moving from `createEl` builders to Preact function components, one surface at a time. Every full-tab screen (the set and rest timers and the interval runner) is drawn this way, sharing the clock, icon buttons and mount in `src/ui/components/screen-parts.tsx`, as are the exercise chart block (`exercise-chart.tsx`), the reading-mode preview (`reading-preview.tsx`) and the simple modals (set note, confirm, kind switch, delete registry entry, parse diagnostics, edit levels and the exercise suggester's rows), each a thin `Modal` shell in `src/ui/obsidian/` that renders its body from `src/ui/components/` into `contentEl` and unmounts it in `onClose`. The workout editor's set rows and Add set bar are drawn the same way (`src/ui/components/set-rows.tsx`), mounted into boxes inside each imperative card and unmounted with the screens; their inputs are uncontrolled, with `value` set in a `useDomEffect` keyed on the set, never as a prop. The plan step modal follows that shell too. The stateful modals (rename, registry entry, import and the interval plan form with its step editor) keep their draft in the class and redraw it on every change; their text boxes are the uncontrolled fields in `src/ui/components/fields.tsx`, so a draft must hold the raw text typed for a redraw to leave it alone, and the step editor's rows are keyed by id so focus survives. A ported surface's DOM-free labels and maths live in `src/ui/model/`.
  - The Obsidian class holds the state and mounts the component with Preact `render`, under a `HostContext` provider of `obsidianHost` (`src/ui/obsidian/host.ts`) when the tree draws icons (the default host throws, so a missing provider fails loudly), and unmounts it with `render(null, el)` before it empties or closes the pane (`clearContent` in the editor view). Components keep no state of their own.
  - A code block or post-processor section mounts through `preactRenderChild` (`src/ui/obsidian/preact-render-child.ts`) registered with `ctx.addChild`, so Obsidian unloading the section unmounts the tree. Preact adopts a container's existing children, so mount into an element of its own.
  - `setIcon` runs only through `useIcon` (`src/ui/components/host.ts`, built on `useDomEffect` in `src/ui/components/dom-effect.ts`) over the `Host` context, on an element of its own, since it replaces the element's children. Text the view rewrites between renders (a timer's clock) is set in a layout effect, never drawn as a Preact child.
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
- **Vault I/O:** use `vault.process(file, current => next)` for background rewrites and the `Editor` API for active-file edits. Use `fileManager.trashFile(file)` for deletes. Look files up with `vault.getAbstractFileByPath(path)`. Normalize all user-supplied paths with `normalizePath()`. Never touch the filesystem directly. Use `markdownFilesInFolder` (`src/vault/folder-scan.ts`) for folder scans rather than `vault.getMarkdownFiles()`, which enumerates the whole vault.
- **Popout safety:** use `activeWindow` / `activeDocument` (declared as ESLint readonly globals here, and banned in `src/domain`, `src/ui/model` and `src/ui/components`) for DOM lookups and event targets, but `window.setTimeout` / `setInterval` / `clearTimeout` / `clearInterval` for timers, since a timer owned by a popout dies when that popout closes. Bare `document` / `setTimeout` break in popout windows.
- **DOM:** build elements via Obsidian helpers (`createEl`, `createDiv`, `createSpan`) in `src/ui/obsidian`, or JSX in a Preact component. Never use `document.createElement`, `innerHTML`, `outerHTML`, or inline styles. All styling lives in `styles.css` using Obsidian CSS variables.
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
- **Beta builds:** an open PR labelled `beta` plus a semver label publishes a BRAT-only GitHub prerelease (`X.Y.Z-beta.N`, picked by `scripts/beta-version.ts`) on every push, via `.github/workflows/beta.yml`. It never commits to `main` or bumps `manifest.json` there, because the community store reads that file. Testers add the repo in BRAT and pick the latest version, which includes prereleases. Merging is the release to everyone, so do not merge a `beta` PR until the owner has tested it.
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
