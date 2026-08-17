import type { App } from 'obsidian'
import { describe, expect, it, vi } from 'vitest'

import { buildExerciseRenamePlan } from '../../src/domain/exercise-rename-planner'
import type { FitKitSettings } from '../../src/settings'
import { composeExerciseNote } from '../../src/vault/exercise-note'
import {
  applyExerciseRenamePlan,
  buildExerciseRenamePlanFromVault,
} from '../../src/vault/exercise-rename-apply'

vi.mock('obsidian', () => ({
  normalizePath: (path: string) => path.replace(/\/+/g, '/'),
}))

function settings(overrides: Partial<FitKitSettings> = {}): FitKitSettings {
  return {
    fitnessRoot: 'Fitness',
    autoOpenWorkoutEditor: true,
    strengthRestTimerEnabled: true,
    autosaveDebounceMs: 600,
    chartSessionsWindow: 30,
    exerciseRegistry: [],
    deletedExercises: [],
    hiddenDashboardSectionsByPath: {},
    schemaVersion: 1,
    ...overrides,
  }
}

interface MockFile {
  path: string
  basename: string
  extension: string
}

interface Seed {
  path: string
  body: string
  frontmatter?: Record<string, unknown>
}

function workoutBody(exercise: string): string {
  return `---
type: workout
date: 2026-05-08
name: Test
---

## [[${exercise}]]

- [exercise:: [[${exercise}]]] [set:: 1] [weight:: 100] [reps:: 5]
`
}

function buildMockApp(seeds: Seed[], options: { failRename?: boolean } = {}) {
  const files: MockFile[] = seeds.map((seed) => ({
    path: seed.path,
    basename: (seed.path.split('/').pop() ?? seed.path).replace(/\.md$/, ''),
    extension: 'md',
  }))
  const content = new Map(seeds.map((seed) => [seed.path, seed.body]))
  const frontmatter = new Map(seeds.map((seed) => [seed.path, seed.frontmatter ?? {}]))
  const renameCalls: Array<{ from: string; to: string }> = []
  const trashCalls: string[] = []
  const failProcessPaths = new Set<string>()

  /**
   * Every method below is typed against `MockFile`, not the real `TFile`;
   * the object literal is only reconciled with `App` via the single cast at
   * the end, so no per-call cast gymnastics are needed in between.
   */
  const app = {
    vault: {
      getMarkdownFiles: () => [...files],
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
      read: async (file: MockFile) => content.get(file.path) ?? '',
      process: async (file: MockFile, callback: (live: string) => string) => {
        if (failProcessPaths.has(file.path)) {
          throw new Error(`Simulated failure for ${file.path}`)
        }
        const current = content.get(file.path) ?? ''
        const next = callback(current)
        content.set(file.path, next)
        return next
      },
    },
    fileManager: {
      renameFile: async (file: MockFile, newPath: string) => {
        if (options.failRename) {
          throw new Error('Disk full')
        }
        renameCalls.push({ from: file.path, to: newPath })
        const body = content.get(file.path) ?? ''
        content.delete(file.path)
        content.set(newPath, body)
        const fm = frontmatter.get(file.path)
        frontmatter.delete(file.path)
        if (fm) {
          frontmatter.set(newPath, fm)
        }
        file.path = newPath
        file.basename = (newPath.split('/').pop() ?? newPath).replace(/\.md$/, '')
      },
      trashFile: async (file: MockFile) => {
        trashCalls.push(file.path)
        content.delete(file.path)
        frontmatter.delete(file.path)
        const index = files.indexOf(file)
        if (index >= 0) {
          files.splice(index, 1)
        }
      },
    },
    metadataCache: {
      getFileCache: (file: MockFile) => ({ frontmatter: frontmatter.get(file.path) }),
    },
  } as unknown as App

  return { app, content, frontmatter, renameCalls, trashCalls, failProcessPaths, files }
}

function exerciseSeed(name: string, path: string, body?: string): Seed {
  return {
    path,
    body: body ?? composeExerciseNote(name, 'strength', 'Fitness/Workouts', 'kg'),
    frontmatter: { type: 'exercise', kind: 'strength', unit: 'kg' },
  }
}

