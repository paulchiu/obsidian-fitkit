import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'

import { harnessDocument, harnessWindow } from './obsidian-dom'

let loaded = false

/**
 * Load the repo's real `styles.css` into the harness document once, so
 * `getComputedStyle` resolves the same cascade the plugin ships.
 */
export function ensureStylesheetLoaded(): void {
  if (loaded) {
    return
  }
  loaded = true
  /** Harness tests run in node, so the stylesheet resolves from the repo root. */
  const css = readFileSync(join(process.cwd(), 'styles.css'), 'utf8')
  const style = harnessDocument.createElement('style')
  style.setAttribute('data-fitkit-harness', 'stylesheet')
  style.textContent = css
  harnessDocument.head.appendChild(style)
}

/**
 * Assert that a property resolves to a theme token. jsdom never substitutes
 * custom properties, so the assertion names the token, not a colour.
 */
export function expectAppliedThemeToken(element: Element, property: string, token: string): void {
  expect(harnessWindow.getComputedStyle(element).getPropertyValue(property).trim()).toBe(
    `var(${token})`,
  )
}
