/**
 * Minimal duck-typed shape `markdownFilesInFolder` needs from a file node: a full
 * vault `path`, plus an optional `extension` (inferred from the path's suffix when omitted).
 */
export interface MockVaultFile {
  path: string
  extension?: string
  [key: string]: unknown
}

export interface MockVaultFolder {
  path: string
  name: string
  children: Array<MockVaultFolder | (MockVaultFile & { extension: string })>
}

function inferExtension(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? '' : path.slice(dot + 1)
}

/**
 * Builds a mock Obsidian folder tree from a flat list of file-like objects, exposing
 * `getFolderByPath` so a test's mockApp.vault only needs this one method to stand in
 * for the real vault that `markdownFilesInFolder` walks.
 */
export function buildMockVaultFolderTree<TFile extends MockVaultFile>(
  files: readonly TFile[],
): { getFolderByPath: (path: string) => MockVaultFolder | null } {
  const folders = new Map<string, MockVaultFolder>()

  function folderFor(path: string): MockVaultFolder {
    const existing = folders.get(path)
    if (existing) {
      return existing
    }
    const folder: MockVaultFolder = { path, name: path.split('/').pop() ?? path, children: [] }
    folders.set(path, folder)
    const parentEnd = path.lastIndexOf('/')
    if (parentEnd >= 0) {
      folderFor(path.slice(0, parentEnd)).children.push(folder)
    }
    return folder
  }

  for (const file of files) {
    const parentEnd = file.path.lastIndexOf('/')
    if (parentEnd < 0) {
      continue
    }
    const extension = file.extension ?? inferExtension(file.path)
    folderFor(file.path.slice(0, parentEnd)).children.push({ ...file, extension })
  }

  return {
    getFolderByPath: (path: string) => folders.get(path) ?? null,
  }
}
