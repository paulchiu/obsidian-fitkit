import { Modal, setIcon, type App } from 'obsidian'

import { formatDurationInput } from '../domain/duration-input'
import { formatIntervalPlan, parseIntervalPlan } from '../domain/interval-plan'
import type { IntervalPreset } from '../domain/interval-presets'
import {
  parseIntervalProgram,
  programSeconds,
  type IntervalProgramResult,
} from '../domain/interval-program'
import { outlineFromPlan, outlineProblem, planFromOutline } from '../domain/plan-outline'
import { renderPlanBuilder } from './plan-builder'

export interface IntervalPlanModalOptions {
  exerciseName: string
  initial: string | undefined
  /** What the form starts from when there is no plan yet, before the built-in default. */
  suggested?: string
  /** Plans offered under "Start from"; the row is left out when there are none. */
  presets: readonly IntervalPreset[]
  onSave: (plan: string | undefined) => void
}

const DEFAULT_PLAN = '(x 8 (work 30s 300W) (rest 90s))'

const DOCS_URL =
  'https://github.com/paulchiu/obsidian-fitkit/blob/main/docs/note-format.md#interval-plans'

/** What the info button shows: each example with the one rule it teaches. */
const PLAN_EXAMPLES: ReadonlyArray<{ plan: string; about: string }> = [
  {
    plan: '(x 8 (work 20s 400W) (rest 10s))',
    about: 'Eight reps of 20s at 400W. A rest at the end of an x goes between rounds.',
  },
  {
    plan: '(x 3 (over 1m 300W) (under 2m 220W))',
    about: 'The first word names the step. Steps with no rest between them run straight on.',
  },
  {
    plan: '(warmup 10m 150W) (x 3 (x 3 (over 1m 300W) (under 2m 220W)) (rest 4m)) (cooldown 5m 120W)',
    about:
      'Nest x for sets of rounds. A step with no target, like (spin 5m), is timed but not scored.',
  },
  {
    plan: '(x 6 (climb 1m (L8 L10 L12 L14 L12 L10)) (rest 1m))',
    about: 'A list of targets takes the next one each round.',
  },
  {
    plan: '(x 6 (every 2m (push open 120kg)))',
    about: 'Open work ends when you tap Rest. Every starts each rep on the clock.',
  },
  {
    plan: '("big gear" 2m 260W)',
    about: 'Quote a name with spaces. Targets are watts (300W), load (120kg) or a level (L12).',
  },
  {
    plan: '8 x 30s @ 300W, 90s rest',
    about: 'The one-line form still works for a single repeat.',
  },
]

/**
 * Edits the `[plan::]` on a duration card as rows of steps, or as text for plans rows cannot
 * show, previewing what the plan comes to as it is edited.
 */
export class IntervalPlanModal extends Modal {
  private stopKeepingPlanInView?: () => void

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

    const presets =
      this.options.presets.length > 0 ? contentEl.createDiv({ cls: 'fitkit-plan-presets' }) : null
    presets?.createSpan({ cls: 'fitkit-label', text: 'Start from' })

    const heading = contentEl.createDiv({ cls: 'fitkit-plan-heading' })
    heading.createSpan({ cls: 'fitkit-label', text: 'Plan' })
    const info = heading.createEl('button', {
      cls: 'fitkit-plan-info',
      attr: { type: 'button', 'aria-label': 'Plan examples', 'aria-expanded': 'false' },
    })
    setIcon(info, 'info')
    const modes = heading.createDiv({ cls: 'fitkit-plan-modes' })
    const modeButton = (text: string): HTMLButtonElement =>
      modes.createEl('button', { cls: 'fitkit-btn', text, attr: { type: 'button' } })
    const stepsButton = modeButton('Steps')
    const textButton = modeButton('Text')
    const builder = contentEl.createDiv({ cls: 'fitkit-plan-builder' })
    const field = contentEl.createEl('textarea', {
      cls: 'fitkit-input fitkit-plan-text',
      attr: { 'aria-label': 'Plan', rows: '3', spellcheck: 'false', autocapitalize: 'off' },
    })
    const note = contentEl.createDiv({
      cls: 'fitkit-plan-note',
      text: "This plan can't be shown as steps, so edit it as text.",
    })
    const preview = contentEl.createDiv({ cls: 'fitkit-plan-preview' })
    const examples = contentEl.createDiv({ cls: 'fitkit-plan-examples', attr: { hidden: '' } })

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

