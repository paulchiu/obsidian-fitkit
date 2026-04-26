import type { TFile, WorkspaceLeaf } from 'obsidian'
import { ItemView, Menu, Notice, setIcon } from 'obsidian'

import { reorderArray } from '../domain/array-utils'
import {
  parseWorkoutNote,
  serializeWorkoutNote,
  type DurationEntry,
  type ExerciseEntry,
  type ExerciseKind,
  type PreserveBlock,
  type StrengthSet,
  type WorkoutNoteModel,
} from '../domain/workout-note-model'
import type FitKitPlugin from '../main'
import { exercisesFolder, workoutsFolder } from '../settings-paths'
import { FileSession } from '../vault/file-session'
import { ConfirmModal } from './confirm-modal'
import { ExerciseSuggestModal } from './exercise-suggest-modal'
import { SetNoteModal } from './set-note-modal'

interface DragSession {
  pointerId: number
  fromIndex: number
  toIndex: number
  startY: number
  card: HTMLElement
  handle: HTMLElement
  list: HTMLElement
  indicator: HTMLElement
}

export const VIEW_TYPE_FITKIT_WORKOUT_EDITOR = 'fitkit-workout-editor'

interface EditableStrengthSet {
  set?: number
  weight?: number
  reps?: number
  note?: string
}

interface EditableDurationEntry {
  set?: number
  durationSeconds?: number
  note?: string
}

interface ExerciseCard {
  name: string
  kind: ExerciseKind
  exerciseNotes?: string
  strengthSets: EditableStrengthSet[]
  durationEntries: EditableDurationEntry[]
}

interface EditorWorkoutModel {
  isFitKitWorkout: boolean
  date: string
  name: string
  sourcePath: string
  exercises: ExerciseCard[]
  preserveBlocks: PreserveBlock[]
}

