import {
  buildExerciseHistoryMap,
  type ExerciseHistoryAnchor,
  type ExerciseHistoryByName,
} from '../domain/exercise-history'
import type { FitKitIndex } from '../domain/types'

export interface ExerciseHistoryIndexOwner {
  getIndex(): Promise<FitKitIndex>
}

export async function exerciseHistoryFromVault(
  owner: ExerciseHistoryIndexOwner,
  anchor: ExerciseHistoryAnchor,
): Promise<ExerciseHistoryByName> {
  return buildExerciseHistoryMap(await owner.getIndex(), anchor)
}
