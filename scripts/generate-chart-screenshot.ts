// SPDX-License-Identifier: MIT
// @ts-nocheck
/**
 * Usage: node scripts/generate-chart-screenshot.ts
 *
 * Regenerates dated Calf Raise chart screenshots from the seeded dev-vault workout notes.
 */

import { Resvg } from '@resvg/resvg-js'
import { createJiti } from 'jiti'
import { JSDOM } from 'jsdom'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const jiti = createJiti(import.meta.url)
const { buildExerciseChartSeries } = await jiti.import('../src/domain/exercise-chart.ts')
const { createRegistry } = await jiti.import('../src/domain/exercise-registry.ts')
const { pickBestSet, pickHeaviestSet } = await jiti.import('../src/domain/epley.ts')
const { parseWorkoutNote } = await jiti.import('../src/domain/workout-note-model.ts')
const { renderExerciseChartSvg } = await jiti.import('../src/ui/exercise-chart-svg.ts')

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const WORKOUTS_DIR = '/Users/paul/dev-misc/dev-vault/dev/Fitness/Workouts'
const OUTPUT_DATE = '2026-04-29'
const EXERCISE_NAME = 'Calf Raise'
const CHART_WIDTH = 800
const CHART_HEIGHT = 320
const CHART_STYLE = `
  .fitkit-chart-axis { stroke: #c7cdd6; stroke-width: 1; }
  .fitkit-chart-grid { stroke: #c7cdd6; stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.6; }
  .fitkit-chart-axis-label { fill: #5f6b7a; font-size: 11px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .fitkit-chart-line { stroke: #3f7ad8; stroke-width: 2; fill: none; }
  .fitkit-chart-dot { fill: #3f7ad8; }
`

setupDom()

const index = {
  schemaVersion: 1,
  builtAt: Date.parse(`${OUTPUT_DATE}T00:00:00.000Z`),
  entries: await readCalfRaiseEntries(),
  diagnostics: [],
}
const registry = createRegistry([{ name: EXERCISE_NAME, kind: 'strength', aliases: [] }])

const outputs = []
for (const metric of ['e1rm', 'weight']) {
  const series = buildExerciseChartSeries(index, registry, EXERCISE_NAME, 'strength', 30, metric)
  const container = activeDocument.createElement('div')
  renderExerciseChartSvg(container, series)
  const svg = serializeRenderedSvg(container)
  const png = new Resvg(svg, {
    background: 'white',
    fitTo: {
      mode: 'width',
      value: CHART_WIDTH,
    },
  })
    .render()
    .asPng()
  const metricName = metric === 'e1rm' ? 'e1rm' : 'Weight'
  const outputPath = path.join(REPO_ROOT, `${OUTPUT_DATE} ${EXERCISE_NAME} Chart ${metricName}.png`)
  await writeFile(outputPath, png)
  outputs.push(outputPath)
}

console.log(outputs.join('\n'))

async function readCalfRaiseEntries() {
  const filenames = (await readdir(WORKOUTS_DIR))
    .filter((filename) => /^\d{4}-\d{2}-\d{2} Calf Raise\.md$/.test(filename))
    .sort()
  const entries = []

  for (const filename of filenames) {
    const filePath = path.join(WORKOUTS_DIR, filename)
    const source = await readFile(filePath, 'utf8')
    const vaultPath = `Fitness/Workouts/${filename}`
    const result = parseWorkoutNote(source, vaultPath)
    if (!result.isWorkout || !result.model) {
      continue
    }
    const fileStat = await stat(filePath)
    entries.push({
      path: vaultPath,
      mtime: fileStat.mtimeMs,
      date: result.model.date,
      name: result.model.name,
      exercises: result.model.exercises.map(toIndexRow),
    })
  }

  return entries
}

function toIndexRow(exercise) {
  if (exercise.kind === 'duration') {
    const durationEntries = exercise.durationEntries ?? []
    return {
      exerciseName: exercise.exerciseName,
      kind: exercise.kind,
      totalSets: durationEntries.length,
      totalDurationSeconds: durationEntries.reduce(
        (total, entry) => total + entry.durationSeconds,
        0,
      ),
    }
  }

  const strengthSets = exercise.strengthSets ?? []
  return {
    exerciseName: exercise.exerciseName,
    kind: exercise.kind,
    bestSet: pickBestSet(strengthSets) ?? undefined,
    maxWeightSet: pickHeaviestSet(strengthSets) ?? undefined,
    totalSets: strengthSets.length,
  }
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.activeWindow = dom.window
  globalThis.activeDocument = dom.window.document

  installElementHelpers(dom.window.HTMLElement.prototype)
  installElementHelpers(dom.window.SVGElement.prototype)
}

function installElementHelpers(prototype) {
  prototype.empty = function empty() {
    this.replaceChildren()
  }
  prototype.addClass = function addClass(className) {
    this.classList.add(className)
  }
  prototype.addClasses = function addClasses(classNames) {
    this.classList.add(...classNames.split(/\s+/).filter(Boolean))
  }
  prototype.setText = function setText(text) {
    this.textContent = text
  }
  prototype.setAttr = function setAttr(name, value) {
    this.setAttribute(name, String(value))
  }
  prototype.createDiv = function createDiv(options = {}) {
    return this.createEl('div', options)
  }
  prototype.createSpan = function createSpan(options = {}) {
    return this.createEl('span', options)
  }
  prototype.createEl = function createEl(tagName, options = {}) {
    const child = activeDocument.createElement(tagName)
    applyElementOptions(child, options)
    this.appendChild(child)
    return child
  }
  prototype.createSvg = function createSvg(tagName, options = {}) {
    const child = activeDocument.createElementNS('http://www.w3.org/2000/svg', tagName)
    applyElementOptions(child, options)
    this.appendChild(child)
    return child
  }
}

function applyElementOptions(element, options) {
  const classes = options.cls
  if (classes) {
    element.classList.add(...classes.split(/\s+/).filter(Boolean))
  }
  if (options.text !== undefined) {
    element.textContent = options.text
  }
  for (const [name, value] of Object.entries(options.attr ?? {})) {
    element.setAttribute(name, String(value))
  }
}

function serializeRenderedSvg(container) {
  const svg = container.querySelector('svg')
  if (!svg) {
    throw new Error('Chart renderer did not create an SVG.')
  }
  svg.setAttribute('width', String(CHART_WIDTH))
  svg.setAttribute('height', String(CHART_HEIGHT))
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.insertBefore(createSvgStyle(), svg.firstChild)
  return new activeWindow.XMLSerializer().serializeToString(svg)
}

function createSvgStyle() {
  const style = activeDocument.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = CHART_STYLE
  return style
}
