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

  it('takes the largest semver label when several are present, as the stable release does', () => {
    expect(betaVersion('1.8.3', ['patch', 'beta', 'major'], [])).toEqual({
      ok: true,
      version: '2.0.0-beta.1',
    })
  })

  it('bumps only the patch number for a patch beta', () => {
    expect(betaVersion('1.8.3', ['patch', 'beta'], [])).toEqual({
      ok: true,
      version: '1.8.4-beta.1',
    })
  })

  it('ignores tags whose beta number is not a plain integer', () => {
    const tags = [
      '1.9.0-beta.2',
      '1.9.0-beta.0x10',
      '1.9.0-beta.1e3',
      'v1.9.0-beta.7',
      '1.9.0-rc.5',
    ]
    expect(betaVersion('1.8.0', ['minor', 'beta'], tags)).toEqual({
      ok: true,
      version: '1.9.0-beta.3',
    })
  })

  it('refuses a stable version that is not X.Y.Z', () => {
    expect(betaVersion('', ['minor', 'beta'], [])).toEqual({
      ok: false,
      reason: 'Expected main to be on a plain X.Y.Z version, found "".',
    })
  })
})
