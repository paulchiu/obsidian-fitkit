import { describe, expect, it } from 'vitest';

import { dashboardPath, workoutFilename, workoutsFolder } from '../src/settings-paths';

describe('settings paths', () => {
  it('builds the workouts folder from the fitness root', () => {
    expect(workoutsFolder({ fitnessRoot: 'Fitness' })).toBe('Fitness/Workouts');
    expect(workoutsFolder({ fitnessRoot: 'Fitness/' })).toBe('Fitness/Workouts');
    expect(workoutsFolder({ fitnessRoot: '/Fitness' })).toBe('Fitness/Workouts');
    expect(workoutsFolder({ fitnessRoot: '/Fitness/' })).toBe('Fitness/Workouts');
    expect(workoutsFolder({ fitnessRoot: 'Areas/Fitness' })).toBe('Areas/Fitness/Workouts');
  });

  it('builds the dashboard path from the fitness root', () => {
    expect(dashboardPath({ fitnessRoot: 'Fitness' })).toBe('Fitness/Fitness Dashboard.md');
  });

  it('builds workout filenames from dates', () => {
    expect(workoutFilename('2026-04-19')).toBe('2026-04-19.md');
  });
});
