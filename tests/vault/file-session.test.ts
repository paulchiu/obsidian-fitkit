import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', () => {
  class TFile {
    path = ''
    basename = ''
    extension = 'md'
    stat = { mtime: 0 }
  }
  return { TFile }
})

import { TFile, type App } from 'obsidian'

import { FileSession } from '../../src/vault/file-session'

const NOTE_PATH = 'Fitness/2026-08-15.md'
const LOADED_TEXT = '---\ntype: workout\n---\n\n[exercise:: [[Squat]]]\n'
const EXTERNAL_TEXT = '---\ntype: workout\n---\n\n[exercise:: [[Bench]]]\n'

interface Harness {
  session: FileSession
  readNote: () => string
  writeExternally: (text: string) => void
}

/**
 * A vault whose text only changes when a test says so. `read` and `process`
 * both go through the same value, so a test can land an external edit between a
 * save's preflight read and its process callback with `writeExternally` while
 * the save is awaiting the read. The file's mtime never changes, matching a
 * sync that rewrites text without Obsidian noticing a new stat.
 */
function createHarness(initialText: string): Harness {
  const file = Object.assign(new TFile(), {
    path: NOTE_PATH,
    basename: '2026-08-15',
    extension: 'md',
    stat: { mtime: 1000 },
  })
  let text = initialText
  const app = {
    vault: {
      read: async (): Promise<string> => text,
      process: async (_target: TFile, callback: (live: string) => string): Promise<string> => {
        text = callback(text)
        return text
      },
    },
  }
  return {
    session: new FileSession(app as unknown as App, file),
    readNote: () => text,
    writeExternally: (next) => {
      text = next
    },
  }
}

describe('FileSession atomic save', () => {
  it('rejects a save when an external edit lands between the preflight read and the process callback', async () => {
    const { session, readNote, writeExternally } = createHarness(LOADED_TEXT)
    await session.load()

    const saving = session.saveIfUnchanged('replacement text')
    writeExternally(EXTERNAL_TEXT)
    const result = await saving

    expect(result).toEqual({ ok: false, reason: 'hash' })
    expect(readNote()).toBe(EXTERNAL_TEXT)
  })

  it('keeps a rejected save blocked against the external text until the session reloads it', async () => {
    const { session, readNote, writeExternally } = createHarness(LOADED_TEXT)
    await session.load()

    const rejected = session.saveIfUnchanged('replacement text')
    writeExternally(EXTERNAL_TEXT)
    expect(await rejected).toEqual({ ok: false, reason: 'hash' })

    expect(await session.saveIfUnchanged('another replacement')).toEqual({
      ok: false,
      reason: 'hash',
    })
    expect(readNote()).toBe(EXTERNAL_TEXT)

    await session.load()
    expect(await session.saveIfUnchanged(EXTERNAL_TEXT)).toMatchObject({ ok: true })
    expect(readNote()).toBe(EXTERNAL_TEXT)
  })

  it('saves an unchanged note and uses each saved text as the next conflict baseline', async () => {
    const { session, readNote } = createHarness(LOADED_TEXT)
    await session.load()

    expect(await session.saveIfUnchanged(LOADED_TEXT)).toMatchObject({ ok: true })
    expect(readNote()).toBe(LOADED_TEXT)

    const firstSave = 'first saved revision'
    expect(await session.saveIfUnchanged(firstSave)).toMatchObject({ ok: true })

    const secondSave = 'second saved revision'
    expect(await session.saveIfUnchanged(secondSave)).toMatchObject({ ok: true })
    expect(readNote()).toBe(secondSave)
  })
})
