/**
 * Usage: STABLE=1.8.0 LABELS=beta,minor TAGS="$(git tag --list)" node scripts/beta-version.ts
 *
 * Prints the version for the next BRAT beta of a PR, or exits 1 with the reason.
 */

import { pathToFileURL } from 'node:url'

import { releaseBump, SEMVER_BUMPS } from './release-bump.ts'

export type BetaVersionResult = { ok: true; version: string } | { ok: false; reason: string }

type Bump = (typeof SEMVER_BUMPS)[number]

function bumpVersion([major = 0, minor = 0, patch = 0]: number[], bump: Bump): string {
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/** Picks the next `X.Y.Z-beta.N` for a PR from main's stable version, its labels and the tags already published. */
export function betaVersion(
  stable: string,
  labels: readonly string[],
  tags: readonly string[],
): BetaVersionResult {
  if (!/^\d+\.\d+\.\d+$/.test(stable)) {
    return { ok: false, reason: `Expected main to be on a plain X.Y.Z version, found "${stable}".` }
  }
  /** A beta previews what merging releases, so it follows the Release workflow's bump. */
  const bump = releaseBump(labels)
  if (bump === 'norelease') {
    return {
      ok: false,
      reason: SEMVER_BUMPS.some((b) => labels.includes(b))
        ? 'A norelease PR never releases, so a beta has no version to take. Remove norelease to publish one.'
        : 'A beta needs one of the major, minor or patch labels to pick its version.',
    }
  }
  const prefix = `${bumpVersion(stable.split('.').map(Number), bump)}-beta.`
  const betaNumbers = tags
    .filter((tag) => tag.startsWith(prefix) && /^\d+$/.test(tag.slice(prefix.length)))
    .map((tag) => Number(tag.slice(prefix.length)))
  return { ok: true, version: `${prefix}${Math.max(0, ...betaNumbers) + 1}` }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = betaVersion(
    process.env.STABLE ?? '',
    (process.env.LABELS ?? '').split(','),
    (process.env.TAGS ?? '').split('\n'),
  )
  if (result.ok) {
    process.stdout.write(`${result.version}\n`)
  } else {
    process.stderr.write(`${result.reason}\n`)
    process.exitCode = 1
  }
}
