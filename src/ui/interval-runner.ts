import { setIcon } from 'obsidian'

import { formatTarget, type IntensityKind, type IntervalPlan } from '../domain/interval-plan'
import {
  hasOpenRep,
  isOnTarget,
  repsWithWorkDone,
  runPhase,
  type RunRow,
} from '../domain/interval-run'

export type RunnerScreen =
  | { kind: 'running' }
  | { kind: 'finished'; hits: number }
  | { kind: 'cut-off'; rep: number; resting: boolean }

export interface RunnerModel {
  exerciseName: string
  plan: IntervalPlan
  rows: readonly RunRow[]
  now: number
  screen: RunnerScreen
}

export interface RunnerHandlers {
  primary: () => void
  togglePause: () => void
  end: () => void
  adjust: (delta: number) => void
  resumeCut: () => void
  endCut: () => void
  back: () => void
}

/** How far one tap of the rest stepper moves each kind of intensity. */
const ADJUST_STEP: Record<IntensityKind, number> = { watts: 5, load: 2.5, level: 1 }

const UNIT: Record<IntensityKind, string> = { watts: ' W', load: ' kg', level: '' }

/**
 * Draws the run screen that takes over the editor tab. Returns the clock element so
 * the view can refresh it every tick without rebuilding buttons under a finger.
 */
export function renderRunner(
  parent: HTMLElement,
  model: RunnerModel,
  handlers: RunnerHandlers,
): HTMLElement | null {
  const runner = parent.createDiv({ cls: 'fitkit-runner' })
  switch (model.screen.kind) {
    case 'finished':
      renderFinished(runner, model, model.screen.hits, handlers)
      return null
    case 'cut-off':
      renderCutOff(runner, model, model.screen, handlers)
      return null
    case 'running':
      return renderRunning(runner, model, handlers)
  }
}

/** `m:ss` for the big clock. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** The big clock's value: time left, or time so far for open work. */
export function clockSeconds(model: Omit<RunnerModel, 'screen'>): number {
  const phase = runPhase(model.rows, model.plan, model.now)
  if (phase.kind === 'idle') {
    return 0
  }
  return phase.remaining ?? phase.elapsed
}

function renderRunning(
  runner: HTMLElement,
  model: RunnerModel,
  handlers: RunnerHandlers,
): HTMLElement | null {
  const phase = runPhase(model.rows, model.plan, model.now)
  if (phase.kind === 'idle') {
    return null
  }
  const resting = phase.kind === 'rest'
  runner.addClass(resting ? 'is-rest' : 'is-work')
  if (phase.paused) {
    runner.addClass('is-paused')
  }

  const top = runner.createDiv({ cls: 'fitkit-runner-top' })
  top.createSpan({
    cls: 'fitkit-runner-phase',
    text: `${resting ? 'Rest' : 'Work'} · rep ${phase.rep} of ${model.plan.reps}`,
  })
  top.createSpan({ cls: 'fitkit-runner-name', text: model.exerciseName })

  const center = runner.createDiv({ cls: 'fitkit-runner-center' })
  const clock = center.createDiv({
    cls: 'fitkit-runner-clock',
    text: formatClock(clockSeconds(model)),
  })
  center.createDiv({
    cls: 'fitkit-runner-target',
    text: resting ? 'rest' : `${formatTarget(model.plan.intensity)} target`,
  })
  renderDots(center, model)
  renderStats(center, model)
  if (phase.paused) {
    center.createDiv({ cls: 'fitkit-runner-note', text: 'Paused' })
  }
  if (resting) {
    renderStepper(center, model, handlers)
  }

  const primary = runner.createEl('button', {
    cls: `fitkit-btn fitkit-runner-primary${resting ? '' : ' fitkit-btn-primary'}`,
    text: resting ? 'Skip' : 'Rest',
    attr: { type: 'button' },
  })
  primary.disabled = phase.paused
  primary.addEventListener('click', handlers.primary)

  const controls = runner.createDiv({ cls: 'fitkit-runner-controls' })
  const pause = controls.createEl('button', {
    cls: 'fitkit-btn',
    attr: { type: 'button', 'aria-label': phase.paused ? 'Resume run' : 'Pause run' },
  })
  setIcon(pause, phase.paused ? 'play' : 'pause')
  pause.createSpan({ text: phase.paused ? 'Resume' : 'Pause' })
  pause.addEventListener('click', handlers.togglePause)
  const end = controls.createEl('button', {
    cls: 'fitkit-btn',
    attr: { type: 'button', 'aria-label': 'End run' },
  })
  setIcon(end, 'square')
  end.createSpan({ text: 'End run' })
  end.addEventListener('click', handlers.end)
  return clock
}

