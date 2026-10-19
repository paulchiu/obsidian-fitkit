import { MarkdownRenderChild } from 'obsidian'
import { render } from 'preact'

/** A render child that unmounts the Preact tree drawn into `containerEl` when Obsidian unloads the section. */
export function preactRenderChild(containerEl: HTMLElement): MarkdownRenderChild {
  const child = new MarkdownRenderChild(containerEl)
  child.onunload = () => render(null, containerEl)
  return child
}
