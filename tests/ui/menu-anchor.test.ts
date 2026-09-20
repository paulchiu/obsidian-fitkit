import { describe, expect, it } from 'vitest'

import { menuAnchorForTrigger } from '../../src/ui/menu-anchor'

describe('menuAnchorForTrigger', () => {
  it('spans the control so the menu can align to either of its edges', () => {
    const anchor = menuAnchorForTrigger({ left: 600, width: 28, bottom: 40 })

    expect(anchor.x).toBe(600)
    expect(anchor.y).toBe(40)
    expect(anchor.x + (anchor.width ?? 0)).toBe(628)
  })

  it('asks for the menu to hang off the control rather than sit past it', () => {
    const anchor = menuAnchorForTrigger({ left: 600, width: 28, bottom: 40 })

    expect(anchor.left).toBe(true)
    expect(anchor.overlap).toBe(true)
  })
})
