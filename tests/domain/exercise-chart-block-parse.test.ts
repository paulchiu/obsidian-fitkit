import { describe, expect, it } from 'vitest'

import {
  parseExerciseChartBlock,
  resolveExerciseChartMetric,
  type ExerciseChartFrontmatter,
} from '../../src/domain/exercise-chart-block-parse'

function resolveMetric(source: string, frontmatter?: ExerciseChartFrontmatter): string {
  const notes: string[] = []
  const parsed = parseExerciseChartBlock(source)
  return resolveExerciseChartMetric(parsed, frontmatter, 'strength', notes)
}

function resolveBodyweightMetric(
  source: string,
  frontmatter?: ExerciseChartFrontmatter,
  notes: string[] = [],
): string {
  const parsed = parseExerciseChartBlock(source)
  return resolveExerciseChartMetric(parsed, frontmatter, 'bodyweight', notes)
}

describe('exercise chart block parsing', () => {
  // Lock: duration ignores any supplied or frontmatter metric and pushes no notes.
  it('resolves duration to the default metric without reading metrics or notes', () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock('metric: weight')

    const metric = resolveExerciseChartMetric(parsed, { metric: 'weight' }, 'duration', notes)

    expect(metric).toBe('e1rm')
    expect(notes).toEqual([])
  })

  it('lets the code-block metric override frontmatter metric', () => {
    expect(resolveMetric('metric: weight', { metric: 'e1rm' })).toBe('weight')
  })

  it('warns once for an invalid block-level metric and ignores frontmatter', () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock('metric: not-a-metric')

    const metric = resolveExerciseChartMetric(parsed, { metric: 'weight' }, 'strength', notes)

    expect(metric).toBe('e1rm')
    expect(notes).toEqual(["Ignored invalid metric value 'not-a-metric'; using e1rm."])
  })

  it('does not warn about invalid frontmatter when the block metric is valid', () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock('metric: weight')

    const metric = resolveExerciseChartMetric(parsed, { metric: 'nope' }, 'strength', notes)

    expect(metric).toBe('weight')
    expect(notes).toEqual([])
  })

  it('metric: with empty value is silently treated as unspecified and falls through to frontmatter', () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock('metric: ')

    const metric = resolveExerciseChartMetric(parsed, { metric: 'weight' }, 'strength', notes)

    expect(metric).toBe('weight')
    expect(notes).toEqual([])
  })

  it('metric: "" is silently treated as unspecified and falls through to frontmatter', () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock('metric: ""')

    const metric = resolveExerciseChartMetric(parsed, { metric: 'weight' }, 'strength', notes)

    expect(metric).toBe('weight')
    expect(notes).toEqual([])
  })

  it("metric: '' is silently treated as unspecified and falls through to frontmatter", () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock("metric: ''")

    const metric = resolveExerciseChartMetric(parsed, { metric: 'weight' }, 'strength', notes)

    expect(metric).toBe('weight')
    expect(notes).toEqual([])
  })

  it("metric: ' is silently treated as unspecified and falls through to frontmatter", () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock("metric: '")

    const metric = resolveExerciseChartMetric(parsed, { metric: 'weight' }, 'strength', notes)

    expect(metric).toBe('weight')
    expect(notes).toEqual([])
  })

  it('accepts quoted code-block metric values', () => {
    expect(resolveMetric('metric: "weight"')).toBe('weight')
  })

  it('strips inline YAML comments from code-block metric values', () => {
    expect(resolveMetric('metric: weight # chart the heaviest set')).toBe('weight')
  })

  it('preserves exercise, kind, and window parsing behavior', () => {
    expect(
      parseExerciseChartBlock(`
exercise: Bench Press
kind: duration
window: 12
`),
    ).toMatchObject({
      exerciseName: 'Bench Press',
      kind: 'duration',
      window: 12,
      windowFallback: false,
    })
  })

  it('accepts kinds case-insensitively through the shared parser', () => {
    expect(parseExerciseChartBlock('kind: DURATION').kind).toBe('duration')
    expect(parseExerciseChartBlock('kind:   Strength  ').kind).toBe('strength')
  })

  it('leaves kind untouched on an unrecognised value', () => {
    expect(parseExerciseChartBlock('kind: cardio').kind).toBeNull()
    expect(parseExerciseChartBlock('kind: strength\nkind: cardio').kind).toBe('strength')
  })

  it('resolves metric level for a bodyweight block', () => {
    expect(resolveBodyweightMetric('metric: level')).toBe('level')
  })

  it('resolves metric reps for a bodyweight block', () => {
    expect(resolveBodyweightMetric('metric: reps')).toBe('reps')
  })

  it('echoes the supplied metric value as written when rejecting it', () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock('metric: WEIGHT')

    const metric = resolveExerciseChartMetric(parsed, undefined, 'bodyweight', notes)

    expect(metric).toBe('level')
    expect(notes).toEqual(["Ignored invalid metric value 'WEIGHT'; using level."])
  })

  it('rejects a strength metric on a bodyweight block the way a bad metric is reported', () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock('metric: weight')

    const metric = resolveExerciseChartMetric(parsed, undefined, 'bodyweight', notes)

    expect(metric).toBe('level')
    expect(notes).toEqual(["Ignored invalid metric value 'weight'; using level."])
  })

  it('rejects a bodyweight metric on a strength block the way a bad metric is reported', () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock('metric: level')

    const metric = resolveExerciseChartMetric(parsed, undefined, 'strength', notes)

    expect(metric).toBe('e1rm')
    expect(notes).toEqual(["Ignored invalid metric value 'level'; using e1rm."])
  })

  it('defaults a bodyweight block with no metric to level without a note', () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock('exercise: Push-Up')

    const metric = resolveExerciseChartMetric(parsed, undefined, 'bodyweight', notes)

    expect(metric).toBe('level')
    expect(notes).toEqual([])
  })

  it('reads a valid bodyweight metric from frontmatter when the block has none', () => {
    expect(resolveBodyweightMetric('exercise: Push-Up', { metric: 'reps' })).toBe('reps')
  })

  it('ignores a leftover frontmatter metric quietly when the block supplies none', () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock('exercise: Push-Up')

    const metric = resolveExerciseChartMetric(parsed, { metric: 'e1rm' }, 'bodyweight', notes)

    expect(metric).toBe('level')
    expect(notes).toEqual([])
  })

  it('falls back quietly for a frontmatter metric of another kind', () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock('exercise: Push-Up')

    const metric = resolveExerciseChartMetric(parsed, { metric: 'weight' }, 'bodyweight', notes)

    expect(metric).toBe('level')
    expect(notes).toEqual([])
  })
})
