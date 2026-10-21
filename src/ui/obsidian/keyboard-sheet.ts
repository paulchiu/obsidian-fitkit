/** Space kept between a step field being typed in and the Save bar or phone keyboard below it. */
const KEYBOARD_CLEARANCE = 16

/**
 * Keeps the focused field visible over the phone keyboard by ending the sheet at the keyboard.
 * The plan text scrolls `top` (iOS can overshoot with examples open); step fields clear the Save bar.
 * Returns the cleanup.
 */
export function keepInViewOverKeyboard(
  form: HTMLElement,
  { top, field, bar, sheet, area }: KeyboardLayout,
): () => void {
  const win = activeWindow
  let keyboard = 0
  const align = (): void => {
    const focused = form.ownerDocument.activeElement
    if (focused === field) {
      const visibleTop = Math.max(
        form.getBoundingClientRect().top,
        win.visualViewport?.offsetTop ?? 0,
      )
      form.scrollTop += top.getBoundingClientRect().top - visibleTop
    } else if (keyboard > 0 && focused?.tagName === 'INPUT' && form.contains(focused)) {
      const visibleBottom = Math.min(win.innerHeight - keyboard, bar.getBoundingClientRect().top)
      const hidden = focused.getBoundingClientRect().bottom - (visibleBottom - KEYBOARD_CLEARANCE)
      if (hidden > 0) {
        form.scrollTop += hidden
      }
    }
  }
  const resized = (evt: Event): void => {
    keyboard = keyboardHeight(evt, win)
    liftOffKeyboard(sheet, area, win.innerHeight - keyboard)
    align()
  }
  /** A step field scrolls as soon as it is tapped; the plan text waits for the keyboard. */
  const fieldFocused = (): void => {
    if (form.ownerDocument.activeElement !== field) {
      align()
    }
  }
  win.addEventListener('keyboardDidShow', resized)
  win.addEventListener('keyboardDidHide', resized)
  win.visualViewport?.addEventListener('resize', resized)
  form.addEventListener('focusin', fieldFocused)
  return () => {
    liftOffKeyboard(sheet, area, Infinity)
    win.removeEventListener('keyboardDidShow', resized)
    win.removeEventListener('keyboardDidHide', resized)
    win.visualViewport?.removeEventListener('resize', resized)
    form.removeEventListener('focusin', fieldFocused)
  }
}

interface KeyboardLayout {
  top: HTMLElement
  field: HTMLElement
  bar: HTMLElement
  sheet: HTMLElement
  area: HTMLElement
}

/**
 * Pins the sheet's top while the keyboard covers part of the modal `area` and ends the sheet at
 * `keyboardTop`, first moving a sheet up if that makes it fit; puts it back when the keyboard is down.
 */
function liftOffKeyboard(sheet: HTMLElement, area: HTMLElement, keyboardTop: number): void {
  sheet.classList.remove('fitkit-keyboard-up')
  const bounds = area.getBoundingClientRect()
  if (keyboardTop >= bounds.bottom) {
    sheet.style.removeProperty('--fitkit-keyboard-top')
    sheet.style.removeProperty('--fitkit-keyboard-room')
    return
  }
  const { top, height } = sheet.getBoundingClientRect()
  const fitted = keyboardTop - height
  const pinned = fitted >= bounds.top ? Math.min(top, fitted) : top
  sheet.style.setProperty('--fitkit-keyboard-top', `${pinned - bounds.top}px`)
  sheet.style.setProperty('--fitkit-keyboard-room', `${keyboardTop - pinned}px`)
  sheet.classList.add('fitkit-keyboard-up')
}

/** The keyboard's height from the app's keyboard event, else what it takes off the visual viewport. */
function keyboardHeight(evt: Event, win: Window): number {
  if (evt.type === 'keyboardDidHide') {
    return 0
  }
  const viewport = win.visualViewport
  const covered = viewport ? win.innerHeight - viewport.height - viewport.offsetTop : 0
  const reported = 'keyboardHeight' in evt ? Number(evt.keyboardHeight) : 0
  return Math.max(0, covered, Number.isFinite(reported) ? reported : 0)
}
