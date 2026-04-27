import type { App } from 'obsidian'

import {
  buildExerciseHistoryMap,
  type ExerciseHistoryAnchor,
  type ExerciseHistoryByName,
} from '../domain/exercise-history'
import type { FitKitIndex } from '../domain/types'
import type { FitKitSettings } from '../settings'
import { rebuildIndex } from './index'

export interface ExerciseHistoryIndexOwner {
  app: App
  settings: FitKitSettings
  cachedIndex: FitKitIndex | null
}

export async function exerciseHistoryFromVault(
  owner: ExerciseHistoryIndexOwner,
  anchor: ExerciseHistoryAnchor,
): Promise<ExerciseHistoryByName> {
  if (owner.cachedIndex === null) {
    owner.cachedIndex = await rebuildIndex(owner.app, owner.settings)
  }

  return buildExerciseHistoryMap(owner.cachedIndex, anchor)
}
