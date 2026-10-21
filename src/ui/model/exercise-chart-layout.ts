import { bodyweightLevelName, type BodyweightLadder } from '../../domain/bodyweight-levels'
import { formatNumber, formatReps } from '../../domain/number-format'
import { assertUnreachableMetric } from '../../domain/exercise-metric'
import { niceRange, pickXTickIndices, type ChartSeries } from '../../domain/exercise-chart'

const VIEW_WIDTH = 800
const VIEW_HEIGHT = 320
const MARGIN_LEFT = 56
const MARGIN_RIGHT = 16
const MARGIN_TOP = 16
const MARGIN_BOTTOM = 44
const PLOT_HEIGHT = VIEW_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM
const Y_TICKS = 4
/** Level labels are words, so their axis takes a wider margin than a numeric one; the plot narrows to pay for it. */
const LEVEL_MARGIN_LEFT = 140
/** Level axes reuse the numeric axis label budget, so long ladders thin to the same count. */
const MAX_LEVEL_TICKS = Y_TICKS + 1
/** Rung-name characters a level label shows before shortening. SVG has no measuring path, so a fixed budget stands in for the widened margin. */
const LEVEL_LABEL_MAX_CHARS = 20
export const DOT_RADIUS = 3.5

export interface ChartLine {
  x1: number
  x2: number
  y1: number
  y2: number
}

export interface ChartText {
  x: number
  y: number
  text: string
}

export interface ChartYLabel extends ChartText {
  /** The rung name in full, set when `text` shortens it. */
  fullName?: string
}

export interface ChartXLabel extends ChartText {
  anchor: 'middle' | 'end'
}

export interface ChartDot {
  cx: number
  cy: number
  tooltip: string
}

/** Everything the chart svg draws, in the order it draws it. */
export interface ChartLayout {
  title: string
  viewBox: string
  grid: ChartLine[]
  axes: ChartLine[]
  metricLabel: ChartText | null
  yLabels: ChartYLabel[]
  xLabels: ChartXLabel[]
  /** `points` of the series line; null for a lone session. */
  linePoints: string | null
  dots: ChartDot[]
}

interface Range {
  min: number
  max: number
}

/** Shorten a rung name past the axis budget, keeping the distinguishing start and marking the cut. */
function shortenLevelLabel(name: string): string {
  if (name.length <= LEVEL_LABEL_MAX_CHARS) {
    return name
  }
  return `${name.slice(0, LEVEL_LABEL_MAX_CHARS - 1)}…`
}

/** Left margin for a series: rung names need words of room, numbers do not. */
function marginLeft(series: ChartSeries): number {
  return series.metric === 'level' ? LEVEL_MARGIN_LEFT : MARGIN_LEFT
}

/** Plot width for a series, narrowing as its left margin widens. */
function plotWidth(series: ChartSeries): number {
  return VIEW_WIDTH - marginLeft(series) - MARGIN_RIGHT
}

