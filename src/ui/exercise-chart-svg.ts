import { bodyweightLevelName, type BodyweightLadder } from '../domain/bodyweight-levels'
import { niceRange, pickXTickIndices, type ChartSeries } from '../domain/exercise-chart'

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

export interface RenderChartOptions {
  notes?: string[]
  ladder?: BodyweightLadder
}

export function renderExerciseChartSvg(
  container: HTMLElement,
  series: ChartSeries,
  options: RenderChartOptions = {},
): void {
  container.empty()
  container.addClass('fitkit-chart')

  for (const note of options.notes ?? []) {
    container.createDiv({ cls: 'fitkit-chart-note', text: note })
  }

  container.createDiv({ cls: 'fitkit-chart-title', text: buildTitle(series) })

  if (series.points.length === 0) {
    container.createDiv({
      cls: 'fitkit-chart-empty',
      text: emptyMessage(series),
    })
    return
  }

  const svg = container.createSvg('svg', {
    cls: 'fitkit-chart-svg',
    attr: {
      viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': buildTitle(series),
    },
  })

  const values = series.points.map((point) => point.value)
  const range = niceRange(values)
  drawGrid(svg, range, series)
  drawAxes(svg, series)
  drawMetricLabel(svg, series)
  drawYLabels(svg, range, series, options.ladder)
  drawXLabels(svg, series)
  drawSeries(svg, series, range, options.ladder)
}

function buildTitle(series: ChartSeries): string {
  const count = series.points.length
  if (count === 0) {
    return series.exerciseName
  }
  if (series.totalDates > count) {
    return `${series.exerciseName} · last ${count} of ${series.totalDates} sessions`
  }
  return `${series.exerciseName} · last ${count} session${count === 1 ? '' : 's'}`
}

function emptyMessage(series: ChartSeries): string {
  return `No ${series.kind} sessions found for this exercise yet.`
}

/** Gridlines sit on the labelled ticks: whole rungs for a level axis, even fractions otherwise. */
function drawGrid(
  svg: SVGSVGElement,
  range: { min: number; max: number },
  series: ChartSeries,
): void {
  if (series.metric === 'level') {
    for (const level of pickLevelTickLevels(range, series)) {
      const y = computeY(level, range)
      svg.createSvg('line', {
        cls: 'fitkit-chart-grid',
        attr: {
          x1: marginLeft(series),
          x2: marginLeft(series) + plotWidth(series),
          y1: y,
          y2: y,
        },
      })
    }
    return
  }
  for (let tick = 0; tick <= Y_TICKS; tick++) {
    const ratio = tick / Y_TICKS
    const y = MARGIN_TOP + (1 - ratio) * PLOT_HEIGHT
    svg.createSvg('line', {
      cls: 'fitkit-chart-grid',
      attr: {
        x1: marginLeft(series),
        x2: marginLeft(series) + plotWidth(series),
        y1: y,
        y2: y,
      },
    })
  }
}

function drawAxes(svg: SVGSVGElement, series: ChartSeries): void {
  svg.createSvg('line', {
    cls: 'fitkit-chart-axis',
    attr: {
      x1: marginLeft(series),
      x2: marginLeft(series),
      y1: MARGIN_TOP,
      y2: MARGIN_TOP + PLOT_HEIGHT,
    },
  })
  svg.createSvg('line', {
    cls: 'fitkit-chart-axis',
    attr: {
      x1: marginLeft(series),
      x2: marginLeft(series) + plotWidth(series),
      y1: MARGIN_TOP + PLOT_HEIGHT,
      y2: MARGIN_TOP + PLOT_HEIGHT,
    },
  })
}

function drawYLabels(
  svg: SVGSVGElement,
  range: { min: number; max: number },
  series: ChartSeries,
  ladder: BodyweightLadder | undefined,
): void {
  if (series.metric === 'level') {
    drawLevelYLabels(svg, range, series, ladder)
    return
  }
  for (let tick = 0; tick <= Y_TICKS; tick++) {
    const ratio = tick / Y_TICKS
    const value = range.min + (range.max - range.min) * ratio
    const y = MARGIN_TOP + (1 - ratio) * PLOT_HEIGHT
    const label = svg.createSvg('text', {
      cls: 'fitkit-chart-axis-label',
      attr: {
        x: marginLeft(series) - 8,
        y: y + 4,
        'text-anchor': 'end',
        'data-axis': 'y',
      },
    })
    label.textContent = formatChartValue(value, series, undefined)
  }
}

/**
 * Integer rung ticks for a level axis. Rungs are 1-based, so the axis never
 * labels a rung zero; a span longer than the label budget keeps its ends
 * and the rungs the series visits, thinned evenly.
 */
