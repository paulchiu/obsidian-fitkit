import { formatDurationInput } from '../../domain/duration-input'
import type { PlanSummary } from '../../domain/plan-summary'

const PROFILE_HEIGHT = 40
const STRIP_HEIGHT = 6

/**
 * The interval card's plan: a profile with each step's bars in its colour, a strip of logged
 * reps by hit with a tick where the next starts, a legend line keyed to the bar colours, and totals.
 */
export function renderPlanSummary(parent: HTMLElement, summary: PlanSummary, plan: string): void {
  const { seconds } = summary
  /** A sliver of the plan's length, so neighbouring bars stay apart at any width. */
  const gap = seconds * 0.003
  const box = (height: number): string => `0 0 ${seconds} ${height}`

  const profile = parent.createSvg('svg', {
    cls: 'fitkit-plan-profile',
    attr: { viewBox: box(PROFILE_HEIGHT), preserveAspectRatio: 'none', 'aria-hidden': 'true' },
  })
  const strip = parent.createSvg('svg', {
    cls: 'fitkit-plan-strip',
    attr: { viewBox: box(STRIP_HEIGHT), preserveAspectRatio: 'none', 'aria-hidden': 'true' },
  })
  for (const bar of summary.bars) {
    const width = String(Math.max(gap, bar.seconds - gap))
    const height = bar.height * PROFILE_HEIGHT
    profile.createSvg('rect', {
      cls: ['fitkit-plan-bar', `is-key-${bar.key}`],
      attr: { x: bar.start, y: PROFILE_HEIGHT - height, width, height },
    })
    strip.createSvg('rect', {
      cls: ['fitkit-plan-progress', `is-${bar.state}`],
      attr: { x: bar.start, y: 0, width, height: STRIP_HEIGHT },
    })
  }
  if (summary.nextAt !== undefined) {
    const width = seconds * 0.008
    strip.createSvg('rect', {
      cls: 'fitkit-plan-marker',
      attr: { x: summary.nextAt - width / 2, y: 0, width, height: STRIP_HEIGHT },
    })
  }

  const legend = parent.createDiv({ cls: 'fitkit-plan-legend' })
  if (!summary.legend) {
    legend.setText(plan)
  }
  for (const part of summary.legend ?? []) {
    if (part.kind === 'step') {
      const step = legend.createSpan({ cls: 'fitkit-plan-step' })
      step.createSpan({ cls: `fitkit-plan-swatch is-key-${part.key}` })
      step.createSpan({ text: `${part.name} ` })
      step.createSpan({ cls: 'fitkit-plan-muted', text: part.time })
      if (part.target) {
        step.createSpan({ text: ` ${part.target}` })
      }
    } else if (part.kind === 'count') {
      legend.createSpan({ cls: 'fitkit-plan-count', text: part.text })
    } else {
      legend.createSpan({ cls: 'fitkit-plan-muted', text: part.text })
    }
  }

  const totals = parent.createDiv({ cls: 'fitkit-plan-totals' })
  const reps = `${summary.reps} ${summary.reps === 1 ? 'rep' : 'reps'}`
  totals.createSpan({ text: `${reps} · ${formatDurationInput(seconds)}` })
  if (summary.done > 0) {
    totals.createSpan({ text: `${summary.done} of ${summary.reps} done` })
  }
}
