import { createRef, render, type JSX, type RefObject } from 'preact'
import { useLayoutEffect } from 'preact/hooks'

import { formatTarget } from '../../domain/interval-plan'
import { formatStep, type IntervalProgram } from '../../domain/interval-program'
import { runPhase, stepAt, targetedSteps } from '../../domain/interval-run'
import type { RunScreen } from '../../domain/interval-session'
import { formatClock } from '../model/clock'
import {
  ADJUST_STEP,
  clockSeconds,
  dotStates,
  primaryLabel,
  roundsLabel,
  statsLabel,
  stepperValue,
  type RunnerTimeline,
} from '../model/interval-runner'
import { HostContext, type Host } from './host'
import { Control } from './timer-screen'

export interface RunnerModel extends RunnerTimeline {
  exerciseName: string
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

/** A drawn runner: the clock the view refreshes every tick (null off the running screen), and how to take it down. */
export interface RunnerMount {
  clock: HTMLElement | null
  unmount: () => void
}

/** Draws the run screen that takes over the editor tab. */
export function renderRunner(
  parent: HTMLElement,
  model: RunnerModel,
  handlers: RunnerHandlers,
  host: Host,
): RunnerMount {
  const clock = createRef<HTMLDivElement>()
  render(
    <HostContext.Provider value={host}>
      <Runner model={model} handlers={handlers} clock={clock} />
    </HostContext.Provider>,
    parent,
  )
  return { clock: clock.current, unmount: () => render(null, parent) }
}

function Runner({
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
      return <CutOff model={model} cut={screen} handlers={handlers} />
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
  const target = resting ? 'rest' : step.target ? `${formatTarget(step.target)} target` : null
  const rounds = roundsLabel(step, program)
  const stats = statsLabel(model)
  const stepper = resting && program.intensity ? program.intensity : null
  return (
    <div
      class={`fitkit-runner ${resting ? 'is-rest' : 'is-work'}${phase.paused ? ' is-paused' : ''}`}
    >
      <div class="fitkit-runner-top">
        <span class="fitkit-runner-phase">
          {`${resting ? 'Rest' : 'Work'} · rep ${phase.rep} of ${program.steps.length}`}
        </span>
        <span class="fitkit-runner-name">{model.exerciseName}</span>
      </div>
      <div class="fitkit-runner-center">
        {!resting && step.name !== undefined && <div class="fitkit-runner-step">{step.name}</div>}
        <Clock seconds={clockSeconds(model)} clock={clock} />
        {target !== null && <div class="fitkit-runner-target">{target}</div>}
        {rounds !== null && <div class="fitkit-runner-rounds">{rounds}</div>}
        {upcoming && <div class="fitkit-runner-next">{`Next: ${formatStep(upcoming)}`}</div>}
        <Dots model={model} />
        {stats !== null && <div class="fitkit-runner-stats">{stats}</div>}
        {phase.paused && <div class="fitkit-runner-note">Paused</div>}
        {stepper !== null && <Stepper model={model} kind={stepper} adjust={handlers.adjust} />}
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

/** The clock's text is set outside the render, since the view rewrites it on every tick. */
function Clock({
  seconds,
  clock,
}: {
  seconds: number
  clock: RefObject<HTMLDivElement>
}): JSX.Element {
  useLayoutEffect(() => {
    if (clock.current) clock.current.textContent = formatClock(seconds)
  }, [seconds])
  return <div class="fitkit-runner-clock" ref={clock} />
}

function Dots({ model }: { model: RunnerModel }): JSX.Element {
  return (
    <div class="fitkit-runner-dots">
      {dotStates(model).map((state, i) => (
        <span key={i} class={`fitkit-runner-dot ${state}`.trim()} />
      ))}
    </div>
  )
}

/** During rest, corrects the rep just done, read off the machine's console. */
function Stepper({
  model,
  kind,
  adjust,
}: {
  model: RunnerModel
  kind: NonNullable<IntervalProgram['intensity']>
  adjust: (delta: number) => void
}): JSX.Element {
  return (
    <div class="fitkit-runner-stepper">
      <button
        type="button"
        class="fitkit-btn"
        aria-label="Lower last rep"
        onClick={() => adjust(-ADJUST_STEP[kind])}
      >
        −
      </button>
      <span class="fitkit-runner-stepper-value">{stepperValue(model)}</span>
      <button
        type="button"
        class="fitkit-btn"
        aria-label="Raise last rep"
        onClick={() => adjust(ADJUST_STEP[kind])}
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
  const targeted = targetedSteps(model.program)
  const [count, label] =
    targeted > 0
      ? [`${hits}/${targeted}`, 'reps on target']
      : [String(model.rows.length), 'reps done']
  return (
    <div class="fitkit-runner is-finished">
      <div class="fitkit-runner-top">
        <span class="fitkit-runner-phase">Run finished</span>
        <span class="fitkit-runner-name">{model.exerciseName}</span>
      </div>
      <div class="fitkit-runner-center">
        <div class="fitkit-runner-hits">{count}</div>
        <div class="fitkit-runner-target">{label}</div>
        <Dots model={model} />
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
  model,
  cut,
  handlers,
}: {
  model: RunnerModel
  cut: { rep: number; resting: boolean }
  handlers: RunnerHandlers
}): JSX.Element {
  const where = cut.resting ? `rep ${cut.rep} rest` : `rep ${cut.rep}`
  return (
    <div class="fitkit-runner is-cut-off">
      <div class="fitkit-runner-banner">
        <div class="fitkit-runner-phase">{`Run cut off at ${where}`}</div>
        <div class="fitkit-runner-note">
          {`Obsidian closed during ${where} of ${model.exerciseName}, and the clock has since passed the end of the plan, so no reps were filled in.`}
        </div>
      </div>
      <button
        type="button"
        class="fitkit-btn fitkit-btn-primary fitkit-runner-primary"
        onClick={handlers.resumeCut}
      >
        {`Resume rep ${cut.resting ? cut.rep + 1 : cut.rep}`}
      </button>
      <button type="button" class="fitkit-btn" onClick={handlers.endCut}>
        End run here
      </button>
    </div>
  )
}