describe('applyExerciseRenamePlan: plain rename', () => {
  it('renames the note file once and rewrites workout note occurrences', async () => {
    const config = settings({
      exerciseRegistry: [{ name: 'Row', kind: 'strength', unit: 'kg', aliases: [] }],
    })
    const { app, content, renameCalls } = buildMockApp([
      exerciseSeed('Row', 'Fitness/Exercises/Row.md'),
      { path: 'Fitness/Workouts/2026-05-08.md', body: workoutBody('Row') },
    ])

    const plan = await buildExerciseRenamePlanFromVault(app, config, 'Row', 'Barbell Row')
    expect(plan.refusal).toBeNull()
    expect(plan.operation).toBe('rename')

    const result = await applyExerciseRenamePlan(app, config, plan)

    expect(renameCalls).toEqual([
      { from: 'Fitness/Exercises/Row.md', to: 'Fitness/Exercises/Barbell Row.md' },
    ])
    expect(result.noteRenamed).toBe(true)
    expect(result.finalNotePath).toBe('Fitness/Exercises/Barbell Row.md')
    expect(result.workoutNotesRewritten).toBe(1)
    expect(result.headingOccurrencesRewritten).toBe(1)
    expect(result.fieldOccurrencesRewritten).toBe(1)
    expect(result.failures).toEqual([])

    expect(content.get('Fitness/Workouts/2026-05-08.md')).toContain('## [[Barbell Row]]')
    expect(content.get('Fitness/Workouts/2026-05-08.md')).toContain('[exercise:: [[Barbell Row]]]')

    /**
     * migrateExerciseNote ran with the NEW name: both the Recent sessions and
     * Notes blocks follow the rename (Notes mirrors Recent sessions'
     * staleness-following, so an uncustomised query is silently rewritten
     * rather than left pointing at the old name).
     */
    const renamedNote = content.get('Fitness/Exercises/Barbell Row.md') ?? ''
    expect(renamedNote).toContain('link("Barbell Row")')
    expect(renamedNote).not.toContain('link("Row")')
    expect(result.noteMigrationWarnings).toEqual([])

    expect(config.exerciseRegistry).toEqual([
      { name: 'Barbell Row', kind: 'strength', unit: 'kg', aliases: ['Row'] },
    ])
  })

  it('is safe to re-run: a second full pass makes no further changes', async () => {
    const config = settings({
      exerciseRegistry: [{ name: 'Row', kind: 'strength', aliases: [] }],
    })
    const { app, renameCalls } = buildMockApp([
      exerciseSeed('Row', 'Fitness/Exercises/Row.md'),
      { path: 'Fitness/Workouts/2026-05-08.md', body: workoutBody('Row') },
    ])

    const firstPlan = await buildExerciseRenamePlanFromVault(app, config, 'Row', 'Barbell Row')
    const firstResult = await applyExerciseRenamePlan(app, config, firstPlan)
    expect(firstResult.failures).toEqual([])
    expect(renameCalls).toHaveLength(1)
    const registrySnapshotAfterFirstRun = JSON.stringify(config.exerciseRegistry)

    const secondPlan = await buildExerciseRenamePlanFromVault(app, config, 'Row', 'Barbell Row')
    const secondResult = await applyExerciseRenamePlan(app, config, secondPlan)

    expect(secondResult.failures).toEqual([])
    expect(secondResult.noteRenamed).toBe(false)
    expect(secondResult.workoutNotesRewritten).toBe(0)
    /** No second rename attempted: the note is already at the destination path. */
    expect(renameCalls).toHaveLength(1)
    expect(JSON.stringify(config.exerciseRegistry)).toBe(registrySnapshotAfterFirstRun)
  })

  it('rewrites nothing for a workout note whose live text already uses the new name', async () => {
    const config = settings()
    const { app, content } = buildMockApp([
      { path: 'Fitness/Workouts/2026-05-08.md', body: workoutBody('Barbell Row') },
    ])
    const before = content.get('Fitness/Workouts/2026-05-08.md')

    /** Plan built from stale text (as if captured before the note was already fixed elsewhere). */
    const plan = buildExerciseRenamePlan({
      oldName: 'Row',
      newName: 'Barbell Row',
      registry: [],
      catalog: [],
      deletedExercises: [],
      workoutNotes: [{ path: 'Fitness/Workouts/2026-05-08.md', text: workoutBody('Row') }],
    })
    expect(plan.workoutNotes).toHaveLength(1)

    const result = await applyExerciseRenamePlan(app, config, plan)

    expect(result.workoutNotesRewritten).toBe(0)
    expect(result.headingOccurrencesRewritten).toBe(0)
    expect(result.fieldOccurrencesRewritten).toBe(0)
    expect(content.get('Fitness/Workouts/2026-05-08.md')).toBe(before)
  })

  it('reports a per-file failure without aborting the rest', async () => {
    const config = settings({
      exerciseRegistry: [{ name: 'Row', kind: 'strength', aliases: [] }],
    })
    const { app, content, failProcessPaths } = buildMockApp([
      exerciseSeed('Row', 'Fitness/Exercises/Row.md'),
      { path: 'Fitness/Workouts/2026-05-08.md', body: workoutBody('Row') },
      { path: 'Fitness/Workouts/2026-05-09.md', body: workoutBody('Row') },
    ])
    failProcessPaths.add('Fitness/Workouts/2026-05-08.md')

    const plan = await buildExerciseRenamePlanFromVault(app, config, 'Row', 'Barbell Row')
    const result = await applyExerciseRenamePlan(app, config, plan)

    expect(result.failures).toEqual([
      {
        path: 'Fitness/Workouts/2026-05-08.md',
        stage: 'workout-note-rewrite',
        message: 'Simulated failure for Fitness/Workouts/2026-05-08.md',
      },
    ])
    /** The other workout note still got fixed. */
    expect(result.workoutNotesRewritten).toBe(1)
    expect(content.get('Fitness/Workouts/2026-05-09.md')).toContain('[[Barbell Row]]')
    expect(content.get('Fitness/Workouts/2026-05-08.md')).toContain('[[Row]]')
    /** The note itself still got renamed; only the one workout note failed. */
    expect(result.noteRenamed).toBe(true)
  })

  it('aborts before touching the registry or any workout note when the note rename itself fails', async () => {
    const config = settings({
      exerciseRegistry: [{ name: 'Row', kind: 'strength', aliases: [] }],
    })
    const { app, content } = buildMockApp(
      [
        exerciseSeed('Row', 'Fitness/Exercises/Row.md'),
        { path: 'Fitness/Workouts/2026-05-08.md', body: workoutBody('Row') },
      ],
      { failRename: true },
    )

    const plan = await buildExerciseRenamePlanFromVault(app, config, 'Row', 'Barbell Row')
    const result = await applyExerciseRenamePlan(app, config, plan)

    expect(result.failures).toEqual([
      { path: 'Fitness/Exercises/Row.md', stage: 'note-rename', message: 'Disk full' },
    ])
    expect(result.noteRenamed).toBe(false)
    expect(result.workoutNotesRewritten).toBe(0)
    expect(content.get('Fitness/Workouts/2026-05-08.md')).toContain('[[Row]]')
    expect(config.exerciseRegistry).toEqual([{ name: 'Row', kind: 'strength', aliases: [] }])
  })

  it('never sets a unit on the resulting registry entry when neither side had one', async () => {
    const config = settings({
      exerciseRegistry: [{ name: 'Row', kind: 'strength', aliases: [] }],
    })
    const { app } = buildMockApp([exerciseSeed('Row', 'Fitness/Exercises/Row.md')])

    const plan = await buildExerciseRenamePlanFromVault(app, config, 'Row', 'Barbell Row')
    await applyExerciseRenamePlan(app, config, plan)

    expect(config.exerciseRegistry).toEqual([
      { name: 'Barbell Row', kind: 'strength', unit: undefined, aliases: ['Row'] },
    ])
    expect('unit' in (config.exerciseRegistry[0] ?? {})).toBe(true)
    expect(JSON.stringify(config.exerciseRegistry[0])).not.toContain('kg')
  })
})

