import { render, type JSX } from 'preact'
import { describe, expect, it } from 'vitest'

import { HostContext, useIcon, type Host } from '../../../src/ui/components/host'
import { createTestRoot } from '../../harness/obsidian-dom'

function Glyph({ name }: { name: string }): JSX.Element {
  const ref = useIcon<HTMLSpanElement>(name)
  return <span ref={ref} />
}

describe('useIcon', () => {
  it('draws the icon through the host provided above it', () => {
    const root = createTestRoot()
    const host: Host = { icon: (el, name) => el.setAttribute('data-icon', name) }
    render(
      <HostContext.Provider value={host}>
        <Glyph name="play" />
      </HostContext.Provider>,
      root,
    )
    expect(root.querySelector('span')?.getAttribute('data-icon')).toBe('play')
  })

  it('fails loudly when no host is provided', () => {
    const root = createTestRoot()
    expect(() => render(<Glyph name="play" />, root)).toThrow('No Host provided')
  })
})
