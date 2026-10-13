/**
 * Usage: STABLE=1.8.0 LABELS=beta,minor TAGS="$(git tag --list)" node scripts/beta-version.ts
 *
 * Prints the version for the next BRAT beta of a PR, or exits 1 with the reason.
 */

import { pathToFileURL } from 'node:url'

export type BetaVersionResult = { ok: true; version: string } | { ok: false; reason: string }

type Bump = 'major' | 'minor' | 'patch'

function bumpVersion(stable: string, bump: Bump): string {
  const [major = 0, minor = 0, patch = 0] = stable.split('.').map(Number)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/** Picks the next `X.Y.Z-beta.N` for a PR, using release.yml's label priority for the bump. */
export function betaVersion(
  stable: string,
  labels: readonly string[],
  tags: readonly string[],
): BetaVersionResult {
  const bump = (['major', 'minor', 'patch'] as const).find((b) => labels.includes(b))
  if (!bump) {
    return {
      ok: false,
      reason: 'A beta needs one of the major, minor or patch labels to pick its version.',
    }
  }
  const target = bumpVersion(stable, bump)
  const prefix = `${target}-beta.`
  const published = tags
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => Number(tag.slice(prefix.length)))
    .filter(Number.isInteger)
  return { ok: true, version: `${prefix}${Math.max(0, ...published) + 1}` }
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
