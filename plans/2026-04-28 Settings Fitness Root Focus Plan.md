---
status: approved
target: v0.8.1
date: 2026-04-28
branch: feature/settings-fitness-root-focus
---

# Settings Fitness Root Focus Plan

## 1. Problem

Typing into the **Fitness root** input in plugin settings loses focus after every character. Only one keystroke lands per focus pass, making the field effectively unusable.

## 2. Root Cause

`FitKitSettingTab.display` (`src/settings.ts:51-56`) calls `this.display()` from inside the fitness-root `onChange`. `display()` runs `containerEl.empty()` and rebuilds the whole tab, so the focused `<input>` is detached from the DOM and replaced with a freshly-built one. The blur is the natural consequence.

The reason the call exists is to refresh the three "Derived paths" preview lines (Workouts folder, Exercises folder, Dashboard) that depend on `fitnessRoot`.

## 3. Fix

Build the derived-paths block once with stable element references and update only their text content from the `onChange`. Drop the `this.display()` call.

- Capture refs to the three preview `<div>` elements when they are created.
- Wrap their value text in a small inline `<span>` so re-rendering the value does not disturb the label prefix.
- After `settings.fitnessRoot` is normalised, call a local `refreshDerivedPaths()` that rewrites the three span text contents from `workoutsFolder` / `exercisesFolder` / `dashboardPath`.

## 4. Out Of Scope

- Journal folder and other text inputs do not call `display()`, so they keep working. No change needed.
- Bootstrap button still calls `display()` because it mutates the registry list and the user is not in a text field at that moment. Leave it.

## 5. Tests

UI tab behaviour is manual per AGENTS.md §6. Existing unit tests for `settings-paths` cover the path math. No new automated coverage.

Manual:

1. Open settings, click into Fitness root, hold a key, confirm focus stays and the field updates.
2. Confirm the three derived-paths lines update live as you type.
3. Confirm Journal folder still saves on edit and Bootstrap still re-renders the registry section.

## 6. Risk

Low. Local UI-only change in a single file. No data migration, no autosave path, no view lifecycle.

## 7. Changelog

Under `### Fixed`:

- Settings: editing the Fitness root no longer loses focus after every character; the derived-paths preview now updates in place.

## 8. Release Label

`patch`.
