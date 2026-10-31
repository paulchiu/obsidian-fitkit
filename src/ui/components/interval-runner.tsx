import type { JSX, RefObject } from 'preact'

import { formatStep } from '../../domain/interval-program'
import { runPhase, stepAt } from '../../domain/interval-run'
import type { RunScreen } from '../../domain/interval-session'
import type { StepperStep } from '../../domain/interval-stepper'
import {
  cutOffLabels,
  dotStates,
  finishedScore,
  phaseLabel,
  phaseSeconds,
  primaryLabel,
  repStepper,
  roundsLabel,
  statsLabel,
  targetLabel,
  type DotState,
  type RunnerTimeline,
} from '../model/interval-runner'
import { useDomEffect } from './dom-effect'
import { Clock, Control } from './screen-parts'

export interface RunnerModel extends RunnerTimeline {
  exerciseName: string
  screen: RunScreen
  stepperStep: StepperStep
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

/** The run screen that takes over the editor tab; only the running screen has a clock. */
export function Runner({
  model,
  handlers,
  clock,
}: {
  model: RunnerModel
  handlers: RunnerHandlers
  clock: RefObject<HTMLDivElement>
}): JSX.Element {
  const { screen } = model
  switch (screen.kind) {
    case 'finished':
      return <Finished model={model} hits={screen.hits} back={handlers.back} />
    case 'cut-off':
      return (
        <CutOff
          exerciseName={model.exerciseName}
          cut={screen}
          resume={handlers.resumeCut}
          end={handlers.endCut}
        />
      )
    case 'running':
      return <Running model={model} handlers={handlers} clock={clock} />
  }
}

function Running({
  model,
  handlers,
  clock,
}: {
  model: RunnerModel
  handlers: RunnerHandlers
  clock: RefObject<HTMLDivElement>
}): JSX.Element {
  const { program } = model
  const phase = runPhase(model.rows, program, model.now)
  const step = phase.kind === 'idle' ? undefined : stepAt(program, phase.rep - 1)
  if (phase.kind === 'idle' || !step) {
    return <div class="fitkit-runner" />
  }
  const resting = phase.kind === 'rest'
  const upcoming = program.steps[phase.rep]
  const target = targetLabel(resting, step)
  const rounds = roundsLabel(step, program)
  const stats = statsLabel(model)
  const stepper = repStepper(model, model.stepperStep)
  return (
    <div
      class={`fitkit-runner ${resting ? 'is-rest' : 'is-work'}${phase.paused ? ' is-paused' : ''}`}
    >
      <div class="fitkit-runner-top">
        <span class="fitkit-runner-phase">{phaseLabel(resting, phase.rep, program)}</span>
        <span class="fitkit-runner-name">{model.exerciseName}</span>
      </div>
      <div class="fitkit-runner-center">
        {!resting && step.name !== undefined && <div class="fitkit-runner-step">{step.name}</div>}
        <Clock seconds={phaseSeconds(phase)} clock={clock} />
        {target !== null && <div class="fitkit-runner-target">{target}</div>}
        {rounds !== null && <div class="fitkit-runner-rounds">{rounds}</div>}
        {upcoming && <div class="fitkit-runner-next">{`Next: ${formatStep(upcoming)}`}</div>}
        <Dots states={dotStates(model)} />
        {stats !== null && <div class="fitkit-runner-stats">{stats}</div>}
        {phase.paused && <div class="fitkit-runner-note">Paused</div>}
        {stepper !== null && <Stepper {...stepper} adjust={handlers.adjust} />}
      </div>
      <button
        type="button"
        class={`fitkit-btn fitkit-runner-primary${resting ? '' : ' fitkit-btn-primary'}`}
        disabled={phase.paused}
        onClick={handlers.primary}
      >
        {primaryLabel(resting, step, upcoming)}
      </button>
      <div class="fitkit-runner-controls">
        <Control
          icon={phase.paused ? 'play' : 'pause'}
          text={phase.paused ? 'Resume' : 'Pause'}
          label={phase.paused ? 'Resume run' : 'Pause run'}
          onClick={handlers.togglePause}
        />
        <Control icon="square" text="End run" label="End run" onClick={handlers.end} />
      </div>
    </div>
  )
}

const DOT_CLASS: Record<DotState, string> = {
  hit: 'fitkit-runner-dot is-hit',
  miss: 'fitkit-runner-dot is-miss',
  done: 'fitkit-runner-dot is-done',
  current: 'fitkit-runner-dot is-current',
  pending: 'fitkit-runner-dot',
}

/** One dot per planned rep; the stylesheet narrows the gap by the rep count so the row never wraps. */
function Dots({ states }: { states: readonly DotState[] }): JSX.Element {
  const row = useDomEffect<HTMLDivElement>(
    (el) => el.style.setProperty('--fitkit-reps', String(states.length)),
    [states.length],
  )
  return (
    <div class="fitkit-runner-dots" ref={row}>
      {states.map((state, i) => (
        <span key={i} class={DOT_CLASS[state]} />
      ))}
    </div>
  )
}

/** Corrects the rep just done, read off the machine's console. */
function Stepper({
  step,
  value,
  adjust,
}: {
  step: number
  value: string
  adjust: (delta: number) => void
}): JSX.Element {
  return (
    <div class="fitkit-runner-stepper">
      <button
        type="button"
        class="fitkit-btn"
        aria-label="Lower last rep"
        onClick={() => adjust(-step)}
      >
        −
      </button>
      <span class="fitkit-runner-stepper-value">{value}</span>
      <button
        type="button"
        class="fitkit-btn"
        aria-label="Raise last rep"
        onClick={() => adjust(step)}
      >
        +
      </button>
    </div>
  )
}

function Finished({
  model,
  hits,
  back,
}: {
  model: RunnerModel
  hits: number
  back: () => void
}): JSX.Element {
  const { count, caption } = finishedScore(model, hits)
  return (
    <div class="fitkit-runner is-finished">
      <div class="fitkit-runner-top">
        <span class="fitkit-runner-phase">Run finished</span>
        <span class="fitkit-runner-name">{model.exerciseName}</span>
      </div>
      <div class="fitkit-runner-center">
        <div class="fitkit-runner-hits">{count}</div>
        <div class="fitkit-runner-target">{caption}</div>
        <Dots states={dotStates(model)} />
      </div>
      <button
        type="button"
        class="fitkit-btn fitkit-btn-primary fitkit-runner-primary"
        onClick={back}
      >
        Back to workout
      </button>
    </div>
  )
}

function CutOff({
  exerciseName,
  cut,
  resume,
  end,
}: {
  exerciseName: string
  cut: { rep: number; resting: boolean }
  resume: () => void
  end: () => void
}): JSX.Element {
  const labels = cutOffLabels(cut, exerciseName)
  return (
    <div class="fitkit-runner is-cut-off">
      <div class="fitkit-runner-banner">
        <div class="fitkit-runner-phase">{labels.phase}</div>
        <div class="fitkit-runner-note">{labels.note}</div>
      </div>
      <button
        type="button"
        class="fitkit-btn fitkit-btn-primary fitkit-runner-primary"
        onClick={resume}
      >
        {labels.resume}
      </button>
      <button type="button" class="fitkit-btn" onClick={end}>
        End run here
      </button>
    </div>
  )
}
