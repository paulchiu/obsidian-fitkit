import type { App } from 'obsidian'

/**
 * Walk the parent path of `filePath` segment by segment, creating any missing
 * folders. Obsidian's `vault.createFolder` does not create intermediate
 * directories; this helper makes deep destinations safe to write to.
 */
export async function ensureParentFolder(app: App, filePath: string): Promise<void> {
  const segments = filePath.split('/').slice(0, -1)
  let current = ''
  for (const segment of segments) {
    if (segment === '') {
      continue
    }
    current = current === '' ? segment : `${current}/${segment}`
    if (!app.vault.getAbstractFileByPath(current)) {
      /** A concurrent operation may have created the folder between the check and the create; treat "already exists" as success. */
      await app.vault.createFolder(current).catch(() => undefined)
    }
  }
}
