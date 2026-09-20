import { beforeEach, describe, expect, it } from 'vitest'

import { createTestRoot, harnessWindow, installObsidianDomExtensions } from './obsidian-dom'

beforeEach(() => {
  installObsidianDomExtensions()
})

describe('obsidian dom', () => {
  it('builds a real div child with class and text, then empties it', () => {
    const root = createTestRoot()
    const child = root.createDiv({ cls: 'x', text: 'hello' })

    expect(child.instanceOf(harnessWindow.HTMLDivElement)).toBe(true)
    expect(child.classList.contains('x')).toBe(true)
    expect(child.textContent).toBe('hello')

    root.empty()
    expect(root.childElementCount).toBe(0)
  })

  it('creates an input with attributes through createEl', () => {
    const root = createTestRoot()
    const input = root.createEl('input', {
      cls: 'fitkit-input',
      attr: { type: 'text', 'data-kind': 'weight' },
    })

    expect(input.instanceOf(harnessWindow.HTMLInputElement)).toBe(true)
    expect(input.getAttribute('data-kind')).toBe('weight')
  })

  it('sets input type, value and placeholder from top-level options', () => {
    const root = createTestRoot()
    const input = root.createEl('input', { type: 'checkbox', value: 'on', placeholder: 'x' })

    expect(input.type).toBe('checkbox')
    expect(input.value).toBe('on')
    expect(input.placeholder).toBe('x')
  })

  it('honours a parent override and prepends first when asked', () => {
    const root = createTestRoot()
    const other = createTestRoot()
    root.createDiv({ text: 'first' })

    root.createEl('span', { text: 'Zero', prepend: true })
    root.createEl('span', { text: 'Away', parent: other })

    expect(root.children.length).toBe(2)
    expect(root.children[0]?.textContent).toBe('Zero')
    expect(other.children.length).toBe(1)
    expect(other.children[0]?.textContent).toBe('Away')
  })

  it('honours parent and prepend on svg children', () => {
    const root = createTestRoot()
    const svg = root.createSvg('svg', {})
    const other = root.createSvg('svg', {})
    svg.createSvg('circle', { attr: { cx: 1 } })

    svg.createSvg('circle', { attr: { cx: 0 }, prepend: true })
    svg.createSvg('circle', { attr: { cx: 2 }, parent: other })

    expect(svg.children.length).toBe(2)
    expect(svg.children[0]?.getAttribute('cx')).toBe('0')
    expect(other.children.length).toBe(1)
    expect(other.children[0]?.getAttribute('cx')).toBe('2')
  })
  it('sets title and href from top-level options', () => {
    const root = createTestRoot()
    const link = root.createEl('a', {
      href: 'https://example.com/note',
      title: 'Tip',
      text: 'Link',
    })

    expect(link.getAttribute('href')).toBe('https://example.com/note')
    expect(link.getAttribute('title')).toBe('Tip')
  })

  it('creates a span child through createSpan', () => {
    const root = createTestRoot()
    const child = root.createSpan({ cls: 'a b', text: 'label' })

    expect(child.instanceOf(harnessWindow.HTMLSpanElement)).toBe(true)
    expect(child.classList.contains('b')).toBe(true)
    expect(child.textContent).toBe('label')
  })

  it('creates namespaced svg children through createSvg', () => {
    const root = createTestRoot()
    const svg = root.createSvg('svg', { cls: 'chart' })
    const circle = svg.createSvg('circle', { attr: { cx: 3 } })

    expect(svg.instanceOf(harnessWindow.SVGElement)).toBe(true)
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(circle.getAttribute('cx')).toBe('3')
  })

  it('adds and checks classes through addClass and hasClass', () => {
    const root = createTestRoot()

    root.addClass('is-compact')

    expect(root.hasClass('is-compact')).toBe(true)
    expect(root.hasClass('is-narrow')).toBe(false)
  })

  it('adds several classes at once through addClasses', () => {
    const root = createTestRoot()

    root.addClasses(['one', 'two'])

    expect(root.hasClass('one')).toBe(true)
    expect(root.hasClass('two')).toBe(true)
  })

  it('removes a class through removeClass', () => {
    const root = createTestRoot()
    root.addClass('is-narrow')

    root.removeClass('is-narrow')

    expect(root.hasClass('is-narrow')).toBe(false)
  })

  it('replaces text content through setText', () => {
    const root = createTestRoot()
    const child = root.createDiv({ text: 'Before' })

    child.setText('After')

    expect(child.textContent).toBe('After')
  })

  it('writes attributes through setAttr', () => {
    const root = createTestRoot()
    const child = root.createDiv()

    child.setAttr('aria-label', 'Load')

    expect(child.getAttribute('aria-label')).toBe('Load')
  })

  it('narrows element types through instanceOf', () => {
    const root = createTestRoot()
    const child: Element = root.createDiv()

    expect(child.instanceOf(harnessWindow.HTMLDivElement)).toBe(true)
    expect(child.instanceOf(harnessWindow.HTMLSpanElement)).toBe(false)
  })

  it('removes itself from its parent through detach', () => {
    const root = createTestRoot()
    const child = root.createDiv()

    child.detach()

    expect(root.childElementCount).toBe(0)
    expect(child.parentNode).toBe(null)
  })
})
