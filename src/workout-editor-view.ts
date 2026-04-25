import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import { ItemView, Modal, Notice, SuggestModal } from 'obsidian';

import { FileSession } from './file-session';
import type FitKitPlugin from './main';
import { exercisesFolder, workoutsFolder } from './settings-paths';
import {
  parseWorkoutNote,
  serializeWorkoutNote,
  type DurationEntry,
  type ExerciseEntry,
  type ExerciseKind,
  type PreserveBlock,
  type StrengthSet,
  type WorkoutNoteModel,
} from './workout-note-model';

export const VIEW_TYPE_FITKIT_WORKOUT_EDITOR = 'fitkit-workout-editor';

interface EditableStrengthSet {
  set?: number;
  weight?: number;
  reps?: number;
  note?: string;
}

interface EditableDurationEntry {
  set?: number;
  durationSeconds?: number;
  note?: string;
}

interface ExerciseCard {
  name: string;
  kind: ExerciseKind;
  exerciseNotes?: string;
  strengthSets: EditableStrengthSet[];
  durationEntries: EditableDurationEntry[];
}

interface EditorWorkoutModel {
  isFitKitWorkout: boolean;
  date: string;
  name: string;
  sourcePath: string;
  exercises: ExerciseCard[];
  preserveBlocks: PreserveBlock[];
}

