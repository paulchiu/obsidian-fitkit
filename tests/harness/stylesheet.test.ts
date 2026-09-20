import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createTestRoot, harnessDocument, harnessWindow } from './obsidian-dom'
import { ensureStylesheetLoaded, expectAppliedThemeToken, findUnstyledClasses } from './stylesheet'

vi.mock('obsidian', () => {
  class ItemView {}

  class Modal {
    contentEl = createTestRoot()
    modalEl = createTestRoot()

    titleEl = createTestRoot()

    setTitle(title: string): this {
      this.titleEl.textContent = title
      return this
    }

    constructor(readonly app: unknown) {}

    close(): void {}
  }

  class SuggestModal<T> extends Modal {
    suggestions: T[] = []
  }

  class Menu {}

  class Notice {}

  class TFile {}

  return {
    ItemView,
    Menu,
    Modal,
    Notice,
    SuggestModal,
    TFile,
    normalizePath: (path: string) => path.replace(/\/+/g, '/'),
    setIcon: vi.fn(),
  }
})

import type { ChartSeries } from '../../src/domain/exercise-chart'
import { createRegistry, type ExerciseRegistry } from '../../src/domain/exercise-registry'
import { renderExerciseChartSvg } from '../../src/ui/exercise-chart-svg'
import { PlanStepModal } from '../../src/ui/plan-step-modal'
import { WorkoutEditorView } from '../../src/ui/workout-editor-view'

beforeAll(() => {
  ensureStylesheetLoaded()
})

afterEach(() => {
  harnessDocument.body.replaceChildren()
})

describe('stylesheet', () => {
  it('resolves the cascade so the taller variant wins', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    const tall = root.createDiv({ cls: 'fitkit-skeleton-line is-tall' })
    const base = root.createDiv({ cls: 'fitkit-skeleton-line' })

    expect(harnessWindow.getComputedStyle(tall).getPropertyValue('height')).toBe('32px')
    expect(harnessWindow.getComputedStyle(base).getPropertyValue('height')).toBe('12px')
  })

  it('reports the theme token instead of a resolved colour', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    const empty = root.createDiv({ cls: 'fitkit-empty' })

    expectAppliedThemeToken(empty, 'color', '--text-muted')
  })

  it('reports a class with a mistyped prefix instead of skipping it', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    const card = root.createDiv({ cls: 'fitkti-empty' })

    expect(findUnstyledClasses(card)).toEqual(['fitkti-empty'])
  })

  it('honours a class styled only inside a media query', () => {
    const style = harnessDocument.createElement('style')
    style.textContent = '@media (max-width: 640px) { .fitkit-media-only-probe { display: block; } }'
    harnessDocument.head.appendChild(style)
    try {
      const probed = createTestRoot().createDiv({ cls: 'fitkit-media-only-probe' })

      expect(findUnstyledClasses(probed)).toEqual([])
    } finally {
      style.remove()
    }
  })

  it('reports only the class the stylesheet never defines', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    const card = root.createDiv({ cls: 'fitkit-empty fitkit-bodywieght-row' })

    expect(findUnstyledClasses(card)).toEqual(['fitkit-bodywieght-row'])
  })

  it('reports a misspelled bodyweight header spacer class', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    const spacer = root.createSpan({ cls: 'fitkit-bodyweigt-head-spacer' })

    expect(findUnstyledClasses(spacer)).toEqual(['fitkit-bodyweigt-head-spacer'])
  })

  it('keeps a state class that only ever appears in a compound selector', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    const line = root.createDiv({ cls: 'fitkit-skeleton-line is-tall' })

    expect(findUnstyledClasses(line)).toEqual([])
  })

  it('ignores classes Obsidian styles rather than this plugin', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    const row = root.createDiv({ cls: 'setting-item mod-cta' })

    expect(findUnstyledClasses(row)).toEqual([])
  })
})

/** A series with points, so the chart renders its full SVG rather than the empty state. */
function chartSeries(): ChartSeries {
  return {
    exerciseName: 'Bench Press',
    kind: 'strength',
    metric: 'weight',
    unit: 'kg',
    points: [80, 82.5, 85].map((value, index) => ({
      date: `2026-04-${15 + index}`,
      value,
      workoutPath: `w/2026-04-${15 + index}.md`,
    })),
    windowRequested: 3,
    totalDates: 3,
  }
}

