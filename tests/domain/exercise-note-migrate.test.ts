import { describe, expect, it } from 'vitest'

import { createRegistry, type ExerciseRegistry } from '../../src/domain/exercise-registry'
import {
  migrateExerciseNote,
  setExerciseNoteKind,
  setExerciseNoteLevels,
} from '../../src/domain/exercise-note-migrate'
import { buildNotesBlock, buildRecentSessionsBlock } from '../../src/domain/exercise-note-template'

const registry = createRegistry([
  { name: 'Squat', kind: 'strength', unit: 'kg', aliases: [] },
  { name: 'Plank', kind: 'duration', unit: 'kg', aliases: [] },
])

function migrate(
  source: string,
  options: { name?: string; registry?: ExerciseRegistry; fitnessRoot?: string } = {},
): ReturnType<typeof migrateExerciseNote> {
  return migrateExerciseNote(source, {
    name: options.name ?? 'Squat',
    registry: options.registry ?? registry,
    fitnessRoot: options.fitnessRoot ?? 'Fitness',
  })
}

function completeStrengthNote(
  recent = buildRecentSessionsBlock('Squat', 'strength', 'Fitness'),
  notes = buildNotesBlock('Squat', 'Fitness'),
): string {
  return `---
type: exercise
kind: strength
metric: e1rm
unit: kg
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Recent sessions

${recent}

## Notes

${notes}
`
}

function completeStrengthNoteFor(name: string, unit = 'kg'): string {
  return completeStrengthNote(
    buildRecentSessionsBlock(name, 'strength', 'Fitness'),
    buildNotesBlock(name, 'Fitness'),
  ).replace('unit: kg', `unit: ${unit}`)
}

function completeDurationNote(
  name = 'Mystery',
  recent = buildRecentSessionsBlock(name, 'duration', 'Fitness'),
  notes = buildNotesBlock(name, 'Fitness'),
): string {
  return `---
type: exercise
kind: duration
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Recent sessions

${recent}

## Notes

${notes}
`
}

function completeBodyweightNote(
  name = 'Mystery',
  recent = buildRecentSessionsBlock(name, 'bodyweight', 'Fitness'),
  notes = buildNotesBlock(name, 'Fitness'),
): string {
  return `---
type: exercise
kind: bodyweight
levels:
  - ${name}
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Recent sessions

${recent}

## Notes

${notes}
`
}

function withLineEnding(markdown: string, lineEnding: '\n' | '\r\n'): string {
  return lineEnding === '\n' ? markdown : markdown.replace(/\n/g, '\r\n')
}

function extractDataviewBlockAfter(markdown: string, heading: string): string {
  const headingText = `## ${heading}`
  const headingIndex = markdown.indexOf(headingText)
  expect(headingIndex).toBeGreaterThanOrEqual(0)
  const afterHeadingIndex = headingIndex + headingText.length
  const blockOffset = markdown.slice(afterHeadingIndex).indexOf('```dataview')
  expect(blockOffset).toBeGreaterThanOrEqual(0)
  const blockStart = afterHeadingIndex + blockOffset
  const blockEnd = markdown.indexOf('\n```', blockStart + '```dataview'.length)
  expect(blockEnd).toBeGreaterThanOrEqual(0)
  return markdown.slice(blockStart, blockEnd + '\n```'.length)
}

/** Canonical bodyweight Recent sessions block, written out so the query it carries is verified literally rather than recomputed by the code under test. */
const BODYWEIGHT_RECENT_SESSIONS_BLOCK = [
  '```dataview',
  'TABLE WITHOUT ID',
  '  file.link AS Workout,',
  '  L.level AS Level,',
  '  L.reps AS Reps,',
  '  L.load AS Load',
  'FROM "Fitness/Workouts"',
  'FLATTEN file.lists AS L',
  'WHERE L.exercise = link("Mystery") AND L.level',
  'SORT file.name DESC, L.set ASC',
  'LIMIT 10',
  '```',
].join('\n')

function frontmatterMarkerCount(markdown: string): number {
  return markdown.split(/\r?\n/).filter((line) => line === '---' || line === '\ufeff---').length
}

function leadingFrontmatterLines(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/)
  expect(lines[0] === '---' || lines[0] === '\ufeff---').toBe(true)
  const end = lines.findIndex((line, index) => index > 0 && line === '---')
  expect(end).toBeGreaterThan(0)
  return lines.slice(1, end)
}