export class WorkoutEditorView extends ItemView {
  private session: FileSession | null = null
  private model: EditorWorkoutModel | null = null
  private dirty = false
  private conflictDetected = false
  private resizeObserver: ResizeObserver | null = null
  private autoSaveTimer: number | null = null
  private autoSaveInflight = false
  private autoSaveRequeued = false
  private dragSession: DragSession | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: FitKitPlugin,
  ) {
    super(leaf)
  }

  getViewType(): string {
    return VIEW_TYPE_FITKIT_WORKOUT_EDITOR
  }

  getDisplayText(): string {
    return this.session?.file.basename ?? 'Workout editor'
  }

  getIcon(): string {
    return 'dumbbell'
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('fitkit-editor-root')
    this.resizeObserver = new ResizeObserver(() => this.updateNarrowState())
    this.resizeObserver.observe(this.contentEl)
    this.updateNarrowState()
    this.registerDragLifetimeListeners()
    this.renderEmpty('Open a workout note to edit.')
  }

  private registerDragLifetimeListeners(): void {
    const cancel = (evt: PointerEvent): void => {
      if (!this.dragSession || evt.pointerId !== this.dragSession.pointerId) {
        return
      }
      this.endDrag(false)
    }
    const finish = (evt: PointerEvent): void => {
      if (!this.dragSession || evt.pointerId !== this.dragSession.pointerId) {
        return
      }
      this.endDrag(true)
    }
    this.registerDomEvent(activeWindow, 'pointerup', finish)
    this.registerDomEvent(activeWindow, 'pointercancel', cancel)
    this.registerDomEvent(activeWindow, 'lostpointercapture', cancel)
  }

  async onClose(): Promise<void> {
    if (this.autoSaveTimer !== null) {
      activeWindow.clearTimeout(this.autoSaveTimer)
      this.autoSaveTimer = null
    }
    await this.flushAutoSave()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.dragSession) {
      this.endDrag(false)
    }
    this.contentEl.empty()
    this.session = null
    this.model = null
  }

  private updateNarrowState(): void {
    this.contentEl.classList.toggle('is-narrow', this.contentEl.clientWidth < 600)
  }

  async loadFile(file: TFile): Promise<void> {
    if (this.autoSaveTimer !== null) {
      activeWindow.clearTimeout(this.autoSaveTimer)
      this.autoSaveTimer = null
    }
    if (this.session && this.dirty && !this.conflictDetected) {
      await this.flushAutoSave()
    }
    this.session = new FileSession(this.app, file)
    const { model, isWorkout, warnings } = await this.session.load()
    this.model = toEditorWorkoutModel(model, isWorkout, file.path)
    this.dirty = false
    this.conflictDetected = false
    this.render()
    if (warnings.length > 0) {
      new Notice(`Loaded with ${warnings.length} parse warning(s).`)
    }
  }

  async reloadFromDisk(): Promise<void> {
    if (!this.session) {
      return
    }
    if (this.autoSaveTimer !== null) {
      activeWindow.clearTimeout(this.autoSaveTimer)
      this.autoSaveTimer = null
    }
    const { model, isWorkout } = await this.session.load()
    this.model = toEditorWorkoutModel(model, isWorkout, this.session.file.path)
    this.dirty = false
    this.conflictDetected = false
    this.render()
    new Notice('Reloaded from disk.')
  }

  private renderEmpty(message: string): void {
    this.contentEl.empty()
    const wrap = this.contentEl.createDiv({ cls: 'fitkit-empty' })
    wrap.setText(message)
  }

  private render(): void {
    if (!this.model || !this.session) {
      this.renderEmpty('No file loaded.')
      return
    }
    this.contentEl.empty()
    const container = this.contentEl.createDiv({ cls: 'fitkit-container' })

    this.renderHeader(container)

    if (!this.model.isFitKitWorkout) {
      const warn = container.createDiv({ cls: 'fitkit-warn' })
      warn.setText(
        'This note has no `type: workout` frontmatter. The editor will not save changes here.',
      )
      return
    }

    if (this.conflictDetected) {
      const banner = container.createDiv({ cls: 'fitkit-conflict' })
      banner.createSpan({
        text: 'File changed on disk. Reload to pick up external edits before continuing.',
      })
      const btn = banner.createEl('button', {
        cls: 'fitkit-btn fitkit-btn-warn',
        text: 'Reload from disk',
      })
      btn.addEventListener('click', () => void this.reloadFromDisk())
    }

    const list = container.createDiv({ cls: 'fitkit-exercise-list' })
    for (let i = 0; i < this.model.exercises.length; i++) {
      this.renderExerciseCard(list, i)
    }

    const footer = container.createDiv({ cls: 'fitkit-footer' })
    const addBtn = footer.createEl('button', { cls: 'fitkit-btn', text: 'Add exercise' })
    addBtn.addEventListener('click', () => void this.openAddExerciseModal())
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: 'fitkit-header' })
    const file = this.session?.file
    header.createEl('h3', { cls: 'fitkit-file-title', text: file?.basename ?? 'Workout' })

    const meta = header.createDiv({ cls: 'fitkit-meta' })
    if (this.model?.isFitKitWorkout) {
      const nameField = meta.createDiv({ cls: 'fitkit-name-field' })
      nameField.createEl('label', {
        cls: 'fitkit-label',
        text: 'Workout name',
        attr: { for: 'fitkit-workout-name' },
      })
      const nameInput = nameField.createEl('input', {
        cls: 'fitkit-workout-name-input',
        attr: {
          type: 'text',
          id: 'fitkit-workout-name',
          placeholder: 'Untitled workout',
        },
      })
      nameInput.value = this.model.name
      nameInput.addEventListener('input', () => {
        if (!this.model) {
          return
        }
        this.model.name = nameInput.value
        this.markDirty()
      })
    }
    meta.createSpan({ cls: 'fitkit-meta-line', text: this.metaLineText() })
  }

  private renderExerciseCard(list: HTMLElement, index: number): void {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex) {
      return
    }

    const card = list.createDiv({ cls: 'fitkit-card' })
    card.dataset.exerciseIndex = String(index)

    const top = card.createDiv({ cls: 'fitkit-card-top' })

    const handle = top.createEl('button', {
      cls: 'fitkit-drag-handle',
      attr: {
        type: 'button',
        'aria-label': 'Drag to reorder',
        tabindex: '0',
      },
    })
    setIcon(handle, 'grip-vertical')
    this.installCardDrag(card, handle, list)

    const nameButton = top.createEl('button', {
      cls: 'fitkit-name-button',
      attr: { type: 'button', 'aria-label': 'Change exercise' },
    })
    nameButton.setText(ex.name)
    nameButton.addEventListener('click', () => void this.openRenameExerciseModal(index))

    const gearBtn = top.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-muted fitkit-gear-button',
      attr: { 'aria-label': 'Exercise options' },
    })
    setIcon(gearBtn, 'settings')
    gearBtn.addEventListener('click', (evt) => this.openCardMenu(evt, index))

    const notesRow = card.createDiv({ cls: 'fitkit-field-row' })
    notesRow.createEl('label', { cls: 'fitkit-label', text: 'Exercise notes' })
    const notesArea = notesRow.createEl('textarea', { cls: 'fitkit-textarea' })
    notesArea.value = ex.exerciseNotes ?? ''
    notesArea.addEventListener('input', () => {
      ex.exerciseNotes = notesArea.value.length > 0 ? notesArea.value : undefined
      this.markDirty()
    })

    if (ex.kind === 'strength') {
      this.renderStrengthTable(card, ex, index)
    } else {
      this.renderDurationTable(card, ex, index)
    }
  }

  private renderStrengthTable(card: HTMLElement, ex: ExerciseCard, exerciseIndex: number): void {
    const wrap = card.createDiv({ cls: 'fitkit-set-area' })

    const header = wrap.createDiv({ cls: 'fitkit-set-row fitkit-set-head' })
    header.createSpan({ cls: 'fitkit-set-label', text: 'Set' })
    header.createSpan({ cls: 'fitkit-set-label', text: 'Weight' })
    header.createSpan({ cls: 'fitkit-set-label', text: 'Reps' })

    for (let i = 0; i < ex.strengthSets.length; i++) {
      this.renderStrengthRow(wrap, ex, i)
    }

    const actions = wrap.createDiv({ cls: 'fitkit-row-actions' })
    const addBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Add set' })
    addBtn.addEventListener('click', () => {
      const nextNumber = ex.strengthSets.length + 1
      ex.strengthSets.push({ set: nextNumber })
      this.markDirty()
      this.render()
      this.focusRowCell(exerciseIndex, ex.strengthSets.length - 1, 'Weight')
    })

    const dupBtn = actions.createEl('button', {
      cls: 'fitkit-btn fitkit-btn-muted',
      text: 'Duplicate last set',
    })
    dupBtn.toggleAttribute('disabled', ex.strengthSets.length === 0)
    dupBtn.addEventListener('click', () => {
      const last = ex.strengthSets[ex.strengthSets.length - 1]
      if (!last) {
        return
      }
      const copy: EditableStrengthSet = { ...last, set: (last.set ?? ex.strengthSets.length) + 1 }
      ex.strengthSets.push(copy)
      this.markDirty()
      this.render()
      this.focusRowCell(exerciseIndex, ex.strengthSets.length - 1, 'Weight')
    })
  }

  private renderStrengthRow(wrap: HTMLElement, ex: ExerciseCard, i: number): void {
    const set = ex.strengthSets[i]
    if (!set) {
      return
    }
    const container = wrap.createDiv({ cls: 'fitkit-row' })
    const row = container.createDiv({ cls: 'fitkit-set-row' })

    const setInput = this.createInputCell(row, 'Set', { type: 'number', inputmode: 'numeric' })
    setInput.value = set.set !== undefined ? String(set.set) : ''
    setInput.addEventListener('input', () => {
      set.set = parseNumberInput(setInput.value)
      this.markDirty()
    })

    const weightInput = this.createInputCell(row, 'Weight', {
      type: 'number',
      step: '0.1',
      inputmode: 'decimal',
    })
    weightInput.value = set.weight !== undefined ? String(set.weight) : ''
    weightInput.addEventListener('input', () => {
      set.weight = parseNumberInput(weightInput.value)
      this.markDirty()
    })

    const repsInput = this.createInputCell(row, 'Reps', { type: 'number', inputmode: 'numeric' })
    repsInput.value = set.reps !== undefined ? String(set.reps) : ''
    repsInput.addEventListener('input', () => {
      set.reps = parseNumberInput(repsInput.value)
      this.markDirty()
    })

    this.renderRowActions(container, {
      label: `set ${i + 1}`,
      currentNote: set.note,
      onDelete: () => {
        ex.strengthSets.splice(i, 1)
        this.markDirty()
        this.render()
      },
      onNoteSave: (next) => {
        set.note = next
        this.markDirty()
        this.render()
      },
    })
  }

  private renderDurationTable(card: HTMLElement, ex: ExerciseCard, exerciseIndex: number): void {
    const wrap = card.createDiv({ cls: 'fitkit-set-area' })

    const header = wrap.createDiv({ cls: 'fitkit-set-row fitkit-duration-row fitkit-set-head' })
    header.createSpan({ cls: 'fitkit-set-label', text: 'Set' })
    header.createSpan({ cls: 'fitkit-set-label', text: 'Duration (s)' })

    for (let i = 0; i < ex.durationEntries.length; i++) {
      this.renderDurationRow(wrap, ex, i)
    }

    const actions = wrap.createDiv({ cls: 'fitkit-row-actions' })
    const addBtn = actions.createEl('button', { cls: 'fitkit-btn', text: 'Add duration entry' })
    addBtn.addEventListener('click', () => {
      ex.durationEntries.push({})
      this.markDirty()
      this.render()
      this.focusRowCell(exerciseIndex, ex.durationEntries.length - 1, 'Duration (s)')
    })
  }

  private renderDurationRow(wrap: HTMLElement, ex: ExerciseCard, i: number): void {
    const durationEntry = ex.durationEntries[i]
    if (!durationEntry) {
      return
    }
    const container = wrap.createDiv({ cls: 'fitkit-row' })
    const row = container.createDiv({ cls: 'fitkit-set-row fitkit-duration-row' })

    const setInput = this.createInputCell(row, 'Set', { type: 'number', inputmode: 'numeric' })
    setInput.value = durationEntry.set !== undefined ? String(durationEntry.set) : String(i + 1)
    setInput.addEventListener('input', () => {
      durationEntry.set = parseNumberInput(setInput.value)
      this.markDirty()
    })

    const durationInput = this.createInputCell(row, 'Duration (s)', {
      type: 'number',
      step: '1',
      inputmode: 'numeric',
    })
    durationInput.value =
      durationEntry.durationSeconds !== undefined ? String(durationEntry.durationSeconds) : ''
    durationInput.addEventListener('input', () => {
      durationEntry.durationSeconds = parseNumberInput(durationInput.value)
      this.markDirty()
    })

    this.renderRowActions(container, {
      label: `duration entry ${i + 1}`,
      currentNote: durationEntry.note,
      onDelete: () => {
        ex.durationEntries.splice(i, 1)
        this.markDirty()
        this.render()
      },
      onNoteSave: (next) => {
        durationEntry.note = next
        this.markDirty()
        this.render()
      },
    })
  }

  private renderRowActions(
    container: HTMLElement,
    opts: {
      label: string
      currentNote: string | undefined
      onDelete: () => void
      onNoteSave: (next: string | undefined) => void
    },
  ): void {
    const strip = container.createDiv({ cls: 'fitkit-row-actions-strip' })
    const noteBtn = strip.createEl('button', {
      cls: 'fitkit-btn fitkit-row-action',
      attr: { 'aria-label': `Edit note for ${opts.label}` },
    })
    setIcon(noteBtn, 'pencil')
    const openNoteModal = (): void => {
      new SetNoteModal(this.app, {
        title: `Note for ${opts.label}`,
        initial: opts.currentNote ?? '',
        onSave: opts.onNoteSave,
      }).open()
    }
    noteBtn.addEventListener('click', openNoteModal)

    const trashBtn = strip.createEl('button', {
      cls: 'fitkit-btn fitkit-destructive-button fitkit-row-action',
      attr: { 'aria-label': `Remove ${opts.label}` },
    })
    setIcon(trashBtn, 'trash-2')
    trashBtn.addEventListener('click', () => {
      void this.confirmAndDeleteRow(opts.label, opts.onDelete)
    })

    if (opts.currentNote && opts.currentNote.length > 0) {
      const line = container.createDiv({
        cls: 'fitkit-note-line',
        attr: { role: 'button', tabindex: '0' },
      })
      line.setText(opts.currentNote)
      line.addEventListener('click', openNoteModal)
      line.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault()
          openNoteModal()
        }
      })
    }
  }

  private async confirmAndDeleteRow(label: string, onDelete: () => void): Promise<void> {
    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        this.app,
        {
          title: 'Remove row?',
          message: `Remove ${label}? This cannot be undone.`,
          confirmText: 'Remove',
          cancelText: 'Cancel',
        },
        resolve,
      ).open()
    })
    if (confirmed) {
      onDelete()
    }
  }

  private async switchKind(index: number, nextKind: ExerciseKind): Promise<void> {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex || ex.kind === nextKind) {
      return
    }
    const hadRows = hasRows(ex)
    const confirmed = await this.confirmKindSwitch(ex, nextKind)
    if (!confirmed) {
      return
    }
    this.applyKindSwitch(index, nextKind, hadRows)
  }

  private async confirmKindSwitch(card: ExerciseCard, nextKind: ExerciseKind): Promise<boolean> {
    if (!hasRows(card)) {
      return true
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
      ).open()
    })
  }

  private applyKindSwitch(index: number, nextKind: ExerciseKind, clearedRows: boolean): void {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex || ex.kind === nextKind) {
      return
    }
    const previousKind = ex.kind
    ex.kind = nextKind
    ex.strengthSets = []
    ex.durationEntries = []
    this.markDirty()
    this.render()
    if (clearedRows) {
      new Notice(`Switched to ${nextKind}. Previous ${previousKind} rows were cleared.`)
    }
  }

  private createCell(row: HTMLElement, label: string, cls?: string): HTMLElement {
    const cell = row.createDiv({ cls: cls ? `fitkit-cell ${cls}` : 'fitkit-cell' })
    cell.dataset.label = label
    return cell
  }

  private createInputCell(
    row: HTMLElement,
    label: string,
    attr: Record<string, string>,
  ): HTMLInputElement {
    const cell = this.createCell(row, label)
    const input = cell.createEl('input', { cls: 'fitkit-input', attr })
    input.setAttr('aria-label', label)
    return input
  }

  private focusRowCell(exerciseIndex: number, rowIndex: number, label: string): void {
    const cards = this.contentEl.querySelectorAll('.fitkit-exercise-list > .fitkit-card')
    const card = cards.item(exerciseIndex)
    if (!(card instanceof HTMLElement)) {
      return
    }
    const rows = card.querySelectorAll('.fitkit-set-area > .fitkit-row')
    const row = rows.item(rowIndex)
    if (!(row instanceof HTMLElement)) {
      return
    }
    const selector = `.fitkit-cell[data-label="${label}"] input.fitkit-input`
    const input = row.querySelector(selector)
    if (input instanceof HTMLInputElement) {
      input.focus()
      input.select()
    }
  }

  private moveExercise(index: number, delta: number): void {
    if (!this.model) {
      return
    }
    const target = index + delta
    if (target < 0 || target >= this.model.exercises.length) {
      return
    }
    const arr = this.model.exercises
    const a = arr[index]
    const b = arr[target]
    if (!a || !b) {
      return
    }
    arr[index] = b
    arr[target] = a
    this.markDirty()
    this.render()
  }

  private removeExercise(index: number): void {
    if (!this.model) {
      return
    }
    this.model.exercises.splice(index, 1)
    this.markDirty()
    this.render()
  }

  private openCardMenu(evt: MouseEvent, index: number): void {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex) {
      return
    }
    const lastIndex = this.model.exercises.length - 1
    const otherKind: ExerciseKind = ex.kind === 'strength' ? 'duration' : 'strength'
    const switchLabel = otherKind === 'strength' ? 'Switch to strength' : 'Switch to duration'

    const menu = new Menu()
    menu.addItem((item) =>
      item
        .setTitle(switchLabel)
        .setIcon('repeat')
        .onClick(() => void this.switchKind(index, otherKind)),
    )
    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle('Move up')
        .setIcon('chevron-up')
        .setDisabled(index === 0)
        .onClick(() => this.moveExercise(index, -1)),
    )
    menu.addItem((item) =>
      item
        .setTitle('Move down')
        .setIcon('chevron-down')
        .setDisabled(index === lastIndex)
        .onClick(() => this.moveExercise(index, 1)),
    )
    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle('Remove exercise')
        .setIcon('trash-2')
        .setWarning(true)
        .onClick(() => void this.confirmAndRemoveExercise(index)),
    )

    const target = evt.currentTarget
    if (target instanceof HTMLElement) {
      const rect = target.getBoundingClientRect()
      menu.showAtPosition({ x: rect.left, y: rect.bottom })
    } else {
      menu.showAtMouseEvent(evt)
    }
  }

  private installCardDrag(card: HTMLElement, handle: HTMLElement, list: HTMLElement): void {
    handle.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0) {
        return
      }
      if (this.dragSession) {
        return
      }
      const fromIndex = readCardIndex(card)
      if (fromIndex === null) {
        return
      }
      evt.preventDefault()
      handle.setPointerCapture(evt.pointerId)
      const indicator = list.createDiv({ cls: 'fitkit-drop-indicator' })
      const session: DragSession = {
        pointerId: evt.pointerId,
        fromIndex,
        toIndex: fromIndex,
        startY: evt.clientY,
        card,
        handle,
        list,
        indicator,
      }
      this.dragSession = session
      card.addClass('is-dragging')
      this.positionDropIndicator(session)
    })

    handle.addEventListener('pointermove', (evt) => {
      const session = this.dragSession
      if (!session || evt.pointerId !== session.pointerId) {
        return
      }
      const dy = evt.clientY - session.startY
      session.card.style.setProperty('--fitkit-drag-offset', `${dy}px`)
      session.toIndex = this.computeDropIndex(session, evt.clientY)
      this.positionDropIndicator(session)
    })
  }

  private computeDropIndex(session: DragSession, pointerY: number): number {
    const cards = Array.from(session.list.querySelectorAll<HTMLElement>(':scope > .fitkit-card'))
    let target = session.fromIndex
    for (let i = 0; i < cards.length; i++) {
      const sibling = cards[i]
      if (!sibling || sibling === session.card) {
        continue
      }
      const rect = sibling.getBoundingClientRect()
      const midpoint = rect.top + rect.height / 2
      if (pointerY < midpoint) {
        target = i
        break
      }
      target = i
    }
    return target
  }

  private positionDropIndicator(session: DragSession): void {
    const cards = Array.from(session.list.querySelectorAll<HTMLElement>(':scope > .fitkit-card'))
    const reference = cards[session.toIndex] ?? null
    if (reference === session.indicator) {
      return
    }
    if (reference) {
      session.list.insertBefore(session.indicator, reference)
    } else {
      session.list.appendChild(session.indicator)
    }
  }

  private endDrag(commit: boolean): void {
    const session = this.dragSession
    if (!session) {
      return
    }
    this.dragSession = null
    session.card.removeClass('is-dragging')
    session.card.style.removeProperty('--fitkit-drag-offset')
    if (session.handle.hasPointerCapture(session.pointerId)) {
      session.handle.releasePointerCapture(session.pointerId)
    }
    session.indicator.remove()
    if (!commit || !this.model) {
      return
    }
    const { fromIndex, toIndex } = session
    const targetIndex = toIndex > fromIndex ? toIndex - 1 : toIndex
    if (fromIndex === targetIndex) {
      return
    }
    this.model.exercises = reorderArray(this.model.exercises, fromIndex, targetIndex)
    this.markDirty()
    this.render()
  }

  private async confirmAndRemoveExercise(index: number): Promise<void> {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex) {
      return
    }
    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        this.app,
        {
          title: 'Remove exercise?',
          message: `Remove "${ex.name}"? This cannot be undone.`,
          confirmText: 'Remove',
          cancelText: 'Cancel',
        },
        resolve,
      ).open()
    })
    if (!confirmed) {
      return
    }
    this.removeExercise(index)
  }

  private async openAddExerciseModal(): Promise<void> {
    if (!this.model) {
      return
    }
    const names = await this.collectExerciseSuggestions()
    new ExerciseSuggestModal(this.app, names, (name) => {
      const trimmed = name.trim()
      if (!trimmed || !this.model) {
        return
      }
      const exerciseIndex = this.model.exercises.length
      this.model.exercises.push({
        name: trimmed,
        kind: 'strength',
        strengthSets: [{ set: 1 }],
        durationEntries: [],
      })
      this.markDirty()
      this.render()
      this.focusRowCell(exerciseIndex, 0, 'Weight')
    }).open()
  }

  private async openRenameExerciseModal(index: number): Promise<void> {
    if (!this.model) {
      return
    }
    const ex = this.model.exercises[index]
    if (!ex) {
      return
    }
    const names = await this.collectExerciseSuggestions()
    const modal = new ExerciseSuggestModal(this.app, names, (name) => {
      const trimmed = name.trim()
      if (!trimmed || !this.model) {
        return
      }
      const target = this.model.exercises[index]
      if (!target) {
        return
      }
      if (target.name === trimmed) {
        return
      }
      target.name = trimmed
      this.markDirty()
      this.render()
    })
    modal.open()
    modal.inputEl.value = ex.name
    modal.inputEl.dispatchEvent(new Event('input'))
  }

  private async collectExerciseSuggestions(): Promise<string[]> {
    const names = new Set<string>()
    const files = this.app.vault.getMarkdownFiles()
    const exerciseFolder = exercisesFolder(this.plugin.settings)
    const workoutFolder = workoutsFolder(this.plugin.settings)

    for (const file of files) {
      if (isInFolder(file.path, exerciseFolder)) {
        names.add(file.basename)
      }
    }

    for (const file of files) {
      if (!isInFolder(file.path, workoutFolder)) {
        continue
      }
      try {
        const text = await this.app.vault.cachedRead(file)
        const result = parseWorkoutNote(text, file.path)
        if (!result.isWorkout || !result.model) {
          continue
        }
        for (const exercise of result.model.exercises) {
          names.add(exercise.exerciseName)
        }
      } catch {
        /** Suggestion-list collection should never break the editor; skip unreadable or unparseable files silently. */
        continue
      }
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }

  private markDirty(): void {
    this.dirty = true
    this.updateMetaText()
    this.scheduleAutoSave()
  }

  private metaLineText(): string {
    const parts: string[] = []
    if (this.model?.date) {
      parts.push(`date: ${this.model.date}`)
    }
    if (this.dirty) {
      parts.push('unsaved')
    }
    return parts.join(' | ')
  }

  private updateMetaText(): void {
    const line = this.contentEl.querySelector('.fitkit-meta-line')
    if (line instanceof HTMLElement) {
      line.setText(this.metaLineText())
    }
  }

  private scheduleAutoSave(): void {
    if (this.conflictDetected) {
      return
    }
    if (this.autoSaveTimer !== null) {
      activeWindow.clearTimeout(this.autoSaveTimer)
    }
    this.autoSaveTimer = activeWindow.setTimeout(() => {
      this.autoSaveTimer = null
      void this.flushAutoSave()
    }, this.plugin.settings.autosaveDebounceMs)
  }

  private async flushAutoSave(): Promise<void> {
    if (!this.session || !this.model) {
      return
    }
    if (!this.dirty || !this.model.isFitKitWorkout) {
      return
    }
    if (this.conflictDetected) {
      return
    }
    if (this.autoSaveInflight) {
      this.autoSaveRequeued = true
      return
    }
    this.autoSaveInflight = true
    try {
      const nextText = serializeWorkoutNote(toWorkoutNoteModel(this.model))
      const result = await this.session.saveIfUnchanged(nextText)
      if (!result.ok) {
        this.conflictDetected = true
        new Notice('File changed on disk. Reload before further edits.')
        this.render()
        return
      }
      this.dirty = false
      this.updateMetaText()
    } finally {
      this.autoSaveInflight = false
      if (this.autoSaveRequeued) {
        this.autoSaveRequeued = false
        this.scheduleAutoSave()
      }
    }
  }
}

