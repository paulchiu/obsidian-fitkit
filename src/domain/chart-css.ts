/**
 * Concrete stand-ins for the Obsidian theme tokens the chart rules reference.
 * Geometry only depends on sizes, so the stand-ins match the screenshot
 * renderer's previous hard-coded palette.
 */
const CHART_TOKEN_STAND_INS: Record<string, string> = {
  '--background-modifier-border': '#c7cdd6',
  '--text-muted': '#5f6b7a',
  '--interactive-accent': '#3f7ad8',
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