describe('unstyled render', () => {
  it('finds no unstyled class in rendered workout editor cards', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    const registry = createRegistry([])
    const exercises = [
      {
        name: 'Squat',
        kind: 'strength',
        exerciseNotes: 'Belt on from set 2',
        strengthSets: [],
        durationEntries: [],
        bodyweightSets: [],
      },
      {
        name: 'Push-up',
        kind: 'bodyweight',
        strengthSets: [],
        durationEntries: [],
        bodyweightSets: [{ set: 1, level: 1, reps: 10 }],
      },
      {
        name: 'Weighted push-up',
        kind: 'bodyweight',
        strengthSets: [],
        durationEntries: [],
        bodyweightSets: [{ set: 1, level: 1, reps: 8, load: 10 }],
      },
    ] as const

    for (const exercise of exercises) {
      renderExerciseCard(root, exercise, registry)
    }

    expect(root.querySelector('.fitkit-exercise-note-line')).not.toBeNull()
    expect(
      root.querySelector('.fitkit-bodyweight-row.fitkit-set-head:not(.has-load)'),
    ).not.toBeNull()
    expect(root.querySelector('.fitkit-bodyweight-row.fitkit-set-head.has-load')).not.toBeNull()
    expect(findUnstyledClasses(root)).toEqual([])
  })

  it('sizes the bodyweight header spacer from the shared kebab column token', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    renderExerciseCard(
      root,
      {
        name: 'Push-up',
        kind: 'bodyweight',
        strengthSets: [],
        durationEntries: [],
        bodyweightSets: [{ set: 1, level: 1, reps: 10 }],
      },
      createRegistry([]),
    )
    const spacer = root.querySelector('.fitkit-bodyweight-head-spacer')

    expect(spacer).not.toBeNull()
    expectAppliedThemeToken(spacer as Element, 'inline-size', '--fitkit-kebab-col')
  })

  it('aligns the exercise note with its card-level siblings', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    renderExerciseCard(
      root,
      {
        name: 'Squat',
        kind: 'strength',
        exerciseNotes: 'Belt on from set 2',
        strengthSets: [],
        durationEntries: [],
        bodyweightSets: [],
      },
      createRegistry([]),
    )
    const note = root.querySelector('.fitkit-exercise-note-line')

    expect(note).not.toBeNull()
    expect(harnessWindow.getComputedStyle(note as Element).getPropertyValue('padding-inline')).toBe(
      '0px',
    )
  })

  it('finds no unstyled class in a rendered chart', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    renderExerciseChartSvg(root, chartSeries(), { notes: ['note one'] })

    expect(findUnstyledClasses(root)).toEqual([])
  })

  it('finds no unstyled class in a rendered empty chart', () => {
    const root = createTestRoot()
    harnessDocument.body.appendChild(root)
    renderExerciseChartSvg(root, { ...chartSeries(), points: [] })

    expect(findUnstyledClasses(root)).toEqual([])
  })

  it('finds no unstyled class in a rendered modal', () => {
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void): number => {
        callback()
        return 1
      },
    })
    try {
      const modal = new PlanStepModal({} as never, {
        exerciseName: 'Push-up',
        kind: 'bodyweight',
        initial: '',
        onSave: vi.fn(),
      })
      modal.onOpen()

      expect(findUnstyledClasses(modal.contentEl)).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

interface ExerciseCardRenderView {
  plugin: unknown
  model: unknown
  exerciseHistory: unknown
  renderExerciseCard(list: HTMLElement, index: number, registry: ExerciseRegistry): void
}

function renderExerciseCard(
  root: HTMLElement,
  exercise: unknown,
  registry: ExerciseRegistry,
): void {
  const view = Object.create(WorkoutEditorView.prototype) as ExerciseCardRenderView
  view.plugin = {
    settings: {
      fitnessRoot: 'Fitness',
      strengthRestTimerEnabled: false,
      exerciseRegistry: [],
      deletedExercises: [],
    },
    saveSettings: vi.fn(() => Promise.resolve()),
  }
  view.model = { exercises: [exercise] }
  view.exerciseHistory = new Map()
  view.renderExerciseCard(root, 0, registry)
}
