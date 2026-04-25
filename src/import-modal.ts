import type { App } from 'obsidian';
import { Modal, Notice, TFile, normalizePath } from 'obsidian';

import { regenerateDashboard } from './dashboard';
import type { ExerciseKind, ExerciseRegistryEntry } from './exercise-registry';
import { createRegistry, normalize, resolve, upsertEntry } from './exercise-registry';
import type { ExerciseRegistry } from './exercise-registry';
import { rebuildIndex, updateIndexEntry } from './index';
import type { ParsedExercise, ParsedJournal } from './journal-grammar';
import { parseJournal } from './journal-grammar';
import type FitKitPlugin from './main';
import { exercisesFolder, workoutFilename, workoutsFolder } from './settings-paths';
import type { CanonicalExercise, CanonicalWorkout } from './workout-note-serializer';
import { serializeWorkout } from './workout-note-serializer';

type MappingChoice =
  | { kind: 'resolved'; canonicalName: string }
  | { kind: 'create-new'; canonicalName: string; exerciseKind: ExerciseKind }
  | { kind: 'unresolved' };

type MappingState = Map<string, MappingChoice>;

interface ImportModalOptions {
  initialInput: string;
  readOnly: boolean;
  defaultFilenameDate: string;
}

export class ImportModal extends Modal {
  private plugin: FitKitPlugin;
  private registry: ExerciseRegistry = createRegistry();
  private rawInput: string;
  private readOnly: boolean;
  private defaultFilenameDate: string;
  private parsed: ParsedJournal;
  private mapping: MappingState = new Map();
  private targetPath: string;
  private createMissing: boolean;

  private contentWrapper: HTMLElement | null = null;
  private rawTextarea: HTMLTextAreaElement | null = null;
  private previewEl: HTMLElement | null = null;
  private warningsEl: HTMLElement | null = null;
  private mappingEl: HTMLElement | null = null;
  private targetInput: HTMLInputElement | null = null;
  private createMissingInput: HTMLInputElement | null = null;

  constructor(plugin: FitKitPlugin, options: ImportModalOptions) {
    super(plugin.app);
    this.plugin = plugin;
    this.rawInput = options.initialInput;
    this.readOnly = options.readOnly;
    this.defaultFilenameDate = options.defaultFilenameDate;
    this.parsed = parseJournal(this.rawInput);
    this.targetPath = this.defaultTargetPath();
    this.createMissing = this.plugin.settings.autoCreateMissingExercises;
  }

