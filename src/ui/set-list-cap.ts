/** Whether a set list is shown in full past the cap; held per card so it survives re-renders. */
export interface SetListExpansion {
  expanded: () => boolean
  setExpanded: (expanded: boolean) => void
}

/**
 * Clips a set list taller than half the window behind a toggle that shows it
 * all, so one long card does not take over the editor. Returns a refit for
 * when the pane's size changes, such as a hidden tab being shown.
 */
export const capSetList = (
  area: HTMLElement,
  rows: HTMLElement,
  count: number,
  expansion: SetListExpansion,
): (() => void) => {
  const toggle = area.createEl('button', {
    cls: 'fitkit-btn fitkit-btn-muted fitkit-set-toggle',
    attr: { type: 'button' },
  })
  const refit = (): void => {
    const tall = rows.scrollHeight > rows.win.innerHeight / 2
    const capped = tall && !expansion.expanded()
    if (capped) {
      rows.addClass('is-capped')
    } else {
      rows.removeClass('is-capped')
    }
    toggle.hidden = !tall
    toggle.setText(capped ? `Show all ${count} sets` : 'Show fewer sets')
    toggle.setAttr('aria-expanded', String(!capped))
  }
  toggle.addEventListener('click', () => {
    expansion.setExpanded(!expansion.expanded())
    refit()
  })
  refit()
  return refit
}