function drawLevelYLabels(
  svg: SVGSVGElement,
  range: { min: number; max: number },
  series: ChartSeries,
  ladder: BodyweightLadder | undefined,
): void {
  for (const level of pickLevelTickLevels(range, series)) {
    const y = computeY(level, range)
    const fullName = bodyweightLevelName(ladder, level)
    const label = svg.createSvg('text', {
      cls: 'fitkit-chart-axis-label',
      attr: {
        x: marginLeft(series) - 8,
        y: y + 4,
        'text-anchor': 'end',
        'data-axis': 'y',
      },
    })
    label.textContent = shortenLevelLabel(fullName)
    if (label.textContent !== fullName) {
      label.createSvg('title').textContent = fullName
    }
  }
}

/**
 * Rungs a level axis labels: every rung spanned while the span fits the
 * budget, otherwise the span ends plus the rungs the series visits.
 */
function pickLevelTickLevels(range: { min: number; max: number }, series: ChartSeries): number[] {
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
  const last = ordered[ordered.length - 1] as number
  if (thinned[thinned.length - 1] !== last) {
    thinned.push(last)
  }
  return thinned
}

function drawMetricLabel(svg: SVGSVGElement, series: ChartSeries): void {
  const label = chartYAxisTitle(series)
  if (!label) {
    return
  }
  const title = svg.createSvg('text', {
    cls: 'fitkit-chart-axis-label',
    attr: {
      x: marginLeft(series),
      y: MARGIN_TOP - 4,
      'text-anchor': 'start',
    },
  })
  title.textContent = label
}

function drawXLabels(svg: SVGSVGElement, series: ChartSeries): void {
  const indices = pickXTickIndices(series.points.length)
  const condensed = series.points.length >= 8
  for (const index of indices) {
    const point = series.points[index]
    if (!point) {
      continue
    }
    const x = computeX(index, series.points.length, series)
    const label = svg.createSvg('text', {
      cls: 'fitkit-chart-axis-label',
      attr: {
        x,
        y: MARGIN_TOP + PLOT_HEIGHT + 18,
        'text-anchor': xLabelAnchor(index, series.points.length),
        'data-axis': 'x',
      },
    })
    label.textContent = condensed ? point.date.slice(5) : point.date
  }
}

/**
 * The last date label anchors inward. Its tick sits one margin from the
 * viewBox, so a centred label half wider than that margin hangs off the edge.
 */
function xLabelAnchor(index: number, count: number): string {
  if (index === count - 1) {
    return 'end'
  }
  return 'middle'
}

function drawSeries(
  svg: SVGSVGElement,
  series: ChartSeries,
  range: { min: number; max: number },
  ladder: BodyweightLadder | undefined,
): void {
  const points = series.points
  const coords = points.map((point, index) => {
    const x = computeX(index, points.length, series)
    const y = computeY(point.value, range)
    return { x, y, point }
  })

  if (coords.length > 1) {
    const linePoints =
      series.metric === 'level' ? stepLinePoints(coords) : coords.map(({ x, y }) => `${x},${y}`)
    svg.createSvg('polyline', {
      cls: 'fitkit-chart-line',
      attr: {
        points: linePoints.join(' '),
        fill: 'none',
      },
    })
  }

  for (const { x, y, point } of coords) {
    const dot = svg.createSvg('circle', {
      cls: 'fitkit-chart-dot',
      attr: {
        cx: x,
        cy: y,
        r: 3.5,
      },
    })
    const titleEl = dot.createSvg('title')
    titleEl.textContent = formatChartTooltip(point.date, point.value, series, ladder)
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

function computeY(value: number, range: { min: number; max: number }): number {
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
  if (series.metric === 'e1rm') {
    return `e1rm (${series.unit})`
  }
  if (series.metric === 'weight' && (series.unit === 'kg' || series.unit === 'lbs')) {
    return `weight (${series.unit})`
  }
  if (series.metric === 'reps') {
    return 'reps'
  }
  if (series.metric === 'level') {
    return 'level'
  }
  return null
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
  if (series.metric === 'level') {
    return bodyweightLevelName(ladder, value)
  }
  if (series.metric === 'e1rm') {
    return `${value.toFixed(1)}${series.unit}`
  }
  if (series.metric === 'weight' && (series.unit === 'kg' || series.unit === 'lbs')) {
    return `${formatNumber(value)}${series.unit}`
  }
  if (series.unit === 'reps') {
    const formatted = formatNumber(value)
    return `${formatted} rep${formatted === '1' ? '' : 's'}`
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

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value)
  }
  return String(Number(value.toFixed(1)))
}
