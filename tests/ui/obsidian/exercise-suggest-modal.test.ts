import { afterEach, describe, expect, it, vi } from 'vitest'

import { outline } from '../../harness/outline'
import { createTestRoot, harnessDocument } from '../../harness/obsidian-dom'
import { findUnstyledClasses } from '../../harness/stylesheet'

vi.mock('obsidian', () => {
  class SuggestModal {
    inputEl = createTestRoot()
    limit = 100
    emptyStateText = ''
    constructor(readonly app: unknown) {}
    setPlaceholder(): void {}
    onOpen(): Promise<void> {
      return Promise.resolve()
    }
    onClose(): void {}
    close(): void {
      this.onClose()
    }
  }

  return { SuggestModal }
})

import { ExerciseSuggestModal } from '../../../src/ui/obsidian/exercise-suggest-modal'

function row(item: Parameters<ExerciseSuggestModal['renderSuggestion']>[0]): HTMLElement {
  const modal = new ExerciseSuggestModal({} as never, ['Plank'], vi.fn())
  const el = harnessDocument.body.createDiv()
  modal.renderSuggestion(item, el)
  return el
}

describe('exercise suggest modal rows', () => {
  afterEach(() => {
    harnessDocument.body.replaceChildren()
  })

  it.each([
    ['an existing exercise', { type: 'existing', name: 'Plank' }],
    ['a new exercise', { type: 'new', name: 'Bear crawl' }],
  ] as const)('draws %s', (_name, item) => {
    const el = row(item)

    expect(outline(el)).toMatchSnapshot()
    expect(findUnstyledClasses(el)).toEqual([])
  })

  it('replaces what the row held when it is drawn again', () => {
    const modal = new ExerciseSuggestModal({} as never, ['Plank'], vi.fn())
    const el = harnessDocument.body.createDiv()

    modal.renderSuggestion({ type: 'existing', name: 'Plank' }, el)
    modal.renderSuggestion({ type: 'new', name: 'Bear crawl' }, el)

    expect(el.textContent).toBe(
      'Add "Bear crawl"You will choose whether to create an exercise note.',
    )
  })
})
