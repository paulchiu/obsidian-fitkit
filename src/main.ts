import { Notice, Plugin, normalizePath } from 'obsidian';

import type { FitKitIndex, IndexDiagnostic } from './index';
import { rebuildIndex } from './index';
import { regenerateDashboard } from './dashboard';
import { ParseDiagnosticsModal } from './parse-diagnostics-modal';
import { DEFAULT_SETTINGS, FitKitSettingTab, type FitKitSettings } from './settings';
import { dashboardPath } from './settings-paths';

export default class FitKitPlugin extends Plugin {
  settings!: FitKitSettings;
  cachedIndex: FitKitIndex | null = null;
  lastDiagnostics: IndexDiagnostic[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new FitKitSettingTab(this.app, this));

    this.addCommand({
      id: 'fitkit-rebuild-index',
      name: 'Rebuild index',
      callback: async () => {
        this.cachedIndex = await rebuildIndex(this.app, this.settings);
        this.lastDiagnostics = this.cachedIndex.diagnostics;
        new Notice(
          `Indexed ${this.cachedIndex.entries.length} workout(s)${
            this.lastDiagnostics.length ? `, ${this.lastDiagnostics.length} diagnostic(s)` : ''
          }.`,
        );
      },
    });

    this.addCommand({
      id: 'fitkit-rebuild-dashboard',
      name: 'Rebuild dashboard',
      callback: async () => {
        this.cachedIndex = await rebuildIndex(this.app, this.settings);
        this.lastDiagnostics = this.cachedIndex.diagnostics;
        const result = await regenerateDashboard(this.app, this.settings, this.cachedIndex);
        new Notice(`Dashboard rebuilt: ${result.sectionCount} section(s) at ${result.path}.`);
      },
    });

    this.addCommand({
      id: 'fitkit-restore-hidden-sections',
      name: 'Restore hidden sections in current dashboard',
      callback: async () => {
        const path = normalizePath(dashboardPath(this.settings));
        if (this.settings.hiddenDashboardSectionsByPath[path]) {
          delete this.settings.hiddenDashboardSectionsByPath[path];
          await this.saveSettings();
        }
        if (!this.cachedIndex) {
          this.cachedIndex = await rebuildIndex(this.app, this.settings);
        }
        const result = await regenerateDashboard(this.app, this.settings, this.cachedIndex);
        new Notice(`Restored hidden sections; ${result.sectionCount} section(s) now in dashboard.`);
      },
    });

    this.addCommand({
      id: 'fitkit-show-parse-diagnostics',
      name: 'Show parse diagnostics',
      callback: () => {
        if (this.lastDiagnostics.length === 0) {
          new Notice('No diagnostics from the last index build.');
          return;
        }
        new ParseDiagnosticsModal(this.app, this.lastDiagnostics).open();
      },
    });
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
