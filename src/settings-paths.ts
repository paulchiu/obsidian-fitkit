export function normalizeFolder(s: string): string {
  return s.replace(/^\/+/, '').replace(/\/+$/, '');
}

export interface FitKitSettingsPathInput {
  fitnessRoot: string;
}

export function workoutsFolder(s: FitKitSettingsPathInput): string {
  return `${normalizeFolder(s.fitnessRoot)}/Workouts`;
}

export function exercisesFolder(s: FitKitSettingsPathInput): string {
  return `${normalizeFolder(s.fitnessRoot)}/Exercises`;
}

export function dashboardPath(s: FitKitSettingsPathInput): string {
  return `${normalizeFolder(s.fitnessRoot)}/Fitness Dashboard.md`;
}

export function workoutFilename(date: string): string {
  return `${date}.md`;
}