  onOpen(): void {
    this.registry = createRegistry(this.plugin.settings.exerciseRegistry);

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fitkit-import-modal');
    contentEl.createEl('h2', { text: 'Journal import preview' });

    const panes = contentEl.createDiv({ cls: 'fitkit-import-panes' });
    const left = panes.createDiv({ cls: 'fitkit-import-pane fitkit-import-pane-left' });
    const right = panes.createDiv({ cls: 'fitkit-import-pane fitkit-import-pane-right' });

    left.createEl('div', { text: 'Raw journal input', cls: 'fitkit-import-pane-label' });
    const textarea = left.createEl('textarea', { cls: 'fitkit-import-raw-textarea' });
    textarea.value = this.rawInput;
    textarea.readOnly = this.readOnly;
    textarea.rows = 20;
    textarea.addEventListener('input', () => {
      this.rawInput = textarea.value;
      this.recompute();
    });
    this.rawTextarea = textarea;

    right.createEl('div', { text: 'Canonical workout preview', cls: 'fitkit-import-pane-label' });
    const preview = right.createEl('pre', { cls: 'fitkit-import-preview' });
    this.previewEl = preview;

    this.contentWrapper = contentEl.createDiv({ cls: 'fitkit-import-below' });

    const targetRow = this.contentWrapper.createDiv({
      cls: 'fitkit-import-section fitkit-import-target-row',
    });
    targetRow.createEl('label', { text: 'Target path', cls: 'fitkit-import-target-label' });
    const targetInput = targetRow.createEl('input', {
      type: 'text',
      cls: 'fitkit-import-target-input',
    });
    targetInput.value = this.targetPath;
    targetInput.addEventListener('input', () => {
      this.targetPath = targetInput.value.trim();
      this.renderPreview();
    });
    this.targetInput = targetInput;

    const warningsSection = this.contentWrapper.createDiv({ cls: 'fitkit-import-section' });
    warningsSection.createEl('h3', { text: 'Warnings' });
    this.warningsEl = warningsSection.createDiv({ cls: 'fitkit-import-warnings' });

    const mappingSection = this.contentWrapper.createDiv({ cls: 'fitkit-import-section' });
    mappingSection.createEl('h3', { text: 'Exercise mapping' });
    this.mappingEl = mappingSection.createDiv({ cls: 'fitkit-import-mapping' });

    const checkboxRow = this.contentWrapper.createDiv({
      cls: 'fitkit-import-section fitkit-import-checkbox-row',
    });
    const createMissingInput = checkboxRow.createEl('input', { type: 'checkbox' });
    createMissingInput.checked = this.createMissing;
    createMissingInput.addEventListener('change', () => {
      this.createMissing = createMissingInput.checked;
    });
    checkboxRow.createEl('label', {
      text: 'Also create missing exercise notes in the exercises folder',
    });
    this.createMissingInput = createMissingInput;

    const actions = this.contentWrapper.createDiv({ cls: 'fitkit-import-actions' });
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'fitkit-btn' });
    cancelBtn.addEventListener('click', () => this.close());
    const confirmBtn = actions.createEl('button', {
      text: 'Import',
      cls: 'fitkit-btn fitkit-btn-primary',
    });
    confirmBtn.addEventListener('click', () => void this.handleConfirm(false));

    this.recompute();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private defaultTargetPath(): string {
    return normalizePath(
      `${workoutsFolder(this.plugin.settings)}/${workoutFilename(this.defaultFilenameDate)}`,
    );
  }

  private recompute(): void {
    this.parsed = parseJournal(this.rawInput);
    this.syncMappingWithParsed();
    this.renderMapping();
    this.renderWarnings();
    this.renderPreview();
  }

  private syncMappingWithParsed(): void {
    const seen = new Set<string>();
    for (const exercise of this.parsed.exercises) {
      const key = normalize(exercise.rawName);
      seen.add(key);
      if (this.mapping.has(key)) {
        continue;
      }
      const resolution = resolve(this.registry, exercise.rawName);
      if (resolution.kind === 'match') {
        this.mapping.set(key, { kind: 'resolved', canonicalName: resolution.entry.name });
      } else {
        this.mapping.set(key, { kind: 'unresolved' });
      }
    }
    for (const key of [...this.mapping.keys()]) {
      if (!seen.has(key)) {
        this.mapping.delete(key);
      }
    }
  }

  private renderMapping(): void {
    if (!this.mappingEl) {
      return;
    }
    this.mappingEl.empty();
    if (this.parsed.exercises.length === 0) {
      this.mappingEl.createEl('div', {
        text: 'No exercises parsed yet.',
        cls: 'fitkit-import-muted',
      });
      return;
    }

    const table = this.mappingEl.createEl('table', { cls: 'fitkit-import-table' });
    const header = table.createEl('tr');
    header.createEl('th', { text: 'Raw name' });
    header.createEl('th', { text: 'Status' });
    header.createEl('th', { text: 'Resolution' });

    const rawKeys = new Set<string>();
    for (const exercise of this.parsed.exercises) {
      const key = normalize(exercise.rawName);
      if (rawKeys.has(key)) {
        continue;
      }
      rawKeys.add(key);
      this.renderMappingRow(table, exercise);
    }
  }

  private renderMappingRow(table: HTMLElement, exercise: ParsedExercise): void {
    const row = table.createEl('tr');
    row.createEl('td', { text: exercise.rawName });

    const key = normalize(exercise.rawName);
    const resolution = resolve(this.registry, exercise.rawName);
    const choice = this.mapping.get(key);

    const statusCell = row.createEl('td');
    const select = row.createEl('td').createEl('select', { cls: 'fitkit-import-select' });

    const optionUnresolved = document.createElement('option');
    optionUnresolved.value = '__unresolved__';
    optionUnresolved.text = '(unresolved)';
    select.appendChild(optionUnresolved);

    const candidateEntries: ExerciseRegistryEntry[] =
      resolution.kind === 'ambiguous'
        ? resolution.candidates
        : resolution.kind === 'match'
          ? [resolution.entry]
          : [];

    for (const entry of this.registry.entries) {
      const option = document.createElement('option');
      option.value = `existing:${entry.name}`;
      option.text = `${entry.name} (${entry.kind})`;
      select.appendChild(option);
    }

    const createStrengthOption = document.createElement('option');
    createStrengthOption.value = 'create-strength';
    createStrengthOption.text = `Create new (strength): ${exercise.rawName}`;
    select.appendChild(createStrengthOption);
    const createDurationOption = document.createElement('option');
    createDurationOption.value = 'create-duration';
    createDurationOption.text = `Create new (duration): ${exercise.rawName}`;
    select.appendChild(createDurationOption);

    if (choice && choice.kind === 'resolved') {
      select.value = `existing:${choice.canonicalName}`;
    } else if (choice && choice.kind === 'create-new') {
      select.value = choice.exerciseKind === 'duration' ? 'create-duration' : 'create-strength';
    } else {
      select.value = '__unresolved__';
    }

    if (resolution.kind === 'match' && choice && choice.kind === 'resolved') {
      statusCell.setText('Matched');
      statusCell.addClass('fitkit-import-status-match');
    } else if (resolution.kind === 'ambiguous') {
      statusCell.setText(`Ambiguous (${candidateEntries.length})`);
      statusCell.addClass('fitkit-import-status-ambiguous');
    } else if (resolution.kind === 'match') {
      statusCell.setText('Matched');
    } else {
      statusCell.setText('Unknown');
      statusCell.addClass('fitkit-import-status-unknown');
    }

    select.addEventListener('change', () => {
      void this.handleMappingSelection(exercise, select.value);
    });
  }

  private async handleMappingSelection(exercise: ParsedExercise, value: string): Promise<void> {
    const key = normalize(exercise.rawName);
    if (value === '__unresolved__') {
      this.mapping.set(key, { kind: 'unresolved' });
    } else if (value === 'create-strength' || value === 'create-duration') {
      const exerciseKind: ExerciseKind = value === 'create-duration' ? 'duration' : 'strength';
      this.mapping.set(key, {
        kind: 'create-new',
        canonicalName: exercise.rawName,
        exerciseKind,
      });
      await this.upsertRegistryEntry({
        name: exercise.rawName,
        kind: exerciseKind,
        aliases: [],
      });
    } else if (value.startsWith('existing:')) {
      const name = value.slice('existing:'.length);
      this.mapping.set(key, { kind: 'resolved', canonicalName: name });
      await this.persistAliasForExistingEntry(name, exercise.rawName);
    }
    this.renderWarnings();
    this.renderPreview();
  }

  private async persistAliasForExistingEntry(name: string, rawName: string): Promise<void> {
    const entry = this.registry.entries.find((candidate) => candidate.name === name);
    if (!entry) {
      return;
    }
    const rawKey = normalize(rawName);
    const knownKeys = new Set([entry.name, ...entry.aliases].map((value) => normalize(value)));
    if (knownKeys.has(rawKey)) {
      return;
    }
    await this.upsertRegistryEntry({
      ...entry,
      aliases: [...entry.aliases, rawName],
    });
  }

  private async upsertRegistryEntry(entry: ExerciseRegistryEntry): Promise<void> {
    this.registry = upsertEntry(this.registry, entry);
    this.plugin.settings.exerciseRegistry = this.registry.entries;
    await this.plugin.saveSettings();
  }

  private renderWarnings(): void {
    if (!this.warningsEl) {
      return;
    }
    this.warningsEl.empty();
    const warnings = this.parsed.warnings;
    const unresolvedNames = this.unresolvedExerciseNames();
    if (warnings.length === 0 && unresolvedNames.length === 0) {
      this.warningsEl.createEl('div', { text: 'No warnings.', cls: 'fitkit-import-muted' });
      return;
    }
    if (unresolvedNames.length > 0) {
      const group = this.warningsEl.createDiv({ cls: 'fitkit-import-warning-group' });
      group.createEl('div', { text: 'Exercise mapping', cls: 'fitkit-import-warning-heading' });
      const ul = group.createEl('ul');
      for (const name of unresolvedNames) {
        ul.createEl('li', {
          text: `"${name}" is not resolved. Choose an existing exercise or create a new one.`,
        });
      }
    }
    const groups = new Map<string, typeof warnings>();
    for (const warning of warnings) {
      const key = warning.exerciseRawName ?? '(workout-level)';
      const list = groups.get(key) ?? [];
      list.push(warning);
      groups.set(key, list);
    }
    for (const [heading, list] of groups.entries()) {
      const group = this.warningsEl.createDiv({ cls: 'fitkit-import-warning-group' });
      group.createEl('div', { text: heading, cls: 'fitkit-import-warning-heading' });
      const ul = group.createEl('ul');
      for (const warning of list) {
        const li = ul.createEl('li');
        li.createEl('code', { text: warning.sourceLine });
        li.createSpan({ text: `, ${warning.message} (line ${warning.lineNumber})` });
      }
    }
  }

  private unresolvedExerciseNames(): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const exercise of this.parsed.exercises) {
      const key = normalize(exercise.rawName);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const choice = this.mapping.get(key);
      if (!choice || choice.kind === 'unresolved') {
        names.push(exercise.rawName);
      }
    }
    return names;
  }

  private buildCanonical(): { workout: CanonicalWorkout | null; unresolvedCount: number } {
    let unresolvedCount = 0;
    const exercises: CanonicalExercise[] = [];
    for (const exercise of this.parsed.exercises) {
      const key = normalize(exercise.rawName);
      const choice = this.mapping.get(key);
      let canonicalName: string | null = null;
      if (choice && choice.kind === 'resolved') {
        canonicalName = choice.canonicalName;
      } else if (choice && choice.kind === 'create-new') {
        canonicalName = choice.canonicalName;
      } else {
        unresolvedCount += 1;
      }
      if (!canonicalName) {
        continue;
      }
      exercises.push({
        canonicalName,
        note: exercise.note,
        rows: [...exercise.rows],
      });
    }
    const workoutDate = this.deriveDateFromPath(this.targetPath);
    if (!workoutDate) {
      return { workout: null, unresolvedCount };
    }
    const workout: CanonicalWorkout = {
      name: this.parsed.name,
      date: workoutDate,
      exercises,
    };
    return { workout, unresolvedCount };
  }

  private renderPreview(): void {
    if (!this.previewEl) {
      return;
    }
    const { workout, unresolvedCount } = this.buildCanonical();
    if (!workout) {
      this.previewEl.setText('Preview unavailable until target filename includes a date.');
      return;
    }
    let text = serializeWorkout(workout);
    if (unresolvedCount > 0) {
      text = `# ${unresolvedCount} exercise${
        unresolvedCount === 1 ? '' : 's'
      } still unresolved. Use the mapping above.\n\n${text}`;
    }
    this.previewEl.setText(text);
  }

  private deriveDateFromPath(path: string): string | null {
    const match = path.match(/(\d{4}-\d{2}-\d{2})\.md$/);
    if (match) {
      return match[1] ?? null;
    }
    const dateOnly = path.match(/(\d{4}-\d{2}-\d{2})/);
    return dateOnly ? (dateOnly[1] ?? null) : null;
  }

  private async handleConfirm(overwrite: boolean): Promise<void> {
    const { workout, unresolvedCount } = this.buildCanonical();
    if (!workout) {
      new Notice('Target filename must contain a yyyy-mm-dd date.');
      return;
    }
    if (unresolvedCount > 0) {
      new Notice(`${unresolvedCount} exercise(s) still unresolved.`);
      return;
    }

    await this.persistNewEntries();

    const serialized = serializeWorkout(workout);
    const targetPath = normalizePath(this.targetPath);
    const existing = this.plugin.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof TFile && !overwrite) {
      const confirm = await confirmOverwrite(this.plugin.app, targetPath);
      if (!confirm) {
        return;
      }
      await this.plugin.app.vault.modify(existing, serialized);
    } else if (existing instanceof TFile && overwrite) {
      await this.plugin.app.vault.modify(existing, serialized);
    } else {
      await ensureParentFolder(this.plugin.app, targetPath);
      await this.plugin.app.vault.create(targetPath, serialized);
    }

    if (this.createMissing) {
      await this.createMissingExerciseNotes();
    }
    await this.updateDashboardAfterImport(targetPath);

    new Notice(`Wrote ${targetPath}`);
    this.close();
  }

  private async persistNewEntries(): Promise<void> {
    for (const choice of this.mapping.values()) {
      if (choice.kind !== 'create-new') {
        continue;
      }
      const existing = this.registry.entries.find((entry) => entry.name === choice.canonicalName);
      if (existing) {
        continue;
      }
      await this.upsertRegistryEntry({
        name: choice.canonicalName,
        kind: choice.exerciseKind,
        aliases: [],
      });
    }
  }

  private async createMissingExerciseNotes(): Promise<void> {
    const folder = exercisesFolder(this.plugin.settings);
    for (const choice of this.mapping.values()) {
      if (choice.kind !== 'create-new') {
        continue;
      }
      const path = normalizePath(`${folder}/${choice.canonicalName}.md`);
      const existing = this.plugin.app.vault.getAbstractFileByPath(path);
      if (existing) {
        continue;
      }
      try {
        await ensureParentFolder(this.plugin.app, path);
        const placeholder = `---\ntype: exercise\nkind: ${choice.exerciseKind}\n---\n`;
        await this.plugin.app.vault.create(path, placeholder);
      } catch (error) {
        new Notice(`Could not create ${path}: ${formatError(error)}`);
      }
    }
  }

  private async updateDashboardAfterImport(targetPath: string): Promise<void> {
    if (!this.plugin.settings.autoUpdateDashboard) {
      return;
    }
    try {
      if (this.plugin.cachedIndex === null) {
        this.plugin.cachedIndex = await rebuildIndex(this.plugin.app, this.plugin.settings);
      } else {
        this.plugin.cachedIndex = await updateIndexEntry(
          this.plugin.app,
          this.plugin.settings,
          this.plugin.cachedIndex,
          targetPath,
        );
      }
      this.plugin.lastDiagnostics = this.plugin.cachedIndex.diagnostics;
      await regenerateDashboard(this.plugin.app, this.plugin.settings, this.plugin.cachedIndex);
    } catch (error) {
      new Notice(`Dashboard update failed: ${formatError(error)}`);
    }
  }
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function confirmOverwrite(app: App, targetPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmOverwriteModal(app, targetPath, resolve).open();
  });
}

class ConfirmOverwriteModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private targetPath: string,
    private resolveChoice: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fitkit-kind-confirm-modal');
    contentEl.createEl('h2', { text: 'Overwrite workout?' });
    contentEl.createEl('p', {
      text: `File ${this.targetPath} already exists. Overwrite it?`,
    });

    const actions = contentEl.createDiv({ cls: 'fitkit-confirm-actions' });
    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Cancel' });
    cancel.addEventListener('click', () => this.finish(false));
    const confirm = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-destructive-button',
      text: 'Overwrite',
    });
    confirm.addEventListener('click', () => this.finish(true));
  }

  onClose(): void {
    this.resolve(false);
    this.contentEl.empty();
  }

  private finish(confirmed: boolean): void {
    this.resolve(confirmed);
    this.close();
  }

  private resolve(confirmed: boolean): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.resolveChoice(confirmed);
  }
}