export class WorkoutEditorView extends ItemView {
  private session: FileSession | null = null;
  private model: EditorWorkoutModel | null = null;
  private dirty = false;
  private conflictDetected = false;
  private resizeObserver: ResizeObserver | null = null;
  private autoSaveTimer: number | null = null;
  private autoSaveInflight = false;
  private autoSaveRequeued = false;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: FitKitPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_FITKIT_WORKOUT_EDITOR;
  }

  getDisplayText(): string {
    return this.session?.file.basename ?? 'Workout editor';
  }

  getIcon(): string {
    return 'dumbbell';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('fitkit-editor-root');
    this.resizeObserver = new ResizeObserver(() => this.updateNarrowState());
    this.resizeObserver.observe(this.contentEl);
    this.updateNarrowState();
    this.renderEmpty('Open a workout note to edit.');
  }

  async onClose(): Promise<void> {
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    await this.flushAutoSave();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.contentEl.empty();
    this.session = null;
    this.model = null;
  }

  private updateNarrowState(): void {
    this.contentEl.classList.toggle('is-narrow', this.contentEl.clientWidth < 600);
  }

  async loadFile(file: TFile): Promise<void> {
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    if (this.session && this.dirty && !this.conflictDetected) {
      await this.flushAutoSave();
    }
    this.session = new FileSession(this.app, file);
    const { model, isWorkout, warnings } = await this.session.load();
    this.model = toEditorWorkoutModel(model, isWorkout, file.path);
    this.dirty = false;
    this.conflictDetected = false;
    this.render();
    if (warnings.length > 0) {
      new Notice(`Loaded with ${warnings.length} parse warning(s).`);
    }
  }

  async reloadFromDisk(): Promise<void> {
    if (!this.session) {
      return;
    }
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    const { model, isWorkout } = await this.session.load();
    this.model = toEditorWorkoutModel(model, isWorkout, this.session.file.path);
    this.dirty = false;
    this.conflictDetected = false;
    this.render();
    new Notice('Reloaded from disk.');
  }

  private renderEmpty(message: string): void {
    this.contentEl.empty();
    const wrap = this.contentEl.createDiv({ cls: 'fitkit-empty' });
    wrap.setText(message);
  }

  private render(): void {
    if (!this.model || !this.session) {
      this.renderEmpty('No file loaded.');
      return;
    }
    this.contentEl.empty();
    const container = this.contentEl.createDiv({ cls: 'fitkit-container' });

    this.renderHeader(container);

    if (!this.model.isFitKitWorkout) {
      const warn = container.createDiv({ cls: 'fitkit-warn' });
      warn.setText(
        'This note has no `type: workout` frontmatter. The editor will not save changes here.',
      );
      return;
    }

    if (this.conflictDetected) {
      const banner = container.createDiv({ cls: 'fitkit-conflict' });
      banner.createSpan({
        text: 'File changed on disk. Reload to pick up external edits before continuing.',
      });
      const btn = banner.createEl('button', {
        cls: 'fitkit-btn fitkit-btn-warn',
        text: 'Reload from disk',
      });
      btn.addEventListener('click', () => void this.reloadFromDisk());
    }

    const list = container.createDiv({ cls: 'fitkit-exercise-list' });
    for (let i = 0; i < this.model.exercises.length; i++) {
      this.renderExerciseCard(list, i);
    }

    const footer = container.createDiv({ cls: 'fitkit-footer' });
    const addBtn = footer.createEl('button', { cls: 'fitkit-btn', text: 'Add exercise' });
    addBtn.addEventListener('click', () => void this.openAddExerciseModal());
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: 'fitkit-header' });
    const file = this.session?.file;
    header.createEl('h3', { cls: 'fitkit-file-title', text: file?.basename ?? 'Workout' });
    const meta = header.createDiv({ cls: 'fitkit-meta' });
    meta.setText(this.metaText());
  }

  private renderExerciseCard(list: HTMLElement, index: number): void {
    if (!this.model) {
      return;
    }
    const ex = this.model.exercises[index];
    if (!ex) {
      return;
    }

    const card = list.createDiv({ cls: 'fitkit-card' });

    const top = card.createDiv({ cls: 'fitkit-card-top' });
    const nameInput = top.createEl('input', {
      cls: 'fitkit-name-input',
      attr: { type: 'text' },
    });
    nameInput.value = ex.name;
    nameInput.addEventListener('input', () => {
      ex.name = nameInput.value;
      this.markDirty();
    });

    const kindWrap = top.createDiv({ cls: 'fitkit-kind-toggle' });
    const strengthBtn = kindWrap.createEl('button', {
      cls: `fitkit-btn fitkit-btn-muted${ex.kind === 'strength' ? ' is-active' : ''}`,
      text: 'Strength',
    });
    const durationBtn = kindWrap.createEl('button', {
      cls: `fitkit-btn fitkit-btn-muted${ex.kind === 'duration' ? ' is-active' : ''}`,
      text: 'Duration',
    });
    strengthBtn.addEventListener('click', () => void this.switchKind(index, 'strength'));
    durationBtn.addEventListener('click', () => void this.switchKind(index, 'duration'));

    const moveUp = top.createEl('button', { cls: 'fitkit-btn fitkit-btn-muted', text: 'Up' });
    moveUp.toggleAttribute('disabled', index === 0);
    moveUp.addEventListener('click', () => this.moveExercise(index, -1));
    const moveDown = top.createEl('button', { cls: 'fitkit-btn fitkit-btn-muted', text: 'Down' });
    moveDown.toggleAttribute('disabled', index === this.model.exercises.length - 1);
    moveDown.addEventListener('click', () => this.moveExercise(index, 1));
    const removeBtn = top.createEl('button', {
      cls: 'fitkit-btn fitkit-destructive-button',
      text: 'Remove',
    });
    removeBtn.addEventListener('click', () => this.removeExercise(index));

    const notesRow = card.createDiv({ cls: 'fitkit-field-row' });
    notesRow.createEl('label', { cls: 'fitkit-label', text: 'Exercise notes' });
    const notesArea = notesRow.createEl('textarea', { cls: 'fitkit-textarea' });
    notesArea.value = ex.exerciseNotes ?? '';
    notesArea.addEventListener('input', () => {
      ex.exerciseNotes = notesArea.value.length > 0 ? notesArea.value : undefined;
      this.markDirty();
    });

    if (ex.kind === 'strength') {
      this.renderStrengthTable(card, ex, index);
    } else {
      this.renderDurationTable(card, ex, index);
    }
  }

  private renderStrengthTable(card: HTMLElement, ex: ExerciseCard, exerciseIndex: number): void {
    const wrap = card.createDiv({ cls: 'fitkit-set-area' });

    const header = wrap.createDiv({ cls: 'fitkit-set-row fitkit-set-head' });
    header.createSpan({ cls: 'fitkit-set-label', text: 'Set' });
    header.createSpan({ cls: 'fitkit-set-label', text: 'Weight' });
    header.createSpan({ cls: 'fitkit-set-label', text: 'Reps' });
    header.createSpan({ cls: 'fitkit-set-label', text: 'Notes' });
    header.createSpan({ cls: 'fitkit-set-label', text: '' });

    for (let i = 0; i < ex.strengthSets.length; i++) {
      this.renderStrengthRow(wrap, ex, i);
    }

    const actions = wrap.createDiv({ cls: 'fitkit-row-actions' });
    const addBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Add set' });
    addBtn.addEventListener('click', () => {
      const nextNumber = ex.strengthSets.length + 1;
      ex.strengthSets.push({ set: nextNumber });
      this.markDirty();
      this.render();
      this.focusRowCell(exerciseIndex, ex.strengthSets.length - 1, 'Weight');
    });

    const dupBtn = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-muted',
      text: 'Duplicate last set',
    });
    dupBtn.toggleAttribute('disabled', ex.strengthSets.length === 0);
    dupBtn.addEventListener('click', () => {
      const last = ex.strengthSets[ex.strengthSets.length - 1];
      if (!last) {
        return;
      }
      const copy: EditableStrengthSet = { ...last, set: (last.set ?? ex.strengthSets.length) + 1 };
      ex.strengthSets.push(copy);
      this.markDirty();
      this.render();
      this.focusRowCell(exerciseIndex, ex.strengthSets.length - 1, 'Weight');
    });
  }

  private renderStrengthRow(wrap: HTMLElement, ex: ExerciseCard, i: number): void {
    const set = ex.strengthSets[i];
    if (!set) {
      return;
    }
    const row = wrap.createDiv({ cls: 'fitkit-set-row' });

    const setInput = this.createInputCell(row, 'Set', { type: 'number', inputmode: 'numeric' });
    setInput.value = set.set !== undefined ? String(set.set) : '';
    setInput.addEventListener('input', () => {
      set.set = parseNumberInput(setInput.value);
      this.markDirty();
    });

    const weightInput = this.createInputCell(row, 'Weight', {
      type: 'number',
      step: '0.1',
      inputmode: 'decimal',
    });
    weightInput.value = set.weight !== undefined ? String(set.weight) : '';
    weightInput.addEventListener('input', () => {
      set.weight = parseNumberInput(weightInput.value);
      this.markDirty();
    });

    const repsInput = this.createInputCell(row, 'Reps', { type: 'number', inputmode: 'numeric' });
    repsInput.value = set.reps !== undefined ? String(set.reps) : '';
    repsInput.addEventListener('input', () => {
      set.reps = parseNumberInput(repsInput.value);
      this.markDirty();
    });

    const notesInput = this.createInputCell(row, 'Notes', { type: 'text' });
    notesInput.value = set.note ?? '';
    notesInput.addEventListener('input', () => {
      set.note = notesInput.value.length > 0 ? notesInput.value : undefined;
      this.markDirty();
    });

    const actionCell = this.createCell(row, 'Actions', 'fitkit-action-cell');
    const rm = actionCell.createEl('button', {
      cls: 'fitkit-btn fitkit-destructive-button',
      text: 'X',
    });
    rm.addEventListener('click', () => {
      ex.strengthSets.splice(i, 1);
      this.markDirty();
      this.render();
    });
  }

  private renderDurationTable(card: HTMLElement, ex: ExerciseCard, exerciseIndex: number): void {
    const wrap = card.createDiv({ cls: 'fitkit-set-area' });

    const header = wrap.createDiv({ cls: 'fitkit-set-row fitkit-duration-row fitkit-set-head' });
    header.createSpan({ cls: 'fitkit-set-label', text: 'Duration (s)' });
    header.createSpan({ cls: 'fitkit-set-label', text: 'Notes' });
    header.createSpan({ cls: 'fitkit-set-label', text: '' });

    for (let i = 0; i < ex.durationEntries.length; i++) {
      this.renderDurationRow(wrap, ex, i);
    }

    const actions = wrap.createDiv({ cls: 'fitkit-row-actions' });
    const addBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Add duration entry' });
    addBtn.addEventListener('click', () => {
      ex.durationEntries.push({});
      this.markDirty();
      this.render();
      this.focusRowCell(exerciseIndex, ex.durationEntries.length - 1, 'Duration (s)');
    });
  }

  private renderDurationRow(wrap: HTMLElement, ex: ExerciseCard, i: number): void {
    const durationEntry = ex.durationEntries[i];
    if (!durationEntry) {
      return;
    }
    const row = wrap.createDiv({ cls: 'fitkit-set-row fitkit-duration-row' });

    const durationInput = this.createInputCell(row, 'Duration (s)', {
      type: 'number',
      step: '1',
      inputmode: 'numeric',
    });
    durationInput.value =
      durationEntry.durationSeconds !== undefined ? String(durationEntry.durationSeconds) : '';
    durationInput.addEventListener('input', () => {
      durationEntry.durationSeconds = parseNumberInput(durationInput.value);
      this.markDirty();
    });

    const notesInput = this.createInputCell(row, 'Notes', { type: 'text' });
    notesInput.value = durationEntry.note ?? '';
    notesInput.addEventListener('input', () => {
      durationEntry.note = notesInput.value.length > 0 ? notesInput.value : undefined;
      this.markDirty();
    });

    const actionCell = this.createCell(row, 'Actions', 'fitkit-action-cell');
    const rm = actionCell.createEl('button', {
      cls: 'fitkit-btn fitkit-destructive-button',
      text: 'X',
    });
    rm.addEventListener('click', () => {
      ex.durationEntries.splice(i, 1);
      this.markDirty();
      this.render();
    });
  }

  private async switchKind(index: number, nextKind: ExerciseKind): Promise<void> {
    if (!this.model) {
      return;
    }
    const ex = this.model.exercises[index];
    if (!ex || ex.kind === nextKind) {
      return;
    }
    const hadRows = hasRows(ex);
    const confirmed = await this.confirmKindSwitch(ex, nextKind);
    if (!confirmed) {
      return;
    }
    this.applyKindSwitch(index, nextKind, hadRows);
  }

  private async confirmKindSwitch(card: ExerciseCard, nextKind: ExerciseKind): Promise<boolean> {
    if (!hasRows(card)) {
      return true;
    }
    return new Promise((resolve) => {
      new ConfirmModal(
        this.app,
        {
          title: 'Switch exercise type?',
          message: `${card.name} has ${card.kind} rows. Switching to ${nextKind} will clear those rows from the editor.`,
          confirmText: 'Switch and discard',
          cancelText: 'Cancel',
        },
        resolve,
      ).open();
    });
  }

  private applyKindSwitch(index: number, nextKind: ExerciseKind, clearedRows: boolean): void {
    if (!this.model) {
      return;
    }
    const ex = this.model.exercises[index];
    if (!ex || ex.kind === nextKind) {
      return;
    }
    const previousKind = ex.kind;
    ex.kind = nextKind;
    ex.strengthSets = [];
    ex.durationEntries = [];
    this.markDirty();
    this.render();
    if (clearedRows) {
      new Notice(`Switched to ${nextKind}. Previous ${previousKind} rows were cleared.`);
    }
  }

  private createCell(row: HTMLElement, label: string, cls?: string): HTMLElement {
    const cell = row.createDiv({ cls: cls ? `fitkit-cell ${cls}` : 'fitkit-cell' });
    cell.dataset.label = label;
    return cell;
  }

  private createInputCell(
    row: HTMLElement,
    label: string,
    attr: Record<string, string>,
  ): HTMLInputElement {
    const cell = this.createCell(row, label);
    const input = cell.createEl('input', { cls: 'fitkit-input', attr });
    input.setAttr('aria-label', label);
    return input;
  }

  private focusRowCell(exerciseIndex: number, rowIndex: number, label: string): void {
    const cards = this.contentEl.querySelectorAll('.fitkit-exercise-list > .fitkit-card');
    const card = cards.item(exerciseIndex);
    if (!(card instanceof HTMLElement)) {
      return;
    }
    const rows = card.querySelectorAll('.fitkit-set-area > .fitkit-set-row:not(.fitkit-set-head)');
    const row = rows.item(rowIndex);
    if (!(row instanceof HTMLElement)) {
      return;
    }
    const selector = `.fitkit-cell[data-label="${label}"] input.fitkit-input`;
    const input = row.querySelector(selector);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }

  private moveExercise(index: number, delta: number): void {
    if (!this.model) {
      return;
    }
    const target = index + delta;
    if (target < 0 || target >= this.model.exercises.length) {
      return;
    }
    const arr = this.model.exercises;
    const a = arr[index];
    const b = arr[target];
    if (!a || !b) {
      return;
    }
    arr[index] = b;
    arr[target] = a;
    this.markDirty();
    this.render();
  }

  private removeExercise(index: number): void {
    if (!this.model) {
      return;
    }
    this.model.exercises.splice(index, 1);
    this.markDirty();
    this.render();
  }

  private async openAddExerciseModal(): Promise<void> {
    if (!this.model) {
      return;
    }
    const names = await this.collectExerciseSuggestions();
    new ExerciseSuggestModal(this.app, names, (name) => {
      const trimmed = name.trim();
      if (!trimmed || !this.model) {
        return;
      }
      const exerciseIndex = this.model.exercises.length;
      this.model.exercises.push({
        name: trimmed,
        kind: 'strength',
        strengthSets: [{ set: 1 }],
        durationEntries: [],
      });
      this.markDirty();
      this.render();
      this.focusRowCell(exerciseIndex, 0, 'Weight');
    }).open();
  }

  private async collectExerciseSuggestions(): Promise<string[]> {
    const names = new Set<string>();
    const files = this.app.vault.getMarkdownFiles();
    const exerciseFolder = exercisesFolder(this.plugin.settings);
    const workoutFolder = workoutsFolder(this.plugin.settings);

    for (const file of files) {
      if (isInFolder(file.path, exerciseFolder)) {
        names.add(file.basename);
      }
    }

    for (const file of files) {
      if (!isInFolder(file.path, workoutFolder)) {
        continue;
      }
      try {
        const text = await this.app.vault.cachedRead(file);
        const result = parseWorkoutNote(text, file.path);
        if (!result.isWorkout || !result.model) {
          continue;
        }
        for (const exercise of result.model.exercises) {
          names.add(exercise.exerciseName);
        }
      } catch {
        /** Suggestion-list collection should never break the editor; skip unreadable or unparseable files silently. */
        continue;
      }
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  private markDirty(): void {
    this.dirty = true;
    this.updateMetaText();
    this.scheduleAutoSave();
  }

  private metaText(): string {
    const parts: string[] = [];
    if (this.model?.date) {
      parts.push(`date: ${this.model.date}`);
    }
    if (this.model?.name) {
      parts.push(`name: ${this.model.name}`);
    }
    if (this.dirty) {
      parts.push('unsaved');
    }
    return parts.join(' | ');
  }

  private updateMetaText(): void {
    const meta = this.contentEl.querySelector('.fitkit-meta');
    if (!meta) {
      return;
    }
    (meta as HTMLElement).setText(this.metaText());
  }

  private scheduleAutoSave(): void {
    if (this.conflictDetected) {
      return;
    }
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
    }
    this.autoSaveTimer = window.setTimeout(() => {
      this.autoSaveTimer = null;
      void this.flushAutoSave();
    }, this.plugin.settings.autosaveDebounceMs);
  }

  private async flushAutoSave(): Promise<void> {
    if (!this.session || !this.model) {
      return;
    }
    if (!this.dirty || !this.model.isFitKitWorkout) {
      return;
    }
    if (this.conflictDetected) {
      return;
    }
    if (this.autoSaveInflight) {
      this.autoSaveRequeued = true;
      return;
    }
    this.autoSaveInflight = true;
    try {
      const nextText = serializeWorkoutNote(toWorkoutNoteModel(this.model));
      const result = await this.session.saveIfUnchanged(nextText);
      if (!result.ok) {
        this.conflictDetected = true;
        new Notice('File changed on disk. Reload before further edits.');
        this.render();
        return;
      }
      this.dirty = false;
      this.updateMetaText();
    } finally {
      this.autoSaveInflight = false;
      if (this.autoSaveRequeued) {
        this.autoSaveRequeued = false;
        this.scheduleAutoSave();
      }
    }
  }
}

function parseNumberInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const n = Number(trimmed);
  if (Number.isNaN(n)) {
    return undefined;
  }
  return n;
}

function hasRows(card: ExerciseCard): boolean {
  return card.strengthSets.length > 0 || card.durationEntries.length > 0;
}

function toEditorWorkoutModel(
  model: WorkoutNoteModel | null,
  isWorkout: boolean,
  sourcePath: string,
): EditorWorkoutModel {
  if (!model) {
    return {
      isFitKitWorkout: isWorkout,
      date: '',
      name: '',
      sourcePath,
      exercises: [],
      preserveBlocks: [],
    };
  }

  return {
    isFitKitWorkout: isWorkout,
    date: model.date,
    name: model.name,
    sourcePath: model.sourcePath,
    exercises: model.exercises.map(toEditorExercise),
    preserveBlocks: [...model.preserveBlocks],
  };
}

function toEditorExercise(exercise: ExerciseEntry): ExerciseCard {
  const card: ExerciseCard = {
    name: exercise.exerciseName,
    kind: exercise.kind,
    strengthSets: (exercise.strengthSets ?? []).map(toEditorStrengthSet),
    durationEntries: (exercise.durationEntries ?? []).map(toEditorDurationEntry),
  };
  if (exercise.note !== undefined) {
    card.exerciseNotes = exercise.note;
  }
  return card;
}

