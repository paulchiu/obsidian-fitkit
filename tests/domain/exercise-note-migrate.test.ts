import { describe, expect, it } from 'vitest'

import { migrateExerciseNote } from '../../src/domain/exercise-note-migrate'

describe('migrateExerciseNote', () => {
  it('inserts a Progress chart section before ## Notes', () => {
    const source = `---
type: exercise
kind: strength
---

## Recent sessions

\`\`\`dataview
TABLE
\`\`\`

## Notes

\`\`\`dataview
TABLE
\`\`\`
`
    const next = migrateExerciseNote(source)
    expect(next).toContain('## Progress chart')
    expect(next).toContain('```fitkit-chart\n```')
    expect(next.indexOf('## Progress chart')).toBeLessThan(next.indexOf('## Notes'))
  })

  it('appends Progress chart section when no ## Notes heading exists', () => {
    const source = `---
type: exercise
kind: strength
---

## Recent sessions

\`\`\`dataview
TABLE
\`\`\`
`
    const next = migrateExerciseNote(source)
    expect(next).toContain('## Progress chart')
    expect(next).toContain('```fitkit-chart\n```')
    expect(next.endsWith('\n')).toBe(true)
  })

  it('returns the source unchanged when a real fitkit-chart fence is already present', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

## Progress chart

\`\`\`fitkit-chart
window: 60
\`\`\`

## Notes
`
    expect(migrateExerciseNote(source)).toBe(source)
  })

  it('treats a fitkit-chart string inside another fenced block as missing (still inserts)', () => {
    const source = `---
type: exercise
kind: strength
---

\`\`\`text
\`\`\`fitkit-chart
\`\`\`
\`\`\`

## Notes
`
    const next = migrateExerciseNote(source)
    expect(next).not.toBe(source)
    expect(next).toContain('## Progress chart')
  })

  it('does not recognise indented fences as chart blocks', () => {
    const source = `---
type: exercise
kind: strength
---

   \`\`\`fitkit-chart
   \`\`\`

## Notes
`
    const next = migrateExerciseNote(source)
    expect(next).not.toBe(source)
    expect(next).toContain('## Progress chart')
  })

  it('recognises 4-backtick chart fences', () => {
    const source = `---
type: exercise
kind: strength
metric: e1rm
---

\`\`\`\`fitkit-chart
\`\`\`\`

## Notes
`
    expect(migrateExerciseNote(source)).toBe(source)
  })

  it('does not match ### Notes (h3) when looking for the Notes heading', () => {
    const source = `---
type: exercise
kind: strength
---

### Notes

something
`
    const next = migrateExerciseNote(source)
    const progressIndex = next.indexOf('## Progress chart')
    const subNotesIndex = next.indexOf('### Notes')
    expect(progressIndex).toBeGreaterThan(subNotesIndex)
  })

  it('is idempotent', () => {
    const source = `---
type: exercise
kind: strength
---

## Recent sessions

## Notes
`
    const once = migrateExerciseNote(source)
    const twice = migrateExerciseNote(once)
    expect(twice).toBe(once)
  })

  it('adds default e1rm metric to strength frontmatter when missing', () => {
    const source = `---
type: exercise
kind: strength
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`
`
    const next = migrateExerciseNote(source)

    expect(next).toContain(`type: exercise
kind: strength
metric: e1rm
---`)
  })

  it('leaves an existing metric key unchanged', () => {
    const source = `---
type: exercise
kind: strength
metric: weight
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`
`

    expect(migrateExerciseNote(source)).toBe(source)
  })

  it('does not add metric frontmatter for duration exercise notes', () => {
    const source = `---
type: exercise
kind: duration
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`
`

    expect(migrateExerciseNote(source)).toBe(source)
  })

  it('does not add metric frontmatter when kind is missing', () => {
    const source = `---
type: exercise
---

## Progress chart

\`\`\`fitkit-chart
\`\`\`
`

    expect(migrateExerciseNote(source)).toBe(source)
  })

  it('preserves the original trailing newline (presence)', () => {
    const source = `---
type: exercise
---

## Notes
`
    expect(migrateExerciseNote(source).endsWith('\n')).toBe(true)
  })

  it('preserves the original trailing newline (absence)', () => {
    const source = `---
type: exercise
---

## Notes`
    expect(migrateExerciseNote(source).endsWith('\n')).toBe(false)
  })

  it('preserves frontmatter byte-for-byte', () => {
    const source = `---
type: exercise
kind: duration
foo: bar
---

## Notes
`
    const next = migrateExerciseNote(source)
    const frontmatterEnd = next.indexOf('---', 4) + 3
    expect(next.slice(0, frontmatterEnd)).toBe(source.slice(0, source.indexOf('---', 4) + 3))
  })
})
