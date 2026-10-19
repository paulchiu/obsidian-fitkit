import { afterEach, describe, expect, it, vi } from 'vitest'

import { outline } from '../../harness/outline'
import { createTestRoot, harnessDocument } from '../../harness/obsidian-dom'
import { findUnstyledClasses } from '../../harness/stylesheet'

vi.mock('obsidian', () => {
  class Modal {
    contentEl = createTestRoot()
    modalEl = createTestRoot()

    titleEl = createTestRoot()

    setTitle(title: string): this {
      this.titleEl.textContent = title
      return this
    }

    constructor(readonly app: unknown) {}

    close(): void {
      const maybeClosable = this as { onClose?: () => void }
      maybeClosable.onClose?.()
    }
  }

  return { Modal }
})

import { ParseDiagnosticsModal } from '../../../src/ui/obsidian/parse-diagnostics-modal'

describe('parse diagnostics modal', () => {
  afterEach(() => {
    harnessDocument.body.replaceChildren()
  })

  it('lists each warning under its path, name or a general heading', () => {
    const modal = new ParseDiagnosticsModal({} as never, [
      { path: 'Workouts/a.md', warnings: ['Bad set', 'Bad weight'] },
      { name: 'Plank', warnings: ['Unknown kind'] },
      { warnings: ['Something else'] },
    ])
    harnessDocument.body.appendChild(modal.contentEl)
    modal.onOpen()

    expect(modal.titleEl.textContent).toBe('Parse diagnostics')
    expect(outline(modal.contentEl)).toMatchSnapshot()
    expect(findUnstyledClasses(modal.contentEl)).toEqual([])
  })

  it('takes a custom title', () => {
    const modal = new ParseDiagnosticsModal({} as never, [], 'Exercise registry diagnostics')
    modal.onOpen()

    expect(modal.titleEl.textContent).toBe('Exercise registry diagnostics')
  })
})
