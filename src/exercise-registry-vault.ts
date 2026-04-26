import type { App } from 'obsidian'

import { bootstrapFromStems, mergeRegistries } from './exercise-registry'
import type { ExerciseRegistryEntry } from './exercise-registry'
import type { FitKitSettings } from './settings'
import { exercisesFolder } from './settings-paths'

export function exerciseRegistryWithVaultNotes(
  app: App,
  settings: FitKitSettings,
): ExerciseRegistryEntry[] {
  const folder = exercisesFolder(settings)
  const stems = app.vault
    .getMarkdownFiles()
    .filter((file) => file.path.startsWith(`${folder}/`))
    .map((file) => file.basename)
  const fresh = bootstrapFromStems(stems)
  return mergeRegistries(settings.exerciseRegistry, fresh.entries)
}
