import type { App, TFile } from 'obsidian'
import { describe, expect, it } from 'vitest'

import { FileSession } from '../../src/vault/file-session'

function createVault() {
  let text = 'Original workout'
  let beforeProcess: (() => void) | null = null
  const vault = {
    read: async (_file: TFile): Promise<string> => text,
    process: async (_file: TFile, transform: (current: string) => string): Promise<string> => {
      beforeProcess?.()
      beforeProcess = null
      text = transform(text)
      file.stat.mtime += 1
      return text
    },
  }
  const file: TFile = {
    path: 'Fitness/Workouts/session.md',
    name: 'session.md',
    basename: 'session',
    extension: 'md',
    parent: null,
    vault: vault as unknown as App['vault'],
    stat: { mtime: 100, ctime: 100, size: text.length },
  }
  const session = new FileSession({ vault } as unknown as App, file)
  return {
    session,
    read: () => vault.read(file),
    edit: (next: string, mtime = file.stat.mtime) => {
      text = next
      file.stat.mtime = mtime
    },
    beforeNextProcess: (edit: () => void) => {
      beforeProcess = edit
    },
  }
}

describe('FileSession', () => {
  it.each([100, 200])(
    'preserves an atomic external edit at mtime %i until reload allows a save',
    async (externalMtime) => {
      const { session, read, edit, beforeNextProcess } = createVault()
      const loaded = await session.load()
      beforeNextProcess(() => edit('External workout edit', externalMtime))

      expect(await session.saveIfUnchanged('Attempted replacement')).toEqual({
        ok: false,
        reason: 'conflict',
      })
      expect(await read()).toBe('External workout edit')
      expect(session.snapshotMtime).toBe(loaded.mtime)
      expect(await session.saveIfUnchanged('Attempted replacement')).toEqual({
        ok: false,
        reason: 'conflict',
      })
      expect(await read()).toBe('External workout edit')

      expect(await session.load()).toMatchObject({ text: 'External workout edit' })
      expect(await session.saveIfUnchanged('Reloaded workout save')).toMatchObject({ ok: true })
      expect(await read()).toBe('Reloaded workout save')
    },
  )

  it('saves an unchanged note repeatedly and checks the latest saved baseline', async () => {
    const { session, read, edit } = createVault()
    await session.load()

    expect(await session.saveIfUnchanged('First saved workout')).toMatchObject({ ok: true })
    expect(await read()).toBe('First saved workout')
    expect(await session.saveIfUnchanged('Second saved workout')).toMatchObject({ ok: true })
    expect(await read()).toBe('Second saved workout')

    edit('First saved workout')
    expect(await session.saveIfUnchanged('Third saved workout')).toEqual({
      ok: false,
      reason: 'conflict',
    })
    expect(await read()).toBe('First saved workout')
  })

  it('blocks a save after an external edit to non-ASCII text', async () => {
    const { session, read, edit } = createVault()
    edit('A\u0001')
    await session.load()
    edit('Ł')

    expect(await session.saveIfUnchanged('Attempted replacement')).toEqual({
      ok: false,
      reason: 'conflict',
    })
    expect(await read()).toBe('Ł')
  })
})
