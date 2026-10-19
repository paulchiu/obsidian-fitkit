import { describe, expect, it } from 'vitest'

import { createTestRoot } from './obsidian-dom'
import { outline } from './outline'

describe('outline', () => {
  it('joins adjacent text nodes, so text split across nodes reads as it renders', () => {
    const span = createTestRoot().createSpan()
    span.append('Set ', '2')
    expect(outline(span)).toBe('span\n  "Set 2"')
  })

  it('keeps text on either side of an element as separate runs, skipping blanks', () => {
    const p = createTestRoot().createEl('p')
    p.append(' a ')
    p.createEl('b', { text: 'Bold' })
    p.append(' ', ' ')
    expect(outline(p)).toBe('p\n  "a"\n  b\n    "Bold"')
  })

  it('sorts attributes by name and keeps classes in order', () => {
    const button = createTestRoot().createEl('button', {
      cls: 'fitkit-btn is-primary',
      attr: { type: 'button', 'aria-label': 'Stop' },
    })
    expect(outline(button)).toBe('button.fitkit-btn.is-primary[aria-label=Stop][type=button]')
  })

  it('collapses an svg to a child count', () => {
    const svg = createTestRoot().createSvg('svg', { attr: { viewBox: '0 0 1 1' } })
    svg.createSvg('g')
    svg.createSvg('g')
    expect(outline(svg)).toBe('svg[viewBox=0 0 1 1] {2 children}')
  })
})
