import { createTestRoot } from '../harness/obsidian-dom'
import { mixinFileView } from './obsidian-file-view'

export interface MockMenuItem {
  title?: string
  icon?: string
  checked?: boolean
  disabled?: boolean
  warning?: boolean
  onClick?: () => void
}

/** The position def a menu was shown at, as Obsidian's `Menu.showAtPosition` takes it. */
export interface MockMenuPosition {
  x: number
  y: number
  width?: number
  overlap?: boolean
  left?: boolean
}

export interface MockMenu {
  items: MockMenuItem[]
  position?: MockMenuPosition
}

export interface MockModal {
  contentEl: HTMLElement
  modalEl: HTMLElement
  titleEl: HTMLElement
  close(): void
}

/**
 * What the view asked Obsidian to show: menus, the modals still open, and
 * notices. Menus stay mocked since they are Obsidian's; modals draw into
 * harness elements.
 */
export const obsidianRecord = {
  menus: [] as MockMenu[],
  modals: [] as MockModal[],
  notices: [] as string[],
  platform: { isMobile: false },
}

export function resetObsidianRecord(): void {
  obsidianRecord.menus.length = 0
  obsidianRecord.modals.length = 0
  obsidianRecord.notices.length = 0
  obsidianRecord.platform.isMobile = false
}

/**
 * The `obsidian` module for an editor test's `vi.mock` factory, with the view
 * and modal classes backed by harness elements.
 */
export function createObsidianMock(): Record<string, unknown> {
  class ItemView {
    app: unknown
    leaf: unknown
    contentEl: HTMLElement
    constructor(leaf: unknown) {
      this.leaf = leaf
      this.app =
        leaf && typeof leaf === 'object' && 'app' in leaf
          ? (leaf as { app?: unknown }).app
          : undefined
      this.contentEl = createTestRoot()
    }
    registerDomEvent(): void {}
    registerEvent(): void {}
    getState(): Record<string, unknown> {
      return {}
    }
    async setState(_state: unknown, _result: unknown): Promise<void> {}
  }

  class Plugin {}

  class MenuItem {
    constructor(private state: MockMenuItem) {}
    setTitle(title: string): this {
      this.state.title = title
      return this
    }
    setIcon(icon: string): this {
      this.state.icon = icon
      return this
    }
    setWarning(warning: boolean): this {
      this.state.warning = warning
      return this
    }
    setChecked(checked: boolean): this {
      this.state.checked = checked
      return this
    }
    setSection(): this {
      return this
    }
    setDisabled(disabled: boolean): this {
      this.state.disabled = disabled
      return this
    }
    onClick(callback: () => void): this {
      this.state.onClick = callback
      return this
    }
  }

  class Menu implements MockMenu {
    items: MockMenuItem[] = []
    position?: MockMenuPosition
    constructor() {
      obsidianRecord.menus.push(this)
    }
    addItem(callback: (item: MenuItem) => void): this {
      const state: MockMenuItem = {}
      callback(new MenuItem(state))
      this.items.push(state)
      return this
    }
    addSeparator(): this {
      return this
    }
    showAtPosition(position: MockMenuPosition): void {
      this.position = position
    }
    showAtMouseEvent(): void {}
  }

  class Modal implements MockModal {
    contentEl = createTestRoot()
    modalEl = createTestRoot()
    titleEl = createTestRoot()
    constructor(readonly app: unknown) {}
    setTitle(title: string): this {
      this.titleEl.textContent = title
      return this
    }
    open(): void {
      obsidianRecord.modals.push(this)
      void (this as { onOpen?: () => unknown }).onOpen?.()
    }
    /** Closed modals leave the record, so it lists only what is still on screen. */
    close(): void {
      const index = obsidianRecord.modals.indexOf(this)
      if (index >= 0) {
        obsidianRecord.modals.splice(index, 1)
      }
      ;(this as { onClose?: () => void }).onClose?.()
    }
  }

  class SuggestModal extends Modal {
    inputEl = createTestRoot().createEl('input')
    emptyStateText = ''
    limit = 0
    setPlaceholder(): void {}
    async onOpen(): Promise<void> {}
    onClose(): void {}
  }

  class PluginSettingTab {}
  class Setting {}
  class MarkdownView {}

  class Notice {
    constructor(readonly message: string) {
      obsidianRecord.notices.push(message)
    }
  }

  class TFile {
    path = ''
    extension = 'md'
    basename = ''
    stat = { mtime: 1000 }
  }

  const FileView = mixinFileView(ItemView, (value): value is TFile => value instanceof TFile)

  return {
    FileView,
    ItemView,
    MarkdownView,
    Menu,
    Modal,
    Notice,
    Platform: obsidianRecord.platform,
    Plugin,
    PluginSettingTab,
    Setting,
    SuggestModal,
    TFile,
    normalizePath: (path: string) => path.replace(/\/+/g, '/'),
    /** Marks where an icon lands, so structure snapshots pin it. */
    setIcon: (el: HTMLElement, name: string) => el.setAttribute('data-icon', name),
  }
}
