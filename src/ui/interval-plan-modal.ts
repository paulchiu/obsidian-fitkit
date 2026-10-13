import { Modal, type App } from 'obsidian'

import { formatDurationInput } from '../domain/duration-input'
import {
  formatIntervalPlan,
  formatTarget,
  parseIntervalPlan,
  type IntensityKind,
  type IntervalPlan,
  type IntervalPlanResult,
} from '../domain/interval-plan'

export interface IntervalPlanModalOptions {
  exerciseName: string
  initial: string | undefined
  /** What the form starts from when there is no plan yet, before the built-in default. */
  suggested?: string
  onSave: (plan: string | undefined) => void
}

const INTENSITY_OPTIONS: ReadonlyArray<{ value: IntensityKind; label: string }> = [
  { value: 'watts', label: 'Watts' },
  { value: 'load', label: 'Load (kg)' },
  { value: 'level', label: 'Level' },
]

const PACE_OPTIONS: ReadonlyArray<{ value: IntervalPlan['pace']['kind']; label: string }> = [
  { value: 'rest', label: 'Rest after each rep' },
  { value: 'every', label: 'Start every (EMOM)' },
]

const PRESETS: ReadonlyArray<{ label: string; plan: string }> = [
  { label: 'Bike 8 x 30', plan: '8 x 30s @ 300W, 90s rest' },
  { label: 'Tabata', plan: '8 x 20s @ 400W, 10s rest' },
  { label: 'EMOM 40 s', plan: '10 x 40s @ 300W, every 1m' },
  { label: 'Sled every 2:00', plan: '6 x open @ 120kg, every 2m' },
]

const DEFAULT_PLAN = '8 x 30s @ 300W, 90s rest'

interface PlanFields {
  reps: HTMLInputElement
  intensity: HTMLSelectElement
  target: HTMLInputElement
  work: HTMLInputElement
  open: HTMLInputElement
  pace: HTMLSelectElement
  gap: HTMLInputElement
}

/** Edits the one-line `[plan::]` on a duration card through a form, so nobody has to learn the grammar. */
export class IntervalPlanModal extends Modal {
  constructor(
    app: App,
    private options: IntervalPlanModalOptions,
  ) {
    super(app)
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    this.modalEl.addClass('fitkit-set-note-modal-shell')
    contentEl.addClass('fitkit-set-note-modal')
    this.setTitle(`Interval plan for ${this.options.exerciseName}`)

    const presets = contentEl.createDiv({ cls: 'fitkit-plan-presets' })
    presets.createSpan({ cls: 'fitkit-label', text: 'Start from' })
    const grid = contentEl.createDiv({ cls: 'fitkit-plan-grid' })
    const fields: PlanFields = {
      reps: this.numberField(grid, 'Reps'),
      intensity: this.selectField(grid, 'Intensity', INTENSITY_OPTIONS),
      target: this.numberField(grid, 'Target'),
      ...this.workField(grid),
      pace: this.selectField(grid, 'Pace', PACE_OPTIONS),
      gap: this.textField(grid, 'Rest', 'Rest or period'),
    }
    const gapLabel = fields.gap.previousElementSibling
    const preview = contentEl.createDiv({ cls: 'fitkit-plan-preview' })

    const actions = contentEl.createDiv({ cls: 'fitkit-confirm-actions fitkit-set-note-actions' })
    if (this.options.initial !== undefined) {
      const clear = actions.createEl('button', { cls: 'fitkit-btn', text: 'Clear plan' })
      clear.addEventListener('click', () => {
        this.options.onSave(undefined)
        this.close()
      })
    }
    const cancel = actions.createEl('button', { cls: 'fitkit-btn', text: 'Cancel' })
    cancel.addEventListener('click', () => this.close())
    const save = actions.createEl('button', { cls: 'fitkit-btn fitkit-btn-primary', text: 'Save' })

    let current: IntervalPlanResult = parseIntervalPlan('')
    const update = (): void => {
      fields.work.disabled = fields.open.checked
      gapLabel?.setText(fields.pace.value === 'every' ? 'Start every' : 'Rest')
      current = parseIntervalPlan(composeLine(fields))
      preview.empty()
      if (current.ok) {
        preview.createEl('code', { text: formatIntervalPlan(current.plan) })
      } else {
        preview.createSpan({ cls: 'fitkit-plan-error', text: current.reason })
      }
      save.disabled = !current.ok
    }
    save.addEventListener('click', () => {
      if (current.ok) {
        this.options.onSave(formatIntervalPlan(current.plan))
        this.close()
      }
    })
    grid.addEventListener('input', update)
    grid.addEventListener('change', update)
    for (const preset of PRESETS) {
      const button = presets.createEl('button', { cls: 'fitkit-btn', text: preset.label })
      button.addEventListener('click', () => {
        fill(fields, preset.plan)
        update()
      })
    }

    fill(fields, this.options.initial ?? this.options.suggested ?? DEFAULT_PLAN)
    update()
  }

