import type { App, TFile } from 'obsidian'
import { describe, expect, it } from 'vitest'

import type { FitKitIndex } from '../../src/domain/types'
import type { FitKitSettings } from '../../src/settings'
import { composeDashboard, regenerateDashboard } from '../../src/vault/dashboard'

const emptyIndex: FitKitIndex = {
  schemaVersion: 1,
  builtAt: 0,
  entries: [],
  diagnostics: [],
}

const mixedIndex: FitKitIndex = {
  schemaVersion: 1,
  builtAt: 0,
  entries: [
    {
      path: 'Fitness/Workouts/2026-04-24.md',
      mtime: 1,
      date: '2026-04-24',
      name: 'Workout',
      exercises: [
        {
          exerciseName: 'Squat',
          kind: 'strength',
          bestSet: {
            weight: 50,
            reps: 20,
            e1rm: 73.3333333333,
          },
          totalSets: 1,
        },
        {
          exerciseName: 'Plank',
          kind: 'duration',
          totalSets: 1,
          totalDurationSeconds: 120,
        },
      ],
    },
  ],
  diagnostics: [],
}

type MockMarkdownFile = {
  path: string
  basename: string
  frontmatter?: Record<string, unknown>
}

function mockDashboardApp(markdownFiles: MockMarkdownFile[]): {
  app: App
  dashboardMarkdown: () => string
} {
  const frontmatterByPath = new Map(
    markdownFiles.map((file) => [file.path, file.frontmatter] as const),
  )
  const dashboardFile = {
    path: 'Fitness/Fitness Dashboard.md',
    basename: 'Fitness Dashboard',
  }
  let dashboardMarkdown = ''

  return {
    app: {
      vault: {
        getMarkdownFiles: () => markdownFiles as unknown as TFile[],
        getAbstractFileByPath: () => null,
        process: async (_file: TFile, callback: (current: string) => string): Promise<string> => {
          dashboardMarkdown = callback(dashboardMarkdown)
          return dashboardMarkdown
        },
        create: async (_path: string, markdown: string): Promise<TFile> => {
          dashboardMarkdown = markdown
          return dashboardFile
        },
      },
      metadataCache: {
        getFileCache: (file: TFile) => ({
          frontmatter: frontmatterByPath.get(file.path),
        }),
      },
    } as unknown as App,
    dashboardMarkdown: () => dashboardMarkdown,
  }
}

function settingsWithRegistry(
  exerciseRegistry: FitKitSettings['exerciseRegistry'],
): FitKitSettings {
  return {
    fitnessRoot: 'Fitness',
    autoOpenWorkoutEditor: true,
    strengthRestTimerEnabled: true,
    autosaveDebounceMs: 600,
    chartSessionsWindow: 30,
    exerciseRegistry,
    deletedExercises: [],
    hiddenDashboardSectionsByPath: {},
    schemaVersion: 1,
  }
}

