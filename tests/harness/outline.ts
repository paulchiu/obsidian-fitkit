/**
 * `el` as indented `tag.cls[attr=value]` lines with adjacent text joined, so a snapshot pins the
 * structure the stylesheet relies on rather than how the DOM was built. An `<svg>` is one line.
 */
export function outline(el: Element): string {
  return lines(el, 0).join('\n')
}

function lines(el: Element, depth: number): string[] {
  const pad = '  '.repeat(depth)
  const tag = el.tagName.toLowerCase()
  const head = pad + tag + classes(el) + attributes(el)
  if (tag === 'svg') return [`${head} {${el.childElementCount} children}`]
  return [head, ...runs(el.childNodes).flatMap((run) => runLines(run, depth + 1))]
}

/** An element child, or the text of a run of adjacent text children. */
type Run = Element | string

const runLines = (run: Run, depth: number): string[] => {
  if (typeof run !== 'string') return lines(run, depth)
  const text = run.trim()
  return text ? [`${'  '.repeat(depth)}"${text}"`] : []
}

const runs = (nodes: NodeListOf<ChildNode>): Run[] =>
  Array.from(nodes).reduce<Run[]>((out, node) => {
    if (node.nodeType === node.ELEMENT_NODE) return [...out, node as Element]
    if (node.nodeType !== node.TEXT_NODE) return out
    const last = out.at(-1)
    const text = node.textContent ?? ''
    return typeof last === 'string' ? [...out.slice(0, -1), last + text] : [...out, text]
  }, [])

const classes = (el: Element): string => Array.from(el.classList, (c) => `.${c}`).join('')

const attributes = (el: Element): string =>
  Array.from(el.attributes)
    .filter((a) => a.name !== 'class')
    .map((a) => [a.name, a.value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `[${name}=${value}]`)
    .join('')