function toEditorStrengthSet(set: StrengthSet): EditableStrengthSet {
  const editable: EditableStrengthSet = {
    set: set.set,
    weight: set.weight,
    reps: set.reps,
  };
  if (set.note !== undefined) {
    editable.note = set.note;
  }
  return editable;
}

function toEditorDurationEntry(entry: DurationEntry): EditableDurationEntry {
  const editable: EditableDurationEntry = {
    durationSeconds: entry.durationSeconds,
  };
  if (entry.set !== undefined) {
    editable.set = entry.set;
  }
  if (entry.note !== undefined) {
    editable.note = entry.note;
  }
  return editable;
}

function toWorkoutNoteModel(model: EditorWorkoutModel): WorkoutNoteModel {
  return {
    date: model.date,
    name: model.name,
    sourcePath: model.sourcePath,
    exercises: model.exercises.map(toWorkoutExercise),
    preserveBlocks: [...model.preserveBlocks],
  };
}

function toWorkoutExercise(card: ExerciseCard): ExerciseEntry {
  const exercise: ExerciseEntry = {
    exerciseName: card.name,
    kind: card.kind,
  };
  if (card.exerciseNotes !== undefined) {
    exercise.note = card.exerciseNotes;
  }
  if (card.kind === 'strength') {
    exercise.strengthSets = card.strengthSets.map(toStrengthSet);
  } else {
    exercise.durationEntries = card.durationEntries.map(toDurationEntry);
  }
  return exercise;
}

