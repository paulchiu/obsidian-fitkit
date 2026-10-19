import { options } from 'preact'
import { describe, expect, it, vi } from 'vitest'

import { createTestRoot } from '../../harness/obsidian-dom'
import { outline } from '../../harness/outline'

vi.mock('obsidian', () => {
  class TFile {
    basename: string
    extension: string

    constructor(readonly path: string) {
      this.basename = path.split('/').pop()?.replace(/\.md$/, '') ?? ''
      this.extension = path.split('.').pop() ?? ''
    }
  }

  class MarkdownRenderChild {
    private cleanups: Array<() => void> = []
    constructor(readonly containerEl: HTMLElement) {}
    register(cleanup: () => void): void {
      this.cleanups.push(cleanup)
    }
    unload(): void {
      ;(this as unknown as { onunload(): void }).onunload()
      this.cleanups.forEach((cleanup) => cleanup())
    }
  }

  return { MarkdownRenderChild, TFile }
})

import type { MarkdownPostProcessorContext } from 'obsidian'

import type FitKitPlugin from '../../../src/main'
import { formatDurationSeconds } from '../../../src/ui/model/reading-preview'
import { renderWorkoutReadingModeSection } from '../../../src/ui/obsidian/workout-reading-mode'

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
        getFolderByPath: () => null,
      },
      metadataCache: {
        getFileCache: () => null,
      },
    },
    settings: {
      fitnessRoot: 'Fitness',
      exerciseRegistry: [],
      deletedExercises: [],
    },
  } as unknown as FitKitPlugin
}

function createContext(
  sectionText: string,
  frontmatter: Record<string, unknown> | null = { type: 'workout' },
): MarkdownPostProcessorContext & { children: Array<{ unload(): void }> } {
  const children: Array<{ unload(): void }> = []
  return {
    children,
    sourcePath: 'Fitness/Workouts/2026-05-01.md',
    frontmatter,
    addChild: (child: { unload(): void }) => children.push(child),
    getSectionInfo: () => ({
      text: sectionText,
      lineStart: 0,
      lineEnd: sectionText.split(/\r?\n/).length - 1,
    }),
  } as unknown as MarkdownPostProcessorContext & { children: Array<{ unload(): void }> }
}

