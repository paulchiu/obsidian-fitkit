import { describe, expect, it } from 'vitest'

import { inlineChartStyles, measureSvgContentBox, measureSvgOverflow } from './svg-layout'

const AXIS_LABEL =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 320">' +
  '<text x="400" y="294" text-anchor="middle" class="fitkit-chart-axis-label">2026-04-19</text></svg>'

const OVERFLOWING =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 320">' +
  '<text x="792" y="294" text-anchor="middle">2026-04-19</text></svg>'
const IN_BOUNDS =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 320">' +
  '<rect x="10" y="10" width="100" height="50" /></svg>'

describe('svg layout', () => {
  it('reports positive right overflow for a label hanging off the viewBox', () => {
    expect(measureSvgOverflow(OVERFLOWING).right).toBeGreaterThan(0)
  })

  it('reports zero on every edge for content inside the viewBox', () => {
    expect(measureSvgOverflow(IN_BOUNDS)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })

  it('throws naming the font when no usable font is configured', () => {
    expect(() => measureSvgOverflow(IN_BOUNDS, { fontFiles: [] })).toThrow(/DejaVu Sans/)
  })

  it('measures an axis label narrower with the real stylesheet applied', () => {
    const bare = measureSvgContentBox(AXIS_LABEL).width
    const styled = measureSvgContentBox(inlineChartStyles(AXIS_LABEL)).width

    expect(styled).toBeLessThan(bare)
  })
})