function toStrengthSet(set: EditableStrengthSet, index: number): StrengthSet {
  const strengthSet: StrengthSet = {
    set: set.set ?? index + 1,
    weight: set.weight ?? 0,
    reps: set.reps ?? 0,
  };
  if (set.note !== undefined) {
    strengthSet.note = set.note;
  }
  return strengthSet;
}

function toDurationEntry(entry: EditableDurationEntry): DurationEntry {
  const durationEntry: DurationEntry = {
    durationSeconds: entry.durationSeconds ?? 0,
  };
  if (entry.set !== undefined) {
    durationEntry.set = entry.set;
  }
  if (entry.note !== undefined) {
    durationEntry.note = entry.note;
  }
  return durationEntry;
}

function isInFolder(path: string, folder: string): boolean {
  return path !== folder && path.startsWith(`${folder}/`);
}

interface ConfirmModalOptions {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
}

class ConfirmModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private options: ConfirmModalOptions,
    private resolveChoice: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fitkit-kind-confirm-modal');
    contentEl.createEl('h2', { text: this.options.title });
    contentEl.createEl('p', { text: this.options.message });

    const actions = contentEl.createDiv({ cls: 'fitkit-confirm-actions' });
    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: this.options.cancelText });
    cancel.addEventListener('click', () => this.finish(false));
    const confirm = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-destructive-button',
      text: this.options.confirmText,
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

