import { describe, expect, it } from 'vitest'

import { extractChartCss } from '../../src/domain/chart-css'

const SOURCE = [
  '.fitkit-chart-line { stroke: #3f7ad8; }',
  '.fitkit-other { color: red; }',
  '/* .fitkit-chart-trapped { display: none; } */',
].join('\n')

describe('extract chart css', () => {
  it('keeps chart rules while dropping unrelated rules and comments', () => {
    const extracted = extractChartCss(SOURCE)

    expect(extracted).toContain('.fitkit-chart-line')
    expect(extracted).not.toContain('.fitkit-other')
    expect(extracted).not.toContain('.fitkit-chart-trapped')
  })
})
