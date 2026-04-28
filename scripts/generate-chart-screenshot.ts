// SPDX-License-Identifier: MIT
// @ts-nocheck
/**
 * Usage: node scripts/generate-chart-screenshot.ts
 *
 * Regenerates dated chart screenshots for the configured exercise (default Calf Raise).
 * PNGs are written to <repo>/tmp/ by default.
 *
 * Environment variables:
 * - EXERCISE_NAME: Exercise to chart. Defaults to Calf Raise.
 * - WORKOUTS_DIR: Folder containing workout notes. Defaults to the local dev vault.
 * - OUTPUT_DATE: Date stamped into filenames and the generated index. Defaults to today.
 *
 * DOM polyfill:
 * - Covers only what the current renderer uses.
 * - Inspect src/ui/exercise-chart-svg.ts before extending the renderer.
 * - If the renderer touches a new Obsidian element extension, extend this polyfill to match it.
 */

import { Resvg } from '@resvg/resvg-js'
import { createJiti } from 'jiti'
import { JSDOM } from 'jsdom'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const jiti = createJiti(import.meta.url)
const { buildExerciseChartSeries } = await jiti.import('../src/domain/exercise-chart.ts')
const { createRegistry } = await jiti.import('../src/domain/exercise-registry.ts')
const { pickBestSet, pickHeaviestSet } = await jiti.import('../src/domain/epley.ts')
const { parseWorkoutNote } = await jiti.import('../src/domain/workout-note-model.ts')
const { renderExerciseChartSvg } = await jiti.import('../src/ui/exercise-chart-svg.ts')

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const DEFAULT_WORKOUTS_DIR = '/Users/paul/dev-misc/dev-vault/dev/Fitness/Workouts'
const OUTPUT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const EXERCISE_NAME = process.env.EXERCISE_NAME ?? 'Calf Raise'
const WORKOUTS_DIR = resolveWorkoutsDir()
const OUTPUT_DATE = resolveOutputDate()
const OUTPUT_DIR = path.join(REPO_ROOT, 'tmp')
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
await assertWorkoutsDir()
await mkdir(OUTPUT_DIR, { recursive: true })

const index = {
  schemaVersion: 1,
  builtAt: Date.parse(`${OUTPUT_DATE}T00:00:00.000Z`),
  entries: await readWorkoutEntries(),
  diagnostics: [],
}
const registry = createRegistry([{ name: EXERCISE_NAME, kind: 'strength', aliases: [] }])

const outputs = []
for (const metric of ['e1rm', 'weight']) {
  const series = buildExerciseChartSeries(index, registry, EXERCISE_NAME, 'strength', 30, metric)
  const container = activeDocument.createElement('div')
  renderExerciseChartSvg(container, series)
  const svg = serializeRenderedSvg(container)
  const metricName = metric === 'e1rm' ? 'e1rm' : 'Weight'
  const outputPath = path.join(
    OUTPUT_DIR,
    `${OUTPUT_DATE} ${EXERCISE_NAME} Chart ${metricName}.png`,
  )
  let png
  // If the second metric fails, the first metric's PNG remains on disk.
  try {
    png = new Resvg(svg, {
      background: 'white',
      fitTo: {
        mode: 'width',
        value: CHART_WIDTH,
      },
    })
      .render()
      .asPng()
  } catch (error) {
    console.error(
      [
        `Could not render ${EXERCISE_NAME} chart (target: ${outputPath}).`,
        `Underlying error: ${formatErrorMessage(error)}`,
      ].join('\n'),
    )
    process.exit(1)
  }
  await writeFile(outputPath, png)
  outputs.push(outputPath)
}

console.log(outputs.join('\n'))

function resolveWorkoutsDir() {
  const value = process.env.WORKOUTS_DIR
  if (value === undefined) {
    return DEFAULT_WORKOUTS_DIR
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    console.error(
      'WORKOUTS_DIR env var is empty; set it to a real workouts folder or unset to use the default.',
    )
    process.exit(1)
  }
  return trimmed
}

function resolveOutputDate() {
  const value = process.env.OUTPUT_DATE ?? new Date().toLocaleDateString('sv-SE')
  if (OUTPUT_DATE_PATTERN.test(value)) {
    return value
  }

  console.error(
    `OUTPUT_DATE env var must use YYYY-MM-DD: ${value}\nSet OUTPUT_DATE to a date like 2026-04-29 or unset to use today's local date.`,
  )
  process.exit(1)
}

async function assertWorkoutsDir() {
  try {
    const directory = await stat(WORKOUTS_DIR)
    if (directory.isDirectory()) {
      return
    }
  } catch {
    console.error(
      `Workout notes directory does not exist: ${WORKOUTS_DIR}\nSet WORKOUTS_DIR to the Fitness/Workouts folder you want to chart.`,
    )
    process.exit(1)
  }

  console.error(
    `WORKOUTS_DIR is not a directory: ${WORKOUTS_DIR}\nSet WORKOUTS_DIR to the Fitness/Workouts folder you want to chart.`,
  )
  process.exit(1)
}

async function readWorkoutEntries() {
  const workoutFilenamePattern = new RegExp(
    `^\\d{4}-\\d{2}-\\d{2} ${escapeRegExp(EXERCISE_NAME)}\\.md$`,
  )
  const filenames = (await readdir(WORKOUTS_DIR))
    .filter((filename) => workoutFilenamePattern.test(filename))
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
