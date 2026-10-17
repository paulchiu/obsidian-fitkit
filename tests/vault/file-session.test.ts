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
  contents: Map<string, string>
}

/**
 * A vault whose text only changes when a test says so. `read` and `process`
 * both go through the same map, so a test can land an external edit between a
 * save's preflight read and its process callback by mutating `contents` while
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
  const contents = new Map<string, string>([[NOTE_PATH, initialText]])
  const app = {
    vault: {
      read: async (target: { path: string }): Promise<string> => contents.get(target.path) ?? '',
      process: async (
        target: { path: string },
        callback: (live: string) => string,
      ): Promise<string> => {
        const next = callback(contents.get(target.path) ?? '')
        contents.set(target.path, next)
        return next
      },
    },
  }
  return {
    session: new FileSession(app as unknown as App, file),
    contents,
  }
}

describe('FileSession atomic save', () => {
  it('rejects a save when an external edit lands between the preflight read and the process callback', async () => {
    const { session, contents } = createHarness(LOADED_TEXT)
    await session.load()

    const saving = session.saveIfUnchanged('replacement text')
    contents.set(NOTE_PATH, EXTERNAL_TEXT)
    const result = await saving

    expect(result).toEqual({ ok: false, reason: 'hash' })
    expect(contents.get(NOTE_PATH)).toBe(EXTERNAL_TEXT)
  })

  it('keeps a rejected save blocked against the external text until the session reloads it', async () => {
    const { session, contents } = createHarness(LOADED_TEXT)
    await session.load()

    const rejected = session.saveIfUnchanged('replacement text')
    contents.set(NOTE_PATH, EXTERNAL_TEXT)
    expect(await rejected).toEqual({ ok: false, reason: 'hash' })

    expect(await session.saveIfUnchanged('another replacement')).toEqual({
      ok: false,
      reason: 'hash',
    })
    expect(contents.get(NOTE_PATH)).toBe(EXTERNAL_TEXT)

    await session.load()
    expect(await session.saveIfUnchanged(EXTERNAL_TEXT)).toMatchObject({ ok: true })
    expect(contents.get(NOTE_PATH)).toBe(EXTERNAL_TEXT)
  })

  it('saves an unchanged note and uses each saved text as the next conflict baseline', async () => {
    const { session, contents } = createHarness(LOADED_TEXT)
    await session.load()

    expect(await session.saveIfUnchanged(LOADED_TEXT)).toMatchObject({ ok: true })
    expect(contents.get(NOTE_PATH)).toBe(LOADED_TEXT)

    const firstSave = 'first saved revision'
    expect(await session.saveIfUnchanged(firstSave)).toMatchObject({ ok: true })

    const secondSave = 'second saved revision'
    expect(await session.saveIfUnchanged(secondSave)).toMatchObject({ ok: true })
    expect(contents.get(NOTE_PATH)).toBe(secondSave)
  })
})
