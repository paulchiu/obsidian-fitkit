# Offline render harness

UI tests render the real components against the real `styles.css` without
opening Obsidian. The harness owns one jsdom document per test run, loads the
shipped stylesheet into it, and measures chart SVG geometry with resvg and a
pinned font, so checks that used to need a person looking at screenshots are
assertions instead.

What it can check: rendered structure, the cascade (which rule and which theme
token wins), that every rendered class is styled, and SVG geometry. What it
cannot check: HTML layout. jsdom has no layout engine (`getBoundingClientRect`
is all zeros), so element overflow is out of scope by design.

## Modules

- `obsidian-dom.ts` renders through the Obsidian element extensions the plugin
  calls (`createEl`, `createDiv`, `createSpan`, `createSvg`, `empty`,
  `addClass`, `setText`, `setAttr`, and the rest). Everything else is plain
  jsdom. Extensions install on import. `createTestRoot()` gives each test a
  fresh detached root; `findButtons()` and `modalElements()` are the shared
  shapes for modal tests.
- `stylesheet.ts` loads `styles.css` once (`ensureStylesheetLoaded()`),
  asserts which theme token a property resolves to
  (`expectAppliedThemeToken()`, since jsdom never substitutes `var()`), and
  reports rendered classes the stylesheet never styles
  (`findUnstyledClasses()`). A class passes when a selector names it or it is
  recognised (`is-*`/`has-*` state hooks, plus the Obsidian classes in
  `OBSIDIAN_CLASSES`).
- `svg-layout.ts` measures an SVG against its own viewBox
  (`measureSvgOverflow()`). Every measurement first proves text shapes with a
  pinned DejaVu Sans file and fails loudly otherwise, so a missing font can
  never read as fitting. Chart CSS comes from `src/domain/chart-css.ts`,
  shared with the screenshot renderer.

## Starting a new UI test

Render into a fresh root and assert on the public seam (text, labels, classes),
never on internals:

```ts
import { createTestRoot, findButtons } from '../harness/obsidian-dom'
import { findUnstyledClasses } from '../harness/stylesheet'

const root = createTestRoot()
renderMyComponent(root, input)

expect(findButtons(root, 'Save')).toHaveLength(1)
expect(findUnstyledClasses(root)).toEqual([])
```

For a chart, assert presence alongside fit: the expected labels are drawn with
the expected text, and the SVG fits its viewBox. See
`exercise-chart-overflow.test.ts`. A fit assertion alone passes harder the less
is drawn.
