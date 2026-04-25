import { Plugin } from 'obsidian';

import { DEFAULT_SETTINGS, FitKitSettingTab, type FitKitSettings } from './settings';

export default class FitKitPlugin extends Plugin {
  settings!: FitKitSettings;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new FitKitSettingTab(this.app, this));
  }

  onunload(): void {
    /* Phase 4 will add teardown for the editor view. */
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<FitKitSettings> | null;
    if (stored && stored.schemaVersion !== DEFAULT_SETTINGS.schemaVersion) {
      this.settings = { ...DEFAULT_SETTINGS };
      await this.saveSettings();
      return;
    }
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
