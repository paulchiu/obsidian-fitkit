import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'

import { markdownFilesInFolder } from '../../src/vault/folder-scan'
import { buildMockVaultFolderTree } from '../fixtures/mock-vault-folder-tree'

function mockApp(paths: string[]): App {
  return {
    vault: buildMockVaultFolderTree(paths.map((path) => ({ path }))),
  } as unknown as App
}

describe('markdownFilesInFolder', () => {
  it('returns an empty array when the folder does not exist', () => {
    const app = mockApp(['Fitness/Workouts/2026-01-01.md'])

    expect(markdownFilesInFolder(app, 'Fitness/Exercises')).toEqual([])
  })

  it('includes files in nested subfolders', () => {
    const app = mockApp([
      'Fitness/Workouts/2026-01-01.md',
      'Fitness/Workouts/Archive 2025/2025-12-31.md',
      'Fitness/Workouts/Archive 2025/Q4/2025-11-30.md',
    ])

    expect(markdownFilesInFolder(app, 'Fitness/Workouts').map((file) => file.path)).toEqual([
      'Fitness/Workouts/2026-01-01.md',
      'Fitness/Workouts/Archive 2025/2025-12-31.md',
      'Fitness/Workouts/Archive 2025/Q4/2025-11-30.md',
    ])
  })

  it('excludes non-markdown files', () => {
    const app = mockApp(['Fitness/Exercises/Squat.md', 'Fitness/Exercises/Squat.png'])

    expect(markdownFilesInFolder(app, 'Fitness/Exercises').map((file) => file.path)).toEqual([
      'Fitness/Exercises/Squat.md',
    ])
  })

  it('excludes a sibling folder that shares the target folder name as a prefix', () => {
    const app = mockApp([
      'Fitness/Workouts/2026-01-01.md',
      'Fitness/Workouts Archive/2025-12-31.md',
    ])

    expect(markdownFilesInFolder(app, 'Fitness/Workouts').map((file) => file.path)).toEqual([
      'Fitness/Workouts/2026-01-01.md',
    ])
  })

  it('normalizes a folder argument with a leading slash, matching a root-anchored fitness folder', () => {
    const app = mockApp(['Workouts/2026-01-01.md'])

    expect(markdownFilesInFolder(app, '/Workouts').map((file) => file.path)).toEqual([
      'Workouts/2026-01-01.md',
    ])
  })

  it('sorts results by path', () => {
    const app = mockApp([
      'Fitness/Exercises/Squat.md',
      'Fitness/Exercises/Bench Press.md',
      'Fitness/Exercises/Deadlift.md',
    ])

    expect(markdownFilesInFolder(app, 'Fitness/Exercises').map((file) => file.path)).toEqual([
      'Fitness/Exercises/Bench Press.md',
      'Fitness/Exercises/Deadlift.md',
      'Fitness/Exercises/Squat.md',
    ])
  })
})