function parseNumberInput(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return undefined
  }
  const n = Number(trimmed)
  if (Number.isNaN(n)) {
    return undefined
  }
  return n
}

function hasRows(card: ExerciseCard): boolean {
  return card.strengthSets.length > 0 || card.durationEntries.length > 0
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
    }
  }

  return {
    isFitKitWorkout: isWorkout,
    date: model.date,
    name: model.name,
    sourcePath: model.sourcePath,
    exercises: model.exercises.map(toEditorExercise),
    preserveBlocks: [...model.preserveBlocks],
  }
}

function toEditorExercise(exercise: ExerciseEntry): ExerciseCard {
  const card: ExerciseCard = {
    name: exercise.exerciseName,
    kind: exercise.kind,
    strengthSets: (exercise.strengthSets ?? []).map(toEditorStrengthSet),
    durationEntries: (exercise.durationEntries ?? []).map(toEditorDurationEntry),
  }
  if (exercise.note !== undefined) {
    card.exerciseNotes = exercise.note
  }
  return card
}

function toEditorStrengthSet(set: StrengthSet): EditableStrengthSet {
  const editable: EditableStrengthSet = {
    set: set.set,
  }
  if (set.weight !== undefined) {
    editable.weight = set.weight
  }
  if (set.reps !== undefined) {
    editable.reps = set.reps
  }
  if (set.note !== undefined) {
    editable.note = set.note
  }
  return editable
}

