import { Notice, Plugin, TFile, normalizePath } from 'obsidian';

import type { FitKitIndex, IndexDiagnostic } from './index';
import { rebuildIndex } from './index';
import { regenerateDashboard } from './dashboard';
import { ParseDiagnosticsModal } from './parse-diagnostics-modal';
import { DEFAULT_SETTINGS, FitKitSettingTab, type FitKitSettings } from './settings';
import { dashboardPath, workoutFilename, workoutsFolder } from './settings-paths';
import { VIEW_TYPE_FITKIT_WORKOUT_EDITOR, WorkoutEditorView } from './workout-editor-view';

function formatTodayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function emptyWorkoutMarkdown(date: string): string {
  return `---\ntype: workout\ndate: ${date}\nname: \n---\n`;
}

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

    this.registerView(VIEW_TYPE_FITKIT_WORKOUT_EDITOR, (leaf) => new WorkoutEditorView(leaf, this));

    this.addCommand({
      id: 'fitkit-open-todays-workout',
      name: "Open today's workout",
      callback: async () => {
        const today = formatTodayIsoDate();
        const path = `${workoutsFolder(this.settings)}/${workoutFilename(today)}`;
        let file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          const folder = workoutsFolder(this.settings);
          const folderEntry = this.app.vault.getAbstractFileByPath(folder);
          if (!folderEntry) {
            await this.app.vault.createFolder(folder).catch(() => undefined);
          }
          file = await this.app.vault.create(path, emptyWorkoutMarkdown(today));
        }
        if (file instanceof TFile) {
          await this.openWorkoutEditor(file);
        }
      },
    });

    this.addCommand({
      id: 'fitkit-open-workout-editor',
      name: 'Open workout editor for current file',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const ok = file instanceof TFile && file.extension.toLowerCase() === 'md';
        if (!ok) {
          return false;
        }
        if (!checking && file) {
          void this.openWorkoutEditor(file);
        }
        return true;
      },
    });
  }

  /* eslint-disable-next-line obsidianmd/detach-leaves */
  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_FITKIT_WORKOUT_EDITOR);
  }

  private async openWorkoutEditor(file: TFile): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_FITKIT_WORKOUT_EDITOR)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
    }
    await leaf.setViewState({ type: VIEW_TYPE_FITKIT_WORKOUT_EDITOR, active: true });
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof WorkoutEditorView) {
      await view.loadFile(file);
    }
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
