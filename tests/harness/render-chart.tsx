import { render } from 'preact'

import type { BodyweightLadder } from '../../src/domain/bodyweight-levels'
import type { ChartSeries } from '../../src/domain/exercise-chart'
import { ExerciseChart } from '../../src/ui/components/exercise-chart'

/** Draws the chart into `container` the way the chart block does: the container carries `fitkit-chart`. */
export function renderChart(
  container: HTMLElement,
  series: ChartSeries,
  options: { notes?: string[]; ladder?: BodyweightLadder } = {},
): void {
  container.classList.add('fitkit-chart')
  render(<ExerciseChart series={series} notes={options.notes} ladder={options.ladder} />, container)
}
