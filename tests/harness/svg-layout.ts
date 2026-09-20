import { Resvg } from '@resvg/resvg-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { harnessWindow } from './obsidian-dom'

/** Per-edge overflow of SVG content beyond its viewBox, in SVG units. */
export interface SvgOverflow {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Pinned shaping font. Host fonts resolve differently per machine, so one
 * bundled file keeps every measurement identical on macOS and CI.
 */
const SHAPING_FONT_FILE = join(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf')

/**
 * Measurement overrides. `fontFiles` exists so the sentinel test can prove
 * a missing font fails loudly; production callers keep the pinned default.
 */
export interface SvgMeasureOptions {
  fontFiles?: string[]
}

/** Bounding box of everything drawn in SVG markup, in SVG units. */
export interface SvgContentBox {
  x: number
  y: number
  width: number
  height: number
}

/** One known string rendered alone, so blank text can never read as fitting. */
const SENTINEL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40">' +
  '<text x="4" y="28" font-size="11">2026-04-19</text></svg>'

/** Measure how far SVG markup content overflows its own viewBox on each edge. */
export function measureSvgOverflow(
  svgMarkup: string,
  options: SvgMeasureOptions = {},
): SvgOverflow {
  const [viewX, viewY, viewWidth, viewHeight] = readViewBox(svgMarkup)
  const box = measureSvgContentBox(inlineChartStyles(svgMarkup), options)
  return {
    left: Math.max(0, viewX - box.x),
    top: Math.max(0, viewY - box.y),
    right: Math.max(0, box.x + box.width - (viewX + viewWidth)),
    bottom: Math.max(0, box.y + box.height - (viewY + viewHeight)),
  }
}

/**
 * Concrete stand-ins for the Obsidian theme tokens the chart rules reference.
 * Geometry only depends on sizes, but the screenshot renderer reuses this
 * CSS, so the stand-ins match its previous hard-coded palette.
 */
const CHART_TOKEN_STAND_INS: Record<string, string> = {
  '--background-modifier-border': '#c7cdd6',
  '--text-muted': '#5f6b7a',
  '--interactive-accent': '#3f7ad8',
}

/** SVG namespace resvg requires on serialised markup. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/** Serialise a rendered SVG element for measurement, stamping the namespace resvg requires. */
export function serializeSvg(svg: Element): string {
  svg.setAttribute('xmlns', SVG_NAMESPACE)
  return new harnessWindow.XMLSerializer().serializeToString(svg)
}

/** Inline the real chart rules from `styles.css` into SVG markup, so resvg shapes what Obsidian styles. */
export function inlineChartStyles(svgMarkup: string): string {
  const css = readFileSync(join(process.cwd(), 'styles.css'), 'utf8')
  return svgMarkup.replace(
    /<svg[^>]*>/,
    (openTag: string) => `${openTag}<style>${extractChartCss(css)}</style>`,
  )
}

/**
 * Keep the `.fitkit-chart*` rules from a stylesheet, swapping theme tokens
 * for concrete stand-ins. resvg cannot resolve `var()`, and geometry only
 * needs the surviving sizes, so any unmapped token becomes neutral grey.
 */
export function extractChartCss(source: string): string {
  const rules: string[] = []
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '')
  let depth = 0
  let selectorStart = 0
  let bodyStart = 0
  let selector = ''
  for (let index = 0; index < stripped.length; index++) {
    const ch = stripped[index]
    if (ch === '{') {
      if (depth === 0) {
        selector = stripped.slice(selectorStart, index).trim()
        bodyStart = index + 1
      }
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        const body = stripped.slice(bodyStart, index)
        if (!selector.startsWith('@') && selector.includes('.fitkit-chart')) {
          rules.push(`${selector} {${substituteThemeTokens(body)}}`)
        }
        selectorStart = index + 1
      }
    }
  }
  return rules.join('\n')
}

/** Swap `var()` theme tokens for concrete stand-ins resvg can parse. */
function substituteThemeTokens(body: string): string {
  return body.replace(
    /var\(\s*(--[\w-]+)\s*\)/g,
    (match: string, token: string) => CHART_TOKEN_STAND_INS[token] ?? '#888888',
  )
}

/** Bounding box of everything drawn in SVG markup, failing loudly when text cannot shape. */
export function measureSvgContentBox(
  svgMarkup: string,
  options: SvgMeasureOptions = {},
): SvgContentBox {
  const fontFiles = options.fontFiles ?? [SHAPING_FONT_FILE]
  assertTextShapes(fontFiles)
  const box = new Resvg(svgMarkup, {
    font: { loadSystemFonts: false, fontFiles },
  }).getBBox()
  return { x: box?.x ?? 0, y: box?.y ?? 0, width: box?.width ?? 0, height: box?.height ?? 0 }
}

/** Render one known string and require a positive width before trusting any measurement. */
function assertTextShapes(fontFiles: string[]): void {
  const box = new Resvg(SENTINEL_SVG, {
    font: { loadSystemFonts: false, fontFiles },
  }).getBBox()
  if (box !== undefined && box.width > 0) {
    return
  }
  throw new Error(
    'svg-layout: no shaped text measured with DejaVu Sans; the pinned font failed to load, ' +
      'so every label would report zero overflow while rendering nothing',
  )
}

/** Read the four viewBox numbers from an SVG open tag. */
function readViewBox(svgMarkup: string): [number, number, number, number] {
  const match = svgMarkup.match(/viewBox\s*=\s*["']([^"']+)["']/)
  const parts = (match?.[1] ?? '0 0 0 0').split(/[\s,]+/).map(Number)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0]
}
