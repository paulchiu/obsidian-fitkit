import type { BodyweightLadder } from '../../domain/bodyweight-levels'
import type { ChartSeries } from '../../domain/exercise-chart'
import {
  DOT_RADIUS,
  buildChartLayout,
  chartEmptyMessage,
  chartTitle,
} from '../model/exercise-chart-layout'

export interface ExerciseChartProps {
  series: ChartSeries
  notes?: string[]
  ladder?: BodyweightLadder
}

/** A one-line message in the chart's empty-state style. */
export function ChartMessage({ text }: { text: string }) {
  return <div class="fitkit-chart-empty">{text}</div>
}

/** The exercise chart's notes, title and plot, or its empty state when the series has no sessions. */
export function ExerciseChart({ series, notes = [], ladder }: ExerciseChartProps) {
  return (
    <>
      {notes.map((note) => (
        <div class="fitkit-chart-note">{note}</div>
      ))}
      <div class="fitkit-chart-title">{chartTitle(series)}</div>
      {series.points.length === 0 ? (
        <ChartMessage text={chartEmptyMessage(series)} />
      ) : (
        <ChartPlot series={series} ladder={ladder} />
      )}
    </>
  )
}

function ChartPlot({ series, ladder }: { series: ChartSeries; ladder?: BodyweightLadder }) {
  const layout = buildChartLayout(series, ladder)
  return (
    <svg
      class="fitkit-chart-svg"
      viewBox={layout.viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={layout.title}
    >
      {layout.grid.map((line) => (
        <line class="fitkit-chart-grid" x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />
      ))}
      {layout.axes.map((line) => (
        <line class="fitkit-chart-axis" x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />
      ))}
      {layout.metricLabel && (
        <text
          class="fitkit-chart-axis-label"
          x={layout.metricLabel.x}
          y={layout.metricLabel.y}
          text-anchor="start"
        >
          {layout.metricLabel.text}
        </text>
      )}
      {layout.yLabels.map((label) => (
        <text
          class="fitkit-chart-axis-label"
          x={label.x}
          y={label.y}
          text-anchor="end"
          data-axis="y"
        >
          {label.text}
          {label.fullName !== undefined && <title>{label.fullName}</title>}
        </text>
      ))}
      {layout.xLabels.map((label) => (
        <text
          class="fitkit-chart-axis-label"
          x={label.x}
          y={label.y}
          text-anchor={label.anchor}
          data-axis="x"
        >
          {label.text}
        </text>
      ))}
      {layout.linePoints !== null && (
        <polyline class="fitkit-chart-line" points={layout.linePoints} fill="none" />
      )}
      {layout.dots.map((dot) => (
        <circle class="fitkit-chart-dot" cx={dot.cx} cy={dot.cy} r={DOT_RADIUS}>
          <title>{dot.tooltip}</title>
        </circle>
      ))}
    </svg>
  )
}
