import type { JSX } from 'preact'

import { formatDurationInput } from '../../domain/duration-input'
import type { PlanSummary as PlanSummaryModel } from '../../domain/plan-summary'

const PROFILE_HEIGHT = 40
const STRIP_HEIGHT = 6

/**
 * The interval card's plan: a profile with each step's bars in its colour, a strip of logged
 * reps by hit with a tick where the next starts, a legend line keyed to the bar colours, and totals.
 */
export function PlanSummary({
  summary,
  plan,
}: {
  summary: PlanSummaryModel
  plan: string
}): JSX.Element {
  const { seconds } = summary
  /** A sliver of the plan's length, so neighbouring bars stay apart at any width. */
  const gap = seconds * 0.003
  const box = (height: number): string => `0 0 ${seconds} ${height}`
  const bars = summary.bars.map((bar) => ({
    bar,
    width: String(Math.max(gap, bar.seconds - gap)),
    height: bar.height * PROFILE_HEIGHT,
  }))
  const markerWidth = seconds * 0.008
  const reps = `${summary.reps} ${summary.reps === 1 ? 'rep' : 'reps'}`
  return (
    <>
      <svg
        class="fitkit-plan-profile"
        viewBox={box(PROFILE_HEIGHT)}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {bars.map(({ bar, width, height }) => (
          <rect
            class={`fitkit-plan-bar is-key-${bar.key}`}
            x={bar.start}
            y={PROFILE_HEIGHT - height}
            width={width}
            height={height}
          />
        ))}
      </svg>
      <svg
        class="fitkit-plan-strip"
        viewBox={box(STRIP_HEIGHT)}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {bars.map(({ bar, width }) => (
          <rect
            class={`fitkit-plan-progress is-${bar.state}`}
            x={bar.start}
            y={0}
            width={width}
            height={STRIP_HEIGHT}
          />
        ))}
        {summary.nextAt !== undefined && (
          <rect
            class="fitkit-plan-marker"
            x={summary.nextAt - markerWidth / 2}
            y={0}
            width={markerWidth}
            height={STRIP_HEIGHT}
          />
        )}
      </svg>
      <div class="fitkit-plan-legend">
        {summary.legend ? summary.legend.map((part) => <LegendPart part={part} />) : plan}
      </div>
      <div class="fitkit-plan-totals">
        <span>{`${reps} · ${formatDurationInput(seconds)}`}</span>
        {summary.done > 0 && <span>{`${summary.done} of ${summary.reps} done`}</span>}
      </div>
    </>
  )
}

type LegendPartModel = NonNullable<PlanSummaryModel['legend']>[number]

function LegendPart({ part }: { part: LegendPartModel }): JSX.Element {
  if (part.kind === 'step') {
    return (
      <span class="fitkit-plan-step">
        <span class={`fitkit-plan-swatch is-key-${part.key}`} />
        <span>{`${part.name} `}</span>
        <span class="fitkit-plan-muted">{part.time}</span>
        {part.target && <span>{` ${part.target}`}</span>}
      </span>
    )
  }
  if (part.kind === 'count') {
    return <span class="fitkit-plan-count">{part.text}</span>
  }
  return <span class="fitkit-plan-muted">{part.text}</span>
}
