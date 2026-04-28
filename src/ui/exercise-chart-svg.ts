import { niceRange, pickXTickIndices, type ChartSeries } from '../domain/exercise-chart'

const VIEW_WIDTH = 800
const VIEW_HEIGHT = 320
const MARGIN_LEFT = 56
const MARGIN_RIGHT = 16
const MARGIN_TOP = 16
const MARGIN_BOTTOM = 44
const PLOT_WIDTH = VIEW_WIDTH - MARGIN_LEFT - MARGIN_RIGHT
const PLOT_HEIGHT = VIEW_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM
const Y_TICKS = 4

export interface RenderChartOptions {
  notes?: string[]
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
  drawGrid(svg, range)
  drawAxes(svg)
  drawYLabels(svg, range, series.unit)
  drawXLabels(svg, series)
  drawSeries(svg, series, range)
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

function drawGrid(svg: SVGSVGElement, range: { min: number; max: number }): void {
  for (let tick = 0; tick <= Y_TICKS; tick++) {
    const ratio = tick / Y_TICKS
    const y = MARGIN_TOP + (1 - ratio) * PLOT_HEIGHT
    svg.createSvg('line', {
      cls: 'fitkit-chart-grid',
      attr: {
        x1: MARGIN_LEFT,
        x2: MARGIN_LEFT + PLOT_WIDTH,
        y1: y,
        y2: y,
      },
    })
  }
  void range
}

function drawAxes(svg: SVGSVGElement): void {
  svg.createSvg('line', {
    cls: 'fitkit-chart-axis',
    attr: {
      x1: MARGIN_LEFT,
      x2: MARGIN_LEFT,
      y1: MARGIN_TOP,
      y2: MARGIN_TOP + PLOT_HEIGHT,
    },
  })
  svg.createSvg('line', {
    cls: 'fitkit-chart-axis',
    attr: {
      x1: MARGIN_LEFT,
      x2: MARGIN_LEFT + PLOT_WIDTH,
      y1: MARGIN_TOP + PLOT_HEIGHT,
      y2: MARGIN_TOP + PLOT_HEIGHT,
    },
  })
}

function drawYLabels(
  svg: SVGSVGElement,
  range: { min: number; max: number },
  unit: 'kg' | 's',
): void {
  for (let tick = 0; tick <= Y_TICKS; tick++) {
    const ratio = tick / Y_TICKS
    const value = range.min + (range.max - range.min) * ratio
    const y = MARGIN_TOP + (1 - ratio) * PLOT_HEIGHT
    const label = svg.createSvg('text', {
      cls: 'fitkit-chart-axis-label',
      attr: {
        x: MARGIN_LEFT - 8,
        y: y + 4,
        'text-anchor': 'end',
      },
    })
    label.textContent = formatYValue(value, unit)
  }
}

function drawXLabels(svg: SVGSVGElement, series: ChartSeries): void {
  const indices = pickXTickIndices(series.points.length)
  const condensed = series.points.length >= 8
  for (const index of indices) {
    const point = series.points[index]
    if (!point) {
      continue
    }
    const x = computeX(index, series.points.length)
    const label = svg.createSvg('text', {
      cls: 'fitkit-chart-axis-label',
      attr: {
        x,
        y: MARGIN_TOP + PLOT_HEIGHT + 18,
        'text-anchor': 'middle',
      },
    })
    label.textContent = condensed ? point.date.slice(5) : point.date
  }
}

function drawSeries(
  svg: SVGSVGElement,
  series: ChartSeries,
  range: { min: number; max: number },
): void {
  const points = series.points
  const coords = points.map((point, index) => {
    const x = computeX(index, points.length)
    const y = computeY(point.value, range)
    return { x, y, point }
  })

  if (coords.length > 1) {
    const polylinePoints = coords.map(({ x, y }) => `${x},${y}`).join(' ')
    svg.createSvg('polyline', {
      cls: 'fitkit-chart-line',
      attr: {
        points: polylinePoints,
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
    const tooltip = `${point.date}: ${formatYValue(point.value, series.unit)}`
    const titleEl = dot.createSvg('title')
    titleEl.textContent = tooltip
  }
}

function computeX(index: number, count: number): number {
  if (count <= 1) {
    return MARGIN_LEFT + PLOT_WIDTH / 2
  }
  const ratio = index / (count - 1)
  return MARGIN_LEFT + ratio * PLOT_WIDTH
}

function computeY(value: number, range: { min: number; max: number }): number {
  const span = range.max - range.min
  const safeSpan = span === 0 ? 1 : span
  const ratio = (value - range.min) / safeSpan
  return MARGIN_TOP + (1 - ratio) * PLOT_HEIGHT
}

function formatYValue(value: number, unit: 'kg' | 's'): string {
  if (unit === 'kg') {
    return `${formatNumber(value)}kg`
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
