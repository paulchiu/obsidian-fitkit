import { Resvg } from '@resvg/resvg-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { extractChartCss } from '../../src/domain/chart-css'

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