describe('migrateExerciseNote', () => {
  it('prepends missing frontmatter with strength kind and metric from the registry', () => {
    const source = `Existing prose.

## Notes

Keep this.
`
    const result = migrate(source)

    expect(result.status).toBe('updated')
    expect(result.unknownKind).toBe(false)
    expect(result.markdown).toContain(`---
type: exercise
kind: strength
metric: e1rm
unit: kg
---`)
    expect(result.markdown.indexOf('## Progress chart')).toBeLessThan(
      result.markdown.indexOf('## Recent sessions'),
    )
    expect(result.markdown.indexOf('## Recent sessions')).toBeLessThan(
      result.markdown.indexOf('## Notes'),
    )
    expect(result.markdown).toContain('Keep this.')
  })

  it('leaves a note with a non-exercise type alone', () => {
    const source = `---
type: workout
---

## Notes
`
    const result = migrate(source)

    expect(result.markdown).toBe(source)
    expect(result.status).toBe('skipped-non-exercise-type')
    expect(result.changed).toBe(false)
  })

  it('defaults missing no-registry kind to strength and marks the note for validation', () => {
    const source = `Loose exercise note.
`
    const result = migrate(source, { name: 'Mystery', registry: createRegistry([]) })

    expect(result.status).toBe('unknown')
    expect(result.unknownKind).toBe(true)
    expect(result.markdown).toContain(`---
type: exercise
kind: strength
metric: e1rm
unit: kg
---`)
    expect(result.markdown).toContain(buildRecentSessionsBlock('Mystery', 'strength', 'Fitness'))
    expect(result.markdown).toContain('## Progress chart')
    expect(result.markdown).toContain('## Notes')
  })

  it('sorts a bodyweight recent sessions block by performed order like the strength query', () => {
    const block = buildRecentSessionsBlock('Mystery', 'bodyweight', 'Fitness')

    expect(block).toContain('SORT file.name DESC, L.set ASC')
    expect(block).not.toContain('L.level ASC')
  })

  it('infers invalid no-registry kind from an existing bodyweight Recent sessions block', () => {
    const source = completeBodyweightNote('Mystery').replace('kind: bodyweight', 'kind: cardio')
    const result = migrate(source, { name: 'Mystery', registry: createRegistry([]) })
    const second = migrate(result.markdown, { name: 'Mystery', registry: createRegistry([]) })

    expect(result.status).toBe('unknown')
    expect(result.unknownKind).toBe(true)
    expect(result.markdown).toContain('kind: bodyweight')
    expect(result.markdown).not.toContain('kind: cardio')
    expect(result.markdown).not.toContain('metric:')
    expect(result.markdown).toContain('levels:')
    expect(extractDataviewBlockAfter(result.markdown, 'Recent sessions')).toBe(
      BODYWEIGHT_RECENT_SESSIONS_BLOCK,
    )
    expect(second.markdown).toBe(result.markdown)
    expect(extractDataviewBlockAfter(second.markdown, 'Recent sessions')).toBe(
      BODYWEIGHT_RECENT_SESSIONS_BLOCK,
    )
  })

  it('leaves a level query mentioning set to strength instead of stealing it', () => {
    const source = `---
type: exercise
kind: cardio
---

## Recent sessions

\`\`\`dataview
TABLE L.level, L.set
FROM "Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Mystery")
\`\`\`

## Notes
`
    const result = migrate(source, { name: 'Mystery', registry: createRegistry([]) })

    expect(result.unknownKind).toBe(true)
    expect(result.markdown).toContain('kind: strength')
    expect(result.markdown).not.toContain('kind: bodyweight')
  })

  it('infers invalid no-registry kind from an existing duration Recent sessions block', () => {
    const source = completeDurationNote('Mystery').replace('kind: duration', 'kind: cardio')
    const result = migrate(source, { name: 'Mystery', registry: createRegistry([]) })

    expect(result.status).toBe('unknown')
    expect(result.unknownKind).toBe(true)
    expect(result.markdown).toContain(`type: exercise
kind: duration
---`)
    expect(result.markdown).not.toContain('kind: cardio')
    expect(result.markdown).not.toContain('metric:')
    expect(result.markdown).toContain(buildRecentSessionsBlock('Mystery', 'duration', 'Fitness'))
  })

  it('infers missing no-registry kind from an existing duration Recent sessions block', () => {
    const source = completeDurationNote('Mystery').replace('kind: duration\n', '')
    const result = migrate(source, { name: 'Mystery', registry: createRegistry([]) })

    expect(result.status).toBe('unknown')
    expect(result.unknownKind).toBe(true)
    expect(result.markdown).toContain(`type: exercise
kind: duration
---`)
    expect(result.markdown).not.toContain('metric:')
    expect(result.markdown).toContain(buildRecentSessionsBlock('Mystery', 'duration', 'Fitness'))
  })

  it('ignores strength field words in duration exercise names when inferring missing kind', () => {
    const source = completeDurationNote('Set Hold').replace('kind: duration\n', '')
    const result = migrate(source, { name: 'Set Hold', registry: createRegistry([]) })

    expect(result.status).toBe('unknown')
    expect(result.unknownKind).toBe(true)
    expect(result.markdown).toContain(`type: exercise
kind: duration
---`)
    expect(result.markdown).not.toContain('metric:')
    expect(result.markdown).toContain(buildRecentSessionsBlock('Set Hold', 'duration', 'Fitness'))
  })

  it('ignores strength field words in duration exercise names when repairing invalid kind', () => {
    const source = completeDurationNote('Reps Hold').replace('kind: duration', 'kind: cardio')
    const result = migrate(source, { name: 'Reps Hold', registry: createRegistry([]) })

    expect(result.status).toBe('unknown')
    expect(result.unknownKind).toBe(true)
    expect(result.markdown).toContain(`type: exercise
kind: duration
---`)
    expect(result.markdown).not.toContain('kind: cardio')
    expect(result.markdown).not.toContain('metric:')
    expect(result.markdown).toContain(buildRecentSessionsBlock('Reps Hold', 'duration', 'Fitness'))
  })

  it('preserves valid explicit duration kind without a registry match', () => {
    const source = completeDurationNote('Mystery')
    const result = migrate(source, { name: 'Mystery', registry: createRegistry([]) })

    expect(result.markdown).toBe(source)
    expect(result.status).toBe('already')
    expect(result.unknownKind).toBe(false)
  })

  it('accepts and rejects the same kinds as the other frontmatter read paths', () => {
    const accepted = ['strength', 'duration', ' Strength  ', 'DURATION']
    const rejected = ['cardio', '', '   ', '42']
    for (const value of accepted) {
      const source = completeDurationNote('Mystery').replace('kind: duration', `kind: ${value}`)
      const result = migrate(source, { name: 'Mystery', registry: createRegistry([]) })
      expect(result.unknownKind).toBe(false)
    }
    for (const value of rejected) {
      const source = completeDurationNote('Mystery').replace('kind: duration', `kind: ${value}`)
      const result = migrate(source, { name: 'Mystery', registry: createRegistry([]) })
      expect(result.unknownKind).toBe(true)
      expect(result.status).toBe('unknown')
    }
    const missing = migrate(completeDurationNote('Mystery').replace('kind: duration\n', ''), {
      name: 'Mystery',
      registry: createRegistry([]),
    })
    expect(missing.unknownKind).toBe(true)
    expect(missing.status).toBe('unknown')
  })

  it('adds missing type to existing frontmatter', () => {
    const source = `---
kind: duration
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Notes
`
    const result = migrate(source, { name: 'Plank' })

    expect(result.markdown).toContain(`---
type: exercise
kind: duration
---`)
  })

  it('adds missing kind from the registry and metric for strength notes', () => {
    const source = `---
type: exercise
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Notes
`
    const result = migrate(source)

    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: kg
---`)
  })

  it('adds default e1rm metric to existing strength frontmatter when missing', () => {
    const source = `---
type: exercise
kind: strength
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Notes
`
    const result = migrate(source)

    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: kg
---`)
  })

  it('adds a one-rung ladder to existing bodyweight frontmatter when missing', () => {
    const source = completeBodyweightNote('Mystery').replace('levels:\n  - Mystery\n', '')
    const result = migrate(source, { name: 'Mystery', registry: createRegistry([]) })
    const second = migrate(result.markdown, { name: 'Mystery', registry: createRegistry([]) })

    expect(result.status).toBe('updated')
    expect(result.markdown).toContain(`type: exercise
kind: bodyweight
levels:
  - Mystery
---`)
    expect(extractDataviewBlockAfter(result.markdown, 'Recent sessions')).toBe(
      BODYWEIGHT_RECENT_SESSIONS_BLOCK,
    )
    expect(second.markdown).toBe(result.markdown)
  })

  it('leaves a note carrying a good ladder byte-identical', () => {
    const source = completeBodyweightNote('Mystery')
    const result = migrate(source, { name: 'Mystery', registry: createRegistry([]) })

    expect(result.status).toBe('already')
    expect(result.changed).toBe(false)
    expect(result.markdown).toBe(source)
    expect(extractDataviewBlockAfter(result.markdown, 'Recent sessions')).toBe(
      BODYWEIGHT_RECENT_SESSIONS_BLOCK,
    )
  })

  it('drops stray metric and unit lines from a bodyweight note', () => {
    const source = completeBodyweightNote('Mystery').replace(
      'kind: bodyweight\n',
      'kind: bodyweight\nmetric: e1rm\nunit: kg\n',
    )
    const result = migrate(source, { name: 'Mystery', registry: createRegistry([]) })
    const second = migrate(result.markdown, { name: 'Mystery', registry: createRegistry([]) })

    expect(result.markdown).not.toContain('metric:')
    expect(result.markdown).not.toContain('unit:')
    expect(result.markdown).toContain('levels:\n  - Mystery\n')
    expect(extractDataviewBlockAfter(result.markdown, 'Recent sessions')).toBe(
      BODYWEIGHT_RECENT_SESSIONS_BLOCK,
    )
    expect(second.markdown).toBe(result.markdown)
  })

  it('seeds missing frontmatter with a named ladder for a bodyweight registry entry', () => {
    const source = `Existing prose.

## Notes

Keep this.
`
    const bodyweightRegistry = createRegistry([
      { name: 'Push-up', kind: 'bodyweight', aliases: [] },
    ])
    const result = migrate(source, { name: 'Push-up', registry: bodyweightRegistry })

    expect(result.markdown).toContain(`type: exercise
kind: bodyweight
levels:
  - Push-up
---`)
    expect(result.markdown).not.toContain('metric:')
    expect(result.markdown).not.toContain('unit:')
  })

  it('repairs invalid kind frontmatter from the registry', () => {
    const source = `---
type: exercise
kind: cardio
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Notes
`
    const result = migrate(source)

    expect(result.status).toBe('updated')
    expect(result.unknownKind).toBe(false)
    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: kg
---`)
    expect(result.markdown).toContain(buildRecentSessionsBlock('Squat', 'strength', 'Fitness'))
  })

  it('preserves stale valid kind frontmatter and warns when the registry differs', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
unit: kg
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Recent sessions

${buildRecentSessionsBlock('Plank', 'strength', 'Fitness')}

## Notes

${buildNotesBlock('Plank', 'Fitness')}
`
    const result = migrate(source, { name: 'Plank' })

    expect(result.status).toBe('already')
    expect(result.unknownKind).toBe(false)
    expect(result.changed).toBe(false)
    expect(result.warnings).toContainEqual({
      kind: 'registry-kind-conflict',
      noteKind: 'strength',
      registryKind: 'duration',
    })
    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: kg
---`)
    expect(result.markdown).toContain(buildRecentSessionsBlock('Plank', 'strength', 'Fitness'))
    expect(result.markdown).toContain('WHERE L.exercise = link("Plank") AND L.set')
  })

  it('preserves valid strength unit frontmatter when a duration registry entry conflicts', () => {
    const source = completeStrengthNoteFor('Plank', 'lbs')
    const durationRegistry = createRegistry([
      { name: 'Plank', kind: 'duration', unit: 'kg', aliases: [] },
    ])

    const result = migrate(source, { name: 'Plank', registry: durationRegistry })
    const second = migrate(result.markdown, { name: 'Plank', registry: durationRegistry })

    expect(result.status).toBe('already')
    expect(result.changed).toBe(false)
    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: lbs
---`)
    expect(result.markdown).not.toContain('unit: kg')
    expect(result.warnings).toContainEqual({
      kind: 'registry-kind-conflict',
      noteKind: 'strength',
      registryKind: 'duration',
    })
    expect(second.markdown).toBe(result.markdown)
  })

  it('repairs a strength metric that belongs to another kind', () => {
    const source = completeStrengthNote().replace('metric: e1rm', 'metric: level')

    const result = migrate(source)

    expect(result.status).toBe('updated')
    expect(result.markdown).toContain('metric: e1rm')
    expect(result.markdown).not.toContain('metric: level')
  })

  it('leaves an existing metric key unchanged', () => {
    const source = completeStrengthNote().replace('metric: e1rm', 'metric: weight')

    expect(migrate(source).markdown).toBe(source)
  })

  it('adds missing strength unit from the registry and stays idempotent', () => {
    const source = completeStrengthNote().replace('unit: kg\n', '')
    const lbsRegistry = createRegistry([
      { name: 'Squat', kind: 'strength', unit: 'lbs', aliases: [] },
    ])

    const result = migrate(source, { registry: lbsRegistry })
    const second = migrate(result.markdown, { registry: lbsRegistry })

    expect(result.status).toBe('updated')
    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: lbs
---`)
    expect(second.markdown).toBe(result.markdown)
  })

  it('never overwrites valid strength unit frontmatter from the registry, and stays idempotent', () => {
    const source = completeStrengthNote()
    const lbsRegistry = createRegistry([
      { name: 'Squat', kind: 'strength', unit: 'lbs', aliases: [] },
    ])

    const result = migrate(source, { registry: lbsRegistry })
    const second = migrate(result.markdown, { registry: lbsRegistry })

    expect(result.status).toBe('already')
    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: kg
---`)
    expect(result.markdown).not.toContain('unit: lbs')
    expect(second.markdown).toBe(result.markdown)
  })

  it('leaves a valid strength unit frontmatter alone even with a differing registry entry', () => {
    const source = completeStrengthNoteFor('Bench', 'kg')
    const benchRegistry = createRegistry([
      { name: 'Bench', kind: 'strength', unit: 'lbs', aliases: [] },
    ])

    const result = migrate(source, { name: 'Bench', registry: benchRegistry })

    expect(result.status).toBe('already')
    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: kg
---`)
    expect(result.markdown).not.toContain('unit: lbs')
  })

  it('preserves valid strength unit frontmatter without a registry match and stays idempotent', () => {
    const source = completeStrengthNoteFor('Plank Press', 'lbs')
    const emptyRegistry = createRegistry([])

    const result = migrate(source, { name: 'Plank Press', registry: emptyRegistry })
    const second = migrate(result.markdown, { name: 'Plank Press', registry: emptyRegistry })

    expect(result.status).toBe('already')
    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: lbs
---`)
    expect(result.markdown).not.toContain('unit: kg')
    expect(second.status).toBe('already')
    expect(second.markdown).toBe(result.markdown)
  })

  it('repairs invalid strength unit frontmatter to kg without a registry match and stays idempotent', () => {
    const source = completeStrengthNoteFor('Plank Press', 'stone')
    const emptyRegistry = createRegistry([])

    const result = migrate(source, { name: 'Plank Press', registry: emptyRegistry })
    const second = migrate(result.markdown, { name: 'Plank Press', registry: emptyRegistry })

    expect(result.status).toBe('updated')
    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: kg
---`)
    expect(result.markdown).not.toContain('unit: stone')
    expect(second.status).toBe('already')
    expect(second.markdown).toBe(result.markdown)
  })

  it('adds missing strength unit as kg without a registry match and stays idempotent', () => {
    const source = completeStrengthNoteFor('Plank Press').replace('unit: kg\n', '')
    const emptyRegistry = createRegistry([])

    const result = migrate(source, { name: 'Plank Press', registry: emptyRegistry })
    const second = migrate(result.markdown, { name: 'Plank Press', registry: emptyRegistry })

    expect(result.status).toBe('updated')
    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: kg
---`)
    expect(second.status).toBe('already')
    expect(second.markdown).toBe(result.markdown)
  })

  it('repairs invalid strength unit frontmatter to kg', () => {
    const source = completeStrengthNote().replace('unit: kg', 'unit: stone')

    const result = migrate(source)

    expect(result.status).toBe('updated')
    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: kg
---`)
  })

  it('repairs invalid strength unit frontmatter from the registry unit', () => {
    const source = completeStrengthNote().replace('unit: kg', 'unit: stone')
    const lbsRegistry = createRegistry([
      { name: 'Squat', kind: 'strength', unit: 'lbs', aliases: [] },
    ])

    const result = migrate(source, { registry: lbsRegistry })

    expect(result.status).toBe('updated')
    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: lbs
---`)
  })

  it('repairs invalid strength metric frontmatter to the default', () => {
    const source = completeStrengthNote().replace('metric: e1rm', 'metric: pace')

    const result = migrate(source)

    expect(result.status).toBe('updated')
    expect(result.markdown).toContain(`type: exercise
kind: strength
metric: e1rm
unit: kg
---`)
  })

  it('does not add metric frontmatter for duration exercise notes', () => {
    const source = `---
type: exercise
kind: duration
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Recent sessions

${buildRecentSessionsBlock('Plank', 'duration', 'Fitness')}

## Notes

${buildNotesBlock('Plank', 'Fitness')}
`

    expect(migrate(source, { name: 'Plank' }).markdown).toBe(source)
  })

  it('moves a v0 Progress chart section above Recent sessions and preserves content', () => {
    const recent = buildRecentSessionsBlock('Squat', 'strength', 'Fitness')
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Recent sessions

${recent}

## Progress chart

\`\`\`fitkit-chart
window: 12
\`\`\`

## Notes

Keep these notes.
`
    const result = migrate(source)

    expect(result.status).toBe('updated')
    expect(result.markdown.indexOf('## Progress chart')).toBeLessThan(
      result.markdown.indexOf('## Recent sessions'),
    )
    expect(result.markdown.indexOf('## Recent sessions')).toBeLessThan(
      result.markdown.indexOf('## Notes'),
    )
    expect(result.markdown).toContain(recent)
    expect(result.markdown).toContain('window: 12')
    expect(result.markdown).toContain('Keep these notes.')
  })

  it('inserts a missing Progress chart section above Recent sessions', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Recent sessions

${buildRecentSessionsBlock('Squat', 'strength', 'Fitness')}

## Notes

\`\`\`dataview
TABLE
\`\`\`
`
    const result = migrate(source)

    expect(result.markdown).toContain('## Progress chart')
    expect(result.markdown).toContain('```fitkit-chart\n```')
    expect(result.markdown.indexOf('## Progress chart')).toBeLessThan(
      result.markdown.indexOf('## Recent sessions'),
    )
    expect(result.markdown.indexOf('## Recent sessions')).toBeLessThan(
      result.markdown.indexOf('## Notes'),
    )
  })

  it('inserts a missing Progress chart section above Recent sessions when Notes is missing', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Recent sessions

${buildRecentSessionsBlock('Squat', 'strength', 'Fitness')}
`
    const result = migrate(source)

    expect(result.markdown).toContain('## Progress chart')
    expect(result.markdown).toContain('```fitkit-chart\n```')
    expect(result.markdown.indexOf('## Progress chart')).toBeLessThan(
      result.markdown.indexOf('## Recent sessions'),
    )
    expect(result.markdown.endsWith('\n')).toBe(true)
  })

  it('inserts a chart block even when a dataview fence precedes the insertion point', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Recent sessions

${buildRecentSessionsBlock('Squat', 'strength', 'Fitness')}

## Notes

\`\`\`dataview
TABLE WITHOUT ID
  file.link AS Workout
FROM "Fitness/Workouts"
\`\`\`
`
    const result = migrate(source)

    expect(result.markdown).toContain('## Progress chart')
    expect(result.markdown.indexOf('## Progress chart')).toBeLessThan(
      result.markdown.indexOf('## Recent sessions'),
    )
    expect(result.markdown.indexOf('## Recent sessions')).toBeLessThan(
      result.markdown.indexOf('## Notes'),
    )
  })

  it('returns the source unchanged when it already matches the current template', () => {
    const source = completeStrengthNote()

    expect(migrate(source).markdown).toBe(source)
    expect(migrate(source).changed).toBe(false)
    expect(migrate(source).status).toBe('already')
  })

  it('treats a fitkit-chart string inside another fenced block as missing', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Recent sessions

${buildRecentSessionsBlock('Squat', 'strength', 'Fitness')}

\`\`\`text
\`\`\`fitkit-chart
\`\`\`
\`\`\`

## Notes
`
    const result = migrate(source)

    expect(result.markdown).not.toBe(source)
    expect(result.markdown).toContain('## Progress chart')
  })

  it('does not recognise indented fences as chart blocks', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Recent sessions

${buildRecentSessionsBlock('Squat', 'strength', 'Fitness')}

   \`\`\`fitkit-chart
   \`\`\`

## Notes
`
    const result = migrate(source)

    expect(result.markdown).not.toBe(source)
    expect(result.markdown).toContain('## Progress chart')
  })

  it('recognises 4-backtick chart fences', () => {
    const source = completeStrengthNote().replace('```fitkit-chart\n```', '````fitkit-chart\n````')

    expect(migrate(source).markdown).toBe(source)
  })

  it('does not match ### Notes when looking for the Notes heading', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Recent sessions

${buildRecentSessionsBlock('Squat', 'strength', 'Fitness')}

### Notes

something
`
    const result = migrate(source)
    const progressIndex = result.markdown.indexOf('## Progress chart')
    const recentIndex = result.markdown.indexOf('## Recent sessions')
    const subNotesIndex = result.markdown.indexOf('### Notes')
    const notesIndex = result.markdown.indexOf('\n## Notes')

    expect(progressIndex).toBeLessThan(recentIndex)
    expect(notesIndex).toBeGreaterThan(subNotesIndex)
    expect(result.markdown).toContain('## Notes')
  })

  it('appends a missing Notes heading with the canonical dataview block', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
unit: kg
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Recent sessions

${buildRecentSessionsBlock('Squat', 'strength', 'Fitness')}
`
    const result = migrate(source)
    const canonicalNotes = buildNotesBlock('Squat', 'Fitness')

    expect(result.status).toBe('updated')
    expect(result.markdown.endsWith(`## Notes\n\n${canonicalNotes}\n`)).toBe(true)
    expect(extractDataviewBlockAfter(result.markdown, 'Notes')).toBe(canonicalNotes)
  })

  it('inserts the canonical Notes block under an empty Notes heading', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Recent sessions

${buildRecentSessionsBlock('Squat', 'strength', 'Fitness')}

## Notes
`
    const result = migrate(source)
    const canonicalNotes = buildNotesBlock('Squat', 'Fitness')

    expect(result.status).toBe('updated')
    expect(result.markdown).toContain(`## Notes\n\n${canonicalNotes}\n`)
    expect(extractDataviewBlockAfter(result.markdown, 'Notes')).toBe(canonicalNotes)
  })

  it('leaves a canonical Notes block unchanged', () => {
    const source = completeStrengthNote()
    const once = migrate(source)
    const twice = migrate(once.markdown)

    expect(once.markdown).toBe(source)
    expect(once.changed).toBe(false)
    expect(once.status).toBe('already')
    expect(once.warnings).toEqual([])
    expect(twice.markdown).toBe(source)
    expect(twice.changed).toBe(false)
    expect(twice.status).toBe('already')
  })

  it('preserves prose under Notes and emits a custom Notes warning', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
unit: kg
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Recent sessions

${buildRecentSessionsBlock('Squat', 'strength', 'Fitness')}

## Notes

Keep these notes.
`
    const result = migrate(source)

    expect(result.markdown).toBe(source)
    expect(result.changed).toBe(false)
    expect(result.warnings).toEqual([{ kind: 'custom-notes-section' }])
  })

  it('preserves non-canonical Notes dataview and emits a custom Notes warning', () => {
    const customNotes = `\`\`\`dataview
TABLE file.link
FROM "Fitness/Workouts"
WHERE contains(file.outlinks, [[Squat]])
\`\`\``
    const source = completeStrengthNote(
      buildRecentSessionsBlock('Squat', 'strength', 'Fitness'),
      customNotes,
    )
    const result = migrate(source)

    expect(result.markdown).toBe(source)
    expect(result.changed).toBe(false)
    expect(result.warnings).toEqual([{ kind: 'custom-notes-section' }])
  })

  it('inserts a missing Recent sessions section after the chart and before Notes', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Notes
`
    const result = migrate(source)

    expect(result.markdown.indexOf('## Progress chart')).toBeLessThan(
      result.markdown.indexOf('## Recent sessions'),
    )
    expect(result.markdown.indexOf('## Recent sessions')).toBeLessThan(
      result.markdown.indexOf('## Notes'),
    )
    expect(result.markdown).toContain(buildRecentSessionsBlock('Squat', 'strength', 'Fitness'))
  })

  it('inserts a Recent sessions dataview block after an empty heading', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Recent sessions

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Notes
`
    const result = migrate(source)

    expect(result.markdown).toContain(`## Recent sessions

${buildRecentSessionsBlock('Squat', 'strength', 'Fitness')}

## Notes`)
    expect(result.markdown.indexOf('## Progress chart')).toBeLessThan(
      result.markdown.indexOf('## Recent sessions'),
    )
  })

  it('replaces a stale Recent sessions FROM path without touching surrounding prose', () => {
    const staleRecent = buildRecentSessionsBlock('Squat', 'strength', 'Area/Fitness')
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Recent sessions

Pinned explanation.

${staleRecent}

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Notes
`
    const result = migrate(source)

    expect(result.markdown).toContain('Pinned explanation.')
    expect(result.markdown).toContain(buildRecentSessionsBlock('Squat', 'strength', 'Fitness'))
    expect(result.markdown).not.toContain('FROM "Area/Fitness/Workouts"')
  })

  it('replaces a stale Recent sessions link target', () => {
    const staleRecent = buildRecentSessionsBlock('Back Squat', 'strength', 'Fitness')
    const source = completeStrengthNote(staleRecent)
    const result = migrate(source)

    expect(result.markdown).toContain('WHERE L.exercise = link("Squat") AND L.set')
    expect(result.markdown).not.toContain('WHERE L.exercise = link("Back Squat") AND L.set')
  })

  it('keeps a current Recent sessions FROM path unchanged', () => {
    const source = completeStrengthNote()

    expect(migrate(source).markdown).toBe(source)
  })

  it('replaces a stale Notes link target left over from a rename, without warning', () => {
    const staleNotes = buildNotesBlock('Back Squat', 'Fitness')
    const source = completeStrengthNote(undefined, staleNotes)
    const result = migrate(source)

    expect(result.markdown).toContain('WHERE L.exercise = link("Squat") AND L.notes')
    expect(result.markdown).not.toContain('WHERE L.exercise = link("Back Squat") AND L.notes')
    expect(result.warnings).toEqual([])
  })

  it('leaves customised Recent sessions dataview blocks alone', () => {
    const customRecent = `\`\`\`dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps,
  L.e1rm AS E1RM
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Squat") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
\`\`\``
    const source = completeStrengthNote(customRecent)
    const result = migrate(source)

    expect(result.markdown).toBe(source)
    expect(result.warnings).toEqual([{ kind: 'custom-recent-sessions' }])
  })

  it('rewrites a Recent sessions block left over from a kind switch without warning', () => {
    const staleRecent = buildRecentSessionsBlock('Squat', 'duration', 'Fitness')
    const source = completeStrengthNote(staleRecent)
    const result = migrate(source)

    expect(result.markdown).toContain(buildRecentSessionsBlock('Squat', 'strength', 'Fitness'))
    expect(result.markdown).not.toContain(staleRecent)
    expect(result.warnings).toEqual([])
  })

  it('rewrites a strength-shaped Recent sessions block on a duration note without warning', () => {
    const staleRecent = buildRecentSessionsBlock('Plank', 'strength', 'Fitness')
    const source = completeDurationNote('Plank', staleRecent)
    const result = migrate(source, { name: 'Plank' })

    expect(result.markdown).toContain(buildRecentSessionsBlock('Plank', 'duration', 'Fitness'))
    expect(result.markdown).not.toContain(staleRecent)
    expect(result.warnings).toEqual([])
  })

  it('is idempotent on a repaired note', () => {
    const source = `---
type: exercise
---

## Recent sessions

\`\`\`dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Area/Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Squat") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
\`\`\`

## Notes
`
    const once = migrate(source).markdown
    const twice = migrate(once).markdown

    expect(twice).toBe(once)
  })

  it('preserves the original trailing newline when inserting before existing content', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Notes
`
    expect(migrate(source).markdown.endsWith('\n')).toBe(true)
  })

  it('preserves the original trailing newline absence when content follows the insertion', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Notes`
    expect(migrate(source).markdown.endsWith('\n')).toBe(false)
  })

  it('preserves frontmatter byte-for-byte when no frontmatter repair is needed', () => {
    const source = `---
type: exercise
kind: duration
foo: bar
---

## Recent sessions

${buildRecentSessionsBlock('Plank', 'duration', 'Fitness')}

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Notes
`
    const result = migrate(source, { name: 'Plank' })
    const frontmatterEnd = result.markdown.indexOf('---', 4) + 3

    expect(result.markdown.slice(0, frontmatterEnd)).toBe(
      source.slice(0, source.indexOf('---', 4) + 3),
    )
  })

  it('recognises CRLF frontmatter and preserves CRLF in migrated output', () => {
    const source = [
      '---',
      'type: exercise',
      'kind: strength',
      'metric: e1rm',
      '---',
      '',
      'Existing notes.',
    ].join('\r\n')

    const result = migrate(source)

    expect(result.status).toBe('updated')
    expect(frontmatterMarkerCount(result.markdown)).toBe(2)
    expect(leadingFrontmatterLines(result.markdown)).toEqual([
      'type: exercise',
      'kind: strength',
      'metric: e1rm',
      'unit: kg',
    ])
    expect(result.markdown.replace(/\r\n/g, '')).not.toContain('\n')
    expect(result.markdown.startsWith('---\r\ntype: exercise')).toBe(true)
    expect(result.markdown).toContain('## Progress chart')
    const second = migrate(result.markdown)
    expect(second.status).toBe('already')
    expect(second.markdown).toBe(result.markdown)
  })

  it('seeds an empty Notes section in a CRLF note without changing line endings', () => {
    const source = [
      '---',
      'type: exercise',
      'kind: strength',
      'metric: e1rm',
      '---',
      '',
      '## Progress chart',
      '',
      '```fitkit-chart',
      '```',
      '',
      '## Recent sessions',
      '',
      withLineEnding(buildRecentSessionsBlock('Squat', 'strength', 'Fitness'), '\r\n'),
      '',
      '## Notes',
      '',
    ].join('\r\n')
    const result = migrate(source)
    const canonicalNotes = withLineEnding(buildNotesBlock('Squat', 'Fitness'), '\r\n')

    expect(result.status).toBe('updated')
    expect(result.markdown.replace(/\r\n/g, '')).not.toContain('\n')
    expect(result.markdown).not.toContain('\r\r\n')
    expect(result.markdown).toContain(`## Notes\r\n\r\n${canonicalNotes}\r\n`)
    expect(extractDataviewBlockAfter(result.markdown, 'Notes')).toBe(canonicalNotes)

    const second = migrate(result.markdown)
    expect(second.status).toBe('already')
    expect(second.changed).toBe(false)
    expect(second.markdown).toBe(result.markdown)
  })

  it('recognises BOM-prefixed frontmatter and preserves the BOM', () => {
    const source = `\ufeff---
type: exercise
kind: strength
metric: e1rm
---

Existing notes.
`

    const result = migrate(source)

    expect(result.status).toBe('updated')
    expect(result.markdown.startsWith('\ufeff---\n')).toBe(true)
    expect(frontmatterMarkerCount(result.markdown)).toBe(2)
    expect(leadingFrontmatterLines(result.markdown)).toEqual([
      'type: exercise',
      'kind: strength',
      'metric: e1rm',
      'unit: kg',
    ])
    expect(result.markdown).toContain('## Progress chart')
    const second = migrate(result.markdown)
    expect(second.status).toBe('already')
    expect(second.markdown).toBe(result.markdown)
  })

  it('skips malformed frontmatter without changing the file content', () => {
    const source = `---
type: exercise
kind: strength

Existing notes.
`

    const result = migrate(source)

    expect(result.status).toBe('skipped-malformed-frontmatter')
    expect(result.changed).toBe(false)
    expect(result.markdown).toBe(source)
    const second = migrate(result.markdown)
    expect(second.status).toBe('skipped-malformed-frontmatter')
    expect(second.markdown).toBe(source)
  })
})

