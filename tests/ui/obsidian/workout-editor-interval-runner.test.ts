import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('obsidian', async () =>
  (await import('../../fixtures/obsidian-editor-mock')).createObsidianMock(),
)

import { options } from 'preact'

import type { WorkoutEditorView } from '../../../src/ui/obsidian/workout-editor-view'
import {
  button,
  openEditor,
  tick,
  useEditorEnvironment,
  WORKOUT_DATE,
} from '../../fixtures/workout-editor'
import { harnessWindow } from '../../harness/obsidian-dom'
import { outline } from '../../harness/outline'
import { findUnstyledClasses } from '../../harness/stylesheet'

useEditorEnvironment()

/** Moves the wall clock to a Brisbane time on the workout's day and fires the view's ticks. */
const at = (time: string): void => {
  vi.setSystemTime(new Date(`${WORKOUT_DATE}T${time}+10:00`))
  tick()
}

/** Walks the clock forward a second at a time to `time`, the way the view's ticks would see it. */
const runTo = (time: string): void => {
  const target = Date.parse(`${WORKOUT_DATE}T${time}+10:00`)
  while (Date.now() < target) {
    vi.setSystemTime(Math.min(Date.now() + 1000, target))
    tick()
  }
}

const bike = (plan: string, ...rows: string[]): string[] => [
  '## [[Exercise Bike]]',
  '',
  `- [exercise:: [[Exercise Bike]]] [plan:: ${plan}]`,
  ...rows.map((row) => `- [exercise:: [[Exercise Bike]]] ${row}`),
]

const BIKE = '3 x 30s @ 300W, 90s rest'
const WARMUP = '(warmup 30s)'
const REP_1_RESTING = `[set:: 1] [duration:: 30] [watts:: 300] [rest:: 0] [started:: ${WORKOUT_DATE}T07:15:30+10:00]`
const REP_1_WORKING = `[set:: 1] [duration:: 0] [started:: ${WORKOUT_DATE}T07:15:00+10:00]`

const open = async (body: string[]): Promise<WorkoutEditorView> => (await openEditor({ body })).view

const start = async (body: string[]): Promise<WorkoutEditorView> => {
  const view = await open(body)
  button(view.contentEl, 'Start interval plan').click()
  return view
}

/** Opens the note at `time`, so a run in its rows reopens as the view loads. */
const reopen = async (time: string, body: string[]): Promise<WorkoutEditorView> => {
  vi.setSystemTime(new Date(`${WORKOUT_DATE}T${time}+10:00`))
  return open(body)
}

const runner = (view: WorkoutEditorView): HTMLElement => {
  const el = view.contentEl.querySelector<HTMLElement>('.fitkit-runner')
  if (!el) {
    throw new Error('No runner rendered')
  }
  return el
}

const runnerText = (view: WorkoutEditorView, cls: string): string | null | undefined =>
  runner(view).querySelector(`.${cls}`)?.textContent

/** Moves into rep 1's rest after 20 s of work. */
const restAfterRep1 = (view: WorkoutEditorView): void => {
  at('07:15:20')
  button(runner(view), 'Rest').click()
}

