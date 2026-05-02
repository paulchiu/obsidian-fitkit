import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', () => {
  class TFile {
    basename: string
    extension: string

    constructor(readonly path: string) {
      this.basename = path.split('/').pop()?.replace(/\.md$/, '') ?? ''
      this.extension = path.split('.').pop() ?? ''
    }
  }

  return { TFile }
})

import type { MarkdownPostProcessorContext } from 'obsidian'

import type FitKitPlugin from '../../src/main'
import {
  formatDurationSeconds,
  renderWorkoutReadingModeSection,
} from '../../src/ui/workout-reading-mode'

interface TestElementOptions {
  cls?: string
  text?: string
}

class TestElement {
  readonly children: TestElement[] = []
  readonly classes = new Set<string>()
  readonly classList = {
    contains: (className: string): boolean => this.classes.has(className),
  }
  textContent = ''

  constructor(readonly tagName: string) {}

  addClass(className: string): void {
    this.classes.add(className)
  }

  createDiv(options: TestElementOptions = {}): TestElement {
    return this.createEl('div', options)
  }

  createEl(tagName: string, options: TestElementOptions = {}): TestElement {
    const child = new TestElement(tagName)
    if (options.cls) {
      child.addClass(options.cls)
    }
    if (options.text !== undefined) {
      child.textContent = options.text
    }
    this.children.push(child)
    return child
  }

  createSpan(options: TestElementOptions = {}): TestElement {
    return this.createEl('span', options)
  }

  querySelectorAll(selector: string): TestElement[] {
    if (selector !== 'li') {
      return []
    }
    return this.findAllByTag('li')
  }

  findByClass(className: string): TestElement | null {
    if (this.classes.has(className)) {
      return this
    }
    for (const child of this.children) {
      const found = child.findByClass(className)
      if (found) {
        return found
      }
    }
    return null
  }

  findAllByClass(className: string): TestElement[] {
    const own = this.classes.has(className) ? [this] : []
    return [...own, ...this.children.flatMap((child) => child.findAllByClass(className))]
  }

  allText(): string {
    return [this.textContent, ...this.children.map((child) => child.allText())].join(' ')
  }

  private findAllByTag(tagName: string): TestElement[] {
    const own = this.tagName === tagName ? [this] : []
    return [...own, ...this.children.flatMap((child) => child.findAllByTag(tagName))]
  }
}

const strengthSection = [
  '## [[Squat]]',
  '',
  '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
  '- [exercise:: [[Squat]]] [set:: 2] [weight:: 105] [reps:: 3] [notes:: smooth]',
].join('\n')

function createPlugin(): FitKitPlugin {
  return {
    app: {
      vault: {
        getAbstractFileByPath: () => null,
      },
      metadataCache: {
        getFileCache: () => null,
      },
    },
  } as unknown as FitKitPlugin
}

function createContext(
  sectionText: string,
  frontmatter: Record<string, unknown> | null = { type: 'workout' },
): MarkdownPostProcessorContext {
  return {
    sourcePath: 'Fitness/Workouts/2026-05-01.md',
    frontmatter,
    getSectionInfo: () => ({
      text: sectionText,
      lineStart: 0,
      lineEnd: sectionText.split(/\r?\n/).length - 1,
    }),
  } as unknown as MarkdownPostProcessorContext
}

function createRenderedSection(lines: string[]): TestElement {
  const root = new TestElement('div')
  const list = root.createEl('ul')
  for (const line of lines) {
    list.createEl('li', { text: line })
  }
  return root
}

describe('workout reading mode rendering', () => {
  it('renders strength workout rows as a read-only table and hides source rows', () => {
    const root = createRenderedSection([
      '[exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '[exercise:: [[Squat]]] [set:: 2] [weight:: 105] [reps:: 3] [notes:: smooth]',
    ])

    renderWorkoutReadingModeSection(
      createPlugin(),
      root as unknown as HTMLElement,
      createContext(strengthSection),
    )

    expect(root.findByClass('fitkit-reading-preview')).not.toBeNull()
    expect(root.findAllByClass('fitkit-reading-hidden-source-row')).toHaveLength(2)
    expect(root.allText()).toContain('Strength')
    expect(root.allText()).toContain('100 kg')
    expect(root.allText()).toContain('smooth')
  })

  it('renders duration rows with readable durations', () => {
    const section = ['## [[Plank]]', '', '- [exercise:: [[Plank]]] [set:: 1] [duration:: 95]'].join(
      '\n',
    )
    const root = createRenderedSection(['[exercise:: [[Plank]]] [set:: 1] [duration:: 95]'])

    renderWorkoutReadingModeSection(
      createPlugin(),
      root as unknown as HTMLElement,
      createContext(section),
    )

    expect(root.findByClass('fitkit-reading-preview')).not.toBeNull()
    expect(root.allText()).toContain('Duration')
    expect(root.allText()).toContain('1m35s')
  })

  it('does not render when the source rows cannot be safely hidden', () => {
    const root = new TestElement('div')

    renderWorkoutReadingModeSection(
      createPlugin(),
      root as unknown as HTMLElement,
      createContext(strengthSection),
    )

    expect(root.findByClass('fitkit-reading-preview')).toBeNull()
  })

  it('does not hide partial source rows when rendering is unsafe', () => {
    const root = createRenderedSection([
      '[exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      'Custom list item',
      'Another custom list item',
    ])

    renderWorkoutReadingModeSection(
      createPlugin(),
      root as unknown as HTMLElement,
      createContext(strengthSection),
    )

    expect(root.findByClass('fitkit-reading-preview')).toBeNull()
    expect(root.findAllByClass('fitkit-reading-hidden-source-row')).toHaveLength(0)
  })

  it('skips non-workout notes', () => {
    const root = createRenderedSection([
      '[exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '[exercise:: [[Squat]]] [set:: 2] [weight:: 105] [reps:: 3]',
    ])

    renderWorkoutReadingModeSection(
      createPlugin(),
      root as unknown as HTMLElement,
      createContext(strengthSection, { type: 'journal' }),
    )

    expect(root.findByClass('fitkit-reading-preview')).toBeNull()
    expect(root.findAllByClass('fitkit-reading-hidden-source-row')).toHaveLength(0)
  })

  it('formats durations across minute and hour boundaries', () => {
    expect(formatDurationSeconds(undefined)).toBe('-')
    expect(formatDurationSeconds(1)).toBe('1s')
    expect(formatDurationSeconds(45)).toBe('45s')
    expect(formatDurationSeconds(60)).toBe('1m')
    expect(formatDurationSeconds(65)).toBe('1m5s')
    expect(formatDurationSeconds(3600)).toBe('1h')
    expect(formatDurationSeconds(3660)).toBe('1h1m')
  })
})
