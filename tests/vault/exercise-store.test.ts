import { describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', () => {
  class TFile {
    path = ''
    basename = ''
    extension = 'md'
  }
  return { TFile, normalizePath: (path: string) => path.replace(/\/+/g, '/') }
})

import { TFile, type App } from 'obsidian'

import type { ExerciseRegistryEntry } from '../../src/domain/exercise-registry'
import { levelsForName } from '../../src/domain/exercise-registry'
import type { FitKitSettings } from '../../src/settings'
import { createExerciseStore } from '../../src/vault/exercise-store'
import { buildMockVaultFolderTree } from '../fixtures/mock-vault-folder-tree'

interface Seed {
  path: string
  body: string
  /** What the metadata cache reports; absent reads as unparseable frontmatter. */
  frontmatter?: Record<string, unknown>
}

function fileAt(path: string): TFile {
  return Object.assign(new TFile(), {
    path,
    basename: (path.split('/').pop() ?? path).replace(/\.md$/, ''),
    extension: 'md',
  })
}

/**
 * A vault whose metadata cache only changes when a test says so, so writes
 * leave the cache stale exactly as Obsidian does until it re-indexes.
 */
function buildVault(seeds: Seed[] = [], options: { failCreate?: Error; failFolder?: Error } = {}) {
  const files = seeds.map((seed) => fileAt(seed.path))
  const contents = new Map(seeds.map((seed) => [seed.path, seed.body]))
  const frontmatter = new Map(seeds.map((seed) => [seed.path, seed.frontmatter]))
  const app = {
    vault: {
      getFolderByPath: (path: string) => buildMockVaultFolderTree(files).getFolderByPath(path),
      getAbstractFileByPath: (path: string) => {
        if (options.failFolder && !path.endsWith('.md')) {
          throw options.failFolder
        }
        return files.find((file) => file.path === path) ?? null
      },
      process: vi.fn(async (file: TFile, callback: (text: string) => string) => {
        const next = callback(contents.get(file.path) ?? '')
        contents.set(file.path, next)
        return next
      }),
      create: vi.fn(async (path: string, body: string) => {
        if (options.failCreate) {
          throw options.failCreate
        }
        const file = fileAt(path)
        files.push(file)
        contents.set(path, body)
        return file
      }),
      createFolder: async () => undefined,
    },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: frontmatter.get(file.path) }),
    },
  }
  return { app: app as unknown as App, vault: app.vault, contents, frontmatter }
}

function holderWith(overrides: Partial<FitKitSettings> = {}) {
  const settings: FitKitSettings = {
    fitnessRoot: 'Fitness',
    autoOpenWorkoutEditor: true,
    strengthRestTimerEnabled: true,
    intervalBeepsEnabled: true,
    intervalPresets: '',
    autosaveDebounceMs: 600,
    chartSessionsWindow: 30,
    exerciseRegistry: [],
    deletedExercises: [],
    hiddenDashboardSectionsByPath: {},
    schemaVersion: 1,
    ...overrides,
  }
  return { settings, saveSettings: vi.fn(async () => undefined) }
}

const noteSeed = (name: string, kind: string, body = ''): Seed => ({
  path: `Fitness/Exercises/${name}.md`,
  body: `---\ntype: exercise\nkind: ${kind}\n---\n${body}`,
  frontmatter: { type: 'exercise', kind },
})

const strengthRecentSessionsBody = [
  '',
  '## Recent sessions',
  '',
  '```dataview',
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
  '```',
  '',
].join('\n')

