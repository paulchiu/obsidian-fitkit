import { describe, expect, it, vi } from 'vitest'

import { createTestRoot } from '../harness/obsidian-dom'

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
