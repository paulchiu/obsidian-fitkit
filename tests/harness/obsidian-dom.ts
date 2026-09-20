import { JSDOM } from 'jsdom'

/** SVG namespace used for elements created through `createSvg`. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/**
 * Own jsdom backing every harness element. A real URL avoids an opaque
 * origin, without which formatting a failing DOM assertion throws.
 */
const harnessDom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://localhost/',
})

/** Window backing every harness element. Use its constructors for `instanceof`. */
export const harnessWindow = harnessDom.window

/** Document backing every harness element and the loaded stylesheet. */
export const harnessDocument: Document = harnessWindow.document

let installed = false

/**
 * Install the Obsidian element extensions onto the harness prototypes.
 * Self-latching, and applied on import so forgetting it cannot fail later.
 */
export function installObsidianDomExtensions(): void {
  if (installed) {
    return
  }
  installed = true
  const extensions: Record<string, (this: Element, ...args: never[]) => unknown> = {
    createEl,
    createDiv,
    createSpan,
    createSvg,
    empty,
    addClass,
    addClasses,
    removeClass,
    hasClass,
    setText,
    setAttr,
    instanceOf,
    detach,
  }
  Object.assign(harnessWindow.HTMLElement.prototype, extensions)
  Object.assign(harnessWindow.SVGElement.prototype, extensions)
}

/** Fresh detached root for a test to render into. Detached roots keep
 * per-test DOM isolated while the shared document holds the stylesheet.
 */
export function createTestRoot(): HTMLElement {
  return harnessDocument.createElement('div')
}

/** Buttons in a subtree whose visible label is exactly `text`, so every modal test finds actions one way. */
export function findButtons(root: Element, text: string): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')].filter((button) => button.textContent === text)
}

/** The three elements modal tests read off a constructed modal. */
export interface ModalElements {
  contentEl: HTMLElement
  modalEl: HTMLElement
  titleEl: HTMLElement
}

/** Narrow a constructed modal to the elements tests read. */
export function modalElements(modal: ModalElements): ModalElements {
  return modal
}

/** Split a `cls` option (string or string array) into individual class names. */
function splitClasses(cls: string | string[]): string[] {
  const entries = Array.isArray(cls) ? cls : [cls]
  return entries.flatMap((entry) => entry.split(/\s+/)).filter((entry) => entry.length > 0)
}

/** Apply the full `DomElementInfo` options object onto a new child element. */
function applyDomOptions(child: Element, options?: DomElementInfo | string): void {
  if (options === undefined) {
    return
  }
  const resolved: DomElementInfo = typeof options === 'string' ? { cls: options } : options
  if (resolved.cls !== undefined) {
    child.classList.add(...splitClasses(resolved.cls))
  }
  if (typeof resolved.text === 'string') {
    setText.call(child, resolved.text)
  }
  if (resolved.title !== undefined) {
    setAttr.call(child, 'title', resolved.title)
  }
  if (resolved.value !== undefined) {
    /** Property assignment keeps `input.value` live; on an option it reflects to the attribute. */
    const valueTarget = child as unknown as { value?: unknown }
    if (typeof valueTarget.value === 'string') {
      valueTarget.value = resolved.value
    }
  }
  if (resolved.type !== undefined) {
    setAttr.call(child, 'type', resolved.type)
  }
  if (resolved.placeholder !== undefined) {
    setAttr.call(child, 'placeholder', resolved.placeholder)
  }
  if (resolved.href !== undefined) {
    setAttr.call(child, 'href', resolved.href)
  }
  if (resolved.attr !== undefined) {
    for (const [name, value] of Object.entries(resolved.attr)) {
      setAttr.call(child, name, value)
    }
  }
}

/** Apply the `{ cls, attr }` options object onto a new SVG child element. */
function applySvgOptions(child: Element, options?: SvgElementInfo | string): void {
  if (options === undefined) {
    return
  }
  const resolved: SvgElementInfo = typeof options === 'string' ? { cls: options } : options
  if (resolved.cls !== undefined) {
    child.classList.add(...splitClasses(resolved.cls))
  }
  if (resolved.attr !== undefined) {
    for (const [name, value] of Object.entries(resolved.attr)) {
      setAttr.call(child, name, value)
    }
  }
}

function appendChildElement(
  host: Element,
  tagName: string,
  options?: DomElementInfo | string,
): HTMLElement {
  const child = host.ownerDocument.createElement(tagName)
  applyDomOptions(child, options)
  insertChild(host, child, options)
  return child
}

/**
 * Insert into `parent` when the options override it, otherwise the host.
 */
function insertChild(
  host: Element,
  child: Node,
  options?: DomElementInfo | SvgElementInfo | string,
): void {
  const resolved = typeof options === 'string' ? undefined : options
  const target = (resolved?.parent ?? host) as Element
  if (resolved?.prepend === true) {
    target.prepend(child)
    return
  }
  target.appendChild(child)
}

function createEl(
  this: Element,
  tagName: string,
  options?: DomElementInfo | string,
  callback?: (el: HTMLElement) => void,
): HTMLElement {
  const child = appendChildElement(this, tagName, options)
  if (callback !== undefined) {
    callback(child)
  }
  return child
}

function createDiv(
  this: Element,
  options?: DomElementInfo | string,
  callback?: (el: HTMLDivElement) => void,
): HTMLDivElement {
  const child = this.ownerDocument.createElement('div')
  applyDomOptions(child, options)
  insertChild(this, child, options)
  if (callback !== undefined) {
    callback(child)
  }
  return child
}

function createSpan(
  this: Element,
  options?: DomElementInfo | string,
  callback?: (el: HTMLSpanElement) => void,
): HTMLSpanElement {
  const child = this.ownerDocument.createElement('span')
  applyDomOptions(child, options)
  insertChild(this, child, options)
  if (callback !== undefined) {
    callback(child)
  }
  return child
}

function createSvg(
  this: Element,
  tagName: string,
  options?: SvgElementInfo | string,
  callback?: (el: SVGElement) => void,
): SVGElement {
  const child = this.ownerDocument.createElementNS(SVG_NAMESPACE, tagName)
  applySvgOptions(child, options)
  insertChild(this, child, options)
  if (callback !== undefined) {
    callback(child)
  }
  return child
}

function empty(this: Element): void {
  this.replaceChildren()
}

function addClass(this: Element, ...classes: string[]): void {
  this.classList.add(...classes)
}

function addClasses(this: Element, classes: string[]): void {
  this.classList.add(...classes)
}

function removeClass(this: Element, ...classes: string[]): void {
  this.classList.remove(...classes)
}

function hasClass(this: Element, cls: string): boolean {
  return this.classList.contains(cls)
}

function setText(this: Element, value: string): void {
  this.textContent = value
}

function setAttr(this: Element, name: string, value: string | number | boolean | null): void {
  if (value === null) {
    this.removeAttribute(name)
    return
  }
  this.setAttribute(name, String(value))
}

/**
 * Cross-window capable type check. Walks the prototype chain instead of the
 * `instanceof` operator so the check does not depend on realm identity.
 */
function instanceOf(this: Element, type: { new (...args: never[]): unknown }): boolean {
  const target: unknown = (type as { prototype: unknown }).prototype
  let current: unknown = Object.getPrototypeOf(this)
  while (current !== null) {
    if (current === target) {
      return true
    }
    current = Object.getPrototypeOf(current)
  }
  return false
}

function detach(this: Element): void {
  this.remove()
}

installObsidianDomExtensions()