    let current: IntervalProgramResult = parseIntervalProgram('')
    let blank: string | null = null
    const update = (): void => {
      current = blank === null ? parseIntervalProgram(field.value) : { ok: false, reason: blank }
      preview.empty()
      if (current.ok) {
        const reps = current.program.steps.length
        preview.setText(
          `${reps} ${reps === 1 ? 'rep' : 'reps'} · ${formatDurationInput(programSeconds(current.program))}`,
        )
      } else {
        preview.createSpan({ cls: 'fitkit-plan-error', text: current.reason })
      }
      save.disabled = !current.ok
    }
    let inSteps = true
    /** Shows the plan as rows when asked and they can show it, else as text. */
    const show = (steps: boolean): void => {
      const rows = steps ? outlineFromPlan(field.value) : null
      inSteps = rows !== null
      blank = null
      builder.toggleAttribute('hidden', !inSteps)
      field.toggleAttribute('hidden', inSteps)
      note.toggleAttribute('hidden', !steps || inSteps)
      info.toggleAttribute('hidden', inSteps)
      if (inSteps) {
        examples.setAttribute('hidden', '')
        info.setAttribute('aria-expanded', 'false')
      }
      stepsButton.setAttribute('aria-pressed', String(inSteps))
      textButton.setAttribute('aria-pressed', String(!inSteps))
      if (rows) {
        renderPlanBuilder(builder, rows, () => {
          field.value = planFromOutline(rows)
          blank = outlineProblem(rows)
          update()
        })
        blank = outlineProblem(rows)
      }
      update()
    }
    const fill = (plan: string): void => {
      field.value = plan
      show(inSteps)
    }
    stepsButton.addEventListener('click', () => show(true))
    textButton.addEventListener('click', () => show(false))
    save.addEventListener('click', () => {
      if (current.ok) {
        this.options.onSave(tidyPlan(field.value))
        this.close()
      }
    })
    field.addEventListener('input', update)
    info.addEventListener('click', () => {
      const showing = examples.hasAttribute('hidden')
      examples.toggleAttribute('hidden', !showing)
      info.setAttribute('aria-expanded', String(showing))
    })
    for (const example of PLAN_EXAMPLES) {
      const row = examples.createDiv({ cls: 'fitkit-plan-example' })
      row.createEl('code', { text: example.plan })
      row.createDiv({ cls: 'fitkit-plan-example-about', text: example.about })
      const use = row.createEl('button', { cls: 'fitkit-btn', text: 'Use this' })
      use.addEventListener('click', () => fill(example.plan))
    }
    examples.createEl('a', {
      text: 'Full syntax and more examples',
      attr: { href: DOCS_URL },
    })
    if (presets) {
      for (const preset of this.options.presets) {
        const button = presets.createEl('button', { cls: 'fitkit-btn', text: preset.label })
        button.addEventListener('click', () => fill(preset.plan))
      }
    }

    fill(this.options.initial ?? this.options.suggested ?? DEFAULT_PLAN)
    this.stopKeepingPlanInView = keepInViewOverKeyboard(contentEl, heading, field)
  }

  onClose(): void {
    this.stopKeepingPlanInView?.()
    this.modalEl.removeClass('fitkit-set-note-modal-shell')
    this.contentEl.empty()
  }
}

/**
 * Once the phone keyboard is up, scrolls `top` to the top of the visible form while `field`
 * is being typed in: with the examples open, iOS can scroll the form past the field it revealed.
 * Returns the cleanup.
 */
function keepInViewOverKeyboard(
  form: HTMLElement,
  top: HTMLElement,
  field: HTMLElement,
): () => void {
  const win = activeWindow
  const align = (): void => {
    if (field.ownerDocument.activeElement !== field) {
      return
    }
    const visibleTop = Math.max(
      form.getBoundingClientRect().top,
      win.visualViewport?.offsetTop ?? 0,
    )
    form.scrollTop += top.getBoundingClientRect().top - visibleTop
  }
  win.addEventListener('keyboardDidShow', align)
  win.visualViewport?.addEventListener('resize', align)
  return () => {
    win.removeEventListener('keyboardDidShow', align)
    win.visualViewport?.removeEventListener('resize', align)
  }
}

/** One line for the note: a one-line plan in its usual spelling, lists with spacing collapsed outside quoted names. */
function tidyPlan(raw: string): string {
  const line = raw
    .trim()
    .split('"')
    .map((part, index) => (index % 2 === 0 ? part.replace(/\s+/g, ' ') : part))
    .join('"')
  const plan = parseIntervalPlan(line)
  return plan.ok ? formatIntervalPlan(plan.plan) : line
}
