import { describe, expect, it } from 'vitest'

import { createRegistry } from '../../src/domain/exercise-registry'
import { migrateExerciseNote } from '../../src/domain/exercise-note-migrate'
import { buildNotesBlock, buildRecentSessionsBlock } from '../../src/domain/exercise-note-template'

const registry = createRegistry([{ name: 'Squat', kind: 'strength', unit: 'kg', aliases: [] }])

function migrate(source: string): ReturnType<typeof migrateExerciseNote> {
  return migrateExerciseNote(source, { name: 'Squat', registry, fitnessRoot: 'Fitness' })
}

const FRONTMATTER = `---
type: exercise
kind: strength
metric: e1rm
unit: kg
---`

describe('migrateExerciseNote fenced block detection', () => {
  it('finds the Recent sessions query after an unrelated fenced example', () => {
    const source = `${FRONTMATTER}

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Recent sessions

\`\`\`text
an example
\`\`\`

${buildRecentSessionsBlock('Squat', 'strength', 'Fitness')}

## Notes

${buildNotesBlock('Squat', 'Fitness')}
`

    const result = migrate(source)

    expect(result.status).toBe('already')
    expect(result.markdown).toBe(source)
    expect(result.warnings).toEqual([])
  })

  it('finds the chart block after an unrelated fenced example in Progress chart', () => {
    const source = `${FRONTMATTER}

## Progress chart

\`\`\`text
an example
\`\`\`

\`\`\`fitkit-chart
\`\`\`

## Recent sessions

${buildRecentSessionsBlock('Squat', 'strength', 'Fitness')}

## Notes

${buildNotesBlock('Squat', 'Fitness')}
`

    const result = migrate(source)

    expect(result.status).toBe('already')
    expect(result.markdown).toBe(source)
  })

  it('treats an unclosed Recent sessions query as missing and inserts the canonical one', () => {
    const source = `${FRONTMATTER}

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Recent sessions

\`\`\`dataview
TABLE file.link
`

    const result = migrate(source)

    expect(result.markdown).toBe(`${FRONTMATTER}

## Progress chart

\`\`\`fitkit-chart
\`\`\`

## Recent sessions

\`\`\`dataview
TABLE WITHOUT ID
  file.link AS Workout,
  L.set AS Set,
  L.weight AS Weight,
  L.reps AS Reps
FROM "Fitness/Workouts"
FLATTEN file.lists AS L
WHERE L.exercise = link("Squat") AND L.set
SORT file.name DESC, L.set ASC
LIMIT 10
\`\`\`

\`\`\`dataview
TABLE file.link

## Notes

${buildNotesBlock('Squat', 'Fitness')}
`)
  })
})
