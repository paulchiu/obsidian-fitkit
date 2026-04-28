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

describe('exercise chart block parsing', () => {
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

  it('treats an empty metric value as unspecified', () => {
    const notes: string[] = []
    const parsed = parseExerciseChartBlock('metric: ')

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
})
