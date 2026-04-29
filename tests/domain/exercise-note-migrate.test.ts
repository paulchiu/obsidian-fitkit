import { describe, expect, it } from 'vitest'

import { createRegistry, type ExerciseRegistry } from '../../src/domain/exercise-registry'
import { migrateExerciseNote } from '../../src/domain/exercise-note-migrate'
import { buildNotesBlock, buildRecentSessionsBlock } from '../../src/domain/exercise-note-template'

const registry = createRegistry([
  { name: 'Squat', kind: 'strength', aliases: [] },
  { name: 'Plank', kind: 'duration', aliases: [] },
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

  it('omits kind, metric, and Recent sessions when the registry has no kind', () => {
    const source = `Loose exercise note.
`
    const result = migrate(source, { name: 'Mystery', registry: createRegistry([]) })

    expect(result.status).toBe('unknown')
    expect(result.unknownKind).toBe(true)
    expect(result.markdown).toContain(`---
type: exercise
---`)
    expect(result.markdown).not.toContain('kind:')
    expect(result.markdown).not.toContain('metric:')
    expect(result.markdown).not.toContain('## Recent sessions')
    expect(result.markdown).toContain('## Progress chart')
    expect(result.markdown).toContain('## Notes')
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
---`)
  })

  it('leaves an existing metric key unchanged', () => {
    const source = completeStrengthNote().replace('metric: e1rm', 'metric: weight')

    expect(migrate(source).markdown).toBe(source)
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
