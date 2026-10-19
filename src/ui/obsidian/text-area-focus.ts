/** Focuses the modal's text box with the caret at its end, after the modal has settled on screen. */
export function focusTextAreaAtEnd(contentEl: HTMLElement): void {
  window.setTimeout(() => {
    const textarea = contentEl.querySelector('textarea')
    if (!textarea) {
      return
    }
    textarea.focus()
    const length = textarea.value.length
    textarea.setSelectionRange(length, length)
  }, 0)
}
