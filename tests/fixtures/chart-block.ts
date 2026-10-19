import type { MarkdownPostProcessorContext, TFile } from 'obsidian'

import type { FitKitIndex, IndexEntry } from '../../src/domain/types'
import type { FitKitSettings } from '../../src/settings'
import type { renderExerciseChartBlock } from '../../src/ui/obsidian/exercise-chart-block'
import { buildMockVaultFolderTree } from './mock-vault-folder-tree'

export type ChartBlockPlugin = Parameters<typeof renderExerciseChartBlock>[0]
export type Frontmatter = Record<string, unknown>

export const emptyIndex: FitKitIndex = {
  schemaVersion: 1,
  builtAt: 0,
  entries: [],
  diagnostics: [],
}

export function createSettings(overrides: Partial<FitKitSettings> = {}): FitKitSettings {
  return {
    fitnessRoot: 'Fitness',
    autoOpenWorkoutEditor: true,
    strengthRestTimerEnabled: true,
    autosaveDebounceMs: 600,
    chartSessionsWindow: 30,
    exerciseRegistry: [],
    hiddenDashboardSectionsByPath: {},
    schemaVersion: 1,
    ...overrides,
  }
}

export function createPlugin(
  files: TFile[],
  frontmatterByPath: ReadonlyMap<string, Frontmatter>,
  settings: FitKitSettings = createSettings(),
): ChartBlockPlugin {
  return {
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
        ...buildMockVaultFolderTree(files),
      },
      metadataCache: {
        getFileCache: (file: TFile) => ({ frontmatter: frontmatterByPath.get(file.path) }),
      },
    },
    settings,
    cachedIndex: emptyIndex,
    getIndex(this: { cachedIndex: FitKitIndex }): Promise<FitKitIndex> {
      return Promise.resolve(this.cachedIndex)
    },
    lastDiagnostics: [],
  } as unknown as ChartBlockPlugin
}

/** A post-processor context for `sourcePath`; `children` collects what the block registers on it. */
export function createContext(sourcePath: string): MarkdownPostProcessorContext & {
  children: Array<{ onunload(): void }>
} {
  const children: Array<{ onunload(): void }> = []
  return {
    sourcePath,
    children,
    addChild: (child: { onunload(): void }) => {
      children.push(child)
      return child
    },
  } as unknown as MarkdownPostProcessorContext & { children: Array<{ onunload(): void }> }
}

/** One workout per value, a day apart from 2026-04-10, carrying `row` for `exerciseName`. */
export function indexOf(
  exerciseName: string,
  values: number[],
  row: (value: number) => IndexEntry['exercises'][number],
): FitKitIndex {
  return {
    ...emptyIndex,
    entries: values.map((value, offset) => ({
      path: `Fitness/Workouts/2026-04-${10 + offset}.md`,
      mtime: 1,
      date: `2026-04-${10 + offset}`,
      name: 'Workout',
      exercises: [{ ...row(value), exerciseName }],
    })),
  }
}
