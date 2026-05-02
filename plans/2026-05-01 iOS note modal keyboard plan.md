---
status: shipped
target: v0.10.1
date: 2026-05-01
branch: fix/ios-note-modal-keyboard
title: 'iOS note modal keyboard plan'
generation:
  summary_prompt: >-
    Recreate this implementation plan for fixing the FitKit workout set note
    popup when the iOS keyboard covers the Cancel and Save buttons.
  source_context: >-
    Generated from the user-provided screenshot of the iOS keyboard covering
    the note entry popup action buttons, plus inspection of src/ui/set-note-modal.ts
    and styles.css.
  conversation_archive:
    status: 'summarised_only'
    path: null
---

# iOS note modal keyboard plan

## Problem

On iOS, the workout editor's set note popup focuses the textarea immediately.
The keyboard opens over the bottom of the modal, and the Cancel and Save buttons
are partly hidden behind the keyboard.

The affected surface is `SetNoteModal` in `src/ui/set-note-modal.ts`. The modal
currently renders a title, textarea field, and action row as normal grid
children. The modal has no height constraint, no scroll containment, and no
sticky action row.

## Goal

Keep the note textarea focused for fast entry, but make the action buttons
reachable while the iOS keyboard is open.

## Approach

- Keep the modal implementation small and scoped to the note popup.
- Add a shell class to the modal and a specific class to the action row.
- Constrain the note modal height with dynamic viewport units so it can shrink
  with the iOS keyboard where supported.
- Make the note modal body scrollable.
- Make the note modal action row sticky at the bottom of the scrollable modal
  content, with a modal-background backing layer and safe-area padding.
- Keep existing Cancel and Save behaviour unchanged.

## Tests

- Add unit coverage for `SetNoteModal` so the modal shell, content, and action
  classes are present.
- Cover the existing save and blank-note behaviour while touching the modal.
- Run `npm test`, `npm run lint`, `npm run format:check`, and `npm run build`.
- Run CodeRabbit CLI review and address any issues.

## Changelog

Add an Unreleased Fixed entry for the iOS note popup buttons remaining reachable
above the keyboard.

## Release label

patch
