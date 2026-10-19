import type { MenuPositionDef } from 'obsidian'

/** The box of the control a menu drops from, on the axes placement reads. */
export type MenuTriggerBox = Pick<DOMRect, 'left' | 'width' | 'bottom'>

/**
 * Anchor a menu to the control that opened it. Obsidian right-aligns the menu
 * to `x + width` when `left` is set and the menu fits there, so a control near
 * the right edge of its card drops its menu inward rather than beside it.
 */
export function menuAnchorForTrigger(box: MenuTriggerBox): MenuPositionDef {
  return { x: box.left, y: box.bottom, width: box.width, overlap: true, left: true }
}
