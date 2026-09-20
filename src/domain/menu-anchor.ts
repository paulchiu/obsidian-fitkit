/** The control a menu drops from, on the axes Obsidian's placement reads. */
export interface MenuTriggerBox {
  left: number
  width: number
  bottom: number
}

export interface MenuAnchor {
  x: number
  y: number
  width: number
  overlap: boolean
  left: boolean
}

/**
 * Anchor a menu to the control that opened it. Obsidian right-aligns the menu
 * to `x + width` when `left` is set and the menu fits there, so a control near
 * the right edge of its card drops its menu inward rather than beside it.
 */
export function menuAnchorForTrigger(box: MenuTriggerBox): MenuAnchor {
  return { x: box.left, y: box.bottom, width: box.width, overlap: true, left: true }
}
