import type { JSX, RefObject } from 'preact'

import { formatDurationInput } from '../../domain/duration-input'
import { Clock, Control } from './screen-parts'

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
 */
export function SetTimer({
  model,
  handlers,
  clock,
}: {
  model: SetTimerModel
  handlers: SetTimerHandlers
  clock: RefObject<HTMLDivElement | null>
}): JSX.Element {
  const primary = model.running
    ? { text: 'Stop', label: 'Stop timer', onClick: handlers.stop }
    : { text: 'Next set', label: 'Next set', onClick: handlers.next }
  const second = model.running
    ? { icon: 'skip-forward', text: 'Next set', label: 'Next set', onClick: handlers.next }
    : { icon: 'play', text: 'Resume', label: 'Resume timer', onClick: handlers.resume }
  return (
    <div class={model.running ? 'fitkit-runner is-work' : 'fitkit-runner is-work is-paused'}>
      <div class="fitkit-runner-top">
        <span class="fitkit-runner-phase">Set {model.set}</span>
        <span class="fitkit-runner-name">{model.exerciseName}</span>
      </div>
      <div class="fitkit-runner-center">
        <Clock seconds={model.seconds} clock={clock} />
        {model.previousSeconds !== undefined && (
          <div class="fitkit-runner-stats">
            Last set {formatDurationInput(model.previousSeconds)}
          </div>
        )}
        {!model.running && <div class="fitkit-runner-note">Stopped</div>}
      </div>
      <button
        type="button"
        class="fitkit-btn fitkit-runner-primary fitkit-btn-primary"
        aria-label={primary.label}
        onClick={primary.onClick}
      >
        {primary.text}
      </button>
      <div class="fitkit-runner-controls is-three">
        <Control {...second} />
        <Control icon="rotate-ccw" text="Reset" label="Reset set" onClick={handlers.reset} />
        <Control icon="check" text="Done" label="Close timer" onClick={handlers.done} />
      </div>
    </div>
  )
}

/** The runner screen as a plain count-up rest clock; stopping it returns to the workout. */
export function RestTimer({
  seconds,
  stop,
  clock,
}: {
  seconds: number
  stop: () => void
  clock: RefObject<HTMLDivElement | null>
}): JSX.Element {
  return (
    <div class="fitkit-runner is-rest">
      <div class="fitkit-runner-top">
        <span class="fitkit-runner-phase">Rest</span>
      </div>
      <div class="fitkit-runner-center">
        <Clock seconds={seconds} clock={clock} />
      </div>
      <button
        type="button"
        class="fitkit-btn fitkit-runner-primary"
        aria-label="Stop rest timer"
        onClick={stop}
      >
        Stop rest
      </button>
    </div>
  )
}
