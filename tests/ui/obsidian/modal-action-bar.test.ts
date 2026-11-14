import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { harnessDocument } from '../../harness/obsidian-dom'
import {
  computedStyle,
  ensureStylesheetLoaded,
  loadObsidianRules,
  SAFE_AREA_INSET_BOTTOM,
  THEME_TOKENS,
} from '../../harness/stylesheet'

/** Obsidian's bottom spacing token, through its harness stand-in. */
const SPACING = THEME_TOKENS['--size-4-3']

/** Obsidian's own phone padding on every modal body, and its phone sheet height. */
const OBSIDIAN_PHONE_CSS =
  '.is-phone .modal-content { padding: 12px; } .is-phone .modal { max-height: calc(100vh - 20px); bottom: 0; }'

beforeAll(() => {
  ensureStylesheetLoaded()
  loadObsidianRules(OBSIDIAN_PHONE_CSS)
})

afterEach(() => {
  harnessDocument.body.replaceChildren()
  harnessDocument.body.className = ''
  harnessDocument.body.removeAttribute('style')
})

/** A sheet the way the plan form renders: a scrolling form whose last child is the button bar. */
const renderSheet = (): { modal: HTMLElement; form: HTMLElement; bar: HTMLElement } => {
  const modal = harnessDocument.body.createDiv({ cls: 'modal fitkit-set-note-modal-shell' })
  const form = modal.createDiv({ cls: 'modal-content fitkit-set-note-modal' })
  form.createDiv({ cls: 'fitkit-plan-examples' })
  const bar = form.createDiv({ cls: 'fitkit-confirm-actions fitkit-set-note-actions' })
  return { modal, form, bar }
}

describe('modal button bar', () => {
  it('sits on the bottom edge of the sheet, holding the bottom spacing and safe area itself', () => {
    const { form, bar } = renderSheet()

    expect({
      formPaddingBottom: computedStyle(form, 'padding-bottom'),
      barBottom: computedStyle(bar, 'bottom'),
      barPaddingBottom: computedStyle(bar, 'padding-bottom'),
    }).toEqual({
      formPaddingBottom: '0px',
      barBottom: '0px',
      barPaddingBottom: SPACING,
    })
  })

  it('grows the padding below the bar to clear a safe area deeper than the spacing', () => {
    harnessDocument.body.style.setProperty(SAFE_AREA_INSET_BOTTOM, '34px')
    const { bar } = renderSheet()

    expect(computedStyle(bar, 'padding-bottom')).toBe('34px')
  })

  it('on a phone, overrides the padding below the bar and runs out across the side padding', () => {
    harnessDocument.body.addClass('is-phone')
    const { form, bar } = renderSheet()

    expect({
      formPaddingBottom: computedStyle(form, 'padding-bottom'),
      barMargin: [computedStyle(bar, 'margin-left'), computedStyle(bar, 'margin-right')],
      barPadding: [computedStyle(bar, 'padding-left'), computedStyle(bar, 'padding-right')],
    }).toEqual({
      formPaddingBottom: '0px',
      barMargin: [`-${SPACING}`, `-${SPACING}`],
      barPadding: [SPACING, SPACING],
    })
  })

  it('on a phone with the keyboard up, ends the sheet at the keyboard with the bar resting on it', () => {
    harnessDocument.body.addClass('is-phone')
    harnessDocument.body.style.setProperty(SAFE_AREA_INSET_BOTTOM, '34px')
    const { modal, bar } = renderSheet()
    modal.addClass('fitkit-keyboard-up')
    /** The offsets the keyboard sheet sets while the keyboard is up. */
    modal.style.setProperty('--fitkit-keyboard-top', '40px')
    modal.style.setProperty('--fitkit-keyboard-room', '300px')

    expect({
      alignSelf: computedStyle(modal, 'align-self'),
      marginTop: computedStyle(modal, 'margin-top'),
      maxHeight: computedStyle(modal, 'max-height'),
      barPaddingBottom: computedStyle(bar, 'padding-bottom'),
    }).toEqual({
      alignSelf: 'flex-start',
      marginTop: '40px',
      maxHeight: '300px',
      barPaddingBottom: SPACING,
    })
  })
})
