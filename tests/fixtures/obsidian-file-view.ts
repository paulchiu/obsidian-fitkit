interface FileLike {
  path: string
}

interface ViewBase {
  app: unknown
}

type ViewBaseClass = new (...args: never[]) => ViewBase

/**
 * Obsidian's FileView lifecycle over a test's own ItemView mock: setState
 * resolves the path and loadFile swaps files through onUnloadFile/onLoadFile,
 * skipping a reload of the file already open.
 */
export const mixinFileView = <TBase extends ViewBaseClass>(
  ItemView: TBase,
  isFile: (value: unknown) => value is FileLike,
): TBase & (new (...args: never[]) => ViewBase & FileViewMembers) => {
  class FileView extends ItemView {
    file: FileLike | null = null
    navigation = true
    allowNoFile = false

    getState(): Record<string, unknown> {
      return this.file ? { file: this.file.path } : {}
    }

    async setState(state: { file?: string }, result: { layout?: boolean }): Promise<void> {
      if (!('file' in state)) {
        return
      }
      const vault = (this.app as { vault: { getAbstractFileByPath: (p: string) => unknown } })
        .vault
      const target = vault.getAbstractFileByPath(state.file ?? '')
      if (await this.loadFile(isFile(target) ? target : null)) {
        result.layout = true
      }
    }

    async loadFile(file: FileLike | null): Promise<boolean> {
      if (this.file === file) {
        return false
      }
      if (this.file) {
        await this.onUnloadFile(this.file)
      }
      this.file = file
      if (file) {
        await this.onLoadFile(file)
      }
      return true
    }

    async onLoadFile(_file: FileLike): Promise<void> {}
    async onUnloadFile(_file: FileLike): Promise<void> {}
  }
  return FileView
}

interface FileViewMembers {
  file: FileLike | null
  navigation: boolean
  allowNoFile: boolean
  loadFile(file: FileLike | null): Promise<boolean>
}