function toEditorDurationEntry(entry: DurationEntry): EditableDurationEntry {
  const editable: EditableDurationEntry = {
    durationSeconds: entry.durationSeconds,
  }
  if (entry.set !== undefined) {
    editable.set = entry.set
  }
  if (entry.note !== undefined) {
    editable.note = entry.note
  }
  return editable
}

function toWorkoutNoteModel(model: EditorWorkoutModel): WorkoutNoteModel {
  return {
    date: model.date,
    name: model.name,
    sourcePath: model.sourcePath,
    exercises: model.exercises.map(toWorkoutExercise),
    preserveBlocks: [...model.preserveBlocks],
  }
}

function toWorkoutExercise(card: ExerciseCard): ExerciseEntry {
  const exercise: ExerciseEntry = {
    exerciseName: card.name,
    kind: card.kind,
  }
  if (card.exerciseNotes !== undefined) {
    exercise.note = card.exerciseNotes
  }
  if (card.kind === 'strength') {
    exercise.strengthSets = card.strengthSets.map(toStrengthSet)
  } else {
    exercise.durationEntries = card.durationEntries.map(toDurationEntry)
  }
  return exercise
}

function toStrengthSet(set: EditableStrengthSet, index: number): StrengthSet {
  const strengthSet: StrengthSet = {
    set: set.set ?? index + 1,
  }
  if (set.weight !== undefined) {
    strengthSet.weight = set.weight
  }
  if (set.reps !== undefined) {
    strengthSet.reps = set.reps
  }
  if (set.note !== undefined) {
    strengthSet.note = set.note
  }
  return strengthSet
}

function toDurationEntry(entry: EditableDurationEntry): DurationEntry {
  const durationEntry: DurationEntry = {
    durationSeconds: entry.durationSeconds ?? 0,
  }
  if (entry.set !== undefined) {
    durationEntry.set = entry.set
  }
  if (entry.note !== undefined) {
    durationEntry.note = entry.note
  }
  return durationEntry
}

function isInFolder(path: string, folder: string): boolean {
  return path !== folder && path.startsWith(`${folder}/`)
}

function readCardIndex(card: HTMLElement): number | null {
  const raw = card.dataset.exerciseIndex
  if (!raw) {
    return null
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? null : parsed
}
