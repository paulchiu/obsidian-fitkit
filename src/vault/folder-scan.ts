import type { App, TAbstractFile, TFile, TFolder } from 'obsidian'

import { normalizeFolder } from '../settings-paths'

/**
 * Markdown files under `folder` and its subfolders, sorted by path; walks the folder's
 * own subtree rather than the whole vault so the plugin only ever touches its configured folders.
 */
export function markdownFilesInFolder(app: App, folder: string): TFile[] {
  const root = app.vault.getFolderByPath(normalizeFolder(folder))
  if (!root) {
    return []
  }

  const files: TFile[] = []
  const pending: TAbstractFile[] = [...root.children]
  while (pending.length > 0) {
    const node = pending.pop()
    if (!node) {
      continue
    }
    if (isFolder(node)) {
      pending.push(...node.children)
      continue
    }
    if (isMarkdownFile(node)) {
      files.push(node)
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path))
}

/** Narrows structurally on `children` rather than `instanceof TFolder`, so the walk does not depend on the obsidian module's class identities. */
function isFolder(node: TAbstractFile): node is TFolder {
  return Array.isArray((node as { children?: unknown }).children)
}

function isMarkdownFile(node: TAbstractFile): node is TFile {
  return (node as { extension?: unknown }).extension === 'md'
}
