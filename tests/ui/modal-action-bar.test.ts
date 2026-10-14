import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { harnessDocument, harnessWindow } from '../harness/obsidian-dom'
import { ensureStylesheetLoaded, loadObsidianRules } from '../harness/stylesheet'

/** Obsidian's own phone padding on every modal body. */
const OBSIDIAN_PHONE_CSS = '.is-phone .modal-content { padding: 12px; }'

beforeAll(() => {
  ensureStylesheetLoaded()
  loadObsidianRules(OBSIDIAN_PHONE_CSS)
})

afterEach(() => {
  harnessDocument.body.replaceChildren()
  harnessDocument.body.className = ''
})

/** A sheet the way the plan form renders: a scrolling form whose last child is the button bar. */
const renderSheet = (): { form: HTMLElement; bar: HTMLElement } => {
  const modal = harnessDocument.body.createDiv({ cls: 'modal fitkit-set-note-modal-shell' })
  const form = modal.createDiv({ cls: 'modal-content fitkit-set-note-modal' })
  form.createDiv({ cls: 'fitkit-plan-examples' })
  const bar = form.createDiv({ cls: 'fitkit-confirm-actions fitkit-set-note-actions' })
  return { form, bar }
}

const style = (element: Element, property: string): string =>
  harnessWindow.getComputedStyle(element).getPropertyValue(property).trim()

describe('modal button bar', () => {
  it('sits on the bottom edge of the sheet, holding the bottom spacing and safe area itself', () => {
    const { form, bar } = renderSheet()

    expect({
      formPaddingBottom: style(form, 'padding-bottom'),
      barBottom: style(bar, 'bottom'),
      barPaddingBottom: style(bar, 'padding-bottom'),
    }).toEqual({
      formPaddingBottom: '0px',
      barBottom: '0px',
      barPaddingBottom: 'max(var(--size-4-3), env(safe-area-inset-bottom))',
    })
  })

  it('on a phone, overrides the padding below the bar and runs out across the side padding', () => {
    harnessDocument.body.addClass('is-phone')
    const { form, bar } = renderSheet()

    expect({
      formPaddingBottom: style(form, 'padding-bottom'),
      barMargin: [style(bar, 'margin-left'), style(bar, 'margin-right')],
      barPadding: [style(bar, 'padding-left'), style(bar, 'padding-right')],
    }).toEqual({
      formPaddingBottom: '0px',
      barMargin: ['calc(-1 * var(--size-4-3))', 'calc(-1 * var(--size-4-3))'],
      barPadding: ['var(--size-4-3)', 'var(--size-4-3)'],
    })
  })
})
