import { setIcon } from 'obsidian'
import { createRef, render, type JSX, type RefObject } from 'preact'
import { useLayoutEffect } from 'preact/hooks'

import { formatDurationInput } from '../../domain/duration-input'
import { useDomEffect } from './dom-effect'
import { formatClock } from '../obsidian/interval-runner'

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

/** A drawn timer screen: the clock the view refreshes every tick, and how to take the screen down. */
export interface TimerScreenMount {
  clock: HTMLElement
  unmount: () => void
}

/**
 * The runner screen cut down to a stopwatch for one duration set, with every control
 * a stretch session needs so the workout never has to be reopened between sets.
 */
export function renderSetTimer(
  parent: HTMLElement,
  model: SetTimerModel,
  handlers: SetTimerHandlers,
): TimerScreenMount {
  return mount(parent, (clock) => <SetTimer model={model} handlers={handlers} clock={clock} />)
}

/** The runner screen as a plain count-up rest clock; stopping it returns to the workout. */
export function renderRestTimer(
  parent: HTMLElement,
  seconds: number,
  handlers: { stop: () => void },
): TimerScreenMount {
  return mount(parent, (clock) => (
    <RestTimer seconds={seconds} stop={handlers.stop} clock={clock} />
  ))
}

function mount(
  parent: HTMLElement,
  screen: (clock: RefObject<HTMLDivElement>) => JSX.Element,
): TimerScreenMount {
  const clock = createRef<HTMLDivElement>()
  render(screen(clock), parent)
  if (!clock.current) {
    throw new Error('Timer screen drew no clock')
  }
  return { clock: clock.current, unmount: () => render(null, parent) }
}

function SetTimer({
  model,
  handlers,
  clock,
}: {
  model: SetTimerModel
  handlers: SetTimerHandlers
  clock: RefObject<HTMLDivElement>
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

function RestTimer({
  seconds,
  stop,
  clock,
}: {
  seconds: number
  stop: () => void
  clock: RefObject<HTMLDivElement>
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

/** The clock's text is set outside the render, since the view rewrites it on every tick. */
function Clock({
  seconds,
  clock,
}: {
  seconds: number
  clock: RefObject<HTMLDivElement>
}): JSX.Element {
  useLayoutEffect(() => {
    clock.current?.setText(formatClock(seconds))
  }, [seconds])
  return <div class="fitkit-runner-clock" ref={clock} />
}

function Control({
  icon,
  text,
  label,
  onClick,
}: {
  icon: string
  text: string
  label: string
  onClick: () => void
}): JSX.Element {
  const glyph = useDomEffect<HTMLSpanElement>((el) => setIcon(el, icon), [icon])
  return (
    <button type="button" class="fitkit-btn" aria-label={label} onClick={onClick}>
      <span class="fitkit-runner-icon" ref={glyph} />
      <span>{text}</span>
    </button>
  )
}
