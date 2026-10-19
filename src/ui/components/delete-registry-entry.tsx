import type { JSX } from 'preact'

import { ActionBar } from './action-bar'

export interface DeleteRegistryEntryProps {
  entryName: string
  notePath: string | null
  onToggleAlsoDeleteFile: (checked: boolean) => void
  onChoose: (confirmed: boolean) => void
}

/** The warning for removing a registry entry, with a tick box when a note could go too. */
export function DeleteRegistryEntryBody({
  entryName,
  notePath,
  onToggleAlsoDeleteFile,
  onChoose,
}: DeleteRegistryEntryProps): JSX.Element {
  return (
    <>
      <p>{`Remove the registry overlay for '${entryName}'? Existing workout history is not rewritten.`}</p>
      {notePath ? (
        <>
          <p class="fitkit-import-muted">
            The exercise note will stay in your vault unless you choose to delete it too.
          </p>
          <div class="fitkit-import-checkbox-row">
            <input
              type="checkbox"
              id="fitkit-delete-also-file"
              onChange={(event) => onToggleAlsoDeleteFile(event.currentTarget.checked)}
            />
            <label for="fitkit-delete-also-file">
              {`Also delete the exercise note '${notePath}' and ignore this exercise until restored.`}
            </label>
          </div>
        </>
      ) : (
        <p class="fitkit-import-muted">
          No matching exercise note exists in your exercises folder. This exercise will be removed
          from the registry.
        </p>
      )}
      <ActionBar>
        <button class="fitkit-btn" onClick={() => onChoose(false)}>
          Cancel
        </button>
        <button class="fitkit-btn fitkit-destructive-button" onClick={() => onChoose(true)}>
          Delete
        </button>
      </ActionBar>
    </>
  )
}
