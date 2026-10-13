import { setIcon } from 'obsidian'

import { formatDurationInput } from '../domain/duration-input'
import { formatClock } from './interval-runner'

export interface SetTimerModel {
  exerciseName: string
  set: number
  seconds: number
  running: boolean
  /** The set before this one, shown so a hold can be matched. */
  previousSeconds?: number
}

export interface SetTimerHandlers {
  stop: () => void
  resume: () => void
  reset: () => void
  next: () => void
  done: () => void
}

/**
 * The runner screen cut down to a stopwatch for one duration set, with every control
 * a stretch session needs so the workout never has to be reopened between sets.
 * Returns the clock element so the view can refresh it every tick.
 */
export function renderSetTimer(
  parent: HTMLElement,
  model: SetTimerModel,
  handlers: SetTimerHandlers,
): HTMLElement {
  const runner = parent.createDiv({ cls: 'fitkit-runner is-work' })
  if (!model.running) {
    runner.addClass('is-paused')
  }
  const top = runner.createDiv({ cls: 'fitkit-runner-top' })
  top.createSpan({ cls: 'fitkit-runner-phase', text: `Set ${model.set}` })
  top.createSpan({ cls: 'fitkit-runner-name', text: model.exerciseName })

  const center = runner.createDiv({ cls: 'fitkit-runner-center' })
  const clock = center.createDiv({ cls: 'fitkit-runner-clock', text: formatClock(model.seconds) })
  if (model.previousSeconds !== undefined) {
    center.createDiv({
      cls: 'fitkit-runner-stats',
      text: `Last set ${formatDurationInput(model.previousSeconds)}`,
    })
  }
  if (!model.running) {
    center.createDiv({ cls: 'fitkit-runner-note', text: 'Stopped' })
  }

  const primary = model.running
    ? { text: 'Stop', label: 'Stop timer', onClick: handlers.stop }
    : { text: 'Next set', label: 'Next set', onClick: handlers.next }
  const button = runner.createEl('button', {
    cls: 'fitkit-btn fitkit-runner-primary fitkit-btn-primary',
    text: primary.text,
    attr: { type: 'button', 'aria-label': primary.label },
  })
  button.addEventListener('click', primary.onClick)

  const controls = runner.createDiv({ cls: 'fitkit-runner-controls is-three' })
  const second = model.running
    ? { icon: 'skip-forward', text: 'Next set', label: 'Next set', onClick: handlers.next }
    : { icon: 'play', text: 'Resume', label: 'Resume timer', onClick: handlers.resume }
  renderControl(controls, second)
  renderControl(controls, {
    icon: 'rotate-ccw',
    text: 'Reset',
    label: 'Reset set',
    onClick: handlers.reset,
  })
  renderControl(controls, {
    icon: 'check',
    text: 'Done',
    label: 'Close timer',
    onClick: handlers.done,
  })
  return clock
}

/** The runner screen as a plain count-up rest clock; stopping it returns to the workout. */
export function renderRestTimer(
  parent: HTMLElement,
  seconds: number,
  handlers: { stop: () => void },
): HTMLElement {
  const runner = parent.createDiv({ cls: 'fitkit-runner is-rest' })
  const top = runner.createDiv({ cls: 'fitkit-runner-top' })
  top.createSpan({ cls: 'fitkit-runner-phase', text: 'Rest' })
  const center = runner.createDiv({ cls: 'fitkit-runner-center' })
  const clock = center.createDiv({ cls: 'fitkit-runner-clock', text: formatClock(seconds) })
  const stop = runner.createEl('button', {
    cls: 'fitkit-btn fitkit-runner-primary',
    text: 'Stop rest',
    attr: { type: 'button', 'aria-label': 'Stop rest timer' },
  })
  stop.addEventListener('click', handlers.stop)
  return clock
}

function renderControl(
  parent: HTMLElement,
  control: { icon: string; text: string; label: string; onClick: () => void },
): void {
  const button = parent.createEl('button', {
    cls: 'fitkit-btn',
    attr: { type: 'button', 'aria-label': control.label },
  })
  setIcon(button, control.icon)
  button.createSpan({ text: control.text })
  button.addEventListener('click', control.onClick)
}
