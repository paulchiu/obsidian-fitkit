import { setIcon } from 'obsidian'

import { formatTarget, type IntensityKind } from '../../domain/interval-plan'
import { formatStep, type IntervalProgram, type PlanStep } from '../../domain/interval-program'
import {
  hasOpenRep,
  isOnTarget,
  repsWithWorkDone,
  restsAfter,
  runPhase,
  stepAt,
  targetedSteps,
  type RunRow,
} from '../../domain/interval-run'
import type { RunScreen } from '../../domain/interval-session'

export interface RunnerModel {
  exerciseName: string
  program: IntervalProgram
  rows: readonly RunRow[]
  now: number
  screen: RunScreen
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
  const phase = runPhase(model.rows, model.program, model.now)
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
  const phase = runPhase(model.rows, model.program, model.now)
  if (phase.kind === 'idle') {
    return null
  }
  const step = stepAt(model.program, phase.rep - 1)
  if (!step) {
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
    text: `${resting ? 'Rest' : 'Work'} · rep ${phase.rep} of ${model.program.steps.length}`,
  })
  top.createSpan({ cls: 'fitkit-runner-name', text: model.exerciseName })

  const center = runner.createDiv({ cls: 'fitkit-runner-center' })
  if (!resting && step.name !== undefined) {
    center.createDiv({ cls: 'fitkit-runner-step', text: step.name })
  }
  const clock = center.createDiv({
    cls: 'fitkit-runner-clock',
    text: formatClock(clockSeconds(model)),
  })
  const target = resting ? 'rest' : step.target ? `${formatTarget(step.target)} target` : null
  if (target !== null) {
    center.createDiv({ cls: 'fitkit-runner-target', text: target })
  }
  const rounds = roundsLabel(step, model.program)
  if (rounds !== null) {
    center.createDiv({ cls: 'fitkit-runner-rounds', text: rounds })
  }
  const upcoming = model.program.steps[phase.rep]
  if (upcoming) {
    center.createDiv({ cls: 'fitkit-runner-next', text: `Next: ${formatStep(upcoming)}` })
  }
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
    text: primaryLabel(resting, step, upcoming),
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

/** Skip during rest; during work, Rest when a rest follows, Next when a step does, Finish on the last. */
function primaryLabel(resting: boolean, step: PlanStep, upcoming: PlanStep | undefined): string {
  if (resting) {
    return 'Skip'
  }
  if (!upcoming) {
    return 'Finish'
  }
  return restsAfter(step) ? 'Rest' : 'Next'
}

/**
 * Where the step sits in its repeats, or null when that would only repeat the rep count:
 * `Round 3 of 10` for one repeat, `Set 2 of 3 · round 1 of 3` for two.
 */
function roundsLabel(step: PlanStep, program: IntervalProgram): string | null {
  const [outer, inner, ...deeper] = step.rounds
  if (!outer || (!inner && outer.of === program.steps.length)) {
    return null
  }
  if (!inner) {
    return `Round ${outer.round} of ${outer.of}`
  }
  if (deeper.length === 0) {
    return `Set ${outer.round} of ${outer.of} · round ${inner.round} of ${inner.of}`
  }
  return step.rounds.map(({ round, of }) => `${round}/${of}`).join(' · ')
}

/** One dot per planned step: on target, short of it, done with no target, under way, or to come. */
function renderDots(parent: HTMLElement, model: RunnerModel): void {
  const dots = parent.createDiv({ cls: 'fitkit-runner-dots' })
  const done = repsWithWorkDone(model.rows)
  const working = hasOpenRep(model.rows) && done.length < model.rows.length
  model.program.steps.forEach((step, i) => {
    const row = done[i]
    const state = row
      ? !step.target
        ? 'is-done'
        : isOnTarget(row, step)
          ? 'is-hit'
          : 'is-miss'
      : working && i === done.length
        ? 'is-current'
        : ''
    dots.createSpan({ cls: `fitkit-runner-dot ${state}`.trim() })
  })
}

function renderStats(parent: HTMLElement, model: RunnerModel): void {
  const kind = model.program.intensity
  if (!kind) {
    return
  }
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
  const kind = model.program.intensity
  if (!kind) {
    return
  }
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
  const targeted = targetedSteps(model.program)
  if (targeted > 0) {
    center.createDiv({ cls: 'fitkit-runner-hits', text: `${hits}/${targeted}` })
    center.createDiv({ cls: 'fitkit-runner-target', text: 'reps on target' })
  } else {
    center.createDiv({ cls: 'fitkit-runner-hits', text: String(model.rows.length) })
    center.createDiv({ cls: 'fitkit-runner-target', text: 'reps done' })
  }
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