describe('exercise store: recordType', () => {
  it('writes the type into the note and mirrors it into a new registry entry', async () => {
    const { app, contents } = buildVault([noteSeed('Squat', 'duration')])
    const holder = holderWith()

    const result = await createExerciseStore(app, holder).recordType('Squat', 'strength')

    expect(result).toEqual({ name: 'Squat', wrote: 'note', customRecentSessions: false })
    expect(contents.get('Fitness/Exercises/Squat.md')).toContain('kind: strength')
    expect(holder.settings.exerciseRegistry).toEqual([
      { name: 'Squat', kind: 'strength', aliases: [] },
    ])
    expect(holder.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('updates an existing registry entry on the note path', async () => {
    const { app, contents } = buildVault([noteSeed('Squat', 'duration')])
    const holder = holderWith({
      exerciseRegistry: [{ name: 'Squat', kind: 'duration', aliases: [] }],
    })

    await createExerciseStore(app, holder).recordType('Squat', 'strength')

    expect(contents.get('Fitness/Exercises/Squat.md')).toContain('kind: strength')
    expect(holder.settings.exerciseRegistry).toMatchObject([{ name: 'Squat', kind: 'strength' }])
    expect(holder.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('keeps the registry ladder when the note path records a switch', async () => {
    const { app } = buildVault([noteSeed('Push-up', 'strength')])
    const holder = holderWith({
      exerciseRegistry: [
        { name: 'Push-up', kind: 'strength', levels: ['Wall push-up'], aliases: [] },
      ],
    })

    await createExerciseStore(app, holder).recordType('Push-up', 'bodyweight')

    expect(holder.settings.exerciseRegistry).toMatchObject([
      { name: 'Push-up', kind: 'bodyweight', levels: ['Wall push-up'] },
    ])
  })

  it('matches the note case-insensitively and reports the trimmed name', async () => {
    const { app, contents } = buildVault([noteSeed('Squat', 'duration')])

    const result = await createExerciseStore(app, holderWith()).recordType(' squat ', 'strength')

    expect(result?.name).toBe('squat')
    expect(contents.get('Fitness/Exercises/Squat.md')).toContain('kind: strength')
  })

  it('retargets the Recent sessions query at the switched kind', async () => {
    const { app, contents } = buildVault([
      noteSeed('Squat', 'strength', strengthRecentSessionsBody),
    ])

    await createExerciseStore(app, holderWith()).recordType('Squat', 'duration')

    const written = contents.get('Fitness/Exercises/Squat.md') ?? ''
    expect(written).toContain('table without id file.link as Session, duration + "s" as Duration')
    expect(written).not.toContain('L.weight AS Weight')
  })

  it('flags a customised Recent sessions query and leaves it alone', async () => {
    const customised = strengthRecentSessionsBody.replace(
      '  L.weight AS Weight,\n  L.reps AS Reps',
      '  L.weight AS Weight,\n  L.rpe AS RPE',
    )
    const { app, contents } = buildVault([noteSeed('Squat', 'strength', customised)])

    const result = await createExerciseStore(app, holderWith()).recordType('Squat', 'duration')

    expect(result?.customRecentSessions).toBe(true)
    expect(contents.get('Fitness/Exercises/Squat.md')).toContain('L.rpe AS RPE')
  })

  it('falls back to the registry when no note exists', async () => {
    const { app, vault } = buildVault()
    const holder = holderWith()

    const result = await createExerciseStore(app, holder).recordType('Air bike', 'duration')

    expect(result).toEqual({ name: 'Air bike', wrote: 'registry', customRecentSessions: false })
    expect(vault.process).not.toHaveBeenCalled()
    expect(holder.settings.exerciseRegistry).toEqual([
      { name: 'Air bike', kind: 'duration', aliases: [] },
    ])
    expect(holder.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('updates the registry entry for a case-variant name instead of duplicating it', async () => {
    const { app } = buildVault()
    const holder = holderWith({
      exerciseRegistry: [{ name: 'Squat', kind: 'strength', unit: 'kg', aliases: ['back squat'] }],
    })

    await createExerciseStore(app, holder).recordType('squat', 'duration')

    expect(holder.settings.exerciseRegistry).toHaveLength(1)
    expect(holder.settings.exerciseRegistry[0]).toMatchObject({
      name: 'Squat',
      kind: 'duration',
      unit: 'kg',
      aliases: ['back squat'],
    })
  })

  it('marks an interval type on the registry entry and drops the marker on a switch away', async () => {
    const { app } = buildVault()
    const holder = holderWith()
    const store = createExerciseStore(app, holder)

    await store.recordType('Air bike', 'interval')
    const marked = holder.settings.exerciseRegistry[0]
    await store.recordType('Air bike', 'strength')

    expect(marked).toEqual({ name: 'Air bike', kind: 'duration', interval: true, aliases: [] })
    expect(holder.settings.exerciseRegistry).toEqual([
      { name: 'Air bike', kind: 'strength', aliases: [] },
    ])
  })

  it('routes an unparseable note through the note writer and leaves the registry alone', async () => {
    const malformed = '---\ntype: exercise\nkind: duration\n'
    const { app, vault, contents } = buildVault([
      { path: 'Fitness/Exercises/Squat.md', body: malformed },
    ])
    const holder = holderWith()

    const result = await createExerciseStore(app, holder).recordType('Squat', 'strength')

    expect(result).toEqual({ name: 'Squat', wrote: 'note-unchanged', customRecentSessions: false })
    expect(vault.process).toHaveBeenCalledTimes(1)
    expect(contents.get('Fitness/Exercises/Squat.md')).toBe(malformed)
    expect(holder.settings.exerciseRegistry).toEqual([])
    expect(holder.saveSettings).not.toHaveBeenCalled()
  })

  it('does nothing for a blank name', async () => {
    const { app } = buildVault()
    const holder = holderWith()

    expect(await createExerciseStore(app, holder).recordType('  ', 'strength')).toBeNull()
    expect(holder.saveSettings).not.toHaveBeenCalled()
  })
})

describe('exercise store: recordLadder', () => {
  const pushUpWithLadder = (levels: string[]): Seed => ({
    path: 'Fitness/Exercises/Push-up.md',
    body: `---\ntype: exercise\nkind: bodyweight\nlevels:\n${levels.map((rung) => `  - ${rung}\n`).join('')}---\n`,
    frontmatter: { type: 'exercise', kind: 'bodyweight', levels },
  })

  it('writes the ladder into the note and leaves the registry untouched', async () => {
    const { app, contents } = buildVault([pushUpWithLadder(['Wall push-up'])])
    const holder = holderWith()

    const result = await createExerciseStore(app, holder).recordLadder('Push-up', [
      'Incline push-up',
      'Knee push-up',
    ])

    const written = contents.get('Fitness/Exercises/Push-up.md') ?? ''
    expect(result).toEqual({ name: 'Push-up', wrote: 'note' })
    expect(written).toContain('  - Incline push-up\n')
    expect(written).toContain('  - Knee push-up\n')
    expect(written).not.toContain('Wall push-up')
    expect(holder.settings.exerciseRegistry).toEqual([])
    expect(holder.saveSettings).not.toHaveBeenCalled()
  })

  it('creates a bodyweight registry entry when no note exists', async () => {
    const { app, vault } = buildVault()
    const holder = holderWith()

    const result = await createExerciseStore(app, holder).recordLadder('Push-up', [
      'Wall push-up',
      'Knee push-up',
    ])

    expect(result).toEqual({ name: 'Push-up', wrote: 'registry' })
    expect(vault.process).not.toHaveBeenCalled()
    expect(holder.settings.exerciseRegistry).toEqual([
      {
        name: 'Push-up',
        kind: 'bodyweight',
        aliases: [],
        levels: ['Wall push-up', 'Knee push-up'],
      },
    ])
    expect(holder.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('replaces only the levels of an existing registry entry', async () => {
    const { app } = buildVault()
    const existing: ExerciseRegistryEntry = {
      name: 'Push-up',
      kind: 'bodyweight',
      levels: ['Wall push-up'],
      aliases: ['Pushup'],
    }
    const holder = holderWith({ exerciseRegistry: [existing] })

    await createExerciseStore(app, holder).recordLadder('push-up', ['Knee push-up'])

    expect(holder.settings.exerciseRegistry).toEqual([
      { name: 'Push-up', kind: 'bodyweight', levels: ['Knee push-up'], aliases: ['Pushup'] },
    ])
  })

  it('reports an unparseable note as unchanged without touching the registry', async () => {
    const malformed = '---\ntype: exercise\nkind: bodyweight\n'
    const { app, contents } = buildVault([
      { path: 'Fitness/Exercises/Push-up.md', body: malformed },
    ])
    const holder = holderWith()
    const store = createExerciseStore(app, holder)

    const result = await store.recordLadder('Push-up', ['Knee push-up'])

    expect(result).toEqual({ name: 'Push-up', wrote: 'note-unchanged' })
    expect(contents.get('Fitness/Exercises/Push-up.md')).toBe(malformed)
    expect(holder.saveSettings).not.toHaveBeenCalled()
    expect(store.levelsFor('Push-up')).toBeUndefined()
  })

  it('serves the ladder it wrote while the cache still reports the old one', async () => {
    const { app } = buildVault([pushUpWithLadder(['Wall push-up'])])
    const store = createExerciseStore(app, holderWith())

    await store.recordLadder('Push-up', ['Incline push-up', 'Knee push-up'])

    expect(levelsForName(store.registry(), 'Push-up')).toEqual(['Incline push-up', 'Knee push-up'])
    expect(store.levelsFor('push-up')).toEqual(['Incline push-up', 'Knee push-up'])
  })

  it('lets a later outside edit through once the cache has caught up', async () => {
    const { app, frontmatter } = buildVault([pushUpWithLadder(['Wall push-up'])])
    const store = createExerciseStore(app, holderWith())
    const path = 'Fitness/Exercises/Push-up.md'

    await store.recordLadder('Push-up', ['Knee push-up'])
    frontmatter.set(path, { type: 'exercise', kind: 'bodyweight', levels: ['Knee push-up'] })
    store.registry()
    frontmatter.set(path, { type: 'exercise', kind: 'bodyweight', levels: ['Full push-up'] })

    expect(levelsForName(store.registry(), 'Push-up')).toEqual(['Full push-up'])
    expect(store.levelsFor('Push-up')).toEqual(['Full push-up'])
  })

  it('reads the snapshot ladder when it wrote nothing', () => {
    const { app } = buildVault([pushUpWithLadder(['Wall push-up'])])
    const store = createExerciseStore(app, holderWith())

    expect(store.levelsFor('Push-up')).toEqual(['Wall push-up'])
    expect(store.levelsFor('Unknown')).toBeUndefined()
  })

  it('does nothing for a blank name', async () => {
    const { app } = buildVault()
    const holder = holderWith()

    expect(await createExerciseStore(app, holder).recordLadder('', ['Wall push-up'])).toBeNull()
    expect(holder.saveSettings).not.toHaveBeenCalled()
  })
})

describe('exercise store: ensureKnown', () => {
  const squatPath = 'Fitness/Exercises/Squat.md'

  it('reuses an existing note without saving when there is no tombstone', async () => {
    const { app, vault } = buildVault([noteSeed('Squat', 'strength')])
    const holder = holderWith()

    const result = await createExerciseStore(app, holder).ensureKnown('Squat', 'strength', {
      createNote: true,
    })

    expect(result).toEqual({ outcome: 'note-reused', restored: false })
    expect(vault.create).not.toHaveBeenCalled()
    expect(holder.saveSettings).not.toHaveBeenCalled()
  })

  it('restores an existing note by clearing its tombstone', async () => {
    const { app, vault } = buildVault([noteSeed('Squat', 'strength')])
    const holder = holderWith({ deletedExercises: ['squat', 'bench'] })

    const result = await createExerciseStore(app, holder).ensureKnown('Squat', 'strength', {
      createNote: true,
    })

    expect(result).toEqual({ outcome: 'note-reused', restored: true })
    expect(vault.create).not.toHaveBeenCalled()
    expect(holder.settings.deletedExercises).toEqual(['bench'])
    expect(holder.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('creates a note and a registry entry alongside it', async () => {
    const { app, contents } = buildVault()
    const holder = holderWith()

    const result = await createExerciseStore(app, holder).ensureKnown('Squat', 'strength', {
      createNote: true,
    })

    expect(result).toEqual({ outcome: 'note-created' })
    expect(contents.get(squatPath)).toContain('type: exercise\nkind: strength\n')
    expect(contents.get(squatPath)).toContain('FROM "Fitness/Workouts"')
    expect(holder.settings.exerciseRegistry).toEqual([
      { name: 'Squat', kind: 'strength', aliases: [] },
    ])
    expect(holder.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('clears a tombstone in the same save as a created note', async () => {
    const { app } = buildVault()
    const holder = holderWith({ deletedExercises: ['squat'] })

    await createExerciseStore(app, holder).ensureKnown('Squat', 'strength', { createNote: true })

    expect(holder.settings.deletedExercises).toEqual([])
    expect(holder.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('reports a parent folder failure without changing settings', async () => {
    const { app, vault } = buildVault([], { failFolder: new Error('no folder') })
    const holder = holderWith({ deletedExercises: ['squat'] })

    const result = await createExerciseStore(app, holder).ensureKnown('Squat', 'strength', {
      createNote: true,
    })

    expect(result).toEqual({ outcome: 'note-failed', message: 'no folder' })
    expect(vault.create).not.toHaveBeenCalled()
    expect(holder.settings.deletedExercises).toEqual(['squat'])
    expect(holder.saveSettings).not.toHaveBeenCalled()
  })

  it('reports a create failure without changing settings', async () => {
    const { app, vault } = buildVault([], { failCreate: new Error('read only') })
    const holder = holderWith()

    const result = await createExerciseStore(app, holder).ensureKnown('Squat', 'strength', {
      createNote: true,
    })

    expect(result).toEqual({ outcome: 'note-failed', message: 'read only' })
    expect(vault.create).toHaveBeenCalledTimes(1)
    expect(holder.settings.exerciseRegistry).toEqual([])
    expect(holder.saveSettings).not.toHaveBeenCalled()
  })

  it('adds a no-note registry entry and clears its tombstone', async () => {
    const { app, vault } = buildVault()
    const holder = holderWith({ deletedExercises: ['plank'] })

    const result = await createExerciseStore(app, holder).ensureKnown('Plank', 'duration', {
      createNote: false,
    })

    expect(result).toEqual({ outcome: 'registry-added' })
    expect(vault.create).not.toHaveBeenCalled()
    expect(holder.settings.exerciseRegistry).toEqual([
      { name: 'Plank', kind: 'duration', aliases: [] },
    ])
    expect(holder.settings.deletedExercises).toEqual([])
    expect(holder.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('leaves an exercise the registry already knows alone', async () => {
    const { app } = buildVault()
    const holder = holderWith({
      exerciseRegistry: [{ name: 'Plank', kind: 'duration', aliases: ['Front plank'] }],
    })

    const result = await createExerciseStore(app, holder).ensureKnown('front plank', 'strength', {
      createNote: false,
    })

    expect(result).toEqual({ outcome: 'already-known' })
    expect(holder.settings.exerciseRegistry).toHaveLength(1)
    expect(holder.saveSettings).not.toHaveBeenCalled()
  })
})

describe('exercise store: undelete', () => {
  it('removes the tombstone matching the normalized name and saves', async () => {
    const { app } = buildVault()
    const holder = holderWith({ deletedExercises: ['squat', 'bench press'] })

    const removed = await createExerciseStore(app, holder).undelete(' BENCH   PRESS ')

    expect(removed).toBe(true)
    expect(holder.settings.deletedExercises).toEqual(['squat'])
    expect(holder.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('does not save when the name has no tombstone', async () => {
    const { app } = buildVault()
    const holder = holderWith({ deletedExercises: ['squat'] })

    const removed = await createExerciseStore(app, holder).undelete('Bench')

    expect(removed).toBe(false)
    expect(holder.settings.deletedExercises).toEqual(['squat'])
    expect(holder.saveSettings).not.toHaveBeenCalled()
  })
})