describe('WorkoutEditorView interval runner', () => {
  const SCREENS: ReadonlyArray<{ screen: string; open: () => Promise<WorkoutEditorView> }> = [
    {
      screen: 'working, no step name or stats yet',
      open: async () => {
        const view = await start(bike(BIKE))
        at('07:15:10')
        return view
      },
    },
    {
      screen: 'working a named step with rounds',
      open: async () => {
        const view = await start(bike('(x 2 (on 30s 350W) (off 30s 150W))'))
        at('07:15:10')
        return view
      },
    },
    {
      screen: 'working a step in nested repeats',
      open: () =>
        start(
          bike(
            '(x 2 (x 2 (over 1m 300W) (under 1m 220W)) (rest 2m))',
            '[set:: 1] [step:: over] [duration:: 60] [watts:: 300]',
            '[set:: 2] [step:: under] [duration:: 60] [watts:: 220]',
            '[set:: 3] [step:: over] [duration:: 60] [watts:: 300]',
            '[set:: 4] [step:: under] [duration:: 60] [watts:: 220] [rest:: 120]',
          ),
        ),
    },
    {
      screen: 'working the last step',
      open: async () => {
        const view = await start(bike(WARMUP))
        at('07:15:10')
        return view
      },
    },
    {
      screen: 'working while paused',
      open: async () => {
        const view = await start(bike(BIKE))
        at('07:15:12')
        button(view.contentEl, 'Pause run').click()
        return view
      },
    },
    {
      screen: 'resting with the stepper and stats',
      open: async () => {
        const view = await start(bike(BIKE))
        restAfterRep1(view)
        at('07:15:25')
        return view
      },
    },
    {
      screen: 'resting while paused',
      open: async () => {
        const view = await start(bike(BIKE))
        restAfterRep1(view)
        button(view.contentEl, 'Pause run').click()
        return view
      },
    },
    {
      screen: 'resting on a plan with no intensity',
      open: async () => {
        const view = await start(bike('(x 3 (work 30s) (rest 90s))'))
        runTo('07:15:31')
        return view
      },
    },
    {
      screen: 'finished, scored against targets',
      open: async () => {
        const view = await start(
          bike(
            BIKE,
            '[set:: 1] [duration:: 30] [watts:: 300] [rest:: 90]',
            '[set:: 2] [duration:: 30] [watts:: 250] [rest:: 90]',
          ),
        )
        runTo('07:15:31')
        return view
      },
    },
    {
      screen: 'finished with no targets',
      open: async () => {
        const view = await start(bike(WARMUP))
        runTo('07:15:31')
        return view
      },
    },
    {
      screen: 'cut off during rest',
      open: () => reopen('08:00:00', bike(BIKE, REP_1_RESTING)),
    },
    {
      screen: 'cut off during work',
      open: () => reopen('08:00:00', bike(BIKE, REP_1_WORKING)),
    },
  ]

  it.each(SCREENS)('draws the runner $screen', async ({ open }) => {
    const view = await open()

    expect(outline(runner(view))).toMatchSnapshot()
    expect(findUnstyledClasses(view.contentEl)).toEqual([])
  })

  it('moves only the clock text on a tick', async () => {
    const view = await start(bike(BIKE))
    const before = runner(view)
    const clock = before.querySelector('.fitkit-runner-clock')
    const children = [...before.querySelectorAll('*')]

    runTo('07:15:04')

    expect([
      runner(view) === before,
      before.querySelector('.fitkit-runner-clock') === clock,
      [...before.querySelectorAll('*')].every((el, i) => el === children[i]),
      clock?.textContent,
    ]).toEqual([true, true, true, '0:26'])
  })

  it('steps the dots and rep label as the run moves on', async () => {
    const view = await start(bike(BIKE))

    runTo('07:15:31')
    const rest = [runner(view).className, runnerText(view, 'fitkit-runner-phase')]
    button(runner(view), 'Skip').click()

    expect([
      rest,
      runner(view).className,
      runnerText(view, 'fitkit-runner-phase'),
      [...runner(view).querySelectorAll('.fitkit-runner-dot')].map((dot) => dot.className),
    ]).toEqual([
      ['fitkit-runner is-rest', 'Rest · rep 1 of 3'],
      'fitkit-runner is-work',
      'Work · rep 2 of 3',
      ['fitkit-runner-dot is-hit', 'fitkit-runner-dot is-current', 'fitkit-runner-dot'],
    ])
  })

  it('disables the primary button while paused and enables it on resume', async () => {
    const view = await start(bike(BIKE))
    at('07:15:12')

    button(view.contentEl, 'Pause run').click()
    const paused = button(runner(view), 'Rest').disabled
    button(view.contentEl, 'Resume run').click()

    expect([paused, button(runner(view), 'Rest').disabled]).toEqual([true, false])
  })

  it.each([
    { kind: 'watts', plan: BIKE, control: 'Raise last rep', value: 'Rep 1: 305 W' },
    { kind: 'watts', plan: BIKE, control: 'Lower last rep', value: 'Rep 1: 295 W' },
    {
      kind: 'load',
      plan: '3 x 30s @ 100kg, 90s rest',
      control: 'Raise last rep',
      value: 'Rep 1: 102.5 kg',
    },
    {
      kind: 'level',
      plan: '3 x 30s @ L4, 90s rest',
      control: 'Raise last rep',
      value: 'Rep 1: L5',
    },
  ])('steps $kind with $control during rest', async ({ plan, control, value }) => {
    const view = await start(bike(plan))
    restAfterRep1(view)

    button(view.contentEl, control).click()

    expect(runnerText(view, 'fitkit-runner-stepper-value')).toBe(value)
  })

  it('corrects the rep just done while working a step that followed it with no rest', async () => {
    const view = await start(bike('(x 2 (on 30s 350W) (off 30s 150W))'))
    runTo('07:15:31')

    expect(runnerText(view, 'fitkit-runner-stepper-value')).toBe('Rep 1: 350 W')
  })

  it('shows no stepper while working the first rep or a rep that followed a rest', async () => {
    const view = await start(bike(BIKE))
    at('07:15:10')
    const first = runnerText(view, 'fitkit-runner-stepper-value')
    restAfterRep1(view)
    button(runner(view), 'Skip').click()

    expect([first, runnerText(view, 'fitkit-runner-stepper-value')]).toEqual([undefined, undefined])
  })

  it('averages the reps done to one decimal place', async () => {
    const view = await start(
      bike(
        '4 x 30s @ 300W, 90s rest',
        '[set:: 1] [duration:: 30] [watts:: 300] [rest:: 90]',
        '[set:: 2] [duration:: 30] [watts:: 300] [rest:: 90]',
        '[set:: 3] [duration:: 30] [watts:: 301] [rest:: 90]',
      ),
    )

    expect(runnerText(view, 'fitkit-runner-stats')).toBe('Last 301 W · avg 300.3 W')
  })

  describe('priming audio', () => {
    let contexts: number

    beforeEach(() => {
      contexts = 0
      class FakeAudioContext {
        currentTime = 0
        destination = {}
        state = 'running'
        constructor() {
          contexts++
        }
        async resume(): Promise<void> {}
        async close(): Promise<void> {}
      }
      Object.defineProperty(harnessWindow, 'AudioContext', {
        configurable: true,
        value: FakeAudioContext,
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(harnessWindow, 'AudioContext')
    })

    it.each([
      { control: 'Rest', primes: 1 },
      { control: 'Pause', primes: 1 },
      { control: 'End run', primes: 0 },
    ])('$control on a reopened run primes audio $primes time(s)', async ({ control, primes }) => {
      const view = await reopen('07:15:10', bike(BIKE, REP_1_WORKING))

      button(runner(view), control).click()

      expect(contexts).toBe(primes)
    })

    it('primes on Resume of a cut-off run', async () => {
      const view = await reopen('08:00:00', bike(BIKE, REP_1_RESTING))

      button(runner(view), 'Resume rep 2').click()

      expect(contexts).toBe(1)
    })

    it('ends a cut-off run on End run here without priming', async () => {
      const view = await reopen('08:00:00', bike(BIKE, REP_1_RESTING))

      button(runner(view), 'End run here').click()

      expect([
        contexts,
        view.contentEl.querySelector('.fitkit-runner'),
        view.contentEl.querySelectorAll('.fitkit-card').length,
      ]).toEqual([0, null, 1])
    })

    it('returns to the workout on Back to workout without priming', async () => {
      const view = await reopen('07:15:10', bike(WARMUP, REP_1_WORKING))
      runTo('07:15:31')
      const phase = runnerText(view, 'fitkit-runner-phase')

      button(runner(view), 'Back to workout').click()

      expect([
        phase,
        contexts,
        view.contentEl.querySelector('.fitkit-runner'),
        view.contentEl.querySelectorAll('.fitkit-card').length,
      ]).toEqual(['Run finished', 0, null, 1])
    })
  })

  describe('leaving', () => {
    /** Records the classes of every vnode Preact unmounts while `act` runs. */
    const unmountedDuring = async (act: () => Promise<void> | void): Promise<string[]> => {
      const unmounted: string[] = []
      const previous = { ...options }
      options.unmount = (vnode) => {
        const cls = (vnode.props as { class?: unknown }).class
        if (typeof cls === 'string') {
          unmounted.push(cls)
        }
        previous.unmount?.(vnode)
      }
      try {
        await act()
      } finally {
        Object.assign(options, previous)
      }
      return unmounted
    }

    it.each([
      { leaving: 'End run', reach: () => {}, label: 'End run' },
      { leaving: 'Back to workout', reach: () => runTo('07:15:31'), label: 'Back to workout' },
    ])('unmounts the runner on $leaving', async ({ reach, label }) => {
      const view = await start(bike(WARMUP))
      reach()

      const unmounted = await unmountedDuring(() => button(runner(view), label).click())

      expect(unmounted.some((cls) => cls.split(' ').includes('fitkit-runner'))).toBe(true)
    })

    it('unmounts the runner when the tab closes', async () => {
      const view = await start(bike(BIKE))

      const unmounted = await unmountedDuring(() => view.onClose())

      expect([
        unmounted.some((cls) => cls.split(' ').includes('fitkit-runner')),
        view.contentEl.childNodes.length,
      ]).toEqual([true, 0])
    })

    it('draws a fresh runner when it is opened again after leaving', async () => {
      const view = await start(bike(BIKE))
      const first = runner(view)
      button(view.contentEl, 'End run').click()

      button(view.contentEl, 'Start interval plan').click()

      expect([runner(view) === first, first.isConnected]).toEqual([false, false])
    })
  })
})
