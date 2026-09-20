import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createTestRoot,
  harnessDocument,
  harnessWindow,
  installObsidianDomExtensions,
} from './obsidian-dom'
import { ensureStylesheetLoaded, expectAppliedThemeToken } from './stylesheet'

beforeAll(() => {
  ensureStylesheetLoaded()
})

beforeEach(() => {
  installObsidianDomExtensions()
})

afterEach(() => {
  harnessDocument.body.replaceChildren()
})

describe('stylesheet', () => {
  it('resolves the cascade so the taller variant wins', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    const tall = root.createDiv({ cls: 'fitkit-skeleton-line is-tall' })
    const base = root.createDiv({ cls: 'fitkit-skeleton-line' })

    expect(harnessWindow.getComputedStyle(tall).getPropertyValue('height')).toBe('32px')
    expect(harnessWindow.getComputedStyle(base).getPropertyValue('height')).toBe('12px')
  })

  it('reports the theme token instead of a resolved colour', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    const empty = root.createDiv({ cls: 'fitkit-empty' })

    expectAppliedThemeToken(empty, 'color', '--text-muted')
  })
})