type ExerciseChoice = {
  type: 'existing' | 'new';
  name: string;
};

class ExerciseSuggestModal extends SuggestModal<ExerciseChoice> {
  private handleEnterKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') {
      return;
    }
    const first = this.getSuggestions(this.inputEl.value)[0];
    if (!first) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.onPick(first.name);
    this.close();
  };

  constructor(
    app: App,
    private names: string[],
    private onPick: (name: string) => void,
  ) {
    super(app);
    this.setPlaceholder('Type an exercise name (or a new one) then press enter');
    this.emptyStateText = 'Type an exercise name to add it';
    this.limit = 20;
  }

  async onOpen(): Promise<void> {
    await super.onOpen();
    this.inputEl.addEventListener('keydown', this.handleEnterKeydown, true);
  }

  onClose(): void {
    this.inputEl.removeEventListener('keydown', this.handleEnterKeydown, true);
    super.onClose();
  }

  getSuggestions(query: string): ExerciseChoice[] {
    const trimmed = query.trim();
    const normalized = trimmed.toLocaleLowerCase();
    const exact = this.names.some((name) => name.toLocaleLowerCase() === normalized);
    const matches: ExerciseChoice[] = this.names
      .filter((name) => {
        if (!normalized) {
          return true;
        }
        return name.toLocaleLowerCase().includes(normalized);
      })
      .map((name) => ({ type: 'existing' as const, name }));
    if (trimmed && !exact) {
      matches.unshift({ type: 'new', name: trimmed });
    }
    return matches.slice(0, this.limit);
  }

  renderSuggestion(item: ExerciseChoice, el: HTMLElement): void {
    el.empty();
    el.createDiv({
      cls: item.type === 'new' ? 'fitkit-suggest-title is-new' : 'fitkit-suggest-title',
      text: item.type === 'new' ? `Add "${item.name}"` : item.name,
    });
    if (item.type === 'new') {
      el.createDiv({
        cls: 'fitkit-suggest-note',
        text: 'Creates a card only; no exercise note file is created.',
      });
    }
  }

  onChooseSuggestion(item: ExerciseChoice): void {
    this.onPick(item.name);
  }
}
