import type { JSX } from 'preact'

import type { ExerciseRenamePlan } from '../../domain/exercise-rename-planner'
import { ButtonRow } from './action-bar'
import { TextField } from './fields'

export type RenamePhase = 'input' | 'loading' | 'preview'

export interface RenameBodyProps {
  oldName: string
  phase: RenamePhase
  newName: string
  inputError: string | null
  plan: ExerciseRenamePlan | null
  applyWarning: string | null
  applying: boolean
  onNameInput: (value: string) => void
  onPreview: () => void
  onBack: () => void
  onCancel: () => void
  onConfirm: () => void
}

/** The rename modal's body: the name box, the checking line or the preview, under any warning. */
export function RenameBody(props: RenameBodyProps): JSX.Element {
  const { phase, plan, applyWarning } = props
  return (
    <>
      {applyWarning ? <div class="fitkit-warn">{applyWarning}</div> : null}
      {phase === 'input' ? <InputStage {...props} /> : null}
      {phase === 'loading' ? (
        <div class="fitkit-import-muted">Checking workout notes...</div>
      ) : null}
      {phase === 'preview' && plan ? <PreviewStage {...props} plan={plan} /> : null}
    </>
  )
}

function InputStage({
  oldName,
  newName,
  inputError,
  onNameInput,
  onCancel,
  onPreview,
}: RenameBodyProps): JSX.Element {
  return (
    <>
      <p class="fitkit-import-muted">
        {`Renaming '${oldName}' updates its exercise note file, rewrites '[exercise:: [[${oldName}]]]' references in workout notes, and keeps '${oldName}' as an alias. Renaming onto a name already in use merges the two.`}
      </p>
      <div class="fitkit-registry-field">
        <label class="fitkit-registry-field-label">New name</label>
        <TextField
          class="fitkit-registry-input"
          value={newName}
          onValueInput={onNameInput}
          focusOnMount
        />
      </div>
      {inputError ? <div class="fitkit-warn">{inputError}</div> : null}
      <ButtonRow>
        <button class="fitkit-btn" onClick={onCancel}>
          Cancel
        </button>
        <button class="fitkit-btn fitkit-btn-primary" onClick={onPreview}>
          Preview changes
        </button>
      </ButtonRow>
    </>
  )
}

function PreviewStage({
  plan,
  applying,
  onBack,
  onCancel,
  onConfirm,
}: RenameBodyProps & { plan: ExerciseRenamePlan }): JSX.Element {
  if (plan.refusal) {
    return (
      <>
        <h3>Can't rename this exercise</h3>
        <p>{plan.refusal.message}</p>
        <ButtonRow>
          <button class="fitkit-btn" onClick={onBack}>
            Back
          </button>
          <button class="fitkit-btn" onClick={onCancel}>
            Cancel
          </button>
        </ButtonRow>
      </>
    )
  }
  const confirmText = applying
    ? 'Applying...'
    : plan.operation === 'merge'
      ? 'Confirm merge'
      : 'Confirm rename'
  return (
    <>
      <p>
        {plan.operation === 'merge'
          ? `Merging '${plan.oldName}' into '${plan.newName}'.`
          : `Renaming '${plan.oldName}' to '${plan.newName}'.`}
      </p>
      <NoteFileSummary plan={plan} />
      <WorkoutNotesSummary plan={plan} />
      <AliasSummary plan={plan} />
      <StaleSummary plan={plan} />
      {plan.operation === 'merge' ? <MergeWarning plan={plan} /> : null}
      <ButtonRow>
        <button class="fitkit-btn" disabled={applying} onClick={onBack}>
          Back
        </button>
        <button class="fitkit-btn" disabled={applying} onClick={onCancel}>
          Cancel
        </button>
        <button class="fitkit-btn fitkit-btn-primary" disabled={applying} onClick={onConfirm}>
          {confirmText}
        </button>
      </ButtonRow>
    </>
  )
}

