import { App, PluginSettingTab, Setting, normalizePath } from 'obsidian';

import type { ExerciseRegistryEntry } from './exercise-registry';
import type FitKitPlugin from './main';
import { dashboardPath, exercisesFolder, workoutsFolder } from './settings-paths';

export { dashboardPath, exercisesFolder, workoutFilename, workoutsFolder } from './settings-paths';

export interface FitKitSettings {
  fitnessRoot: string;
  journalFolder: string;
  autoCreateMissingExercises: boolean;
  autoUpdateDashboard: boolean;
  autosaveDebounceMs: number;
  exerciseRegistry: ExerciseRegistryEntry[];
  hiddenDashboardSectionsByPath: Record<string, string[]>;
  schemaVersion: 1;
}

export const DEFAULT_SETTINGS: FitKitSettings = {
  fitnessRoot: 'Fitness',
  journalFolder: '',
  autoCreateMissingExercises: false,
  autoUpdateDashboard: true,
  autosaveDebounceMs: 600,
  exerciseRegistry: [],
  hiddenDashboardSectionsByPath: {},
  schemaVersion: 1,
};

export class FitKitSettingTab extends PluginSettingTab {
  plugin: FitKitPlugin;

  constructor(app: App, plugin: FitKitPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.settings;

    new Setting(containerEl).setName('Paths').setHeading();

    new Setting(containerEl)
      .setName('Fitness root')
      .setDesc('Folder under the vault root where workouts, exercises, and the dashboard live.')
      .addText((text) =>
        text.setValue(settings.fitnessRoot).onChange(async (value) => {
          settings.fitnessRoot = normalizePath(value);
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName('Journal folder')
      .setDesc('Optional. Folder where rough journal notes live (used by the import command).')
      .addText((text) =>
        text.setValue(settings.journalFolder).onChange(async (value) => {
          settings.journalFolder = normalizePath(value);
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl('div', {
      text: 'Derived paths:',
      cls: 'setting-item-name',
    });
    containerEl.createEl('div', {
      text: `Workouts folder: ${workoutsFolder(settings)}`,
      cls: 'setting-item-description',
    });
    containerEl.createEl('div', {
      text: `Exercises folder: ${exercisesFolder(settings)}`,
      cls: 'setting-item-description',
    });
    containerEl.createEl('div', {
      text: `Dashboard: ${dashboardPath(settings)}`,
      cls: 'setting-item-description',
    });

    new Setting(containerEl).setName('Behavior').setHeading();

    new Setting(containerEl)
      .setName('Auto-create missing exercises')
      .setDesc(
        'When the importer or editor sees an unknown exercise, also create a stub note under <fitnessRoot>/Exercises/.',
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.autoCreateMissingExercises).onChange(async (value) => {
          settings.autoCreateMissingExercises = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Auto-update dashboard on save')
      .setDesc(
        'When a workout note is saved, refresh the index entry and regenerate the dashboard.',
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.autoUpdateDashboard).onChange(async (value) => {
          settings.autoUpdateDashboard = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Autosave debounce (ms)')
      .setDesc(
        'How long to wait after the last edit before persisting changes in the workout editor view.',
      )
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setValue(String(settings.autosaveDebounceMs)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          settings.autosaveDebounceMs = Number.isNaN(parsed) ? 600 : parsed;
          await this.plugin.saveSettings();
        });
      });
  }
}
