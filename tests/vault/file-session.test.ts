import type { App, TFile } from 'obsidian'
import { describe, expect, it } from 'vitest'

import { FileSession } from '../../src/vault/file-session'

function createVault() {
  let text = 'Original workout'
  let beforeProcess: (() => void) | null = null
  const file = { path: 'Fitness/Workouts/session.md', stat: { mtime: 100 } } as TFile
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
      reason: 'hash',
    })
    expect(await read()).toBe('First saved workout')
  })
})
