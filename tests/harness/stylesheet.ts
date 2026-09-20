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

/**
 * Classes on a rendered subtree that `styles.css` never styles, sorted, so a
 * `cls:` typo fails with the offender named instead of rendering unstyled.
 *
 * A class passes when it is styled (named by any selector, standalone or
 * compound) or recognised: `is-*` and `has-*` state hooks toggled at
 * runtime, and the Obsidian classes below. Anything else is reported,
 * including a mistyped prefix. Extend `OBSIDIAN_CLASSES` when the plugin
 * renders an Obsidian class the stylesheet does not name.
 */
export function findUnstyledClasses(root: Element): string[] {
  ensureStylesheetLoaded()
  const defined = collectStyledClasses()
  const unstyled = new Set<string>()
  const elements = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const element of elements) {
    for (const name of Array.from(element.classList)) {
      if (!defined.has(name) && !isRecognisedClass(name)) {
        unstyled.add(name)
      }
    }
  }
  return [...unstyled].sort()
}

/** Obsidian classes the plugin renders but the plugin stylesheet never names. */
const OBSIDIAN_CLASSES: ReadonlySet<string> = new Set([
  'mod-cta',
  'setting-item-description',
  'setting-item-name',
])

/** State hooks toggled at runtime and consumed inside compound selectors. */
function isRecognisedClass(name: string): boolean {
  return name.startsWith('is-') || name.startsWith('has-') || OBSIDIAN_CLASSES.has(name)
}

/**
 * Every class named by any selector in the loaded stylesheet. Compound
 * members count: a class styled only alongside a state hook is still styled.
 */
function collectStyledClasses(): Set<string> {
  const defined = new Set<string>()
  for (const sheet of Array.from(harnessDocument.styleSheets)) {
    collectFromRules(sheet.cssRules, defined)
  }
  return defined
}

/** Walk style rules (descending into `@media`) collecting every class each selector names. */
function collectFromRules(rules: CSSRuleList, into: Set<string>): void {
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index] as CSSRule
    if (rule instanceof harnessWindow.CSSMediaRule) {
      collectFromRules(rule.cssRules, into)
      continue
    }
    if (!(rule instanceof harnessWindow.CSSStyleRule)) {
      continue
    }
    for (const match of rule.selectorText.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
      const name = match[1]
      if (name !== undefined) {
        into.add(name)
      }
    }
  }
}