function NoteFileSummary({ plan }: { plan: ExerciseRenamePlan }): JSX.Element {
  const text = !plan.sourceNotePath
    ? `No exercise note file exists for '${plan.oldName}'; only the registry entry and workout note references will change.`
    : plan.operation === 'merge' && plan.targetNoteExists && plan.targetNotePath
      ? `'${plan.sourceNotePath}' will be removed after merging into '${plan.targetNotePath}'.`
      : `Rename: '${plan.sourceNotePath}' → '${plan.targetNotePath}'.`
  return (
    <>
      <h3>Exercise note file</h3>
      <p>{text}</p>
    </>
  )
}

function WorkoutNotesSummary({ plan }: { plan: ExerciseRenamePlan }): JSX.Element {
  const { workoutNotes } = plan
  return (
    <>
      <h3>{`Workout notes (${workoutNotes.length})`}</h3>
      {workoutNotes.length === 0 ? (
        <p>{`No workout notes reference '${plan.oldName}'.`}</p>
      ) : (
        <>
          <table class="fitkit-import-table">
            <tr>
              <th>Workout note</th>
              <th>Rows changed</th>
              <th>Left stale</th>
            </tr>
            {workoutNotes.map((note) => (
              <tr key={note.path}>
                <td>{note.path}</td>
                <td>{String(note.headingOccurrences + note.fieldOccurrences)}</td>
                <td>{note.staleOccurrences > 0 ? String(note.staleOccurrences) : ''}</td>
              </tr>
            ))}
          </table>
          <p class="fitkit-import-muted">
            {`${plan.totalHeadingOccurrences + plan.totalFieldOccurrences} row(s) across ${workoutNotes.length} workout note(s) will be updated.`}
          </p>
        </>
      )}
    </>
  )
}

function AliasSummary({ plan }: { plan: ExerciseRenamePlan }): JSX.Element {
  const others = plan.aliasesToKeep.filter((alias) => alias !== plan.oldName)
  return (
    <>
      <h3>Alias</h3>
      <p>
        {plan.aliasesToKeep.includes(plan.oldName)
          ? `'${plan.oldName}' will be kept as an alias of '${plan.newName}', so existing references still resolve.`
          : `'${plan.newName}' and '${plan.oldName}' differ only by case, so no separate alias is needed.`}
      </p>
      {others.length > 0 ? (
        <p class="fitkit-import-muted">{`Other aliases carried over: ${others.join(', ')}.`}</p>
      ) : null}
    </>
  )
}

function StaleSummary({ plan }: { plan: ExerciseRenamePlan }): JSX.Element {
  return (
    <>
      <h3>Left stale</h3>
      {plan.totalStaleOccurrences === 0 ? (
        <p>No references will be left stale.</p>
      ) : (
        <p class="fitkit-warn">
          {`${plan.totalStaleOccurrences} reference(s) use a pathed or aliased wikilink (for example '[[Folder/${plan.oldName}]]' or '[[${plan.oldName}|Display]]') and will not be rewritten here. Obsidian's own link updater may fix these when the note file is renamed; check them if not.`}
        </p>
      )}
    </>
  )
}

function MergeWarning({ plan }: { plan: ExerciseRenamePlan }): JSX.Element {
  const text =
    !plan.sourceNotePath || !plan.targetNoteExists
      ? `'${plan.newName}' has no exercise note yet, so this merge only combines registry entries; no note file is removed.`
      : plan.losingNoteHasProse
        ? `'${plan.sourceNotePath}' will be removed. Its Notes section has text, which will be copied into '${plan.targetNotePath}' under a 'Merged from ${plan.oldName}' heading first.`
        : `'${plan.sourceNotePath}' will be removed. Its Notes section has no text to carry over.`
  return (
    <>
      <h3>Merge</h3>
      <p class="fitkit-warn">{text}</p>
    </>
  )
}
