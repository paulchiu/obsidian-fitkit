import type { FileSession } from './file-session'

/** What the view shows: the `unsaved` marker and the conflict banner. */
export interface AutosaveState {
  dirty: boolean
  conflict: boolean
}

export interface AutosaverDeps {
  /** The note edits are written to, or null once the view has let go of it. */
  session: () => FileSession | null
  /** The note text for the current model, or null when there is nothing to save. */
  serialize: () => string | null
  /** Read at schedule time, so a settings change applies to the next edit. */
  debounceMs: () => number
  refreshIndex: (path: string) => Promise<void>
  /** Fires when the dirty flag changes. */
  onChange: () => void
  /** Fires when a save is blocked by a change on disk. Later saves stay blocked until reset. */
  onConflict: () => void
}

export interface Autosaver {
  markDirty(): void
  state(): AutosaveState
  /** Waits out an in-flight save, writes pending edits, then stops the debounce timer. */
  settle(): Promise<void>
  /** Stops the timer and clears dirty and conflict state for a freshly loaded note. */
  reset(): void
}

/**
 * Debounces edits into FileSession writes. An edit made during a write triggers
 * another write once the current one lands, so no edit is dropped.
 */
export function createAutosaver(deps: AutosaverDeps): Autosaver {
  let dirty = false
  let conflict = false
  /** Bumped by every edit, so a finished write can tell whether it saved the latest one. */
  let editCount = 0
  let timer: number | null = null
  let inflight: Promise<void> | null = null
  let requeued = false

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  const schedule = (): void => {
    if (conflict) {
      return
    }
    clearTimer()
    timer = window.setTimeout(() => {
      timer = null
      void flush()
    }, deps.debounceMs())
  }

  const write = async (session: FileSession, text: string, savedEdit: number): Promise<void> => {
    const path = session.file.path
    try {
      const result = await session.saveIfUnchanged(text)
      if (!result.ok) {
        conflict = true
        deps.onConflict()
        return
      }
      /** An edit made while this write was in flight is not in `text`, so it keeps the note dirty. */
      dirty = editCount !== savedEdit
      deps.onChange()
      /** A failed refresh only leaves the cached index stale, so it must not fail the save. */
      await deps.refreshIndex(path).catch(() => undefined)
    } finally {
      inflight = null
      if (requeued) {
        requeued = false
        if (deps.session()) {
          schedule()
        }
      }
    }
  }

  const flush = async (): Promise<void> => {
    const session = deps.session()
    const text = session ? deps.serialize() : null
    if (!dirty || conflict || !session || text === null) {
      return
    }
    if (inflight) {
      requeued = true
      return
    }
    const savedEdit = editCount
    inflight = write(session, text, savedEdit)
    await inflight
  }

  const markDirty = (): void => {
    dirty = true
    editCount += 1
    deps.onChange()
    schedule()
  }

  const settle = async (): Promise<void> => {
    clearTimer()
    while (inflight) {
      await inflight
    }
    await flush()
    clearTimer()
  }

  const reset = (): void => {
    clearTimer()
    dirty = false
    conflict = false
  }

  return {
    markDirty,
    state: (): AutosaveState => ({ dirty, conflict }),
    settle,
    reset,
  }
}
