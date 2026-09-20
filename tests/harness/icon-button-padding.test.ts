import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createTestRoot, harnessDocument, harnessWindow } from './obsidian-dom'
import { ensureStylesheetLoaded } from './stylesheet'

beforeAll(() => {
  ensureStylesheetLoaded()
})

afterEach(() => {
  harnessDocument.body.replaceChildren()
})

/** The class lists the workout editor renders for its two icon buttons. */
const ROW_KEBAB = 'fitkit-btn fitkit-btn-muted fitkit-row-kebab'
const CARD_GEAR = 'fitkit-btn fitkit-btn-muted fitkit-card-icon-button fitkit-gear-button'

function paddingOf(cls: string): string {
  const root = createTestRoot()
  harnessDocument.body.appendChild(root)
  const button = root.createEl('button', { cls })
  const style = harnessWindow.getComputedStyle(button)
  return [
    style.getPropertyValue('padding-top'),
    style.getPropertyValue('padding-right'),
    style.getPropertyValue('padding-bottom'),
    style.getPropertyValue('padding-left'),
  ].join(' ')
}

describe('icon button padding', () => {
  it('leaves the row kebab and the card gear unpadded so their glyphs stay square', () => {
    expect(paddingOf(ROW_KEBAB)).toBe('0px 0px 0px 0px')
    expect(paddingOf(CARD_GEAR)).toBe('0px 0px 0px 0px')
  })

  it('keeps the padding on a text button', () => {
    expect(paddingOf('fitkit-btn')).toBe('6px 10px 6px 10px')
  })

  it('holds the icon padding against a later rule on the shared button class', () => {
    const later = harnessDocument.createElement('style')
    later.textContent = '.fitkit-btn { padding: 6px 10px; }'
    harnessDocument.head.appendChild(later)
    try {
      expect(paddingOf(ROW_KEBAB)).toBe('0px 0px 0px 0px')
      expect(paddingOf(CARD_GEAR)).toBe('0px 0px 0px 0px')
    } finally {
      later.remove()
    }
  })
})