/** The chart's geometry and text for a series with at least one point. */
export function buildChartLayout(series: ChartSeries, ladder?: BodyweightLadder): ChartLayout {
  const range = niceRange(series.points.map((point) => point.value))
  return {
    title: chartTitle(series),
    viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`,
    grid: gridLines(range, series),
    axes: axisLines(series),
    metricLabel: metricLabel(series),
    yLabels: yLabels(range, series, ladder),
    xLabels: xLabels(series),
    ...seriesMarks(series, range, ladder),
  }
}

export function chartTitle(series: ChartSeries): string {
  const count = series.points.length
  if (count === 0) {
    return series.exerciseName
  }
  if (series.totalDates > count) {
    return `${series.exerciseName} · last ${count} of ${series.totalDates} sessions`
  }
  return `${series.exerciseName} · last ${count} session${count === 1 ? '' : 's'}`
}

export function chartEmptyMessage(series: ChartSeries): string {
  return `No ${series.kind} sessions found for this exercise yet.`
}

function horizontalLine(series: ChartSeries, y: number): ChartLine {
  return {
    x1: marginLeft(series),
    x2: marginLeft(series) + plotWidth(series),
    y1: y,
    y2: y,
  }
}

/** Gridlines sit on the labelled ticks: whole rungs for a level axis, even fractions otherwise. */
function gridLines(range: Range, series: ChartSeries): ChartLine[] {
  if (series.metric === 'level') {
    return pickLevelTickLevels(range, series).map((level) =>
      horizontalLine(series, computeY(level, range)),
    )
  }
  return numericTicks().map((ratio) => horizontalLine(series, tickY(ratio)))
}

function axisLines(series: ChartSeries): ChartLine[] {
  return [
    {
      x1: marginLeft(series),
      x2: marginLeft(series),
      y1: MARGIN_TOP,
      y2: MARGIN_TOP + PLOT_HEIGHT,
    },
    horizontalLine(series, MARGIN_TOP + PLOT_HEIGHT),
  ]
}

/** Tick positions as fractions of the axis, bottom to top. */
function numericTicks(): number[] {
  return Array.from({ length: Y_TICKS + 1 }, (_unused, tick) => tick / Y_TICKS)
}

function tickY(ratio: number): number {
  return MARGIN_TOP + (1 - ratio) * PLOT_HEIGHT
}

function yLabels(range: Range, series: ChartSeries, ladder?: BodyweightLadder): ChartYLabel[] {
  if (series.metric === 'level') {
    return pickLevelTickLevels(range, series).map((level) => {
      const fullName = bodyweightLevelName(ladder, level)
      const text = shortenLevelLabel(fullName)
      return {
        x: marginLeft(series) - 8,
        y: computeY(level, range) + 4,
        text,
        ...(text === fullName ? {} : { fullName }),
      }
    })
  }
  return numericTicks().map((ratio) => ({
    x: marginLeft(series) - 8,
    y: tickY(ratio) + 4,
    text: formatChartValue(range.min + (range.max - range.min) * ratio, series, undefined),
  }))
}

/**
 * Rungs a level axis labels: every rung spanned while the span fits the
 * budget, otherwise the span ends plus the rungs the series visits. Rungs
 * are 1-based, so the axis never labels a rung zero.
 */
function pickLevelTickLevels(range: Range, series: ChartSeries): number[] {
  const low = Math.max(1, Math.ceil(range.min))
  const high = Math.floor(range.max)
  if (high <= low) {
    return [low]
  }
  const spanned: number[] = []
  for (let level = low; level <= high; level++) {
    spanned.push(level)
  }
  if (spanned.length <= MAX_LEVEL_TICKS) {
    return spanned
  }
  const visited = new Set<number>([low, high])
  for (const point of series.points) {
    if (Number.isInteger(point.value) && point.value >= low && point.value <= high) {
      visited.add(point.value)
    }
  }
  return thinTicksToBudget([...visited].sort((left, right) => left - right))
}

/**
 * Evenly thin an ordered tick list to the label budget, keeping the first
 * and last tick so the axis still spans its band.
 */
function thinTicksToBudget(ordered: number[]): number[] {
  if (ordered.length <= MAX_LEVEL_TICKS) {
    return ordered
  }
  const stride = Math.max(1, Math.ceil((ordered.length - 1) / (MAX_LEVEL_TICKS - 1)))
  const thinned = ordered.filter((_level, index) => index % stride === 0)
  const last = ordered.at(-1)
  if (last !== undefined && thinned.at(-1) !== last) {
    thinned.push(last)
  }
  return thinned
}

function metricLabel(series: ChartSeries): ChartText | null {
  const text = chartYAxisTitle(series)
  return text ? { x: marginLeft(series), y: MARGIN_TOP - 4, text } : null
}

function xLabels(series: ChartSeries): ChartXLabel[] {
  const count = series.points.length
  const condensed = count >= 8
  return pickXTickIndices(count).flatMap((index) => {
    const point = series.points[index]
    if (!point) {
      return []
    }
    return [
      {
        x: computeX(index, count, series),
        y: MARGIN_TOP + PLOT_HEIGHT + 18,
        /** The last label anchors inward: its tick sits one margin from the viewBox edge, so a centred label would hang off. */
        anchor: index === count - 1 ? ('end' as const) : ('middle' as const),
        text: condensed ? point.date.slice(5) : point.date,
      },
    ]
  })
}

function seriesMarks(
  series: ChartSeries,
  range: Range,
  ladder: BodyweightLadder | undefined,
): Pick<ChartLayout, 'linePoints' | 'dots'> {
  const points = series.points
  const coords = points.map((point, index) => ({
    x: computeX(index, points.length, series),
    y: computeY(point.value, range),
    point,
  }))
  const linePoints =
    series.metric === 'level' ? stepLinePoints(coords) : coords.map(({ x, y }) => `${x},${y}`)
  return {
    linePoints: coords.length > 1 ? linePoints.join(' ') : null,
    dots: coords.map(({ x, y, point }) => ({
      cx: x,
      cy: y,
      tooltip: formatChartTooltip(point.date, point.value, series, ladder),
    })),
  }
}

/**
 * Step path for a level series: a rung holds until the next session, so the
 * line runs horizontally to the next date before changing vertically.
 */
function stepLinePoints(coords: ReadonlyArray<{ x: number; y: number }>): string[] {
  const first = coords[0]
  if (!first) {
    return []
  }
  const stepped = [`${first.x},${first.y}`]
  for (let index = 1; index < coords.length; index++) {
    const previous = coords[index - 1] as { x: number; y: number }
    const current = coords[index] as { x: number; y: number }
    stepped.push(`${current.x},${previous.y}`, `${current.x},${current.y}`)
  }
  return stepped
}

function computeX(index: number, count: number, series: ChartSeries): number {
  const left = marginLeft(series)
  const width = plotWidth(series)
  if (count <= 1) {
    return left + width / 2
  }
  const ratio = index / (count - 1)
  return left + ratio * width
}

function computeY(value: number, range: Range): number {
  const span = range.max - range.min
  const safeSpan = span === 0 ? 1 : span
  const ratio = (value - range.min) / safeSpan
  return MARGIN_TOP + (1 - ratio) * PLOT_HEIGHT
}

/** Tooltip for a dot: a level names its rung, every other metric formats its value. */
export function formatChartTooltip(
  date: string,
  value: number,
  series: ChartSeries,
  ladder: BodyweightLadder | undefined,
): string {
  if (series.metric === 'e1rm') {
    return `${date}: e1rm ${formatChartValue(value, series, ladder)}`
  }
  return `${date}: ${formatChartValue(value, series, ladder)}`
}

export function chartYAxisTitle(series: ChartSeries): string | null {
  switch (series.metric) {
    case 'e1rm':
      return `e1rm (${series.unit})`
    case 'weight':
      return series.unit === 'kg' || series.unit === 'lbs' ? `weight (${series.unit})` : null
    case 'reps':
      return 'reps'
    case 'level':
      return 'level'
    case 'duration':
      return null
    default:
      return assertUnreachableMetric(series.metric)
  }
}

/**
 * Value text for axes and tooltips. A level names its rung (the axis point
 * is the rung name, so the tooltip matches it) rather than a duration.
 */
export function formatChartValue(
  value: number,
  series: ChartSeries,
  ladder: BodyweightLadder | undefined,
): string {
  switch (series.metric) {
    case 'level':
      return bodyweightLevelName(ladder, value)
    case 'e1rm':
      return `${value.toFixed(1)}${series.unit}`
    case 'weight':
      if (series.unit === 'kg' || series.unit === 'lbs') {
        return `${formatNumber(value)}${series.unit}`
      }
      return formatUnitValue(value, series)
    case 'reps':
    case 'duration':
      return formatUnitValue(value, series)
    default:
      return assertUnreachableMetric(series.metric)
  }
}

/** Reps for a reps unit, otherwise seconds rendered as `Ns` or `Nm Ns`. */
function formatUnitValue(value: number, series: ChartSeries): string {
  if (series.unit === 'reps') {
    return formatReps(value)
  }
  if (value < 60) {
    return `${formatNumber(value)}s`
  }
  const minutes = Math.floor(value / 60)
  const seconds = Math.round(value - minutes * 60)
  if (seconds === 0) {
    return `${minutes}m`
  }
  return `${minutes}m ${seconds}s`
}
