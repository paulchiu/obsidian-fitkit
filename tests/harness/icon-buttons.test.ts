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
const TEXT_BUTTON = 'fitkit-btn'

interface RenderedButton {
  padding: string
  width: string
  height: string
  background: string
  color: string
  glyph: { width: string; height: string }
}

/** Render a button of `cls`, inside a root carrying `rootStyle` (a card's custom properties, say). */
function render(cls: string, rootStyle: Record<string, string> = {}): RenderedButton {
  const root = createTestRoot()
  for (const [property, value] of Object.entries(rootStyle)) {
    root.style.setProperty(property, value)
  }
  harnessDocument.body.appendChild(root)
  const button = root.createEl('button', { cls })
  const glyph = button.createSvg('svg')
  const style = harnessWindow.getComputedStyle(button)
  const glyphStyle = harnessWindow.getComputedStyle(glyph)
  return {
    padding: (['top', 'right', 'bottom', 'left'] as const)
      .map((side) => style.getPropertyValue(`padding-${side}`))
      .join(' '),
    width: style.getPropertyValue('width'),
    height: style.getPropertyValue('height'),
    background: style.getPropertyValue('background'),
    color: style.getPropertyValue('color'),
    glyph: {
      width: glyphStyle.getPropertyValue('width'),
      height: glyphStyle.getPropertyValue('height'),
    },
  }
}

describe('icon buttons', () => {
  it('gives the row kebab a square unpadded box', () => {
    const kebab = render(ROW_KEBAB)

    expect(kebab.padding).toBe('0px 0px 0px 0px')
    expect(kebab.width).toBe('28px')
    expect(kebab.height).toBe('28px')
  })

  it('gives the card gear a square unpadded box around a square glyph', () => {
    const gear = render(CARD_GEAR)

    expect(gear.padding).toBe('0px 0px 0px 0px')
    expect(gear.width).toBe('32px')
    expect(gear.height).toBe(gear.width)
    expect(gear.glyph).toEqual({ width: '18px', height: '18px' })
  })

  it('sizes the card gear from the card control size', () => {
    const gear = render(CARD_GEAR, { '--fitkit-card-control-size': '40px' })

    expect([gear.width, gear.height]).toEqual(['40px', '40px'])
  })

  it('keeps the padding on a text button', () => {
    expect(render(TEXT_BUTTON).padding).toBe('6px 10px 6px 10px')
  })

  it('holds the icon padding against a later rule on the shared button class', () => {
    const later = harnessDocument.createElement('style')
    later.textContent = '.fitkit-btn { padding: 4px 7px; }'
    harnessDocument.head.appendChild(later)
    try {
      expect(render(ROW_KEBAB).padding).toBe('0px 0px 0px 0px')
      expect(render(CARD_GEAR).padding).toBe('0px 0px 0px 0px')
      expect(render(TEXT_BUTTON).padding).toBe('4px 7px 4px 7px')
    } finally {
      later.remove()
    }
  })

  it('leaves every other shared button declaration to the shared rule', () => {
    const text = render(TEXT_BUTTON)

    for (const icon of [render(ROW_KEBAB), render(CARD_GEAR)]) {
      expect(icon.background).toBe(text.background)
      expect(icon.color).toBe(text.color)
    }
  })
})
