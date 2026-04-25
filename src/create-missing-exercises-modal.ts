import type { App } from 'obsidian';
import { Modal, Notice, TFile, normalizePath } from 'obsidian';

import type { ExerciseKind, ExerciseRegistry } from './exercise-registry';
import { createRegistry, resolve, upsertEntry } from './exercise-registry';
import type FitKitPlugin from './main';
import { exercisesFolder } from './settings-paths';
import type { ExerciseEntry, WorkoutNoteModel } from './workout-note-model';

type Row = {
  rawName: string;
  kind: ExerciseKind;
  inRegistry: boolean;
  noteExists: boolean;
  createEntry: boolean;
  createNote: boolean;
};

export class CreateMissingExercisesModal extends Modal {
  private plugin: FitKitPlugin;
  private registry: ExerciseRegistry;
  private rows: Row[];
  private fileTitle: string;

  constructor(plugin: FitKitPlugin, model: WorkoutNoteModel) {
    super(plugin.app);
    this.plugin = plugin;
    this.registry = createRegistry(plugin.settings.exerciseRegistry);
    this.fileTitle = model.sourcePath;
    this.rows = dedupeExercises(model.exercises).map((exercise) => this.buildRow(exercise));
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fitkit-import-modal');
    contentEl.createEl('h2', { text: 'Create missing exercises' });
    contentEl.createEl('p', {
      text: `"${this.fileTitle}" is already a workout note. Review its exercises and create any missing registry entries or exercise note files.`,
      cls: 'fitkit-import-muted',
    });

    if (this.rows.length === 0) {
      contentEl.createEl('div', {
        text: 'No exercises found in this workout.',
        cls: 'fitkit-import-muted',
      });
    } else {
      const table = contentEl.createEl('table', { cls: 'fitkit-import-table' });
      const header = table.createEl('tr');
      header.createEl('th', { text: 'Exercise' });
      header.createEl('th', { text: 'Registry' });
      header.createEl('th', { text: 'Kind' });
      header.createEl('th', { text: 'Note file' });
      for (const row of this.rows) {
        this.renderRow(table, row);
      }
    }

    const actions = contentEl.createDiv({ cls: 'fitkit-import-actions' });
    const cancel = actions.createEl('button', { text: 'Cancel', cls: 'fitkit-btn' });
    cancel.addEventListener('click', () => this.close());
    const apply = actions.createEl('button', {
      text: 'Apply',
      cls: 'fitkit-btn fitkit-btn-primary',
    });
    apply.addEventListener('click', () => void this.handleApply());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private buildRow(exercise: ExerciseEntry): Row {
    const resolution = resolve(this.registry, exercise.exerciseName);
    const inRegistry = resolution.kind === 'match';
    const kind: ExerciseKind = resolution.kind === 'match' ? resolution.entry.kind : exercise.kind;
    const notePath = normalizePath(
      `${exercisesFolder(this.plugin.settings)}/${exercise.exerciseName}.md`,
    );
    const noteExists = this.plugin.app.vault.getAbstractFileByPath(notePath) instanceof TFile;
    return {
      rawName: exercise.exerciseName,
      kind,
      inRegistry,
      noteExists,
      createEntry: !inRegistry,
      createNote: !noteExists,
    };
  }

  private renderRow(table: HTMLElement, row: Row): void {
    const tr = table.createEl('tr');
    tr.createEl('td', { text: row.rawName });

    const regCell = tr.createEl('td');
    if (row.inRegistry) {
      regCell.setText('Matched');
      regCell.addClass('fitkit-import-status-match');
    } else {
      const wrapper = regCell.createDiv({ cls: 'fitkit-import-checkbox-row' });
      const checkbox = wrapper.createEl('input', { type: 'checkbox' });
      checkbox.checked = row.createEntry;
      checkbox.addEventListener('change', () => {
        row.createEntry = checkbox.checked;
      });
      wrapper.createEl('label', { text: 'Create entry' });
      regCell.addClass('fitkit-import-status-unknown');
    }

    const kindCell = tr.createEl('td');
    if (row.inRegistry) {
      kindCell.setText(row.kind);
    } else {
      const select = kindCell.createEl('select', { cls: 'fitkit-import-select' });
      const strengthOption = document.createElement('option');
      strengthOption.value = 'strength';
      strengthOption.text = 'strength';
      select.appendChild(strengthOption);
      const durationOption = document.createElement('option');
      durationOption.value = 'duration';
      durationOption.text = 'duration';
      select.appendChild(durationOption);
      select.value = row.kind;
      select.addEventListener('change', () => {
        row.kind = select.value === 'duration' ? 'duration' : 'strength';
      });
    }

    const noteCell = tr.createEl('td');
    if (row.noteExists) {
      noteCell.setText('Exists');
      noteCell.addClass('fitkit-import-status-match');
    } else {
      const wrapper = noteCell.createDiv({ cls: 'fitkit-import-checkbox-row' });
      const checkbox = wrapper.createEl('input', { type: 'checkbox' });
      checkbox.checked = row.createNote;
      checkbox.addEventListener('change', () => {
        row.createNote = checkbox.checked;
      });
      wrapper.createEl('label', { text: 'Create note' });
      noteCell.addClass('fitkit-import-status-unknown');
    }
  }

  private async handleApply(): Promise<void> {
    let entriesAdded = 0;
    let notesAdded = 0;
    let registryChanged = false;

    for (const row of this.rows) {
      if (row.inRegistry || !row.createEntry) {
        continue;
      }
      this.registry = upsertEntry(this.registry, {
        name: row.rawName,
        kind: row.kind,
        aliases: [],
      });
      registryChanged = true;
      entriesAdded += 1;
    }
    if (registryChanged) {
      this.plugin.settings.exerciseRegistry = this.registry.entries;
      await this.plugin.saveSettings();
    }

    const folder = exercisesFolder(this.plugin.settings);
    for (const row of this.rows) {
      if (row.noteExists || !row.createNote) {
        continue;
      }
      const path = normalizePath(`${folder}/${row.rawName}.md`);
      if (this.plugin.app.vault.getAbstractFileByPath(path)) {
        continue;
      }
      await ensureParentFolder(this.plugin.app, path);
      const placeholder = `---\ntype: exercise\nkind: ${row.kind}\n---\n`;
      await this.plugin.app.vault.create(path, placeholder);
      notesAdded += 1;
    }

    new Notice(`Added ${entriesAdded} registry entry(ies), ${notesAdded} note file(s).`);
    this.close();
  }
}

function dedupeExercises(exercises: ExerciseEntry[]): ExerciseEntry[] {
  const byName = new Map<string, ExerciseEntry>();
  for (const exercise of exercises) {
    if (!byName.has(exercise.exerciseName)) {
      byName.set(exercise.exerciseName, exercise);
    }
  }
  return [...byName.values()];
}

async function ensureParentFolder(app: App, path: string): Promise<void> {
  const parent = path.split('/').slice(0, -1).join('/');
  if (!parent) {
    return;
  }
  const existing = app.vault.getAbstractFileByPath(parent);
  if (existing) {
    return;
  }
  await app.vault.createFolder(parent);
}