describe('dashboard composer', () => {
  it('renders an empty dashboard', () => {
    expect(
      composeDashboard(emptyIndex, 'Fitness/Workouts', 'Fitness/Exercises', new Set()),
    ).toMatch(/^# FitKit Dashboard/)
  })

  it('renders a recent workouts section above PBs when there are no sessions', () => {
    const markdown = composeDashboard(
      emptyIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown.indexOf('## Recent workouts')).toBeGreaterThan(-1)
    expect(markdown.indexOf('## Recent workouts')).toBeLessThan(markdown.indexOf('## PBs'))
    expect(markdown).toContain('_No workouts yet._')
  })

  it('omits the plans section when no exercise has a next-time plan', () => {
    const markdown = composeDashboard(
      mixedIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).not.toContain('## Next session plans')
  })

  it('lists recorded next-time plans with their unit and date', () => {
    const index: FitKitIndex = {
      schemaVersion: 1,
      builtAt: 0,
      entries: [
        {
          path: 'Fitness/Workouts/2026-08-03.md',
          mtime: 1,
          date: '2026-08-03',
          name: 'Earlier',
          exercises: [
            {
              exerciseName: 'Squat',
              kind: 'strength',
              maxWeightSet: { weight: 95, reps: 5 },
              totalSets: 1,
              next: { direction: 'down', step: 5 },
            },
          ],
        },
        {
          path: 'Fitness/Workouts/2026-08-10.md',
          mtime: 2,
          date: '2026-08-10',
          name: 'Later',
          exercises: [
            {
              exerciseName: 'Squat',
              kind: 'strength',
              maxWeightSet: { weight: 100, reps: 5 },
              totalSets: 1,
              next: { direction: 'up', step: 2.5 },
            },
            {
              exerciseName: 'Bench',
              kind: 'strength',
              maxWeightSet: { weight: 60, reps: 5 },
              totalSets: 1,
              next: { direction: 'stay' },
            },
          ],
        },
      ],
      diagnostics: [],
    }

    const markdown = composeDashboard(index, 'Fitness/Workouts', 'Fitness/Exercises', new Set())

    expect(markdown).toContain('## Next session plans')
    expect(markdown).toContain('- **[[#Squat|Squat]]:** up 2.5 kg (planned 2026-08-10)')
    expect(markdown).toContain('- **[[#Bench|Bench]]:** same weight (planned 2026-08-10)')
    expect(markdown.indexOf('## PBs')).toBeLessThan(markdown.indexOf('## Next session plans'))
  })

  it('lists the most recent workouts by date with linked names', () => {
    const entries = Array.from({ length: 12 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0')
      return {
        path: `Fitness/Workouts/2026-04-${day}.md`,
        mtime: i,
        date: `2026-04-${day}`,
        name: `Day ${i + 1}`,
        exercises: [],
      }
    })

    const markdown = composeDashboard(
      { schemaVersion: 1, builtAt: 0, entries, diagnostics: [] },
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('- 2026-04-12: [[Fitness/Workouts/2026-04-12|Day 12]]')
    expect(markdown).toContain('- 2026-04-03: [[Fitness/Workouts/2026-04-03|Day 3]]')
    expect(markdown).not.toContain('Day 2]]')
    expect(markdown).not.toContain('Day 1]]')
  })

  it('falls back to the workout filename when no name is set', () => {
    const markdown = composeDashboard(
      {
        schemaVersion: 1,
        builtAt: 0,
        entries: [
          {
            path: 'Fitness/Workouts/2026-04-24.md',
            mtime: 1,
            date: '2026-04-24',
            name: '',
            exercises: [],
          },
        ],
        diagnostics: [],
      },
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('- 2026-04-24: [[Fitness/Workouts/2026-04-24|2026-04-24]]')
  })

  it('renders PBs and an exercise section for strength entries', () => {
    const markdown = composeDashboard(
      mixedIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('## PBs')
    expect(markdown).toContain('## Squat')
  })

  it('hides exercise sections by hidden key', () => {
    const markdown = composeDashboard(
      mixedIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(['exercise:Squat']),
    )

    expect(markdown).not.toContain('## Squat')
    expect(markdown).not.toContain('[[#Squat|Squat]]')
    expect(markdown).not.toContain('[[Fitness/Exercises/Squat|Squat]]')
  })

  it('is idempotent for the same index input', () => {
    expect(composeDashboard(mixedIndex, 'Fitness/Workouts', 'Fitness/Exercises', new Set())).toBe(
      composeDashboard(mixedIndex, 'Fitness/Workouts', 'Fitness/Exercises', new Set()),
    )
  })

  it('renders strength and duration exercise phrasing', () => {
    const markdown = composeDashboard(
      mixedIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('50kg x 20')
    expect(markdown).toContain('e1rm 73.3kg')
    expect(markdown).toContain('total 120s across 1 session')
    expect(markdown).toContain('duration + "s" as Duration')
  })

  it('defaults strength PB ranking and display to e1rm', () => {
    const markdown = composeDashboard(
      {
        ...emptyIndex,
        entries: [
          {
            path: 'Fitness/Workouts/2026-04-24.md',
            mtime: 1,
            date: '2026-04-24',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Bench Press',
                kind: 'strength',
                bestSet: { weight: 90, reps: 10, e1rm: 120 },
                maxWeightSet: { weight: 105, reps: 1 },
                totalSets: 2,
              },
            ],
          },
          {
            path: 'Fitness/Workouts/2026-04-25.md',
            mtime: 1,
            date: '2026-04-25',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Bench Press',
                kind: 'strength',
                bestSet: { weight: 100, reps: 3, e1rm: 110 },
                maxWeightSet: { weight: 110, reps: 1 },
                totalSets: 2,
              },
            ],
          },
        ],
      },
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('- **[[#Bench Press|Bench Press]]:** 90kg x 10 (e1rm 120.0kg)')
  })

  it('honors weight metric by ranking the heaviest set and omitting e1rm', () => {
    const markdown = composeDashboard(
      {
        ...emptyIndex,
        entries: [
          {
            path: 'Fitness/Workouts/2026-04-24.md',
            mtime: 1,
            date: '2026-04-24',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Bench Press',
                kind: 'strength',
                bestSet: { weight: 90, reps: 10, e1rm: 120 },
                maxWeightSet: { weight: 105, reps: 1 },
                totalSets: 2,
              },
            ],
          },
          {
            path: 'Fitness/Workouts/2026-04-25.md',
            mtime: 1,
            date: '2026-04-25',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Bench Press',
                kind: 'strength',
                bestSet: { weight: 100, reps: 3, e1rm: 110 },
                maxWeightSet: { weight: 105, reps: 3 },
                totalSets: 2,
              },
            ],
          },
        ],
      },
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
      new Map([['Bench Press', 'weight'] as const]),
    )

    expect(markdown).toContain('- **[[#Bench Press|Bench Press]]:** 105kg x 3')
    expect(markdown).not.toContain('e1rm')
  })

  it('renders strength PBs with the configured lbs unit', () => {
    const markdown = composeDashboard(
      {
        ...emptyIndex,
        entries: [
          {
            path: 'Fitness/Workouts/2026-04-24.md',
            mtime: 1,
            date: '2026-04-24',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Bench Press',
                kind: 'strength',
                bestSet: { weight: 200, reps: 5, e1rm: 233.3 },
                maxWeightSet: { weight: 200, reps: 5 },
                totalSets: 1,
              },
            ],
          },
        ],
      },
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
      new Map([['Bench Press', 'e1rm'] as const]),
      new Map([['Bench Press', 'lbs'] as const]),
    )

    expect(markdown).toContain('- **[[#Bench Press|Bench Press]]:** 200lbs x 5 (e1rm 233.3lbs)')
  })

  it('falls back to the registry unit when exercise note unit frontmatter is invalid', async () => {
    const { app, dashboardMarkdown } = mockDashboardApp([
      {
        path: 'Fitness/Exercises/Bench Press.md',
        basename: 'Bench Press',
        frontmatter: { type: 'exercise', kind: 'strength', unit: 'stone' },
      },
    ])

    await regenerateDashboard(
      app,
      settingsWithRegistry([{ name: 'Bench Press', kind: 'strength', unit: 'lbs', aliases: [] }]),
      {
        ...emptyIndex,
        entries: [
          {
            path: 'Fitness/Workouts/2026-04-24.md',
            mtime: 1,
            date: '2026-04-24',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Bench Press',
                kind: 'strength',
                bestSet: { weight: 200, reps: 5, e1rm: 233.3 },
                maxWeightSet: { weight: 200, reps: 5 },
                totalSets: 1,
              },
            ],
          },
        ],
      },
    )

    expect(dashboardMarkdown()).toContain(
      '- **[[#Bench Press|Bench Press]]:** 200lbs x 5 (e1rm 233.3lbs)',
    )
    expect(dashboardMarkdown()).not.toContain('200kg x 5')
  })

  it('renders bodyweight PBs as reps in weight metric mode', () => {
    const markdown = composeDashboard(
      {
        ...emptyIndex,
        entries: [
          {
            path: 'Fitness/Workouts/2026-04-25.md',
            mtime: 1,
            date: '2026-04-25',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Push-up',
                kind: 'strength',
                maxWeightSet: { weight: 0, reps: 12 },
                totalSets: 2,
              },
            ],
          },
        ],
      },
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
      new Map([['Push-up', 'weight'] as const]),
    )

    expect(markdown).toContain('- **[[#Push-up|Push-up]]:** 12 reps')
    expect(markdown).not.toContain('0kg x 12')
  })

  it('ranks bodyweight PBs by reps in weight metric mode', () => {
    const markdown = composeDashboard(
      {
        ...emptyIndex,
        entries: [
          {
            path: 'Fitness/Workouts/2026-04-24.md',
            mtime: 1,
            date: '2026-04-24',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Push-up',
                kind: 'strength',
                maxWeightSet: { weight: 0, reps: 8 },
                totalSets: 1,
              },
            ],
          },
          {
            path: 'Fitness/Workouts/2026-04-25.md',
            mtime: 1,
            date: '2026-04-25',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Push-up',
                kind: 'strength',
                maxWeightSet: { weight: 0, reps: 12 },
                totalSets: 1,
              },
            ],
          },
        ],
      },
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
      new Map([['Push-up', 'weight'] as const]),
    )

    expect(markdown).toContain('- **[[#Push-up|Push-up]]:** 12 reps')
    expect(markdown).not.toContain('- **[[#Push-up|Push-up]]:** 8 reps')
  })

  it('links each PB row to its dashboard section', () => {
    const markdown = composeDashboard(
      mixedIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('- **[[#Squat|Squat]]:** 50kg x 20')
    expect(markdown).toContain('- **[[#Plank|Plank]]:** total 120s across 1 session')
  })

  it('places a path-qualified wikilink to the exercise note under each section heading', () => {
    const markdown = composeDashboard(
      mixedIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('## Squat\n\n[[Fitness/Exercises/Squat|Squat]]\n\n```dataview')
    expect(markdown).toContain('## Plank\n\n[[Fitness/Exercises/Plank|Plank]]\n\n```dataview')
  })

  it('renders strength Dataview tables using list fields', () => {
    const markdown = composeDashboard(
      mixedIndex,
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain(
      [
        'TABLE WITHOUT ID',
        '  file.link AS Workout,',
        '  L.set AS Set,',
        '  L.weight AS Weight,',
        '  L.reps AS Reps',
        'FROM "Fitness/Workouts"',
        'FLATTEN file.lists AS L',
        'WHERE L.exercise = link("Squat") AND L.set',
        'SORT file.name DESC, L.set ASC',
        'LIMIT 10',
      ].join('\n'),
    )
    expect(markdown).not.toContain('contains(item.text, "[exercise:: [[Squat]]]")')
  })

  it('ignores zero-rep best sets when rendering PBs', () => {
    const markdown = composeDashboard(
      {
        ...emptyIndex,
        entries: [
          {
            path: 'Fitness/Workouts/2026-04-24.md',
            mtime: 1,
            date: '2026-04-24',
            name: 'Workout',
            exercises: [
              {
                exerciseName: 'Machine Pushdown',
                kind: 'strength',
                bestSet: {
                  weight: 18.1,
                  reps: 0,
                  e1rm: 18.1,
                },
                totalSets: 1,
              },
            ],
          },
        ],
      },
      'Fitness/Workouts',
      'Fitness/Exercises',
      new Set(),
    )

    expect(markdown).toContain('- **[[#Machine Pushdown|Machine Pushdown]]:** no completed sets')
  })
})
