/**
 * Minimal typing for the parts of jsdom the test harness touches. Declares
 * only the surface the harness uses, so the implementation never needs casts.
 */
declare module 'jsdom' {
  export interface HarnessWindow {
    document: Document
    CSSMediaRule: typeof CSSMediaRule
    CSSStyleRule: typeof CSSStyleRule
    HTMLElement: typeof HTMLElement
    SVGElement: typeof SVGElement
    HTMLDivElement: typeof HTMLDivElement
    HTMLInputElement: typeof HTMLInputElement
    HTMLSpanElement: typeof HTMLSpanElement
    XMLSerializer: typeof XMLSerializer
    getComputedStyle(element: Element): CSSStyleDeclaration
  }

  export class JSDOM {
    constructor(html?: string)
    window: HarnessWindow
  }
}
