/** Focuses `textarea` with the caret at its end, after the modal has settled on screen. */
export function focusTextAreaAtEnd(textarea: HTMLTextAreaElement): void {
  window.setTimeout(() => {
    textarea.focus()
    const length = textarea.value.length
    textarea.setSelectionRange(length, length)
  }, 0)
}
