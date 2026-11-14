import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'

import { harnessDocument, harnessWindow } from './obsidian-dom'

let loaded = false

/**
 * Stand-ins for the Obsidian theme tokens the harness tests read, loaded with `styles.css`.
 * Each value is distinct and never a literal in the stylesheet, so a computed value names its token.
 */
export const THEME_TOKENS = {
  '--size-4-2': '8.5px',
  '--size-4-3': '12.5px',
  '--text-muted': 'rgb(101, 1, 1)',
  '--text-faint': 'rgb(102, 2, 2)',
  '--text-success': 'rgb(103, 3, 3)',
  '--text-warning': 'rgb(104, 4, 4)',
  '--color-green': 'rgb(105, 5, 5)',
  '--color-orange': 'rgb(106, 6, 6)',
  '--interactive-accent': 'rgb(107, 7, 7)',
  '--background-modifier-border': 'rgb(108, 8, 8)',
} as const

/** A theme token the harness defines. */
export type ThemeToken = keyof typeof THEME_TOKENS

/** Custom property standing in for the device's `env(safe-area-inset-*)`; set it to model a notch. */
export const SAFE_AREA_INSET_BOTTOM = '--harness-safe-area-inset-bottom'

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
  style.textContent = withSafeAreaFallbacks(css)
  harnessDocument.head.appendChild(style)
  loadObsidianRules(
    `:root { ${Object.entries(THEME_TOKENS)
      .map(([token, value]) => `${token}: ${value};`)
      .join(' ')} }`,
  )
}

/**
 * jsdom defines no safe-area insets, so an unset `env()` would void its whole declaration.
 * Each gets a fallback reading a harness property, `0px` unless a test sets it, as on a notchless screen.
 */
function withSafeAreaFallbacks(css: string): string {
  return css.replace(
    /env\(safe-area-inset-(top|right|bottom|left)\)/g,
    (_match, side: string) =>
      `env(safe-area-inset-${side}, var(--harness-safe-area-inset-${side}, 0px))`,
  )
}

/** Add rules standing in for Obsidian's own stylesheet, which loads before the plugin's and so loses ties to it. */
export function loadObsidianRules(css: string): void {
  const style = harnessDocument.createElement('style')
  style.textContent = css
  harnessDocument.head.prepend(style)
}

/** Assert that a property resolves to a theme token, through the token's distinct stand-in value. */
export function expectAppliedThemeToken(
  element: Element,
  property: string,
  token: ThemeToken,
): void {
  expect(computedStyle(element, property)).toBe(THEME_TOKENS[token])
}

/**
 * The computed value of `property` on `element`, which must be in the document:
 * jsdom, like a browser, computes nothing for a detached element.
 */
export function computedStyle(element: Element, property: string): string {
  if (!element.isConnected) {
    throw new Error('Attach the element to the harness document before reading its style')
  }
  ensureStylesheetLoaded()
  return harnessWindow.getComputedStyle(element).getPropertyValue(property).trim()
}

/**
 * The value `styles.css` declares for `property` in the first top-level rule whose selector list names `selector`,
 * for a term jsdom cannot reach through `getComputedStyle`.
 */
export function declaredStyle(selector: string, property: string): string {
  ensureStylesheetLoaded()
  const sheet = harnessDocument.querySelector('style[data-fitkit-harness="stylesheet"]')
  const rules = (sheet as HTMLStyleElement | null)?.sheet?.cssRules ?? []
  for (const rule of Array.from(rules)) {
    if (
      rule instanceof harnessWindow.CSSStyleRule &&
      rule.selectorText.split(',').some((part) => part.trim() === selector) &&
      rule.style.getPropertyValue(property) !== ''
    ) {
      return rule.style.getPropertyValue(property)
    }
  }
  throw new Error(`styles.css declares no ${property} for ${selector}`)
}

/** The computed value of `property` with `token` unset on `element`, so a test can pin a `var()` fallback. */
export function computedStyleWithoutToken(
  element: HTMLElement,
  property: string,
  token: string,
): string {
  const previous = element.style.getPropertyValue(token)
  element.style.setProperty(token, 'initial')
  try {
    return computedStyle(element, property)
  } finally {
    if (previous === '') {
      element.style.removeProperty(token)
    } else {
      element.style.setProperty(token, previous)
    }
  }
}

/**
 * Classes on a rendered subtree that `styles.css` never styles, sorted, so a `cls:` typo fails by name.
 * Styled, `is-*`/`has-*` state hooks and the Obsidian classes below pass;
 * extend `OBSIDIAN_CLASSES` when rendering one the stylesheet does not name.
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
  'dropdown',
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