function createRenderedSection(lines: string[]): HTMLElement {
  const root = createTestRoot()
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

    renderWorkoutReadingModeSection(createPlugin(), root, createContext(strengthSection))

    expect(root.querySelector('.fitkit-reading-preview')).not.toBeNull()
    expect(root.querySelectorAll('.fitkit-reading-hidden-source-row')).toHaveLength(2)
    expect(root.textContent).toContain('Strength')
    expect(root.textContent).toContain('100 kg')
    expect(root.textContent).toContain('smooth')
  })

  it('reads a pounds exercise set table in pounds', () => {
    const root = createRenderedSection([
      '[exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '[exercise:: [[Squat]]] [set:: 2] [weight:: 105] [reps:: 3] [notes:: smooth]',
    ])
    const plugin = createPlugin()
    plugin.settings.exerciseRegistry = [
      { name: 'Squat', kind: 'strength', unit: 'lbs', aliases: [] },
    ]

    renderWorkoutReadingModeSection(plugin, root, createContext(strengthSection))

    expect(root.textContent).toContain('100 lbs')
    expect(root.textContent).not.toContain('100 kg')
  })

  it('renders duration rows with readable durations', () => {
    const section = ['## [[Plank]]', '', '- [exercise:: [[Plank]]] [set:: 1] [duration:: 95]'].join(
      '\n',
    )
    const root = createRenderedSection(['[exercise:: [[Plank]]] [set:: 1] [duration:: 95]'])

    renderWorkoutReadingModeSection(createPlugin(), root, createContext(section))

    expect(root.querySelector('.fitkit-reading-preview')).not.toBeNull()
    expect(root.textContent).toContain('Duration')
    expect(root.textContent).toContain('1m35s')
  })

  it('labels a duration exercise logged with a plan as interval and shows the plan', () => {
    const section = [
      '## [[Bike]]',
      '',
      '- [exercise:: [[Bike]]] [plan:: 3 x 1m @ 300W, 30s rest]',
      '- [exercise:: [[Bike]]] [set:: 1] [duration:: 60]',
    ].join('\n')
    const root = createRenderedSection([
      '[exercise:: [[Bike]]] [plan:: 3 x 1m @ 300W, 30s rest]',
      '[exercise:: [[Bike]]] [set:: 1] [duration:: 60]',
    ])

    renderWorkoutReadingModeSection(createPlugin(), root, createContext(section))

    expect([
      root.querySelector('.fitkit-reading-kind')?.textContent,
      root.querySelector('.fitkit-reading-plan')?.textContent,
    ]).toEqual(['Interval', 'Plan: 3 x 1m @ 300W, 30s rest'])
  })

  it('shows the next-time plan recorded on the exercise', () => {
    const section = [
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [next:: up 2.5]',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
    ].join('\n')
    const root = createRenderedSection([
      '[exercise:: [[Squat]]] [next:: up 2.5]',
      '[exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
    ])

    renderWorkoutReadingModeSection(createPlugin(), root, createContext(section))

    expect(root.querySelector('.fitkit-reading-plan')?.textContent).toContain(
      'Next time: up 2.5 kg',
    )
  })

  it('shows the next-time direction on an interval exercise, without a step', () => {
    const lines = [
      '[exercise:: [[Exercise Bike]]] [next:: stay 5] [plan:: (x 3 (over 1m 300W))]',
      '[exercise:: [[Exercise Bike]]] [set:: 1] [duration:: 60] [watts:: 305]',
    ]
    const section = ['## [[Exercise Bike]]', '', ...lines.map((line) => `- ${line}`)].join('\n')
    const root = createRenderedSection(lines)

    renderWorkoutReadingModeSection(createPlugin(), root, createContext(section))

    expect(
      [...root.querySelectorAll('.fitkit-reading-plan')].map((line) => line.textContent),
    ).toEqual(['Plan: (x 3 (over 1m 300W))', 'Next time: same target'])
  })

  it('states the plan step in the same unit as the set table beneath it', () => {
    const section = [
      '## [[Squat]]',
      '',
      '- [exercise:: [[Squat]]] [next:: up 2.5]',
      '- [exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
    ].join('\n')
    const root = createRenderedSection([
      '[exercise:: [[Squat]]] [next:: up 2.5]',
      '[exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
    ])
    const plugin = createPlugin()
    plugin.settings.exerciseRegistry = [
      { name: 'Squat', kind: 'strength', unit: 'lbs', aliases: [] },
    ]

    renderWorkoutReadingModeSection(plugin, root, createContext(section))

    expect(root.querySelector('.fitkit-reading-plan')?.textContent).toContain(
      'Next time: up 2.5 lbs',
    )
    expect(root.querySelector('.fitkit-reading-table')?.textContent).toContain('100 lbs')
  })

  it('serves the ladder and the unit from one registry snapshot build', () => {
    const section = [
      '## [[Push-up]]',
      '',
      '- [exercise:: [[Push-up]]] [set:: 1] [level:: 2] [reps:: 10] [load:: 5]',
    ].join('\n')
    const root = createRenderedSection([
      '[exercise:: [[Push-up]]] [set:: 1] [level:: 2] [reps:: 10] [load:: 5]',
    ])
    const plugin = createPlugin()
    plugin.settings.exerciseRegistry = [
      {
        name: 'Push-up',
        kind: 'bodyweight',
        unit: 'lbs',
        levels: ['Wall push-up', 'Knee push-up'],
        aliases: [],
      },
    ]
    /** The exercises folder lookup is the snapshot's only vault entry point, so it counts builds. */
    let folderLookups = 0
    plugin.app.vault.getFolderByPath = () => {
      folderLookups += 1
      return null
    }

    renderWorkoutReadingModeSection(plugin, root, createContext(section))

    const table = root.querySelector('.fitkit-reading-table')
    expect(table?.textContent).toContain('Knee push-up')
    expect(table?.textContent).toContain('5 lbs')
    expect(folderLookups).toBe(1)
  })

  it('builds the registry snapshot once for a strength preview, not once per readout', () => {
    const root = createRenderedSection([
      '[exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '[exercise:: [[Squat]]] [set:: 2] [weight:: 105] [reps:: 3] [notes:: smooth]',
    ])
    const plugin = createPlugin()
    plugin.settings.exerciseRegistry = [
      { name: 'Squat', kind: 'strength', unit: 'lbs', aliases: [] },
    ]
    let folderLookups = 0
    plugin.app.vault.getFolderByPath = () => {
      folderLookups += 1
      return null
    }

    renderWorkoutReadingModeSection(plugin, root, createContext(strengthSection))

    expect(root.querySelector('.fitkit-reading-table')?.textContent).toContain('100 lbs')
    expect(folderLookups).toBe(1)
  })

  it('shows a bodyweight next-time plan as a count of rungs', () => {
    const section = [
      '## [[Push-up]]',
      '',
      '- [exercise:: [[Push-up]]] [next:: up 1]',
      '- [exercise:: [[Push-up]]] [set:: 1] [level:: 2] [reps:: 10]',
    ].join('\n')
    const root = createRenderedSection([
      '[exercise:: [[Push-up]]] [next:: up 1]',
      '[exercise:: [[Push-up]]] [set:: 1] [level:: 2] [reps:: 10]',
    ])
    const plugin = createPlugin()
    plugin.settings.exerciseRegistry = [
      {
        name: 'Push-up',
        kind: 'bodyweight',
        levels: ['Wall push-up', 'Knee push-up'],
        aliases: [],
      },
    ]

    renderWorkoutReadingModeSection(plugin, root, createContext(section))

    expect(root.querySelector('.fitkit-reading-plan')?.textContent).toContain(
      'Next time: up 1 rung',
    )
  })

  it('shows bodyweight rung names from the registry ladder', () => {
    const section = [
      '## [[Push-up]]',
      '',
      '- [exercise:: [[Push-up]]] [set:: 1] [level:: 2] [reps:: 10]',
    ].join('\n')
    const root = createRenderedSection([
      '[exercise:: [[Push-up]]] [set:: 1] [level:: 2] [reps:: 10]',
    ])
    const plugin = createPlugin()
    plugin.settings.exerciseRegistry = [
      {
        name: 'Push-up',
        kind: 'bodyweight',
        levels: ['Wall push-up', 'Knee push-up'],
        aliases: [],
      },
    ]

    renderWorkoutReadingModeSection(plugin, root, createContext(section))

    expect(root.textContent).toContain('Knee push-up')
  })

  it('falls back to the bare level when no ladder is on file', () => {
    const section = [
      '## [[Push-up]]',
      '',
      '- [exercise:: [[Push-up]]] [set:: 1] [level:: 2] [reps:: 10]',
    ].join('\n')
    const root = createRenderedSection([
      '[exercise:: [[Push-up]]] [set:: 1] [level:: 2] [reps:: 10]',
    ])

    renderWorkoutReadingModeSection(createPlugin(), root, createContext(section))

    expect(root.textContent).toContain('Level 2')
  })

  it('does not render when the source rows cannot be safely hidden', () => {
    const root = createTestRoot()

    renderWorkoutReadingModeSection(createPlugin(), root, createContext(strengthSection))

    expect(root.querySelector('.fitkit-reading-preview')).toBeNull()
  })

  it('does not hide partial source rows when rendering is unsafe', () => {
    const root = createRenderedSection([
      '[exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      'Custom list item',
      'Another custom list item',
    ])

    renderWorkoutReadingModeSection(createPlugin(), root, createContext(strengthSection))

    expect(root.querySelector('.fitkit-reading-preview')).toBeNull()
    expect(root.querySelectorAll('.fitkit-reading-hidden-source-row')).toHaveLength(0)
  })

  it('skips non-workout notes', () => {
    const root = createRenderedSection([
      '[exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '[exercise:: [[Squat]]] [set:: 2] [weight:: 105] [reps:: 3]',
    ])

    renderWorkoutReadingModeSection(
      createPlugin(),
      root,
      createContext(strengthSection, { type: 'journal' }),
    )

    expect(root.querySelector('.fitkit-reading-preview')).toBeNull()
    expect(root.querySelectorAll('.fitkit-reading-hidden-source-row')).toHaveLength(0)
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

describe('workout reading mode structure', () => {
  /** Renders `rows` as the one-exercise section Obsidian would hand the post-processor. */
  const preview = (
    name: string,
    rows: string[],
    settings: Partial<FitKitPlugin['settings']> = {},
  ): string => {
    const section = [`## [[${name}]]`, '', ...rows.map((row) => `- ${row}`)].join('\n')
    const root = createRenderedSection(rows)
    const plugin = createPlugin()
    Object.assign(plugin.settings, settings)

    renderWorkoutReadingModeSection(plugin, root, createContext(section))

    return outline(root)
  }

  it('draws a strength table with a note and a next-time plan', () => {
    expect(
      preview(
        'Squat',
        [
          '[exercise:: [[Squat]]] [next:: up 2.5] [notes:: felt strong]',
          '[exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
          '[exercise:: [[Squat]]] [set:: 2] [weight:: 105.5] [reps:: 3] [notes:: smooth]',
        ],
        { exerciseRegistry: [{ name: 'Squat', kind: 'strength', unit: 'lbs', aliases: [] }] },
      ),
    ).toMatchSnapshot()
  })

  it('draws a bodyweight table with rung names and a load column', () => {
    expect(
      preview(
        'Push-up',
        [
          '[exercise:: [[Push-up]]] [next:: up 1]',
          '[exercise:: [[Push-up]]] [set:: 1] [level:: 2] [reps:: 10] [load:: 5]',
          '[exercise:: [[Push-up]]] [set:: 2] [level:: 4] [reps:: 8] [notes:: slow]',
        ],
        {
          exerciseRegistry: [
            { name: 'Push-up', kind: 'bodyweight', levels: ['Wall', 'Knee'], aliases: [] },
          ],
        },
      ),
    ).toMatchSnapshot()
  })

  it('draws a duration table under its plan', () => {
    expect(
      preview('Bike', [
        '[exercise:: [[Bike]]] [plan:: 3 x 1m @ 300W, 30s rest] [next:: stay 5]',
        '[exercise:: [[Bike]]] [set:: 1] [duration:: 95]',
        '[exercise:: [[Bike]]] [set:: 2] [duration:: 3660] [notes:: hard]',
      ]),
    ).toMatchSnapshot()
  })

  it('draws one row as a singular count', () => {
    expect(
      preview('Squat', ['[exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]']),
    ).toMatchSnapshot()
  })

  it.each([
    ['strength', 'Squat', '[exercise:: [[Squat]]] [next:: up 2.5]'],
    ['duration', 'Plank', '[exercise:: [[Plank]]] [plan:: 3 x 1m]'],
  ])('draws the empty message for a %s exercise without rows', (kind, name, row) => {
    expect(
      preview(name, [row], {
        exerciseRegistry: [
          {
            name,
            kind: kind as 'strength' | 'bodyweight' | 'duration',
            aliases: [],
          },
        ],
      }),
    ).toMatchSnapshot()
  })

  it('unmounts the preview when Obsidian unloads the section', () => {
    const root = createRenderedSection([
      '[exercise:: [[Squat]]] [set:: 1] [weight:: 100] [reps:: 5]',
      '[exercise:: [[Squat]]] [set:: 2] [weight:: 105] [reps:: 3] [notes:: smooth]',
    ])
    const ctx = createContext(strengthSection)
    renderWorkoutReadingModeSection(createPlugin(), root, ctx)
    const unmounted: string[] = []
    const previous = { ...options }
    options.unmount = (vnode) => {
      if (typeof vnode.type === 'string') unmounted.push(vnode.type)
      previous.unmount?.(vnode)
    }
    try {
      for (const child of ctx.children) child.unload()
    } finally {
      Object.assign(options, previous)
    }

    expect(unmounted).toContain('table')
    expect(root.querySelector('.fitkit-reading-preview')).toBeNull()
    expect(root.querySelector('table')).toBeNull()
  })
})
