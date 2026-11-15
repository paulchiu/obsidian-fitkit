/**
 * Usage: LABELS=dependencies,patch,norelease node scripts/release-bump.ts
 *
 * Prints the bump that merging a PR with these labels releases: `major`, `minor`, `patch` or `norelease`.
 */

import { pathToFileURL } from 'node:url'

/** Largest first, so a PR carrying several semver labels releases at the biggest. */
export const SEMVER_BUMPS = ['major', 'minor', 'patch'] as const

export type ReleaseBump = (typeof SEMVER_BUMPS)[number] | 'norelease'

/** `norelease` wins over any semver label, since Dependabot adds it beside its own semver label on every PR. */
export function releaseBump(labels: readonly string[]): ReleaseBump {
  if (labels.includes('norelease')) return 'norelease'
  return SEMVER_BUMPS.find((bump) => labels.includes(bump)) ?? 'norelease'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${releaseBump((process.env.LABELS ?? '').split(','))}\n`)
}
