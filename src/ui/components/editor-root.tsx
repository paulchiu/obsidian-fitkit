import type { JSX, RefObject } from 'preact'
import { useLayoutEffect } from 'preact/hooks'

import { formatDurationInput } from '../../domain/duration-input'
import { useDomEffect } from './dom-effect'
import { ExerciseCardView, type CardHandlers, type CardProps } from './exercise-card'
import { useIcon } from './host'
import { Runner, type RunnerHandlers, type RunnerModel } from './interval-runner'
import { RestTimer, SetTimer, type SetTimerHandlers, type SetTimerModel } from './timer-screen'

/** What the editor view does for the page outside the cards. */
export interface EditorHandlers {
  rename: (name: string) => void
  reload: () => void
  addExercise: () => void
  startRest: () => void
}

export interface EditorPage {
  /** Identity of the loaded workout; a new one is when the name box takes its text again. */
  workoutKey: object
  name: string
  /** A note without `type: workout` shows the warning and no cards. */
  isWorkout: boolean
  metaLine: string
  /** The view rewrites the meta line through this as autosave settles. */
  metaLineRef: RefObject<HTMLSpanElement | null>
  conflict: boolean
  cards: Array<Omit<CardProps, 'handlers'>>
  cardHandlers: CardHandlers
  restEnabled: boolean
  lastRestSeconds: number | null
  handlers: EditorHandlers
}

/** What the editor tab shows: a message, the loading skeleton, a full-tab screen, or the workout. */
export type EditorScene =
  | { kind: 'empty'; message: string }
  | { kind: 'loading' }
  | {
      kind: 'set-timer'
      model: SetTimerModel
      handlers: SetTimerHandlers
      clock: RefObject<HTMLDivElement | null>
    }
  | { kind: 'rest'; seconds: number; stop: () => void; clock: RefObject<HTMLDivElement | null> }
  | {
      kind: 'run'
      model: RunnerModel
      handlers: RunnerHandlers
      clock: RefObject<HTMLDivElement | null>
    }
  | { kind: 'editor'; page: EditorPage }

/** The whole editor tab, redrawn in place from the scene the view hands it. */
export function EditorRoot({ scene }: { scene: EditorScene }): JSX.Element {
  switch (scene.kind) {
    case 'empty':
      return <div class="fitkit-empty">{scene.message}</div>
    case 'loading':
      return <Skeleton />
    case 'set-timer':
      return (
        <Container>
          <SetTimer model={scene.model} handlers={scene.handlers} clock={scene.clock} />
        </Container>
      )
    case 'rest':
      return (
        <Container>
          <RestTimer seconds={scene.seconds} stop={scene.stop} clock={scene.clock} />
        </Container>
      )
    case 'run':
      return (
        <Container>
          <Runner model={scene.model} handlers={scene.handlers} clock={scene.clock} />
        </Container>
      )
    case 'editor':
      return (
        <Container>
          <Page page={scene.page} />
        </Container>
      )
  }
}

function Container({ children }: { children: JSX.Element }): JSX.Element {
  return <div class="fitkit-container">{children}</div>
}

function Skeleton(): JSX.Element {
  return (
    <div class="fitkit-skeleton">
      {[0, 1, 2].map((i) => (
        <div class="fitkit-skeleton-card" key={i}>
          <div class="fitkit-skeleton-row">
            <div class="fitkit-skeleton-line is-tall is-medium" />
            <div class="fitkit-skeleton-line is-tall is-short" />
          </div>
          <div class="fitkit-skeleton-line is-short" />
          <div class="fitkit-skeleton-line" />
          <div class="fitkit-skeleton-line is-medium" />
        </div>
      ))}
    </div>
  )
}

function Page({ page }: { page: EditorPage }): JSX.Element {
  return (
    <>
      <Header page={page} />
      {!page.isWorkout ? (
        <div class="fitkit-warn">
          This note has no `type: workout` frontmatter. The editor will not save changes here.
        </div>
      ) : (
        <>
          {page.conflict && <Conflict reload={page.handlers.reload} />}
          <div class="fitkit-exercise-list">
            {page.cards.map((card) => (
              <ExerciseCardView key={card.ex} {...card} handlers={page.cardHandlers} />
            ))}
          </div>
          <Footer page={page} />
        </>
      )}
    </>
  )
}

function Header({ page }: { page: EditorPage }): JSX.Element {
  const name = useDomEffect<HTMLInputElement>(
    (input) => {
      input.value = page.name
    },
    [page.workoutKey],
  )
  /** The view also writes this line as autosave settles, so it is never drawn as a child. */
  const meta = page.metaLineRef
  useLayoutEffect(() => {
    if (meta.current) meta.current.textContent = page.metaLine
  })
  return (
    <div class="fitkit-header">
      <div class="fitkit-meta">
        {page.isWorkout && (
          <div class="fitkit-name-field">
            <input
              ref={name}
              type="text"
              id="fitkit-workout-name"
              class="fitkit-workout-name-input"
              placeholder="Untitled workout"
              aria-label="Workout name"
              onInput={(evt) => page.handlers.rename(evt.currentTarget.value)}
            />
          </div>
        )}
        <span ref={meta} class="fitkit-meta-line" />
      </div>
    </div>
  )
}

function Conflict({ reload }: { reload: () => void }): JSX.Element {
  return (
    <div class="fitkit-conflict">
      <span>File changed on disk. Reload to pick up external edits before continuing.</span>
      <button class="fitkit-btn fitkit-btn-warn" onClick={reload}>
        Reload from disk
      </button>
    </div>
  )
}

function Footer({ page }: { page: EditorPage }): JSX.Element {
  return (
    <div class="fitkit-footer">
      <button class="fitkit-btn" onClick={page.handlers.addExercise}>
        Add exercise
      </button>
      {page.restEnabled && (
        <RestControl last={page.lastRestSeconds} start={page.handlers.startRest} />
      )}
    </div>
  )
}

function RestControl({ last, start }: { last: number | null; start: () => void }): JSX.Element {
  const icon = useIcon<HTMLSpanElement>('timer')
  return (
    <div class="fitkit-rest-timer-control">
      <button
        type="button"
        class="fitkit-btn fitkit-btn-muted fitkit-rest-timer-button"
        aria-label="Start rest timer"
        onClick={start}
      >
        <span ref={icon} class="fitkit-rest-timer-icon" />
        <span class="fitkit-rest-timer-label">Start rest</span>
      </button>
      {last !== null && (
        <span class="fitkit-rest-timer-last">{`Last rest ${formatDurationInput(last)}`}</span>
      )}
    </div>
  )
}
