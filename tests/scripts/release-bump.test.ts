import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { releaseBump } from '../../scripts/release-bump'

describe('releaseBump', () => {
  it('releases nothing when norelease sits beside a semver label, as on Dependabot PRs', () => {
    expect(releaseBump(['dependencies', 'major', 'norelease'])).toBe('norelease')
  })

  it('releases at the largest semver label when norelease is absent', () => {
    expect(releaseBump(['patch', 'enhancement', 'minor'])).toBe('minor')
  })

  it('releases at major over the smaller semver labels beside it', () => {
    expect(releaseBump(['patch', 'major', 'minor'])).toBe('major')
  })

  it('releases at a single patch label', () => {
    expect(releaseBump(['bug', 'patch'])).toBe('patch')
  })

  it('releases nothing when the PR carries no version label', () => {
    expect(releaseBump(['bug'])).toBe('norelease')
  })

  it('prints the bump for the labels it is given, as the Release workflow reads it', () => {
    const run = (labels: string): string =>
      execFileSync(
        'node',
        [fileURLToPath(new URL('../../scripts/release-bump.ts', import.meta.url))],
        {
          env: { ...process.env, LABELS: labels },
          encoding: 'utf8',
        },
      )

    expect([run('dependencies,minor,norelease'), run('minor,bug')]).toEqual([
      'norelease\n',
      'minor\n',
    ])
  })
})