  onClose(): void {
    this.modalEl.removeClass('fitkit-set-note-modal-shell')
    this.contentEl.empty()
  }

  private label(grid: HTMLElement, text: string): HTMLElement {
    const label = grid.createEl('label', { cls: 'fitkit-plan-field' })
    label.createSpan({ cls: 'fitkit-label', text })
    return label
  }

  private numberField(grid: HTMLElement, text: string): HTMLInputElement {
    return this.label(grid, text).createEl('input', {
      cls: 'fitkit-input',
      attr: { type: 'text', inputmode: 'decimal', 'aria-label': text },
    })
  }

  private textField(grid: HTMLElement, text: string, ariaLabel: string): HTMLInputElement {
    return this.label(grid, text).createEl('input', {
      cls: 'fitkit-input fitkit-duration-input',
      attr: { type: 'text', 'aria-label': ariaLabel },
    })
  }

  private selectField(
    grid: HTMLElement,
    text: string,
    options: ReadonlyArray<{ value: string; label: string }>,
  ): HTMLSelectElement {
    const select = this.label(grid, text).createEl('select', {
      cls: 'dropdown',
      attr: { 'aria-label': text },
    })
    for (const option of options) {
      select.createEl('option', { text: option.label, attr: { value: option.value } })
    }
    return select
  }

  private workField(grid: HTMLElement): { work: HTMLInputElement; open: HTMLInputElement } {
    const label = this.label(grid, 'Work')
    const row = label.createDiv({ cls: 'fitkit-plan-work' })
    const work = row.createEl('input', {
      cls: 'fitkit-input fitkit-duration-input',
      attr: { type: 'text', 'aria-label': 'Work' },
    })
    const openLabel = row.createEl('label', { cls: 'fitkit-plan-open' })
    const open = openLabel.createEl('input', {
      attr: { type: 'checkbox', 'aria-label': 'Open work' },
    })
    openLabel.createSpan({ text: 'Open' })
    return { work, open }
  }
}

function fill(fields: PlanFields, line: string): void {
  const parsed = parseIntervalPlan(line)
  if (!parsed.ok) {
    return
  }
  const { plan } = parsed
  fields.reps.value = String(plan.reps)
  fields.intensity.value = plan.intensity.kind
  fields.target.value = String(plan.intensity.target)
  fields.work.value = plan.workSeconds === null ? '' : formatDurationInput(plan.workSeconds)
  fields.open.checked = plan.workSeconds === null
  fields.pace.value = plan.pace.kind
  fields.gap.value = formatDurationInput(plan.pace.seconds)
}

/** The plan line the fields describe, left for the plan grammar to accept or explain. */
function composeLine(fields: PlanFields): string {
  const kind = fields.intensity.value as IntensityKind
  const target = formatTarget({ kind, target: Number(fields.target.value.trim()) })
  const work = fields.open.checked ? 'open' : fields.work.value.trim()
  const gap = fields.gap.value.trim()
  const pace = fields.pace.value === 'every' ? `every ${gap}` : `${gap} rest`
  return `${fields.reps.value.trim()} x ${work} @ ${target}, ${pace}`
}
