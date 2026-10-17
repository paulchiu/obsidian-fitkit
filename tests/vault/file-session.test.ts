import type { App, TFile } from 'obsidian'
import { describe, expect, it } from 'vitest'

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
  const file = {
    path: NOTE_PATH,
    basename: '2026-08-15',
    extension: 'md',
    stat: { mtime: 1000 },
  }
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
    session: new FileSession(app as unknown as App, file as unknown as TFile),
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
})
