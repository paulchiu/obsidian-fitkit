import { describe, expect, it } from 'vitest'
import { betaVersion } from '../../scripts/beta-version'

describe('betaVersion', () => {
  it('starts a minor beta at beta.1 of the next minor version', () => {
    expect(betaVersion('1.8.0', ['beta', 'minor'], ['1.7.0', '1.8.0'])).toEqual({
      ok: true,
      version: '1.9.0-beta.1',
    })
  })

  it('continues numbering after betas already published for the same target', () => {
    const tags = ['1.8.0', '1.9.0-beta.1', '1.9.0-beta.2', '1.9.0-beta.10', '1.8.1-beta.4']
    expect(betaVersion('1.8.0', ['minor', 'beta'], tags)).toEqual({
      ok: true,
      version: '1.9.0-beta.11',
    })
  })

  it('refuses a beta without a semver label and names the labels to add', () => {
    expect(betaVersion('1.8.0', ['beta', 'norelease'], [])).toEqual({
      ok: false,
      reason: 'A beta needs one of the major, minor or patch labels to pick its version.',
    })
  })
})
