import { normalize } from './exercise-registry'

export function filterSuggestableNames(
  names: string[],
  deletedExercises: string[],
  registryKeys: Set<string>,
): string[] {
  const deletedKeys = new Set(deletedExercises.map((name) => normalize(name)))
  const savedKeys = new Set([...registryKeys].map((name) => normalize(name)))
  const seen = new Set<string>()
  const suggestions: string[] = []

  for (const name of names) {
    const key = normalize(name)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    if (deletedKeys.has(key) && !savedKeys.has(key)) {
      continue
    }

    suggestions.push(name)
  }

  return suggestions
}