/** One dot per planned rep: on target, short of it, the rep under way, or still to come. */
function renderDots(parent: HTMLElement, model: RunnerModel): void {
  const dots = parent.createDiv({ cls: 'fitkit-runner-dots' })
  const done = repsWithWorkDone(model.rows)
  const working = hasOpenRep(model.rows) && done.length < model.rows.length
  for (let i = 0; i < model.plan.reps; i++) {
    const row = done[i]
    const state = row
      ? isOnTarget(row, model.plan)
        ? 'is-hit'
        : 'is-miss'
      : working && i === done.length
        ? 'is-current'
        : ''
    dots.createSpan({ cls: `fitkit-runner-dot ${state}`.trim() })
  }
}

function renderStats(parent: HTMLElement, model: RunnerModel): void {
  const kind = model.plan.intensity.kind
  const done = repsWithWorkDone(model.rows)
    .map((row) => row[kind])
    .filter((value): value is number => value !== undefined)
  const last = done[done.length - 1]
  if (last === undefined) {
    return
  }
  const average = done.reduce((sum, value) => sum + value, 0) / done.length
  parent.createDiv({
    cls: 'fitkit-runner-stats',
    text: `Last ${formatIntensity(kind, last)} · avg ${formatIntensity(kind, Math.round(average * 10) / 10)}`,
  })
}

/** During rest, corrects the rep just done, read off the machine's console. */
function renderStepper(parent: HTMLElement, model: RunnerModel, handlers: RunnerHandlers): void {
  const kind = model.plan.intensity.kind
  const value = model.rows[model.rows.length - 1]?.[kind]
  const stepper = parent.createDiv({ cls: 'fitkit-runner-stepper' })
  const lower = stepper.createEl('button', {
    cls: 'fitkit-btn',
    text: '−',
    attr: { type: 'button', 'aria-label': 'Lower last rep' },
  })
  lower.addEventListener('click', () => handlers.adjust(-ADJUST_STEP[kind]))
  stepper.createSpan({
    cls: 'fitkit-runner-stepper-value',
    text: value === undefined ? '' : `Rep ${model.rows.length}: ${formatIntensity(kind, value)}`,
  })
  const raise = stepper.createEl('button', {
    cls: 'fitkit-btn',
    text: '+',
    attr: { type: 'button', 'aria-label': 'Raise last rep' },
  })
  raise.addEventListener('click', () => handlers.adjust(ADJUST_STEP[kind]))
}

function renderFinished(
  runner: HTMLElement,
  model: RunnerModel,
  hits: number,
  handlers: RunnerHandlers,
): void {
  runner.addClass('is-finished')
  const top = runner.createDiv({ cls: 'fitkit-runner-top' })
  top.createSpan({ cls: 'fitkit-runner-phase', text: 'Run finished' })
  top.createSpan({ cls: 'fitkit-runner-name', text: model.exerciseName })
  const center = runner.createDiv({ cls: 'fitkit-runner-center' })
  center.createDiv({ cls: 'fitkit-runner-hits', text: `${hits}/${model.plan.reps}` })
  center.createDiv({ cls: 'fitkit-runner-target', text: 'reps on target' })
  renderDots(center, model)
  const back = runner.createEl('button', {
    cls: 'fitkit-btn fitkit-btn-primary fitkit-runner-primary',
    text: 'Back to workout',
    attr: { type: 'button' },
  })
  back.addEventListener('click', handlers.back)
}

function renderCutOff(
  runner: HTMLElement,
  model: RunnerModel,
  cut: { rep: number; resting: boolean },
  handlers: RunnerHandlers,
): void {
  runner.addClass('is-cut-off')
  const where = cut.resting ? `rep ${cut.rep} rest` : `rep ${cut.rep}`
  const banner = runner.createDiv({ cls: 'fitkit-runner-banner' })
  banner.createDiv({ cls: 'fitkit-runner-phase', text: `Run cut off at ${where}` })
  banner.createDiv({
    cls: 'fitkit-runner-note',
    text: `Obsidian closed during ${where} of ${model.exerciseName}, and the clock has since passed the end of the plan, so no reps were filled in.`,
  })
  const resume = runner.createEl('button', {
    cls: 'fitkit-btn fitkit-btn-primary fitkit-runner-primary',
    text: `Resume rep ${cut.resting ? cut.rep + 1 : cut.rep}`,
    attr: { type: 'button' },
  })
  resume.addEventListener('click', handlers.resumeCut)
  const end = runner.createEl('button', {
    cls: 'fitkit-btn',
    text: 'End run here',
    attr: { type: 'button' },
  })
  end.addEventListener('click', handlers.endCut)
}

function formatIntensity(kind: IntensityKind, value: number): string {
  return kind === 'level' ? `L${value}` : `${value}${UNIT[kind]}`
}