describe('setExerciseNoteKind', () => {
  it('drops metric and unit lines when switching to bodyweight', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
unit: kg
---

Body.
`

    const result = setExerciseNoteKind(source, 'bodyweight')

    expect(result.changed).toBe(true)
    expect(result.markdown).toContain('kind: bodyweight')
    expect(result.markdown).not.toContain('metric:')
    expect(result.markdown).not.toContain('unit:')
  })

  it('keeps an existing ladder when switching to bodyweight', () => {
    const source = `---
type: exercise
kind: duration
levels:
  - Tuck
---

Body.
`

    const result = setExerciseNoteKind(source, 'bodyweight')

    expect(result.changed).toBe(true)
    expect(result.markdown).toContain('kind: bodyweight')
    expect(result.markdown).toContain('levels:')
    expect(result.markdown).toContain('  - Tuck')
  })
  it('replaces an existing kind line', () => {
    const source = `---
type: exercise
kind: duration
---

Body.
`

    const result = setExerciseNoteKind(source, 'strength')

    expect(result.changed).toBe(true)
    expect(result.markdown).toContain('kind: strength')
    expect(result.markdown).not.toContain('kind: duration')
  })

  it('inserts a kind line when the note has none', () => {
    const source = `---
type: exercise
---

Body.
`

    const result = setExerciseNoteKind(source, 'duration')

    expect(result.changed).toBe(true)
    expect(result.markdown).toBe(`---
type: exercise
kind: duration
---

Body.
`)
  })

  it('is a no-op when the note already records the target kind', () => {
    const source = `---
type: exercise
kind: strength
---

Body.
`

    const result = setExerciseNoteKind(source, 'strength')

    expect(result.changed).toBe(false)
    expect(result.markdown).toBe(source)
  })

  it('leaves notes with no frontmatter block untouched', () => {
    const source = 'Body with no frontmatter.\n'

    const result = setExerciseNoteKind(source, 'strength')

    expect(result.changed).toBe(false)
    expect(result.markdown).toBe(source)
  })
})

describe('setExerciseNoteLevels', () => {
  it('replaces an existing ladder with the edited rungs', () => {
    const source = `---
type: exercise
kind: bodyweight
levels:
  - Wall push-up
  - Knee push-up
---

Body.
`

    const result = setExerciseNoteLevels(source, ['Incline push-up', 'Full push-up'])

    expect(result.changed).toBe(true)
    expect(result.markdown).toBe(`---
type: exercise
kind: bodyweight
levels:
  - Incline push-up
  - Full push-up
---

Body.
`)
  })

  it('inserts a ladder after the kind line when the note has none', () => {
    const source = `---
type: exercise
kind: bodyweight
---

Body.
`

    const result = setExerciseNoteLevels(source, ['Wall push-up'])

    expect(result.changed).toBe(true)
    expect(result.markdown).toBe(`---
type: exercise
kind: bodyweight
levels:
  - Wall push-up
---

Body.
`)
  })

  it('leaves notes with no frontmatter block untouched', () => {
    const source = 'Body with no frontmatter.\n'

    const result = setExerciseNoteLevels(source, ['Wall push-up'])

    expect(result.changed).toBe(false)
    expect(result.markdown).toBe(source)
  })

  it('is a no-op when the ladder already matches', () => {
    const source = `---
type: exercise
kind: bodyweight
levels:
  - Wall push-up
---

Body.
`

    const result = setExerciseNoteLevels(source, ['Wall push-up'])

    expect(result.changed).toBe(false)
    expect(result.markdown).toBe(source)
  })
})
