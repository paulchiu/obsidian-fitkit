import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileSession, SaveResult } from '../../src/vault/file-session'
import { createAutosaver, type AutosaverDeps } from '../../src/vault/autosaver'

const PATH = 'Fitness/Workouts/2026-08-15.md'
const OK: SaveResult = { ok: true, hash: 'h', mtime: 1 }
const CONFLICT: SaveResult = { ok: false, reason: 'hash' }
const DEBOUNCE_MS = 600

interface Gate {
  promise: Promise<void>
  open: () => void
}

function gate(): Gate {
  let open: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

/** A FileSession stand-in whose only behaviour is the save it is given. */
function fakeSession(path: string, save: (text: string) => Promise<SaveResult>): FileSession {
  return { file: { path }, saveIfUnchanged: vi.fn(save) } as unknown as FileSession
}

interface Rig {
  autosaver: ReturnType<typeof createAutosaver>
  writes: string[]
  onChange: ReturnType<typeof vi.fn>
  onConflict: ReturnType<typeof vi.fn>
  refreshIndex: ReturnType<typeof vi.fn>
  setText: (next: string | null) => void
  setSession: (next: FileSession | null) => void
  setDebounce: (ms: number) => void
}

/** Wires an autosaver to a fake session that records each text it is asked to write. */
function rig(save?: (text: string, writeNumber: number) => Promise<SaveResult>): Rig {
  const writes: string[] = []
  let text: string | null = 'a'
  let debounceMs = DEBOUNCE_MS
  let session: FileSession | null = fakeSession(PATH, async (next) => {
    writes.push(next)
    return save ? save(next, writes.length) : OK
  })
  const onChange = vi.fn()
  const onConflict = vi.fn()
  const refreshIndex = vi.fn(async () => undefined)
  const deps: AutosaverDeps = {
    session: () => session,
    serialize: () => text,
    debounceMs: () => debounceMs,
    refreshIndex,
    onChange,
    onConflict,
  }
  return {
    autosaver: createAutosaver(deps),
    writes,
    onChange,
    onConflict,
    refreshIndex,
    setText: (next) => {
      text = next
    },
    setSession: (next) => {
      session = next
    },
    setDebounce: (ms) => {
      debounceMs = ms
    },
  }
}

describe('createAutosaver', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // eslint-disable-next-line obsidianmd/no-global-this -- The test realm's global object is the only handle available for stubbing.
    vi.stubGlobal('window', globalThis)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('coalesces a burst of edits into one write of the latest text after the debounce', async () => {
    const { autosaver, writes, setText } = rig()

    autosaver.markDirty()
    await vi.advanceTimersByTimeAsync(100)
    setText('b')
    autosaver.markDirty()
    await vi.advanceTimersByTimeAsync(100)
    setText('c')
    autosaver.markDirty()

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1)
    expect(writes).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(writes).toEqual(['c'])
    expect(autosaver.state()).toEqual({ dirty: false, conflict: false })
  })

  it('reads the debounce at schedule time', async () => {
    const { autosaver, writes, setDebounce } = rig()
    setDebounce(2000)

    autosaver.markDirty()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(writes).toEqual([])

    await vi.advanceTimersByTimeAsync(1400)
    expect(writes).toEqual(['a'])
  })

  it('writes an edit made during an in-flight save once that save lands', async () => {
    const first = gate()
    const { autosaver, writes, setText } = rig(async (_text, writeNumber) => {
      if (writeNumber === 1) {
        await first.promise
      }
      return OK
    })

    autosaver.markDirty()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(writes).toEqual(['a'])

    setText('b')
    autosaver.markDirty()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(writes).toEqual(['a'])
    expect(autosaver.state().dirty).toBe(true)

    first.open()
    await vi.advanceTimersByTimeAsync(0)
    expect(autosaver.state().dirty).toBe(true)

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(writes).toEqual(['a', 'b'])
    expect(autosaver.state().dirty).toBe(false)
  })

  it('flushes pending edits on settle without waiting for the debounce', async () => {
    const { autosaver, writes, setText } = rig()

    autosaver.markDirty()
    setText('b')
    autosaver.markDirty()
    await autosaver.settle()

    expect(writes).toEqual(['b'])
    expect(autosaver.state().dirty).toBe(false)

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2)
    expect(writes).toEqual(['b'])
  })

  it('settle waits for an in-flight save before resolving', async () => {
    const first = gate()
    const { autosaver, writes } = rig(async () => {
      await first.promise
      return OK
    })
    autosaver.markDirty()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(writes).toEqual(['a'])

    let settled = false
    const settling = autosaver.settle().then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    first.open()
    await settling
    expect(settled).toBe(true)
    expect(writes).toEqual(['a'])
    expect(autosaver.state().dirty).toBe(false)
  })

  it('settle writes an edit made while a save was in flight', async () => {
    const first = gate()
    const { autosaver, writes, setText } = rig(async (_text, writeNumber) => {
      if (writeNumber === 1) {
        await first.promise
      }
      return OK
    })
    autosaver.markDirty()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    setText('b')
    autosaver.markDirty()
    const settling = autosaver.settle()
    first.open()
    await settling

    expect(writes).toEqual(['a', 'b'])
    expect(autosaver.state().dirty).toBe(false)
  })

  it('settle waits until an edit made during its flush has persisted', async () => {
    const first = gate()
    const latest = gate()
    let persisted = ''
    const { autosaver, setText } = rig(async (text) => {
      await (text === 'a' ? first.promise : latest.promise)
      persisted = text
      return OK
    })
    autosaver.markDirty()
    let settled = false
    const settling = autosaver.settle().then(() => {
      settled = true
    })

    setText('b')
    autosaver.markDirty()
    first.open()
    await vi.advanceTimersByTimeAsync(0)

    expect(persisted).toBe('a')
    expect(settled).toBe(false)
    expect(autosaver.state().dirty).toBe(true)

    latest.open()
    await settling
    expect(persisted).toBe('b')
    expect(autosaver.state()).toEqual({ dirty: false, conflict: false })
  })

  it('settle drains successive edits and leaves no delayed write after completion', async () => {
    const first = gate()
    const second = gate()
    const last = gate()
    const persisted: string[] = []
    const { autosaver, writes, setText } = rig(async (text) => {
      if (text === 'a') await first.promise
      if (text === 'b') await second.promise
      if (text === 'c') await last.promise
      persisted.push(text)
      return OK
    })
    autosaver.markDirty()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    setText('b')
    autosaver.markDirty()
    let settled = false
    const settling = autosaver.settle().then(() => {
      settled = true
    })
    first.open()
    await vi.advanceTimersByTimeAsync(0)

    setText('c')
    autosaver.markDirty()
    second.open()
    await vi.advanceTimersByTimeAsync(0)
    expect(persisted).toEqual(['a', 'b'])
    expect(settled).toBe(false)

    setText('d')
    autosaver.markDirty()
    last.open()
    await settling
    expect(persisted).toEqual(['a', 'b', 'c', 'd'])
    expect(autosaver.state()).toEqual({ dirty: false, conflict: false })

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2)
    expect(writes).toEqual(['a', 'b', 'c', 'd'])
  })

  it.each(['conflict', 'missing session', 'null serialization'] as const)(
    'settle finishes with dirty edits when saving is blocked by %s',
    async (blockedBy) => {
      const first = gate()
      let persisted = ''
      const { autosaver, writes, setText, setSession } = rig(async (text) => {
        await first.promise
        if (blockedBy === 'conflict') return CONFLICT
        persisted = text
        return OK
      })
      autosaver.markDirty()
      const settling = autosaver.settle()
      setText('b')
      autosaver.markDirty()
      if (blockedBy === 'missing session') setSession(null)
      if (blockedBy === 'null serialization') setText(null)
      first.open()

      await expect(settling).resolves.toBeUndefined()
      expect(autosaver.state()).toEqual({ dirty: true, conflict: blockedBy === 'conflict' })
      expect(persisted).toBe(blockedBy === 'conflict' ? '' : 'a')
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2)
      expect(writes).toEqual(['a'])
    },
  )

  it('settle rejects and keeps edits dirty when its final write fails', async () => {
    const first = gate()
    const failure = new Error('write failed')
    let persisted = ''
    const { autosaver, setText } = rig(async (text) => {
      if (text === 'b') throw failure
      await first.promise
      persisted = text
      return OK
    })
    autosaver.markDirty()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    setText('b')
    autosaver.markDirty()
    const rejected = expect(autosaver.settle()).rejects.toBe(failure)
    first.open()

    await rejected
    expect(persisted).toBe('a')
    expect(autosaver.state()).toEqual({ dirty: true, conflict: false })
  })

  it('does not write again from a debounce timer that was pending at settle', async () => {
    const { autosaver, writes } = rig()
    autosaver.markDirty()
    await autosaver.settle()
    expect(writes).toEqual(['a'])

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2)
    expect(writes).toEqual(['a'])
  })

  it('writes nothing when the model has nothing to save', async () => {
    const save = vi.fn(async () => OK)
    const session = fakeSession(PATH, save)
    const autosaver = createAutosaver({
      session: () => session,
      serialize: () => null,
      debounceMs: () => DEBOUNCE_MS,
      refreshIndex: async () => undefined,
      onChange: () => undefined,
      onConflict: () => undefined,
    })

    autosaver.markDirty()
    await autosaver.settle()

    expect(save).not.toHaveBeenCalled()
    expect(autosaver.state().dirty).toBe(true)
  })

  it('reports a conflict, blocks later saves, and clears on reset', async () => {
    const { autosaver, writes, setText, onConflict } = rig(async () => CONFLICT)

    autosaver.markDirty()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(writes).toEqual(['a'])
    expect(onConflict).toHaveBeenCalledTimes(1)
    expect(autosaver.state()).toEqual({ dirty: true, conflict: true })

    setText('b')
    autosaver.markDirty()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    await autosaver.settle()
    expect(writes).toEqual(['a'])

    autosaver.reset()
    expect(autosaver.state()).toEqual({ dirty: false, conflict: false })
  })

  it('refreshes the index for the saved note after a successful save', async () => {
    const { autosaver, refreshIndex, onChange } = rig()

    autosaver.markDirty()
    await autosaver.settle()

    expect(refreshIndex).toHaveBeenCalledWith(PATH)
    expect(onChange).toHaveBeenCalled()
  })

  it('does not refresh the index after a blocked save', async () => {
    const { autosaver, refreshIndex } = rig(async () => CONFLICT)

    autosaver.markDirty()
    await autosaver.settle()

    expect(refreshIndex).not.toHaveBeenCalled()
  })

  it('settles normally when the index refresh fails', async () => {
    const { autosaver, refreshIndex } = rig()
    refreshIndex.mockRejectedValueOnce(new Error('index unavailable'))

    autosaver.markDirty()
    await expect(autosaver.settle()).resolves.toBeUndefined()

    expect(autosaver.state().dirty).toBe(false)
  })

  it('refreshes the note that was saved even if the session is swapped mid-save', async () => {
    const first = gate()
    const noteA = fakeSession(PATH, async () => {
      await first.promise
      return OK
    })
    let current: FileSession | null = noteA
    const refreshIndex = vi.fn(async () => undefined)
    const autosaver = createAutosaver({
      session: () => current,
      serialize: () => 'a',
      debounceMs: () => DEBOUNCE_MS,
      refreshIndex,
      onChange: () => undefined,
      onConflict: () => undefined,
    })

    autosaver.markDirty()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    current = fakeSession('Fitness/Workouts/2026-08-16.md', async () => OK)
    first.open()
    await autosaver.settle()

    expect(refreshIndex).toHaveBeenCalledWith(PATH)
  })
})