describe('applyExerciseRenamePlan: merge', () => {
  it('carries the losing note prose into the target before removing it', async () => {
    const config = settings({
      exerciseRegistry: [
        { name: 'Row', kind: 'strength', aliases: [] },
        { name: 'Barbell Row', kind: 'strength', aliases: [] },
      ],
    })
    const loserBody = `---
type: exercise
kind: strength
metric: e1rm
unit: kg
---

## Notes

Cue: keep the bar close to the shins.
`
    const { app, content, trashCalls, files } = buildMockApp([
      exerciseSeed('Row', 'Fitness/Exercises/Row.md', loserBody),
      exerciseSeed('Barbell Row', 'Fitness/Exercises/Barbell Row.md'),
    ])

    const plan = await buildExerciseRenamePlanFromVault(app, config, 'Row', 'Barbell Row')
    expect(plan.operation).toBe('merge')
    expect(plan.losingNoteHasProse).toBe(true)

    const result = await applyExerciseRenamePlan(app, config, plan)

    expect(result.operation).toBe('merge')
    expect(result.proseCarried).toBe(true)
    expect(result.loserNoteRemoved).toBe(true)
    expect(trashCalls).toEqual(['Fitness/Exercises/Row.md'])
    expect(files.some((file) => file.path === 'Fitness/Exercises/Row.md')).toBe(false)

    const survivor = content.get('Fitness/Exercises/Barbell Row.md') ?? ''
    expect(survivor).toContain('Merged from Row')
    expect(survivor).toContain('Cue: keep the bar close to the shins.')

    expect(config.exerciseRegistry).toEqual([
      { name: 'Barbell Row', kind: 'strength', unit: undefined, aliases: ['Row'] },
    ])
  })

  it('does not carry prose when the losing note has none', async () => {
    const config = settings()
    const { app, content, trashCalls } = buildMockApp([
      exerciseSeed('Row', 'Fitness/Exercises/Row.md'),
      exerciseSeed('Barbell Row', 'Fitness/Exercises/Barbell Row.md'),
    ])
    const targetBefore = content.get('Fitness/Exercises/Barbell Row.md')

    const plan = await buildExerciseRenamePlanFromVault(app, config, 'Row', 'Barbell Row')
    expect(plan.losingNoteHasProse).toBe(false)

    const result = await applyExerciseRenamePlan(app, config, plan)

    expect(result.proseCarried).toBe(false)
    expect(result.loserNoteRemoved).toBe(true)
    expect(trashCalls).toEqual(['Fitness/Exercises/Row.md'])
    /** Notes section content unchanged (only the Dataview blocks are regenerated by migrate). */
    const survivorNotesSection = (content.get('Fitness/Exercises/Barbell Row.md') ?? '').split(
      '## Notes',
    )[1]
    expect(survivorNotesSection).not.toContain('Merged from')
    void targetBefore
  })

  it('renames the source note onto the target name when the target is a no-note registry entry', async () => {
    const config = settings({
      exerciseRegistry: [{ name: 'Barbell Row', kind: 'strength', aliases: [] }],
    })
    const { app, content, renameCalls, trashCalls } = buildMockApp([
      exerciseSeed('Row', 'Fitness/Exercises/Row.md'),
    ])

    const plan = await buildExerciseRenamePlanFromVault(app, config, 'Row', 'Barbell Row')
    expect(plan.operation).toBe('merge')
    expect(plan.targetNoteExists).toBe(false)

    const result = await applyExerciseRenamePlan(app, config, plan)

    expect(result.operation).toBe('merge')
    expect(result.noteRenamed).toBe(true)
    expect(result.finalNotePath).toBe('Fitness/Exercises/Barbell Row.md')
    expect(renameCalls).toEqual([
      { from: 'Fitness/Exercises/Row.md', to: 'Fitness/Exercises/Barbell Row.md' },
    ])
    /** No second note to remove: there was only ever one file. */
    expect(trashCalls).toEqual([])
    expect(result.loserNoteRemoved).toBe(false)
    expect(content.get('Fitness/Exercises/Barbell Row.md')).toBeDefined()
    expect(config.exerciseRegistry).toEqual([
      { name: 'Barbell Row', kind: 'strength', unit: undefined, aliases: ['Row'] },
    ])
  })

  it("resolves a merge target typed as an existing alias to the alias owner's real note", async () => {
    const config = settings({
      exerciseRegistry: [{ name: 'Squats', kind: 'strength', unit: 'kg', aliases: ['Squat'] }],
    })
    const { app, content, renameCalls, trashCalls } = buildMockApp([
      exerciseSeed('Squats', 'Fitness/Exercises/Squats.md'),
      exerciseSeed('Deadlift', 'Fitness/Exercises/Deadlift.md'),
    ])

    const plan = await buildExerciseRenamePlanFromVault(app, config, 'Deadlift', 'Squat')
    expect(plan.operation).toBe('merge')
    /** The surviving identity is the entry's real canonical name, not the typed alias. */
    expect(plan.newName).toBe('Squats')
    expect(plan.targetNotePath).toBe('Fitness/Exercises/Squats.md')
    expect(plan.targetNoteExists).toBe(true)

    const result = await applyExerciseRenamePlan(app, config, plan)

    /** Deadlift.md is removed, not renamed: the real target note already exists. */
    expect(renameCalls).toEqual([])
    expect(trashCalls).toEqual(['Fitness/Exercises/Deadlift.md'])
    expect(result.finalNotePath).toBe('Fitness/Exercises/Squats.md')
    expect(content.get('Fitness/Exercises/Squats.md')).toBeDefined()
    expect(content.get('Fitness/Exercises/Deadlift.md')).toBeUndefined()
    expect(config.exerciseRegistry).toEqual([
      { name: 'Squats', kind: 'strength', unit: 'kg', aliases: ['Deadlift', 'Squat'] },
    ])
  })
})

describe('buildExerciseRenamePlanFromVault', () => {
  it('flags a target path collision with an unrelated file', async () => {
    const config = settings()
    const { app } = buildMockApp([
      exerciseSeed('Row', 'Fitness/Exercises/Row.md'),
      { path: 'Fitness/Exercises/Deadlift.md', body: 'not an exercise note', frontmatter: {} },
    ])

    const plan = await buildExerciseRenamePlanFromVault(app, config, 'Row', 'Deadlift')

    expect(plan.refusal).toEqual({
      reason: 'target-collision',
      message: "A file already exists at the destination for 'Deadlift' that is not this exercise.",
    })
  })
})
