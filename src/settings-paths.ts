export function normalizeFolder(s: string): string {
  return s.replace(/^\/+/, '').replace(/\/+$/, '')
}

/** Whether a vault path sits under `folder`, where a folder normalizing to empty is the vault root. */
export function isInFolder(path: string, folder: string): boolean {
  const normalized = normalizeFolder(folder)
  return normalized === '' || path.startsWith(`${normalized}/`)
}

export interface FitKitSettingsPathInput {
  fitnessRoot: string
}

export function workoutsFolder(s: FitKitSettingsPathInput): string {
  return `${normalizeFolder(s.fitnessRoot)}/Workouts`
}

export function exercisesFolder(s: FitKitSettingsPathInput): string {
  return `${normalizeFolder(s.fitnessRoot)}/Exercises`
}

export function dashboardPath(s: FitKitSettingsPathInput): string {
  return `${normalizeFolder(s.fitnessRoot)}/Fitness Dashboard.md`
}

export function workoutFilename(date: string): string {
  return `${date}.md`
}
